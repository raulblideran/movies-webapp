using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
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

    [Theory]
    [InlineData("2021-05-28", 2021, "2021-05-28")] // TMDB's day
    [InlineData("2021-05-28", null, "2021-05-28")]
    [InlineData("2021-05-28", 2022, "2021-05-28")]
    [InlineData("2021-05-28", 2020, "2020-01-01")] // the year typed in is earlier: the link may be wrong
    [InlineData(null, 2021, "2021-01-01")]
    [InlineData(null, null, null)]
    public void A_title_came_out_on_its_TMDB_date_or_else_at_the_start_of_its_year(string? date, int? year, string? expected) =>
        Assert.Equal(expected is null ? null : D(expected),
            WatchSummary.ReleasedOn(new Title { Name = "x", ReleaseDate = date is null ? null : D(date), ReleaseYear = year }));

    [Fact]
    public void Only_a_watch_dated_before_the_release_is_refused()
    {
        var t = new Title { Name = "A Quiet Place Part II", ReleaseDate = D("2021-05-28"), ReleaseYear = 2021 };
        Assert.Equal("That's before A Quiet Place Part II came out (28/05/2021).",
            WatchSummary.BeforeRelease(t, [new Watch { Date = D("2021-06-03") }, new Watch { Date = D("2021-05-27") }]));
        Assert.Null(WatchSummary.BeforeRelease(t, [new Watch { Date = D("2021-05-28") }, new Watch()])); // the day itself, and undated
        Assert.Equal("That's before Shrek came out (2001).", WatchSummary.BeforeRelease(new Title { Name = "Shrek", ReleaseYear = 2001 }, [new Watch { Date = D("2000-12-31") }]));
        Assert.Null(WatchSummary.BeforeRelease(new Title { Name = "?" }, [new Watch { Date = D("1950-01-01") }]));
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

    internal static async Task<JsonElement> JsonAsync(HttpResponseMessage resp)
    {
        Assert.True(resp.IsSuccessStatusCode, await resp.Content.ReadAsStringAsync());
        return await resp.Content.ReadFromJsonAsync<JsonElement>();
    }

    internal static List<JsonElement> Watches(JsonElement title) => title.GetProperty("watches").EnumerateArray().ToList();

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

/// <summary>
/// No watch dated before the title came out, as far as is known (WatchSummary.ReleasedOn). A class of its own,
/// for its own sign-in rate limit.
/// </summary>
public class WatchReleaseDateTests : IClassFixture<TestApp>
{
    private readonly TestApp _app;
    public WatchReleaseDateTests(TestApp app) => _app = app;

    private async Task<HttpClient> EditorAsync(string userName)
    {
        await _app.CreateUserAsync(userName, "correct-horse-battery", "Editor");
        return await _app.SignedInWithMfaAsync(userName, "correct-horse-battery");
    }

    private static Task<JsonElement> JsonAsync(HttpResponseMessage resp) => WatchesApiTests.JsonAsync(resp);
    private static List<JsonElement> Watches(JsonElement title) => WatchesApiTests.Watches(title);
    private static async Task<JsonElement> TitleAsync(HttpClient client, int id) => await JsonAsync(await client.GetAsync($"/api/titles/{id}"));

    private async Task SetReleaseDateAsync(int titleId, string date)
    {
        using var scope = _app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MoviesDbContext>();
        await db.Titles.Where(t => t.Id == titleId).ExecuteUpdateAsync(s => s.SetProperty(t => t.ReleaseDate, DateOnly.Parse(date)));
    }

    [Fact]
    public async Task A_watch_from_before_the_release_is_refused()
    {
        var client = await EditorAsync("w-early");
        var t = await JsonAsync(await client.PostAsJsonAsync("/api/titles", new
        {
            name = "Dune: Part Two", type = "Film", releaseYear = 2024, watches = new[] { new { date = "2024-03-10" } },
        }));
        var id = t.GetProperty("id").GetInt32();
        var firstId = Watches(t)[0].GetProperty("id").GetInt32();

        // only the year is known: the year before is refused, any day of the year is fine
        var early = await client.PostAsJsonAsync($"/api/titles/{id}/watches", new { date = "2023-12-31" });
        Assert.Equal(HttpStatusCode.BadRequest, early.StatusCode);
        Assert.Contains("That's before Dune: Part Two came out (2024).", await early.Content.ReadAsStringAsync());

        // with TMDB's date, the day before is refused and the day itself is fine
        await SetReleaseDateAsync(id, "2024-03-01");
        early = await client.PostAsJsonAsync($"/api/titles/{id}/watches", new { date = "2024-02-29" });
        Assert.Equal(HttpStatusCode.BadRequest, early.StatusCode);
        Assert.Contains("(01/03/2024)", await early.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsJsonAsync($"/api/titles/{id}/watches", new { date = "2024-03-01" })).StatusCode);

        // moving a watch earlier, on its own or with the title, is refused and changes nothing
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync($"/api/watches/{firstId}", new { date = "2024-02-01" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync($"/api/titles/{id}", new
        {
            name = "Dune: Part Two", type = "Film", releaseYear = 2024, watches = new[] { new { id = firstId, date = "2024-02-01" } },
        })).StatusCode);
        t = await TitleAsync(client, id);
        Assert.Equal((2, "2024-03-01"), (t.GetProperty("watchCount").GetInt32(), t.GetProperty("firstWatch").GetString()));
    }

    [Fact]
    public async Task A_watch_already_dated_before_the_release_doesnt_block_other_changes()
    {
        var client = await EditorAsync("w-legacy");
        var t = await JsonAsync(await client.PostAsJsonAsync("/api/titles", new { name = "We Can Be Heroes", type = "Film", watches = new[] { new { date = "2020-12-10" } } }));
        var id = t.GetProperty("id").GetInt32();
        var watchId = Watches(t)[0].GetProperty("id").GetInt32();
        await SetReleaseDateAsync(id, "2020-12-25"); // as an old import could have it

        t = await JsonAsync(await client.PutAsJsonAsync($"/api/watches/{watchId}", new { date = "2020-12-10", notes = "Christmas" }));
        Assert.Equal("Christmas", Watches(t)[0].GetProperty("notes").GetString());
        t = await JsonAsync(await client.PutAsJsonAsync($"/api/titles/{id}", new
        {
            name = "We Can Be Heroes", type = "Film", rating = 6, watches = new[] { new { id = watchId, date = "2020-12-10" } },
        }));
        Assert.Equal(6, t.GetProperty("rating").GetDecimal());

        // and it can be put right
        t = await JsonAsync(await client.PutAsJsonAsync($"/api/watches/{watchId}", new { date = "2020-12-26" }));
        Assert.Equal("2020-12-26", t.GetProperty("firstWatch").GetString());
    }

    [Fact]
    public async Task A_new_title_watched_before_its_release_year_is_refused()
    {
        var client = await EditorAsync("w-early-new");
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/titles", new
        {
            name = "Encanto", type = "Film", releaseYear = 2021, watches = new[] { new { date = "2020-11-24" } },
        })).StatusCode);
        // the same through the old summary fields
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/titles", new
        {
            name = "Encanto", type = "Film", releaseYear = 2021, watchCount = 1, firstWatch = "2020-11-24",
        })).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsJsonAsync("/api/titles", new
        {
            name = "Encanto", type = "Film", releaseYear = 2021, watches = new[] { new { date = "2021-11-24" } },
        })).StatusCode);
    }
}
