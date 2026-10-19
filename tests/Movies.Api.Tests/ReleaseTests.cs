using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Movies.Api.Data;
using Movies.Api.Import;

namespace Movies.Api.Tests;

public class ReleaseConversionTests
{
    private static ReleaseConversion.Shelf Shelf(int id, string name, string[] formats, decimal? price = null, params string[] links) =>
        new(id, name, [.. formats], price, [.. links]);

    private const string Cex = "https://uk.webuy.com/product-detail?id=";

    [Theory]
    [InlineData("Blu-Ray", ReleaseFormat.BluRay, ReleaseEdition.Standard)]
    [InlineData("4K Blu-Ray Steelbook", ReleaseFormat.UltraHdBluRay, ReleaseEdition.Steelbook)]
    [InlineData("DVD Box Set", ReleaseFormat.Dvd, ReleaseEdition.BoxSet)]
    [InlineData("Blu-Ray Box Set", ReleaseFormat.BluRay, ReleaseEdition.BoxSet)]
    public void Parses_the_sheet_labels(string label, ReleaseFormat format, ReleaseEdition edition)
    {
        Assert.Equal((format, edition), ReleaseConversion.ParseLabel(label));
        Assert.Equal(label, ReleaseConversion.Label(format, edition));
    }

    [Fact]
    public void A_box_set_shared_by_titles_is_one_release_with_their_prices_added()
    {
        var plan = ReleaseConversion.Plan([
            Shelf(1, "Shrek", ["Blu-Ray Box Set"], 15m, Cex + "500&categoryName=BLU-RAY-KIDS"),
            Shelf(2, "Shrek 2", [], null, Cex + "500"),
            Shelf(3, "Shrek 3", ["Blu-Ray Box Set"], null, Cex + "500"),
        ]);
        var p = Assert.Single(plan);
        Assert.Equal([1, 2, 3], p.TitleIds);
        Assert.Equal("Shrek collection", p.Release.Name);
        Assert.Equal((ReleaseFormat.BluRay, ReleaseEdition.BoxSet), (p.Release.Format, p.Release.Edition));
        Assert.Equal(15m, p.Release.PricePaid);
        Assert.Equal("500", p.Release.CexSku);
        Assert.Equal(PurchasePlace.Cex, p.Release.PurchasedFrom);
        Assert.Equal(Cex + "500", p.Release.CexUrl);
    }

    [Fact]
    public void Two_copies_of_a_title_are_two_releases_matched_to_their_links_and_sharing_the_price()
    {
        var plan = ReleaseConversion.Plan([
            Shelf(1, "A Silent Voice", ["Blu-Ray", "DVD"], 20m, Cex + "1&categoryName=DVD-ANIME", Cex + "2&categoryName=BLU-RAY-ANIME"),
        ]);
        Assert.Equal(2, plan.Count);
        var dvd = plan.Single(p => p.Release.CexSku == "1").Release;
        var bluRay = plan.Single(p => p.Release.CexSku == "2").Release;
        Assert.Equal(ReleaseFormat.Dvd, dvd.Format);
        Assert.Equal(ReleaseFormat.BluRay, bluRay.Format);
        Assert.Equal(20m, dvd.PricePaid + bluRay.PricePaid);
        Assert.All(plan, p => Assert.Equal("A Silent Voice", p.Release.Name));
    }

    [Fact]
    public void Formats_without_links_still_become_releases_and_odd_prices_split_to_the_penny()
    {
        var plan = ReleaseConversion.Plan([Shelf(1, "Avatar", ["DVD Box Set", "Blu-Ray Box Set", "4K Blu-Ray"], 10m)]);
        Assert.Equal(3, plan.Count);
        Assert.All(plan, p => Assert.Null(p.Release.CexSku));
        Assert.All(plan, p => Assert.Equal(PurchasePlace.Other, p.Release.PurchasedFrom));
        Assert.Equal(10m, plan.Sum(p => p.Release.PricePaid));
        Assert.Equal([3.34m, 3.33m, 3.33m], plan.Select(p => p.Release.PricePaid!.Value));
    }

    [Fact]
    public void Nothing_on_the_shelf_means_no_release()
    {
        Assert.Empty(ReleaseConversion.Plan([Shelf(1, "Streamed", [])]));
    }
}

/// <summary>A database from before releases existed is converted when the app starts.</summary>
public class ShelfMigrationTests
{
    [Fact]
    public async Task Old_title_formats_prices_and_links_become_releases_and_the_columns_go()
    {
        await using var conn = new SqliteConnection("Data Source=:memory:");
        await conn.OpenAsync();
        var options = new DbContextOptionsBuilder<MoviesDbContext>().UseSqlite(conn).Options;

        await using (var db = new MoviesDbContext(options))
        {
            await db.GetService<IMigrator>().MigrateAsync("PhysicalReleases");
            await db.Database.ExecuteSqlRawAsync("""
                INSERT INTO Titles (Id, Name, Type, WatchCount, WithBogdan, Genres, PhysicalFormats, PricePaid, CexLinks, CreatedAt, UpdatedAt) VALUES
                  (1, 'Ice Age', 'Film', 1, 0, '[]', '["Blu-Ray Box Set"]', '6.0', '["https://uk.webuy.com/product-detail?id=77&categoryName=BLU-RAY-KIDS"]', '2026-01-01', '2026-01-01'),
                  (2, 'Ice Age: The Meltdown', 'Film', 1, 0, '[]', '["Blu-Ray Box Set"]', NULL, '["https://uk.webuy.com/product-detail?id=77"]', '2026-01-01', '2026-01-01'),
                  (3, 'Halloween', 'Film', 1, 0, '[]', '["4K Blu-Ray Steelbook"]', '12.0', '[]', '2026-01-01', '2026-01-01'),
                  (4, 'Streamed', 'Film', 1, 0, '[]', '[]', NULL, '[]', '2026-01-01', '2026-01-01')
                """);
        }

        await using (var db = new MoviesDbContext(options))
        {
            await Startup.MigrateAsync(db);
            Assert.Empty(await db.Database.GetPendingMigrationsAsync());

            var releases = await db.Releases.Include(r => r.TitleLinks).OrderBy(r => r.Name).ToListAsync();
            Assert.Equal(2, releases.Count);
            var halloween = releases[0];
            Assert.Equal(("Halloween", ReleaseFormat.UltraHdBluRay, ReleaseEdition.Steelbook, 12m), (halloween.Name, halloween.Format, halloween.Edition, halloween.PricePaid));
            Assert.Equal(PurchasePlace.Other, halloween.PurchasedFrom);
            var iceAge = releases[1];
            Assert.Equal(("Ice Age collection", "77", 6m, PurchasePlace.Cex), (iceAge.Name, iceAge.CexSku, iceAge.PricePaid, iceAge.PurchasedFrom));
            Assert.Equal([1, 2], iceAge.TitleLinks.Select(l => l.TitleId).Order());

            // the old columns are gone; running again changes nothing
            var cols = await db.Database.SqlQueryRaw<string>("SELECT name AS Value FROM pragma_table_info('Titles')").ToListAsync();
            Assert.DoesNotContain("PhysicalFormats", cols);
            Assert.DoesNotContain("PricePaid", cols);
            await Startup.MigrateAsync(db);
            Assert.Equal(2, await db.Releases.CountAsync());
        }
    }
}

public class ReleasesApiTests : IClassFixture<TestApp>
{
    private readonly TestApp _app;
    public ReleasesApiTests(TestApp app) => _app = app;

    private async Task<int> TitleAsync(string name)
    {
        using var scope = _app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MoviesDbContext>();
        var t = new Title { Name = name };
        db.Titles.Add(t);
        await db.SaveChangesAsync();
        return t.Id;
    }

    [Fact]
    public async Task Anonymous_can_read_but_not_write()
    {
        var client = _app.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/releases")).StatusCode);
        var body = new { name = "x", format = "BluRay", edition = "Standard" };
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/releases", body)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PutAsJsonAsync("/api/releases/1", body)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.DeleteAsync("/api/releases/1")).StatusCode);
    }

    [Fact]
    public async Task Editor_can_create_link_edit_and_delete_a_release()
    {
        await _app.CreateUserAsync("releaseeditor", "correct-horse-battery", "Editor");
        var client = await _app.SignedInWithMfaAsync("releaseeditor", "correct-horse-battery");
        var lion = await TitleAsync("The Lion King");
        var lion2 = await TitleAsync("The Lion King II");

        var bad = await client.PostAsJsonAsync("/api/releases", new { name = "", format = "BluRay", edition = "Standard" });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        var missingTitle = await client.PostAsJsonAsync("/api/releases", new { name = "x", format = "BluRay", edition = "Standard", titleIds = new[] { 999999 } });
        Assert.Equal(HttpStatusCode.BadRequest, missingTitle.StatusCode);

        var created = await client.PostAsJsonAsync("/api/releases",
            new { name = "Lion King Trilogy", format = "BluRay", edition = "BoxSet", pricePaid = 5m, titleIds = new[] { lion, lion2 } });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var release = await created.Content.ReadFromJsonAsync<JsonElement>();
        var id = release.GetProperty("id").GetInt32();
        Assert.Equal("BoxSet", release.GetProperty("edition").GetString());
        Assert.Equal("Other", release.GetProperty("purchasedFrom").GetString()); // not given: Other
        Assert.Equal([lion, lion2], release.GetProperty("titleIds").EnumerateArray().Select(e => e.GetInt32()));

        // the title lists its release, with how many titles share it
        var title = await client.GetFromJsonAsync<JsonElement>($"/api/titles/{lion}");
        var onTitle = Assert.Single(title.GetProperty("releases").EnumerateArray());
        Assert.Equal((id, 2), (onTitle.GetProperty("id").GetInt32(), onTitle.GetProperty("titleCount").GetInt32()));

        var edited = await client.PutAsJsonAsync($"/api/releases/{id}",
            new { name = "Lion King Trilogy", format = "UltraHdBluRay", edition = "Steelbook", pricePaid = 7.5m, purchasedFrom = "ForbiddenPlanet", titleIds = new[] { lion2 } });
        edited.EnsureSuccessStatusCode();
        var after = await edited.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("UltraHdBluRay", after.GetProperty("format").GetString());
        Assert.Equal("ForbiddenPlanet", after.GetProperty("purchasedFrom").GetString());
        Assert.Equal([lion2], after.GetProperty("titleIds").EnumerateArray().Select(e => e.GetInt32()));
        Assert.Empty((await client.GetFromJsonAsync<JsonElement>($"/api/titles/{lion}")).GetProperty("releases").EnumerateArray());

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/releases/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/releases/{id}")).StatusCode);
        // deleting the release leaves its titles alone
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync($"/api/titles/{lion2}")).StatusCode);
    }
}
