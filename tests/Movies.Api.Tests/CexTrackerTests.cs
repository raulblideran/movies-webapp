using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Movies.Api.Data;
using Movies.Api.Services;

namespace Movies.Api.Tests;

public class CexSkuTests
{
    [Theory]
    [InlineData("https://uk.webuy.com/product-detail?id=5030697044006", "5030697044006")]
    [InlineData("https://uk.webuy.com/product-detail/?id=4974365610135AB&categoryName=MEGA-DRIVE-SOFTWARE&position=4", "4974365610135AB")]
    [InlineData("  https://uk.webuy.com/product-detail?id=5060223761633S  ", "5060223761633S")]
    [InlineData("5053083202743", "5053083202743")]
    [InlineData("https://uk.webuy.com/search?stext=addams", null)]
    [InlineData("https://example.com/?id=../../etc", null)]
    [InlineData("", null)]
    public void Extracts_the_sku(string input, string? expected) =>
        Assert.Equal(expected, CexItemsService.ExtractSku(input));
}

public class CexTrackerApiTests : IClassFixture<TestApp>
{
    private readonly TestApp _app;
    public CexTrackerApiTests(TestApp app) => _app = app;

    private async Task<int> SeedAsync(string sku)
    {
        using var scope = _app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MoviesDbContext>();
        var item = new CexItem { Sku = sku, Url = CexItemsService.CanonicalUrl(sku), Title = $"Item {sku}", SellPrice = 5 };
        db.CexItems.Add(item);
        await db.SaveChangesAsync();
        return item.Id;
    }

    [Fact]
    public async Task Anonymous_can_list_but_not_change_items()
    {
        var id = await SeedAsync("1111111111111");
        var client = _app.CreateClient();
        var list = await client.GetFromJsonAsync<JsonElement>("/api/cex-items");
        Assert.Contains(list.EnumerateArray(), i => i.GetProperty("sku").GetString() == "1111111111111");

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/cex-items", new { url = "5053083202743" })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PutAsJsonAsync($"/api/cex-items/{id}", new { notes = "x" })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsync($"/api/cex-items/{id}/refresh", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.DeleteAsync($"/api/cex-items/{id}")).StatusCode);
    }

    [Fact]
    public async Task Editor_can_manage_items()
    {
        await _app.CreateUserAsync("cexeditor", "correct-horse-battery", "Editor");
        var client = await _app.SignedInWithMfaAsync("cexeditor", "correct-horse-battery");
        var id = await SeedAsync("2222222222222");

        var bad = await client.PostAsJsonAsync("/api/cex-items", new { url = "https://uk.webuy.com/search?stext=nope" });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);

        var dup = await client.PostAsJsonAsync("/api/cex-items", new { url = "https://uk.webuy.com/product-detail?id=2222222222222&position=3" });
        Assert.Equal(HttpStatusCode.Conflict, dup.StatusCode);

        var edited = await client.PutAsJsonAsync($"/api/cex-items/{id}", new { notes = "  wait for under £4  " });
        Assert.Equal(HttpStatusCode.OK, edited.StatusCode);
        Assert.Equal("wait for under £4", (await edited.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("notes").GetString());

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/cex-items/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.DeleteAsync($"/api/cex-items/{id}")).StatusCode);
    }

    [Fact]
    public async Task Tracker_page_is_served()
    {
        var html = await _app.CreateClient().GetStringAsync("/cex");
        Assert.Contains("CeX Stock Tracker", html);
        Assert.Matches(@"js/cex\.js\?v=\d{12}", html);
    }
}
