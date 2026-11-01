using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Movies.Api.Tests;

/// <summary>The watchlist is titles with list = Watchlist: the same table, endpoints and rules as the Watchlog.</summary>
public class WatchlistTests : IClassFixture<TestApp>
{
    private readonly TestApp _app;
    public WatchlistTests(TestApp app) => _app = app;

    private static readonly string Today = UkTime.Today().ToString("yyyy-MM-dd");

    private async Task<HttpClient> EditorAsync(string userName)
    {
        await _app.CreateUserAsync(userName, "correct-horse-battery", "Editor");
        return await _app.SignedInWithMfaAsync(userName, "correct-horse-battery");
    }

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage resp) => await resp.Content.ReadFromJsonAsync<JsonElement>();

    private async Task<List<string>> NamesAsync(string url) =>
        (await _app.CreateClient().GetFromJsonAsync<JsonElement>(url)).EnumerateArray().Select(t => t.GetProperty("name").GetString()!).ToList();

    private static object ToWatch(string name, string? watchlistAddedOn = null) =>
        new { name, type = "Film", list = "Watchlist", genres = new[] { "Horror" }, releaseYear = 1979, tmdbId = 348, tmdbMediaType = "movie", posterPath = "/alien.jpg", comments = "From a friend", watchlistAddedOn };

    [Fact]
    public async Task Watchlist_titles_are_listed_apart_from_the_watchlog()
    {
        var client = await EditorAsync("wl-lists");
        var created = await client.PostAsJsonAsync("/api/titles", ToWatch("Alien"));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var entry = await JsonAsync(created);
        Assert.Equal("Watchlist", entry.GetProperty("list").GetString());
        Assert.Equal(Today, entry.GetProperty("watchlistAddedOn").GetString()); // no date means today
        Assert.Equal(0, entry.GetProperty("watchCount").GetInt32());

        // a title sent without a list is watched, as before the watchlist existed
        var watched = await JsonAsync(await client.PostAsJsonAsync("/api/titles", new { name = "Aliens", type = "Film", watchCount = 1 }));
        Assert.Equal("Watched", watched.GetProperty("list").GetString());
        Assert.Equal(JsonValueKind.Null, watched.GetProperty("watchlistAddedOn").ValueKind);

        Assert.Contains("Alien", await NamesAsync("/api/titles?list=watchlist"));
        Assert.DoesNotContain("Aliens", await NamesAsync("/api/titles?list=watchlist"));
        Assert.Contains("Aliens", await NamesAsync("/api/titles?list=Watched"));
        Assert.DoesNotContain("Alien", await NamesAsync("/api/titles?list=watched"));
        var everything = await NamesAsync("/api/titles");
        Assert.Contains("Alien", everything);
        Assert.Contains("Aliens", everything);
        Assert.Equal(HttpStatusCode.BadRequest, (await _app.CreateClient().GetAsync("/api/titles?list=someday")).StatusCode);

        // the export is the old sheet: the Watchlog only
        var csv = await client.GetStringAsync("/api/export.csv");
        var fields = csv.Split('\n').SelectMany(l => l.Split(',')).Select(f => f.Trim().Trim('"')).ToList();
        Assert.Contains("Aliens", fields);
        Assert.DoesNotContain("Alien", fields);
    }

    [Fact]
    public async Task The_added_date_can_be_set_but_not_in_the_future()
    {
        var client = await EditorAsync("wl-dates");
        var future = UkTime.Today().AddDays(5).ToString("yyyy-MM-dd");
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/titles", ToWatch("Alien 3", future))).StatusCode);
        var entry = await JsonAsync(await client.PostAsJsonAsync("/api/titles", ToWatch("Alien 3", "2025-12-24")));
        Assert.Equal("2025-12-24", entry.GetProperty("watchlistAddedOn").GetString());
    }

    [Fact]
    public async Task Moving_between_the_lists_keeps_everything_else()
    {
        var client = await EditorAsync("wl-move");
        var entry = await JsonAsync(await client.PostAsJsonAsync("/api/titles", ToWatch("Prometheus", "2026-01-02")));
        var id = entry.GetProperty("id").GetInt32();
        // a disc you own but haven't watched
        var release = await JsonAsync(await client.PostAsJsonAsync("/api/releases",
            new { name = "Prometheus Blu-ray", format = "BluRay", edition = "Standard", titleIds = new[] { id } }));
        Assert.Equal(id, release.GetProperty("titleIds")[0].GetInt32());

        // watched: the same title moves to the Watchlog, with its added date, poster and disc
        var watched = await client.PutAsJsonAsync($"/api/titles/{id}", new
        {
            name = "Prometheus", type = "Film", list = "Watched", watchlistAddedOn = "2026-01-02", rating = 6,
            watches = new[] { new { date = "2026-03-01" } }, genres = new[] { "Sci-Fi" }, posterPath = "/alien.jpg", tmdbId = 348, tmdbMediaType = "movie",
        });
        Assert.Equal(HttpStatusCode.OK, watched.StatusCode);
        var title = await JsonAsync(watched);
        Assert.Equal(id, title.GetProperty("id").GetInt32());
        Assert.Equal("Watched", title.GetProperty("list").GetString());
        Assert.Equal("2026-01-02", title.GetProperty("watchlistAddedOn").GetString());
        Assert.Equal("Prometheus Blu-ray", title.GetProperty("releases")[0].GetProperty("name").GetString());

        // back on the watchlist for a rewatch: its rating and watches stay
        var back = await JsonAsync(await client.PutAsJsonAsync($"/api/titles/{id}", new
        {
            name = "Prometheus", type = "Film", list = "Watchlist", watchlistAddedOn = Today, rating = 6, watchCount = 1,
            firstWatch = "2026-03-01", latestWatch = "2026-03-01", genres = new[] { "Sci-Fi" },
        }));
        Assert.Equal("Watchlist", back.GetProperty("list").GetString());
        Assert.Equal(Today, back.GetProperty("watchlistAddedOn").GetString());
        Assert.Equal(6m, back.GetProperty("rating").GetDecimal());
        Assert.Equal(1, back.GetProperty("watchCount").GetInt32());
        Assert.Single(back.GetProperty("releases").EnumerateArray());

        // a watchlist title sent without a date keeps the one it has
        var kept = await JsonAsync(await client.PutAsJsonAsync($"/api/titles/{id}", new { name = "Prometheus", type = "Film", list = "Watchlist", watchCount = 1 }));
        Assert.Equal(Today, kept.GetProperty("watchlistAddedOn").GetString());

        // undoing a move: back to the Watchlog with no date, as it was before
        var undone = await JsonAsync(await client.PutAsJsonAsync($"/api/titles/{id}", new { name = "Prometheus", type = "Film", list = "Watched", watchCount = 1, watchlistAddedOn = (string?)null }));
        Assert.Equal("Watched", undone.GetProperty("list").GetString());
        Assert.Equal(JsonValueKind.Null, undone.GetProperty("watchlistAddedOn").ValueKind);
    }

    [Fact]
    public async Task Anonymous_visitors_can_read_the_watchlist_but_not_add_to_it()
    {
        var client = _app.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/titles?list=watchlist")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/titles", ToWatch("x"))).StatusCode);
    }

    [Fact]
    public async Task Watchlist_pages_are_served()
    {
        var resp = await _app.CreateClient().GetAsync("/watchlist");
        var html = await resp.Content.ReadAsStringAsync();
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        Assert.Contains("data-list=\"watchlist\"", html);
        Assert.Contains("<h1 class=\"hero-title\">Watchlist</h1>", html);
        Assert.Matches(@"js/app\.js\?v=\d{12}", html);
        Assert.Matches(@"js/lists\.js\?v=\d{12}", html);
        Assert.Matches(@"js/pwa\.js\?v=\d{12}", html);

        var edit = await _app.CreateClient().GetStringAsync("/watchlist/new");
        Assert.Matches(@"js/edit-page\.js\?v=\d{12}", edit);
    }
}
