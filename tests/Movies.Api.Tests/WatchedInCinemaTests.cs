using System.Net.Http.Json;
using System.Text.Json;

namespace Movies.Api.Tests;

// Its own test server: ApiTests already signs in several times, and the sign-in rate limit is per server.
public class WatchedInCinemaTests : IClassFixture<TestApp>
{
    private readonly TestApp _app;
    public WatchedInCinemaTests(TestApp app) => _app = app;

    [Fact]
    public async Task Watched_in_cinema_is_saved_and_defaults_to_false()
    {
        await _app.CreateUserAsync("cinemagoer", "correct-horse-battery", "Editor");
        var client = await _app.SignedInWithMfaAsync("cinemagoer", "correct-horse-battery");

        var plain = await (await client.PostAsJsonAsync("/api/titles", new { name = "Not At The Cinema", type = "Film", rating = 8, watchCount = 1, genres = new[] { "Drama" } })).Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(plain.GetProperty("watchedInCinema").GetBoolean());

        var body = new { name = "Seen At The Cinema", type = "Film", rating = 9, watchCount = 1, genres = new[] { "Drama" }, watchedInCinema = true };
        var created = await (await client.PostAsJsonAsync("/api/titles", body)).Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(created.GetProperty("watchedInCinema").GetBoolean());

        var id = created.GetProperty("id").GetInt32();
        var fetched = await _app.CreateClient().GetFromJsonAsync<JsonElement>($"/api/titles/{id}");
        Assert.True(fetched.GetProperty("watchedInCinema").GetBoolean());

        var off = await (await client.PutAsJsonAsync($"/api/titles/{id}", new { body.name, body.type, body.rating, body.watchCount, body.genres, watchedInCinema = false })).Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(off.GetProperty("watchedInCinema").GetBoolean());
    }
}
