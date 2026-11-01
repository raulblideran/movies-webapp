using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Movies.Api.Services;

namespace Movies.Api.Tests;

public class PostcodeFindTests
{
    [Theory]
    [InlineData("12 High Street\nDoncaster\nDN1 1AA", "DN1 1AA")]
    [InlineData("12 high street, doncaster dn11aa", "DN1 1AA")]
    [InlineData("Flat 3, 1 Palace Road, London SW1A 1AA", "SW1A 1AA")]
    [InlineData("1 Piccadilly, Manchester, M1 1AE", "M1 1AE")]
    [InlineData("10 Downing St, London, SW1A2AA", "SW1A 2AA")]
    [InlineData("12 High Street, Doncaster", null)]
    [InlineData("", null)]
    public void Finds_the_postcode_in_an_address(string address, string? expected) =>
        Assert.Equal(expected, PostcodeClient.Find(address));
}

/// <summary>
/// The app with postcodes.io and CeX answered by fakes. DN1 1AA is in Doncaster, ZZ99 9ZZ doesn't exist,
/// and every product is in stock at one store. CeX's last request is kept, to check where it searched from.
/// </summary>
public class FakeGeoApp : TestApp
{
    public Uri? LastCexRequest;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.ConfigureTestServices(s =>
        {
            s.AddHttpClient<PostcodeClient>().ConfigurePrimaryHttpMessageHandler(() => new FakePostcodes());
            s.AddHttpClient<CexClient>().ConfigurePrimaryHttpMessageHandler(() => new FakeCex(this));
        });
    }

    private class FakePostcodes : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
            Task.FromResult(request.RequestUri!.AbsolutePath switch
            {
                "/postcodes/DN11AA" => Json("""{"status":200,"result":{"postcode":"DN1 1AA","latitude":53.5228,"longitude":-1.1353,"admin_district":"Doncaster"}}"""),
                "/postcodes/ZZ999ZZ" => new HttpResponseMessage(HttpStatusCode.NotFound),
                _ => new HttpResponseMessage(HttpStatusCode.InternalServerError),
            });
    }

    private class FakeCex(FakeGeoApp app) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            app.LastCexRequest = request.RequestUri;
            return Task.FromResult(Json("""{"response":{"data":{"nearestStores":[{"storeName":"Doncaster","quantityOnHand":"2","distance":1.5}]}}}"""));
        }
    }

    private static HttpResponseMessage Json(string body) =>
        new(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
}

public class AddressTests(FakeGeoApp app) : IClassFixture<FakeGeoApp>
{
    private async Task<HttpClient> SignedInAsync(string userName, string role = "Editor")
    {
        await app.CreateUserAsync(userName, "correct-horse-battery", role);
        var client = app.CreateClient();
        (await client.PostAsJsonAsync("/api/auth/login", new { userName, password = "correct-horse-battery" })).EnsureSuccessStatusCode();
        return client;
    }

    private static async Task<string?> DetailAsync(HttpResponseMessage resp) =>
        (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("detail").GetString();

    [Fact]
    public async Task Anonymous_visitors_have_no_address_or_home_stock()
    {
        var client = app.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/account/address")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PutAsJsonAsync("/api/account/address", new { address = "DN1 1AA" })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/cex/5053083202743/stores/home")).StatusCode);
    }

    [Fact]
    public async Task Saving_an_address_locates_it_by_postcode_and_the_tracker_searches_from_there()
    {
        var client = await SignedInAsync("homeowner");

        var empty = await client.GetFromJsonAsync<JsonElement>("/api/account/address");
        Assert.Equal(JsonValueKind.Null, empty.GetProperty("address").ValueKind);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/cex/5053083202743/stores/home")).StatusCode);

        var saved = await client.PutAsJsonAsync("/api/account/address", new { address = "  12 High Street\r\nDoncaster\r\ndn11aa  " });
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        var body = await saved.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("12 High Street\nDoncaster\ndn11aa", body.GetProperty("address").GetString());
        Assert.Equal("DN1 1AA", body.GetProperty("postcode").GetString());
        Assert.Equal("Doncaster", body.GetProperty("place").GetString());

        var read = await client.GetFromJsonAsync<JsonElement>("/api/account/address");
        Assert.Equal("DN1 1AA", read.GetProperty("postcode").GetString());
        Assert.False(read.TryGetProperty("latitude", out _)); // the coordinates stay on the server

        var stock = await client.GetFromJsonAsync<JsonElement>("/api/cex/5053083202743/stores/home");
        Assert.Equal("Doncaster", stock[0].GetProperty("storeName").GetString());
        Assert.Equal(1.5, stock[0].GetProperty("distanceMiles").GetDouble()); // CeX's distance is already in miles
        Assert.Contains("latitude=53.5228&longitude=-1.1353", app.LastCexRequest!.Query);

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync("/api/account/address")).StatusCode);
        var cleared = await client.GetFromJsonAsync<JsonElement>("/api/account/address");
        Assert.Equal(JsonValueKind.Null, cleared.GetProperty("postcode").ValueKind);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/cex/5053083202743/stores/home")).StatusCode);
    }

    [Theory]
    [InlineData("12 High Street, Doncaster", HttpStatusCode.BadRequest, "Include your postcode")]
    [InlineData("1 Nowhere Lane, ZZ99 9ZZ", HttpStatusCode.BadRequest, "Couldn't find the postcode ZZ99 9ZZ")]
    [InlineData("1 Somewhere Road, M1 1AE", HttpStatusCode.BadGateway, "Try again")]
    [InlineData("   ", HttpStatusCode.BadRequest, "Enter your address")]
    public async Task An_address_that_cant_be_located_is_not_saved(string address, HttpStatusCode status, string message)
    {
        var client = await SignedInAsync($"user-{Guid.NewGuid():N}");
        var resp = await client.PutAsJsonAsync("/api/account/address", new { address });
        Assert.Equal(status, resp.StatusCode);
        Assert.Contains(message, await DetailAsync(resp));
        var read = await client.GetFromJsonAsync<JsonElement>("/api/account/address");
        Assert.Equal(JsonValueKind.Null, read.GetProperty("address").ValueKind);
    }

    [Fact]
    public async Task Admins_dont_see_other_users_addresses()
    {
        var owner = await SignedInAsync("private-owner");
        (await owner.PutAsJsonAsync("/api/account/address", new { address = "12 High Street, DN1 1AA" })).EnsureSuccessStatusCode();

        await app.CreateUserAsync("address-admin", "correct-horse-battery", "Admin");
        var admin = await app.SignedInWithMfaAsync("address-admin", "correct-horse-battery");
        var users = await admin.GetStringAsync("/api/users");
        Assert.Contains("private-owner", users);
        Assert.DoesNotContain("High Street", users);
        Assert.DoesNotContain("DN1", users);
    }
}
