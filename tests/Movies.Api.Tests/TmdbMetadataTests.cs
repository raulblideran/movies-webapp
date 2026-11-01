using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Movies.Api.Data;
using Movies.Api.Services;

namespace Movies.Api.Tests;

public class TmdbMetadataTests : IClassFixture<TestApp>
{
    private readonly TestApp _app;
    public TmdbMetadataTests(TestApp app) => _app = app;

    private static TmdbDetailsResponse Parse(string json) => JsonSerializer.Deserialize<TmdbDetailsResponse>(json)!;

    [Fact]
    public void Film_details_give_runtime_synopsis_trailer_collection_and_credits()
    {
        var d = TmdbDetails.From("movie", Parse("""
        {
          "id": 348, "title": "Alien", "release_date": "1979-05-25", "runtime": 117,
          "overview": "  The crew of a commercial spacecraft…  ",
          "belongs_to_collection": { "id": 8091, "name": "Alien Collection" },
          "videos": { "results": [
            { "key": "teaser1", "site": "YouTube", "type": "Teaser", "official": true, "iso_639_1": "en" },
            { "key": "fan", "site": "YouTube", "type": "Trailer", "official": false, "iso_639_1": "en" },
            { "key": "vimeo", "site": "Vimeo", "type": "Trailer", "official": true, "iso_639_1": "en" },
            { "key": "official", "site": "YouTube", "type": "Trailer", "official": true, "iso_639_1": "en" }
          ] },
          "credits": {
            "cast": [
              { "id": 2, "name": "John Hurt", "order": 3 },
              { "id": 1, "name": "Sigourney Weaver", "profile_path": "/sw.jpg", "order": 0 }
            ],
            "crew": [
              { "id": 9, "name": "Ridley Scott", "job": "Director", "profile_path": "/rs.jpg" },
              { "id": 10, "name": "Jerry Goldsmith", "job": "Original Music Composer" }
            ]
          }
        }
        """));
        Assert.Equal<int?>(117, d.Runtime);
        Assert.Equal(new DateOnly(1979, 5, 25), d.ReleaseDate);
        Assert.Equal("The crew of a commercial spacecraft…", d.Overview);
        Assert.Equal("official", d.TrailerKey);
        Assert.Equal<int?>(8091, d.CollectionId);
        Assert.Equal("Alien Collection", d.CollectionName);
        Assert.Equal(new[] { "Ridley Scott:Director", "Sigourney Weaver:Cast", "John Hurt:Cast" },
            d.Credits!.Select(c => $"{c.Name}:{c.Job}"));
        Assert.Equal("/sw.jpg", d.Credits![1].ProfilePath);
    }

    [Fact]
    public void Series_details_use_episode_length_creators_and_whole_run_cast()
    {
        var d = TmdbDetails.From("tv", Parse("""
        {
          "id": 1399, "name": "Game of Thrones", "first_air_date": "2011-04-17",
          "episode_run_time": [], "last_episode_to_air": { "runtime": 58 },
          "created_by": [ { "id": 5, "name": "David Benioff" }, { "id": 6, "name": "D. B. Weiss" } ],
          "aggregate_credits": { "cast": [
            { "id": 20, "name": "Guest", "order": 0, "total_episode_count": 2 },
            { "id": 21, "name": "Emilia Clarke", "order": 1, "total_episode_count": 62 }
          ] }
        }
        """));
        Assert.Equal<int?>(58, d.Runtime);
        Assert.Equal(new DateOnly(2011, 4, 17), d.ReleaseDate); // its first air date
        Assert.Null(d.CollectionId);
        Assert.Null(d.TrailerKey);
        Assert.Equal(new[] { "David Benioff:Creator", "D. B. Weiss:Creator", "Emilia Clarke:Cast", "Guest:Cast" },
            d.Credits!.Select(c => $"{c.Name}:{c.Job}"));
    }

    [Fact]
    public async Task Saving_keeps_tmdb_metadata_and_removing_the_link_clears_it()
    {
        await _app.CreateUserAsync("meta-editor", "correct-horse-battery", "Editor");
        var client = await _app.SignedInWithMfaAsync("meta-editor", "correct-horse-battery");
        var body = new { name = "Alien", type = "Film", watchCount = 1, rating = 9, tmdbId = 348, tmdbMediaType = "movie", genres = new[] { "Horror" } };
        var created = await (await client.PostAsJsonAsync("/api/titles", body)).Content.ReadFromJsonAsync<JsonElement>();
        var id = created.GetProperty("id").GetInt32();

        // what the background sync would have stored (the test app has no TMDB key)
        using (var scope = _app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<MoviesDbContext>();
            var t = await db.Titles.SingleAsync(x => x.Id == id);
            t.Runtime = 117;
            t.Overview = "In space no one can hear you scream.";
            t.TrailerKey = "abc";
            t.CollectionId = 8091;
            t.CollectionName = "Alien Collection";
            t.Credits = [new(9, "Ridley Scott", "/rs.jpg", Credit.Director, 0), new(1, "Sigourney Weaver", null, Credit.Cast, 0)];
            t.TmdbSyncedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
        }

        // an ordinary edit (or a move to the watchlist) keeps it all
        var moved = await (await client.PutAsJsonAsync($"/api/titles/{id}", new { name = "Alien", type = "Film", list = "Watchlist", watchCount = 1, tmdbId = 348, tmdbMediaType = "movie" }))
            .Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(117, moved.GetProperty("runtime").GetInt32());
        Assert.Equal("Alien Collection", moved.GetProperty("collectionName").GetString());
        Assert.Equal("Ridley Scott", moved.GetProperty("directors")[0].GetString());
        Assert.Equal("Sigourney Weaver", moved.GetProperty("cast")[0].GetString());

        // the Stats page's people
        var people = await _app.CreateClient().GetFromJsonAsync<JsonElement>("/api/titles/people");
        Assert.Equal("Ridley Scott", people.GetProperty("people").GetProperty("9").GetProperty("name").GetString());
        Assert.Equal("https://image.tmdb.org/t/p/w185/rs.jpg", people.GetProperty("people").GetProperty("9").GetProperty("photoUrl").GetString());
        var forTitle = people.GetProperty("titles").GetProperty(id.ToString());
        Assert.Equal(9, forTitle.GetProperty("directors")[0].GetInt32());
        Assert.Equal(1, forTitle.GetProperty("cast")[0].GetInt32());

        // no TMDB link, nothing from TMDB
        var cleared = await (await client.PutAsJsonAsync($"/api/titles/{id}", new { name = "Alien", type = "Film", watchCount = 1 }))
            .Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(JsonValueKind.Null, cleared.GetProperty("runtime").ValueKind);
        Assert.Equal(JsonValueKind.Null, cleared.GetProperty("collectionId").ValueKind);
        Assert.Empty(cleared.GetProperty("directors").EnumerateArray());
    }

    [Fact]
    public async Task Collection_endpoint_is_public_and_needs_tmdb()
    {
        // no TMDB key in the test app
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await _app.CreateClient().GetAsync("/api/tmdb/collection/8091")).StatusCode);
    }
}
