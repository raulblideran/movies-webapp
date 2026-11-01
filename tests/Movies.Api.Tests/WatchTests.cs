using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Movies.Api.Data;

namespace Movies.Api.Tests;

/// <summary>How the old summary (first/latest watch, count, Bogdan, cinema) becomes watches, without guessing dates.</summary>
public class WatchSeedingTests
{
    private static DateOnly D(string s) => DateOnly.Parse(s);

    private static List<Watch> Seed(int count, string? first = null, string? latest = null, bool bogdan = false, string? bogdanOn = null, bool cinema = false) =>
        WatchSummary.FromSummary(new Title
        {
            Name = "x",
            WatchCount = count,
            FirstWatch = first is null ? null : D(first),
            LatestWatch = latest is null ? null : D(latest),
            WithBogdan = bogdan,
            DateWithBogdan = bogdanOn is null ? null : D(bogdanOn),
            WatchedInCinema = cinema,
        });

    [Fact]
    public void First_and_latest_are_dated_and_the_rest_are_not()
    {
        var w = Seed(5, "2015-03-10", "2025-08-12");
        Assert.Equal(5, w.Count);
        Assert.Equal([D("2015-03-10"), D("2025-08-12")], w.Where(x => x.Date is not null).Select(x => x.Date!.Value));
        Assert.Equal(3, w.Count(x => x.Date is null));
    }

    [Fact]
    public void The_same_first_and_latest_day_is_one_watch()
    {
        var w = Seed(2, "2020-01-01", "2020-01-01");
        Assert.Equal([D("2020-01-01"), (DateOnly?)null], w.Select(x => x.Date));
    }

    [Fact]
    public void One_watch_with_two_dates_keeps_the_other_date_in_its_notes()
    {
        var w = Assert.Single(Seed(1, "2022-07-18", "2025-01-19"));
        Assert.Equal(D("2022-07-18"), w.Date);
        Assert.Contains("19/01/2025", w.Notes);
    }

    [Fact]
    public void Dates_with_a_count_of_zero_are_still_a_watch() =>
        Assert.Equal(D("2001-01-23"), Assert.Single(Seed(0, "2001-01-23")).Date);

    [Fact]
    public void Nothing_watched_has_no_watches() => Assert.Empty(Seed(0));

    [Fact]
    public void Bogdan_goes_on_the_watch_that_day_or_dates_an_undated_one_or_is_one_more()
    {
        Assert.True(Seed(2, "2019-04-06", "2024-10-20", bogdan: true, bogdanOn: "2024-10-20").Single(x => x.Date == D("2024-10-20")).WithBogdan);

        var dated = Seed(10, "2012-03-29", "2025-01-11", bogdan: true, bogdanOn: "2023-02-02");
        Assert.Equal(10, dated.Count);
        Assert.Equal(D("2023-02-02"), dated.Single(x => x.WithBogdan).Date);
        Assert.Equal(7, dated.Count(x => x.Date is null));

        var extra = Seed(1, "2026-02-10", bogdan: true, bogdanOn: "2026-09-30");
        Assert.Equal(2, extra.Count);
        Assert.Equal(D("2026-09-30"), extra.Single(x => x.WithBogdan).Date);
    }

    [Fact]
    public void Bogdan_without_a_date_goes_on_an_undated_watch_or_the_first()
    {
        Assert.Null(Seed(3, "2026-04-10", "2026-05-12", bogdan: true).Single(x => x.WithBogdan).Date);
        Assert.True(Assert.Single(Seed(1, "2026-04-10", bogdan: true)).WithBogdan);
    }

    [Fact]
    public void A_bogdan_date_without_the_flag_is_ignored() =>
        Assert.DoesNotContain(Seed(2, "2019-04-06", "2024-10-20", bogdanOn: "2024-10-20"), x => x.WithBogdan);

    [Fact]
    public void Cinema_goes_on_the_first_watch()
    {
        var w = Seed(3, "2025-03-14", "2026-09-22", cinema: true);
        Assert.Equal(D("2025-03-14"), w.Single(x => x.InCinema).Date);
        Assert.True(Assert.Single(Seed(1, cinema: true)).InCinema);
    }

    [Fact]
    public void The_summary_is_worked_out_from_the_watches()
    {
        var t = new Title { Name = "x", Watches = Seed(4, "2015-03-10", "2025-08-12", bogdan: true, bogdanOn: "2020-05-05", cinema: true) };
        WatchSummary.Apply(t);
        Assert.Equal((4, D("2015-03-10"), D("2025-08-12")), (t.WatchCount, t.FirstWatch, t.LatestWatch));
        Assert.Equal((true, D("2020-05-05"), true), (t.WithBogdan, t.DateWithBogdan, t.WatchedInCinema));
    }
}

/// <summary>A database from before watches existed gets them when the app starts.</summary>
public class WatchMigrationTests
{
    [Fact]
    public async Task Old_titles_get_watches_from_their_summary_and_a_fresh_TMDB_sync()
    {
        await using var conn = new SqliteConnection("Data Source=:memory:");
        await conn.OpenAsync();
        var options = new DbContextOptionsBuilder<MoviesDbContext>().UseSqlite(conn).Options;

        await using (var db = new MoviesDbContext(options))
        {
            await db.GetService<IMigrator>().MigrateAsync("TmdbMetadata");
            await db.Database.ExecuteSqlRawAsync("""
                INSERT INTO Titles (Id, Name, Type, List, WatchCount, FirstWatch, LatestWatch, WithBogdan, DateWithBogdan, WatchedInCinema, Genres, Credits, TmdbId, TmdbMediaType, TmdbSyncedAt, CreatedAt, UpdatedAt) VALUES
                  (1, 'Back To The Future', 'Film', 'Watched', 4, '2012-03-29', '2025-01-11', 1, '2023-02-02', 0, '[]', '[]', 105, 'movie', '2026-10-31', '2026-01-01', '2026-01-01'),
                  (2, 'Bohemian Rhapsody', 'Film', 'Watched', 1, '2018-10-27', '2018-10-27', 0, NULL, 1, '[]', '[]', NULL, NULL, NULL, '2026-01-01', '2026-01-01'),
                  (3, 'Alien', 'Film', 'Watchlist', 0, NULL, NULL, 0, NULL, 0, '[]', '[]', NULL, NULL, NULL, '2026-01-01', '2026-01-01')
                """);
        }

        await using (var db = new MoviesDbContext(options))
        {
            await Startup.MigrateAsync(db);
            Assert.Empty(await db.Database.GetPendingMigrationsAsync());
            var titles = await db.Titles.Include(t => t.Watches).OrderBy(t => t.Id).ToListAsync();

            var bttf = titles[0];
            Assert.Equal(4, bttf.Watches.Count);
            Assert.Equal(DateOnly.Parse("2023-02-02"), bttf.Watches.Single(w => w.WithBogdan).Date);
            Assert.Single(bttf.Watches, w => w.Date is null);
            Assert.Equal(4, bttf.WatchCount);
            Assert.Null(bttf.TmdbSyncedAt); // fetched again, for its score, language and countries

            Assert.True(Assert.Single(titles[1].Watches).InCinema);
            Assert.Empty(titles[2].Watches);

            // running again adds nothing
            await Startup.MigrateAsync(db);
            Assert.Equal(5, await db.Watches.CountAsync());
        }
    }
}

public class WatchesApiTests : IClassFixture<TestApp>
{
    private readonly TestApp _app;
    public WatchesApiTests(TestApp app) => _app = app;

    private async Task<HttpClient> EditorAsync(string userName)
    {
        await _app.CreateUserAsync(userName, "correct-horse-battery", "Editor");
        return await _app.SignedInWithMfaAsync(userName, "correct-horse-battery");
    }

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage resp)
    {
        Assert.True(resp.IsSuccessStatusCode, await resp.Content.ReadAsStringAsync());
        return await resp.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static List<JsonElement> Watches(JsonElement title) => title.GetProperty("watches").EnumerateArray().ToList();

    [Fact]
    public async Task A_new_title_takes_its_watches_and_works_out_its_summary()
    {
        var client = await EditorAsync("w-new");
        var t = await JsonAsync(await client.PostAsJsonAsync("/api/titles", new
        {
            name = "Arrival", type = "Film", rating = 9, tags = new[] { "Sunday night", " sunday NIGHT ", "" },
            watches = new object[]
            {
                new { date = "2016-11-12", inCinema = true, notes = "  Opening weekend  " },
                new { date = (string?)null, withBogdan = true },
                new { date = "2024-02-01" },
            },
        }));
        Assert.Equal(3, t.GetProperty("watchCount").GetInt32());
        Assert.Equal("2016-11-12", t.GetProperty("firstWatch").GetString());
        Assert.Equal("2024-02-01", t.GetProperty("latestWatch").GetString());
        Assert.True(t.GetProperty("watchedInCinema").GetBoolean());
        Assert.True(t.GetProperty("withBogdan").GetBoolean());
        Assert.Equal(JsonValueKind.Null, t.GetProperty("dateWithBogdan").ValueKind); // the Bogdan watch has no date
        Assert.Equal(["Sunday night"], t.GetProperty("tags").EnumerateArray().Select(x => x.GetString()));
        var ws = Watches(t);
        Assert.Equal("Opening weekend", ws[0].GetProperty("notes").GetString());
        Assert.Equal(JsonValueKind.Null, ws[2].GetProperty("date").ValueKind); // undated last
    }

    [Fact]
    public async Task Watches_are_added_changed_and_deleted_one_at_a_time()
    {
        var client = await EditorAsync("w-crud");
        var t = await JsonAsync(await client.PostAsJsonAsync("/api/titles", new { name = "Heat", type = "Film", watches = new[] { new { date = "2010-05-01" } } }));
        var id = t.GetProperty("id").GetInt32();

        var added = await client.PostAsJsonAsync($"/api/titles/{id}/watches", new { date = "2026-10-30", withBogdan = true, notes = "4K disc" });
        Assert.Equal(HttpStatusCode.Created, added.StatusCode);
        var body = await JsonAsync(added);
        var watchId = body.GetProperty("watchId").GetInt32();
        t = body.GetProperty("title");
        Assert.Equal((2, "2026-10-30", "2026-10-30"), (t.GetProperty("watchCount").GetInt32(), t.GetProperty("latestWatch").GetString(), t.GetProperty("dateWithBogdan").GetString()));

        t = await JsonAsync(await client.PutAsJsonAsync($"/api/watches/{watchId}", new { date = "2026-10-29", withBogdan = false, inCinema = true }));
        Assert.Equal("2026-10-29", t.GetProperty("latestWatch").GetString());
        Assert.False(t.GetProperty("withBogdan").GetBoolean());
        Assert.True(t.GetProperty("watchedInCinema").GetBoolean());

        t = await JsonAsync(await client.DeleteAsync($"/api/watches/{watchId}"));
        Assert.Equal((1, "2010-05-01"), (t.GetProperty("watchCount").GetInt32(), t.GetProperty("latestWatch").GetString()));
        Assert.False(t.GetProperty("watchedInCinema").GetBoolean());
        Assert.Equal(HttpStatusCode.NotFound, (await client.DeleteAsync($"/api/watches/{watchId}")).StatusCode);

        // a date in the future is refused; so is anyone not signed in
        var future = UkTime.Today().AddDays(5).ToString("yyyy-MM-dd");
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync($"/api/titles/{id}/watches", new { date = future })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await _app.CreateClient().PostAsJsonAsync($"/api/titles/{id}/watches", new { date = "2020-01-01" })).StatusCode);
    }

    [Fact]
    public async Task Saving_a_title_with_its_watches_changes_adds_and_removes_them()
    {
        var client = await EditorAsync("w-sync");
        var t = await JsonAsync(await client.PostAsJsonAsync("/api/titles", new
        {
            name = "Up", type = "Film",
            watches = new object[] { new { date = "2009-10-16" }, new { date = "2015-01-01" }, new { date = (string?)null } },
        }));
        var id = t.GetProperty("id").GetInt32();
        var ws = Watches(t);

        // the first is changed, the second dropped, the undated one kept, a new one added
        t = await JsonAsync(await client.PutAsJsonAsync($"/api/titles/{id}", new
        {
            name = "Up", type = "Film",
            watches = new object[]
            {
                new { id = ws[0].GetProperty("id").GetInt32(), date = "2009-10-17", withBogdan = true },
                new { id = ws[2].GetProperty("id").GetInt32(), date = (string?)null },
                new { date = "2026-01-01" },
            },
        }));
        Assert.Equal(["2009-10-17", "2026-01-01", null], Watches(t).Select(w => w.GetProperty("date").GetString()));
        Assert.Equal(ws[0].GetProperty("id").GetInt32(), Watches(t)[0].GetProperty("id").GetInt32());

        // left out, they stay; the summary fields sent are ignored
        t = await JsonAsync(await client.PutAsJsonAsync($"/api/titles/{id}", new { name = "Up", type = "Film", watchCount = 9, firstWatch = "2000-01-01" }));
        Assert.Equal(3, t.GetProperty("watchCount").GetInt32());
        Assert.Equal("2009-10-17", t.GetProperty("firstWatch").GetString());

        // a title's watches go with it
        await client.DeleteAsync($"/api/titles/{id}");
        Assert.Equal(HttpStatusCode.NotFound, (await client.DeleteAsync($"/api/watches/{ws[2].GetProperty("id").GetInt32()}")).StatusCode);
    }

    [Fact]
    public async Task Yearly_goals_are_set_read_and_removed()
    {
        var client = await EditorAsync("w-goals");
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync("/api/goals/2027", new { target = 100 })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync("/api/goals/2027", new { target = 120 })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync("/api/goals/2027", new { target = 0 })).StatusCode);
        var goals = await _app.CreateClient().GetFromJsonAsync<JsonElement>("/api/goals");
        var g = goals.EnumerateArray().Single(x => x.GetProperty("year").GetInt32() == 2027);
        Assert.Equal(120, g.GetProperty("target").GetInt32());
        Assert.Equal(HttpStatusCode.Unauthorized, (await _app.CreateClient().PutAsJsonAsync("/api/goals/2027", new { target = 5 })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync("/api/goals/2027")).StatusCode);
    }
}
