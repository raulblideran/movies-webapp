using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Movies.Api.Data;
using Movies.Api.Services;

namespace Movies.Api.Tests;

/// <summary>The app with other sites' pictures answered by a fake, and one editor signed in once (sign-ins are rate limited).</summary>
public class CoverApp : TestApp
{
    public static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01];
    public static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D];

    private Task<HttpClient>? _editor;
    public Task<HttpClient> EditorAsync() => _editor ??= SignInAsync();

    private async Task<HttpClient> SignInAsync()
    {
        await CreateUserAsync("covereditor", "correct-horse-battery", "Editor");
        return await SignedInWithMfaAsync("covereditor", "correct-horse-battery");
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.ConfigureTestServices(s =>
            s.AddHttpClient<CoverFetcher>().ConfigurePrimaryHttpMessageHandler(() => new FakeSite()));
    }

    /// <summary>/cover.jpg is a picture, /page.html a web page, /missing.jpg a 404.</summary>
    private class FakeSite : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
            Task.FromResult(request.RequestUri!.AbsolutePath switch
            {
                "/cover.jpg" => new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(Jpeg) },
                "/page.html" => new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("<html>a page</html>", Encoding.UTF8, "text/html") },
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            });
    }

    public async Task<int> ReleaseAsync(string name)
    {
        using var scope = Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MoviesDbContext>();
        var r = new PhysicalRelease { Name = name };
        db.Releases.Add(r);
        await db.SaveChangesAsync();
        return r.Id;
    }
}

/// <summary>Your own picture of a release: set, shown, replaced and removed; and pictures fetched from links.</summary>
public class ReleaseCoverTests(CoverApp app) : IClassFixture<CoverApp>
{
    private static ByteArrayContent Picture(byte[] data, string type = "image/jpeg")
    {
        var c = new ByteArrayContent(data);
        c.Headers.ContentType = new MediaTypeHeaderValue(type);
        return c;
    }

    private static async Task<JsonElement> OkJson(HttpResponseMessage resp)
    {
        Assert.True(resp.IsSuccessStatusCode, $"{(int)resp.StatusCode}: {await resp.Content.ReadAsStringAsync()}");
        return await resp.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static async Task<string> ErrorOf(HttpResponseMessage resp)
    {
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        return (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors").GetProperty("Cover")[0].GetString()!;
    }

    [Fact]
    public async Task A_cover_is_set_shown_replaced_and_removed()
    {
        var client = await app.EditorAsync();
        var id = await app.ReleaseAsync("This Is It steel tin");
        var anonymous = app.CreateClient();

        Assert.Equal(HttpStatusCode.NotFound, (await anonymous.GetAsync($"/api/releases/{id}/cover")).StatusCode);
        Assert.Equal(JsonValueKind.Null, (await anonymous.GetFromJsonAsync<JsonElement>($"/api/releases/{id}")).GetProperty("coverUrl").ValueKind);

        var set = await OkJson(await client.PutAsync($"/api/releases/{id}/cover", Picture(CoverApp.Jpeg)));
        var url = set.GetProperty("coverUrl").GetString()!;
        Assert.StartsWith($"/api/releases/{id}/cover?v=", url);

        // anyone sees it, cached for good (the link changes with the picture)
        var shown = await anonymous.GetAsync(url);
        Assert.Equal(HttpStatusCode.OK, shown.StatusCode);
        Assert.Equal("image/jpeg", shown.Content.Headers.ContentType!.MediaType);
        Assert.Equal(CoverApp.Jpeg, await shown.Content.ReadAsByteArrayAsync());
        Assert.Contains("immutable", shown.Headers.CacheControl!.ToString());
        var listed = (await anonymous.GetFromJsonAsync<JsonElement>("/api/releases")).EnumerateArray().Single(r => r.GetProperty("id").GetInt32() == id);
        Assert.Equal(url, listed.GetProperty("coverUrl").GetString());

        // a new picture gets a new link; the type comes from the bytes, not the header
        await Task.Delay(5);
        var replaced = await OkJson(await client.PutAsync($"/api/releases/{id}/cover", Picture(CoverApp.Png, "image/jpeg")));
        Assert.NotEqual(url, replaced.GetProperty("coverUrl").GetString());
        Assert.Equal("image/png", (await anonymous.GetAsync(replaced.GetProperty("coverUrl").GetString())).Content.Headers.ContentType!.MediaType);

        // editing the release leaves the cover alone
        var edited = await OkJson(await client.PutAsJsonAsync($"/api/releases/{id}", new { name = "This Is It", format = "Dvd", edition = "Steelbook" }));
        Assert.Equal(replaced.GetProperty("coverUrl").GetString(), edited.GetProperty("coverUrl").GetString());

        var removed = await OkJson(await client.DeleteAsync($"/api/releases/{id}/cover"));
        Assert.Equal(JsonValueKind.Null, removed.GetProperty("coverUrl").ValueKind);
        Assert.Equal(HttpStatusCode.NotFound, (await anonymous.GetAsync($"/api/releases/{id}/cover")).StatusCode);
    }

    [Fact]
    public async Task Only_editors_set_covers_and_only_pictures_are_taken()
    {
        var id = await app.ReleaseAsync("Checked");
        var anonymous = app.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.PutAsync($"/api/releases/{id}/cover", Picture(CoverApp.Jpeg))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.DeleteAsync($"/api/releases/{id}/cover")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/releases/cover-from?url=https://example.com/cover.jpg")).StatusCode);

        var client = await app.EditorAsync();
        Assert.Contains("JPEG, PNG or WebP", await ErrorOf(await client.PutAsync($"/api/releases/{id}/cover", Picture("<svg/>"u8.ToArray(), "image/svg+xml"))));
        Assert.Contains("too big", await ErrorOf(await client.PutAsync($"/api/releases/{id}/cover", Picture([.. CoverApp.Jpeg, .. new byte[3 * 1024 * 1024]]))));
        Assert.Equal(HttpStatusCode.NotFound, (await client.PutAsync("/api/releases/999999/cover", Picture(CoverApp.Jpeg))).StatusCode);
    }

    [Fact]
    public async Task Deleting_a_release_deletes_its_cover()
    {
        var client = await app.EditorAsync();
        var id = await app.ReleaseAsync("Gone");
        await OkJson(await client.PutAsync($"/api/releases/{id}/cover", Picture(CoverApp.Jpeg)));
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/releases/{id}")).StatusCode);
        using var scope = app.Services.CreateScope();
        Assert.False(await scope.ServiceProvider.GetRequiredService<MoviesDbContext>().ReleaseCovers.AnyAsync(c => c.ReleaseId == id));
    }

    [Fact]
    public async Task A_picture_comes_from_a_link_but_not_a_page_or_a_private_address()
    {
        var client = await app.EditorAsync();
        var got = await client.GetAsync("/api/releases/cover-from?url=" + Uri.EscapeDataString("https://example.com/cover.jpg"));
        Assert.Equal(HttpStatusCode.OK, got.StatusCode);
        Assert.Equal("image/jpeg", got.Content.Headers.ContentType!.MediaType);
        Assert.Equal(CoverApp.Jpeg, await got.Content.ReadAsByteArrayAsync());

        async Task<string> Refused(string url) => await ErrorOf(await client.GetAsync("/api/releases/cover-from?url=" + Uri.EscapeDataString(url)));
        Assert.Contains("isn't a picture", await Refused("https://example.com/page.html"));
        Assert.Contains("404", await Refused("https://example.com/missing.jpg"));
        Assert.Contains("web link", await Refused("ftp://example.com/cover.jpg"));
        Assert.Contains("web link", await Refused("not a link"));
        Assert.Contains("port", await Refused("https://example.com:8443/cover.jpg"));
        Assert.Contains("public internet", await Refused("http://127.0.0.1/cover.jpg"));
        Assert.Contains("public internet", await Refused("http://169.254.169.254/latest/meta-data"));
        Assert.Contains("public internet", await Refused("http://[::1]/cover.jpg"));
    }

    [Theory]
    [InlineData("8.8.8.8", true)]
    [InlineData("104.18.32.7", true)]
    [InlineData("2606:4700::6810:84e5", true)]
    [InlineData("127.0.0.1", false)]
    [InlineData("10.1.2.3", false)]
    [InlineData("172.20.0.1", false)]
    [InlineData("192.168.1.10", false)]
    [InlineData("169.254.169.254", false)]
    [InlineData("100.100.1.1", false)]
    [InlineData("0.0.0.0", false)]
    [InlineData("224.0.0.1", false)]
    [InlineData("::1", false)]
    [InlineData("::", false)]
    [InlineData("fe80::1", false)]
    [InlineData("fd12:3456::1", false)]
    [InlineData("::ffff:10.0.0.1", false)]
    [InlineData("::ffff:8.8.8.8", true)]
    [InlineData("64:ff9b::a00:1", false)]
    public void Only_public_addresses_are_reachable(string address, bool expected) =>
        Assert.Equal(expected, CoverFetcher.IsPublic(IPAddress.Parse(address)));
}
