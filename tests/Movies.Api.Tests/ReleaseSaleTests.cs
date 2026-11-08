using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Movies.Api.Data;
using Movies.Api.Services;

namespace Movies.Api.Tests;

/// <summary>The app with one editor signed in once and shared by the tests (sign-ins are rate limited).</summary>
public class SaleApp : TestApp
{
    private Task<HttpClient>? _editor;
    public Task<HttpClient> EditorAsync() => _editor ??= SignInAsync();

    private async Task<HttpClient> SignInAsync()
    {
        await CreateUserAsync("saleeditor", "correct-horse-battery", "Editor");
        return await SignedInWithMfaAsync("saleeditor", "correct-horse-battery");
    }

    public async Task<int> TitleAsync(string name)
    {
        using var scope = Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MoviesDbContext>();
        var t = new Title { Name = name };
        db.Titles.Add(t);
        await db.SaveChangesAsync();
        return t.Id;
    }
}

/// <summary>Releases marked as traded in or sold: they stay, with where, when and for how much.</summary>
public class ReleaseSaleApiTests(SaleApp app) : IClassFixture<SaleApp>
{
    private static string Iso(DateOnly d) => d.ToString("yyyy-MM-dd");
    private static readonly DateOnly Today = UkTime.Today();

    private static async Task<JsonElement> OkJson(HttpResponseMessage resp)
    {
        Assert.True(resp.IsSuccessStatusCode, $"{(int)resp.StatusCode}: {await resp.Content.ReadAsStringAsync()}");
        return await resp.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static void Sale(JsonElement r, string? via, string? on, decimal? got, string? payout)
    {
        string? Str(string name) => r.GetProperty(name).ValueKind == JsonValueKind.Null ? null : r.GetProperty(name).GetString();
        decimal? Num(string name) => r.GetProperty(name).ValueKind == JsonValueKind.Null ? null : r.GetProperty(name).GetDecimal();
        Assert.Equal((via, on, got, payout), (Str("soldVia"), Str("soldOn"), Num("soldFor"), Str("payout")));
    }

    [Fact]
    public async Task A_sale_is_saved_changed_and_cleared()
    {
        var client = await app.EditorAsync();
        var title = await app.TitleAsync("Shrek");
        var bought = Today.AddYears(-2);
        var sold = Today.AddDays(-5);

        // traded in at CeX for a £2 voucher
        var created = await OkJson(await client.PostAsJsonAsync("/api/releases", new
        {
            name = "Shrek",
            format = "Dvd",
            edition = "Standard",
            pricePaid = 5m,
            titleIds = new[] { title },
            boughtOn = Iso(bought),
            soldVia = "Cex",
            soldOn = Iso(sold),
            soldFor = 2m,
            payout = "Voucher",
        }));
        var id = created.GetProperty("id").GetInt32();
        Sale(created, "Cex", Iso(sold), 2m, "Voucher");
        Assert.Equal(Iso(bought), created.GetProperty("boughtOn").GetString());

        // the title carries it too, so the pages can tell the shelf from what's gone
        var onTitle = Assert.Single((await client.GetFromJsonAsync<JsonElement>($"/api/titles/{title}")).GetProperty("releases").EnumerateArray());
        Sale(onTitle, "Cex", Iso(sold), 2m, "Voucher");
        Assert.Equal(Iso(bought), onTitle.GetProperty("boughtOn").GetString());

        // sold on eBay instead: cash or voucher is only a CeX thing
        var ebay = await OkJson(await client.PutAsJsonAsync($"/api/releases/{id}", new
        {
            name = "Shrek", format = "Dvd", edition = "Standard", pricePaid = 5m, titleIds = new[] { title },
            boughtOn = Iso(bought), soldVia = "Ebay", soldOn = Iso(sold), soldFor = 4.5m, payout = "Voucher",
        }));
        Sale(ebay, "Ebay", Iso(sold), 4.5m, null);

        // "Traded in or sold" unticked: no channel clears the date and price, whatever was sent
        var back = await OkJson(await client.PutAsJsonAsync($"/api/releases/{id}", new
        {
            name = "Shrek", format = "Dvd", edition = "Standard", pricePaid = 5m, titleIds = new[] { title },
            boughtOn = Iso(bought), soldVia = (string?)null, soldOn = Iso(sold), soldFor = 4.5m, payout = "Cash",
        }));
        Sale(back, null, null, null, null);
        Assert.Equal(Iso(bought), back.GetProperty("boughtOn").GetString()); // the purchase date stays

        // a PUT is the whole release: one without the sale fields puts it back on the shelf
        await OkJson(await client.PutAsJsonAsync($"/api/releases/{id}", new
        {
            name = "Shrek", format = "Dvd", edition = "Standard", titleIds = new[] { title }, soldVia = "Other", soldOn = Iso(Today),
        }));
        var omitted = await OkJson(await client.PutAsJsonAsync($"/api/releases/{id}", new { name = "Shrek", format = "Dvd", edition = "Standard", titleIds = new[] { title } }));
        Sale(omitted, null, null, null, null);
        Assert.Equal(JsonValueKind.Null, omitted.GetProperty("boughtOn").ValueKind);
    }

    [Fact]
    public async Task A_sale_is_checked()
    {
        var client = await app.EditorAsync();
        async Task<HttpResponseMessage> Post(object sale) =>
            await client.PostAsJsonAsync("/api/releases", Merge(new { name = "Checked", format = "BluRay", edition = "Standard" }, sale));

        async Task Refused(object sale, string key)
        {
            var resp = await Post(sale);
            Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
            var errors = (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors");
            Assert.True(errors.TryGetProperty(key, out _), $"expected an error for {key}: {errors}");
        }

        await Refused(new { soldVia = "Cex" }, "SoldOn"); // sold, but when?
        await Refused(new { soldVia = "Ebay", soldOn = Iso(Today.AddDays(2)) }, "SoldOn"); // in the future
        await Refused(new { soldVia = "Ebay", soldOn = Iso(Today.AddDays(-10)), boughtOn = Iso(Today.AddDays(-5)) }, "SoldOn"); // before it was bought
        await Refused(new { soldVia = "Ebay", soldOn = Iso(Today), soldFor = -1m }, "SoldFor");
        await Refused(new { soldVia = 99, soldOn = Iso(Today) }, "SoldVia"); // a number that isn't a channel
        await Refused(new { soldVia = "Cex", soldOn = Iso(Today), payout = 7 }, "Payout");
        await Refused(new { boughtOn = Iso(Today.AddDays(2)) }, "BoughtOn");

        // a channel that doesn't exist doesn't even bind
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(new { soldVia = "Gumtree", soldOn = Iso(Today) })).StatusCode);

        // today, a free giveaway and no price at all are all fine
        Sale(await OkJson(await Post(new { soldVia = "Other", soldOn = Iso(Today), soldFor = 0m })), "Other", Iso(Today), 0m, null);
        Sale(await OkJson(await Post(new { soldVia = "FacebookMarketplace", soldOn = Iso(Today) })), "FacebookMarketplace", Iso(Today), null, null);
    }

    private static Dictionary<string, object?> Merge(object a, object b)
    {
        var d = new Dictionary<string, object?>();
        foreach (var o in new[] { a, b })
            foreach (var p in o.GetType().GetProperties())
                d[p.Name] = p.GetValue(o);
        return d;
    }
}

/// <summary>The daily CeX snapshot covers what's on the shelf: a sold release's prices stop being recorded.</summary>
public class SoldReleaseSnapshotTests(FakeCexApp app) : IClassFixture<FakeCexApp>
{
    [Fact]
    public async Task Sold_releases_are_left_out_unless_another_copy_is_owned()
    {
        using (var scope = app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<MoviesDbContext>();
            db.Releases.AddRange(
                new PhysicalRelease { Name = "Owned", CexSku = "3000000000001" },
                new PhysicalRelease { Name = "Sold", CexSku = "3000000000002", SoldVia = SaleChannel.Cex, SoldOn = new DateOnly(2026, 11, 3) },
                // one copy sold, another still on the shelf: still tracked
                new PhysicalRelease { Name = "Sold copy", CexSku = "3000000000003", SoldVia = SaleChannel.Ebay, SoldOn = new DateOnly(2026, 11, 3) },
                new PhysicalRelease { Name = "Kept copy", CexSku = "3000000000003" });
            await db.SaveChangesAsync();
        }

        using (var scope = app.Services.CreateScope())
        {
            var history = scope.ServiceProvider.GetRequiredService<CexHistoryService>();
            Assert.Equal(["3000000000001", "3000000000003"], (await history.OwnedSkusAsync()).Order());
            await history.SnapshotAsync(TimeSpan.Zero);
        }

        using (var scope = app.Services.CreateScope())
        {
            var skus = await scope.ServiceProvider.GetRequiredService<MoviesDbContext>().CexPriceSnapshots.Select(s => s.Sku).ToListAsync();
            Assert.Contains("3000000000001", skus);
            Assert.Contains("3000000000003", skus);
            Assert.DoesNotContain("3000000000002", skus);
        }
    }

    [Fact]
    public async Task History_can_be_narrowed_to_one_product()
    {
        using (var scope = app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<MoviesDbContext>();
            db.CexPriceSnapshots.AddRange(
                new CexPriceSnapshot { Sku = "4000000000001", Date = new DateOnly(2026, 10, 30), CashPrice = 2, ExchangePrice = 3, SellPrice = 6 },
                new CexPriceSnapshot { Sku = "4000000000002", Date = new DateOnly(2026, 10, 30), CashPrice = 1 });
            await db.SaveChangesAsync();
        }
        var one = await app.CreateClient().GetFromJsonAsync<JsonElement>("/api/cex/history?sku=4000000000001");
        var item = Assert.Single(one.EnumerateArray());
        Assert.Equal("4000000000001", item.GetProperty("sku").GetString());
        Assert.Equal(3m, Assert.Single(item.GetProperty("points").EnumerateArray()).GetProperty("exchange").GetDecimal());
    }
}
