using System.Net;
using Movies.Api.Services;

namespace Movies.Api.Tests;

public class TmdbTests : IClassFixture<TestApp>
{
    private readonly TestApp _app;
    public TmdbTests(TestApp app) => _app = app;

    [Theory]
    [InlineData("https://www.themoviedb.org/movie/603-the-matrix", "movie", 603)]
    [InlineData("https://www.themoviedb.org/tv/1399-game-of-thrones/season/1", "tv", 1399)]
    [InlineData("https://www.themoviedb.org/ro/movie/603", "movie", 603)]
    [InlineData("https://themoviedb.org/movie/603?language=en-GB", "movie", 603)]
    [InlineData("  movie/603  ", "movie", 603)]
    [InlineData("tv/1399", "tv", 1399)]
    public void Parses_tmdb_links(string link, string mediaType, int id) =>
        Assert.Equal<(string, int)?>((mediaType, id), TmdbClient.ParseLink(link));

    [Theory]
    [InlineData("")]
    [InlineData("the matrix")]
    [InlineData("https://www.themoviedb.org/person/287")]
    [InlineData("https://www.themoviedb.org/movie/abc")]
    [InlineData("https://evil.example/movie/603")]
    [InlineData("https://themoviedb.org.evil.example/movie/603")]
    [InlineData("javascript:alert(1)")]
    public void Rejects_anything_else(string link) => Assert.Null(TmdbClient.ParseLink(link));

    [Fact]
    public void Details_split_tv_genres_and_spot_anime()
    {
        var d = TmdbDetails.From("tv", new TmdbDetailsResponse(
            37854, null, "One Piece", null, "1999-10-20", "/p.jpg", "ja", ["JP"],
            [new("Animation"), new("Action & Adventure")], 22, 1150));
        Assert.Equal("One Piece", d.Title);
        Assert.Equal("Series", d.Type);
        Assert.Equal<int?>(1999, d.Year);
        Assert.Equal(new[] { "Animation", "Action", "Adventure" }, d.Genres);
        Assert.Equal<(int?, int?)>((22, 1150), (d.Seasons, d.Episodes));
        Assert.True(d.IsAnime);
        Assert.Equal("https://image.tmdb.org/t/p/w500/p.jpg", d.PosterUrl);
    }

    [Fact]
    public async Task Details_endpoint_is_for_editors_and_checks_the_link()
    {
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await _app.CreateClient().GetAsync("/api/tmdb/details?link=movie/603")).StatusCode);

        await _app.CreateUserAsync("tmdblinker", "correct-horse-battery", "Editor");
        var client = await _app.SignedInWithMfaAsync("tmdblinker", "correct-horse-battery");
        Assert.Equal(HttpStatusCode.BadRequest,
            (await client.GetAsync("/api/tmdb/details?link=" + Uri.EscapeDataString("https://www.imdb.com/title/tt0133093"))).StatusCode);
        // The test app has no TMDB key, so a valid link stops there.
        Assert.Equal(HttpStatusCode.ServiceUnavailable,
            (await client.GetAsync("/api/tmdb/details?link=" + Uri.EscapeDataString("https://www.themoviedb.org/movie/603"))).StatusCode);
    }
}
