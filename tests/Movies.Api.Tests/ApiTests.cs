using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Movies.Api.Tests;

public class ApiTests : IClassFixture<TestApp>
{
    private readonly TestApp _app;
    public ApiTests(TestApp app) => _app = app;

    private static object NewTitle(string name, decimal? rating = 8) =>
        new { name, type = "Film", rating, watchCount = 1, genres = new[] { "Drama" }, firstWatch = "2024-05-17" };

    [Fact]
    public async Task Anonymous_can_read_but_not_write()
    {
        var client = _app.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/titles")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/titles", NewTitle("x"))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.DeleteAsync("/api/titles/1")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/users")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/export.csv")).StatusCode);
    }

    [Fact]
    public async Task Version_is_the_build_date_and_time()
    {
        var v = await _app.CreateClient().GetFromJsonAsync<JsonElement>("/api/version");
        Assert.Matches(@"^\d{6}\.\d{4}$", v.GetProperty("version").GetString());
    }

    [Fact]
    public async Task Index_has_version_and_cache_busted_scripts()
    {
        var resp = await _app.CreateClient().GetAsync("/");
        var html = await resp.Content.ReadAsStringAsync();
        Assert.Equal("no-cache", resp.Headers.CacheControl?.ToString());
        Assert.DoesNotContain("{{version}}", html);
        Assert.Matches(@"v\d{6}\.\d{4}</span", html);
        Assert.Matches(@"js/app\.js\?v=\d{12}", html);
    }

    [Fact]
    public async Task Stats_page_is_served()
    {
        var html = await _app.CreateClient().GetStringAsync("/stats");
        Assert.Contains("Collection Stats", html);
        Assert.Matches(@"js/charts\.js\?v=\d{12}", html);
        Assert.Matches(@"js/stats\.js\?v=\d{12}", html);
    }

    [Theory]
    [InlineData("/titles/new")]
    [InlineData("/titles/12/edit")]
    public async Task Editor_pages_are_served(string path)
    {
        var resp = await _app.CreateClient().GetAsync(path);
        var html = await resp.Content.ReadAsStringAsync();
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        Assert.Contains("<base href=\"/\"", html);
        Assert.Matches(@"js/edit-page\.js\?v=\d{12}", html);
    }

    [Fact]
    public async Task Wrong_password_is_rejected()
    {
        await _app.CreateUserAsync("wrongpw", "correct-horse-battery", "Editor");
        var client = _app.CreateClient();
        var resp = await client.PostAsJsonAsync("/api/auth/login", new { userName = "wrongpw", password = "nope-nope-nope" });
        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    [Fact]
    public async Task Editing_requires_mfa_enrolment()
    {
        await _app.CreateUserAsync("nomfa", "correct-horse-battery", "Editor");
        var client = _app.CreateClient();
        (await client.PostAsJsonAsync("/api/auth/login", new { userName = "nomfa", password = "correct-horse-battery" })).EnsureSuccessStatusCode();

        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync("/api/titles", NewTitle("Blocked"))).StatusCode);
        var me = await client.GetFromJsonAsync<JsonElement>("/api/auth/me");
        Assert.False(me.GetProperty("canEdit").GetBoolean());
    }

    [Fact]
    public async Task Editor_with_mfa_can_crud_titles_but_not_manage_users()
    {
        await _app.CreateUserAsync("editor", "correct-horse-battery", "Editor");
        var client = await _app.SignedInWithMfaAsync("editor", "correct-horse-battery");

        var created = await client.PostAsJsonAsync("/api/titles", NewTitle("Test Film"));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var createdJson = await created.Content.ReadFromJsonAsync<JsonElement>();
        var id = createdJson.GetProperty("id").GetInt32();
        Assert.Equal("2024-05-17", createdJson.GetProperty("firstWatch").GetString()); // the day is kept

        var bad = await client.PutAsJsonAsync($"/api/titles/{id}", NewTitle("Test Film", rating: 12));
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);

        var ok = await client.PutAsJsonAsync($"/api/titles/{id}", NewTitle("Test Film Renamed", rating: 11));
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var fetched = await _app.CreateClient().GetFromJsonAsync<JsonElement>($"/api/titles/{id}");
        Assert.Equal("Test Film Renamed", fetched.GetProperty("name").GetString());
        Assert.Equal(11m, fetched.GetProperty("rating").GetDecimal());

        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/users")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/titles/{id}")).StatusCode);
    }

    [Fact]
    public async Task Second_sign_in_requires_the_authenticator_code()
    {
        await _app.CreateUserAsync("twostep", "correct-horse-battery", "Admin");
        var first = _app.CreateClient();
        (await first.PostAsJsonAsync("/api/auth/login", new { userName = "twostep", password = "correct-horse-battery" })).EnsureSuccessStatusCode();
        var setup = await (await first.PostAsync("/api/account/mfa/setup", null)).Content.ReadFromJsonAsync<TestApp.SetupDto>();
        (await first.PostAsJsonAsync("/api/account/mfa/enable", new { code = Totp.Code(setup!.SharedKey) })).EnsureSuccessStatusCode();

        var second = _app.CreateClient();
        var login = await second.PostAsJsonAsync("/api/auth/login", new { userName = "twostep", password = "correct-horse-battery" });
        Assert.True((await login.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("requiresMfa").GetBoolean());
        // Password alone isn't a session.
        Assert.Equal(HttpStatusCode.Unauthorized, (await second.PostAsJsonAsync("/api/titles", NewTitle("x"))).StatusCode);

        Assert.Equal(HttpStatusCode.Unauthorized,
            (await second.PostAsJsonAsync("/api/auth/login/mfa", new { code = "000000" })).StatusCode);
        (await second.PostAsJsonAsync("/api/auth/login/mfa", new { code = Totp.Code(setup.SharedKey) })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.OK, (await second.GetAsync("/api/users")).StatusCode);
    }
}

public class RateLimitTests : IClassFixture<TestApp>
{
    private readonly TestApp _app;
    public RateLimitTests(TestApp app) => _app = app;

    [Fact]
    public async Task Login_attempts_are_rate_limited()
    {
        var client = _app.CreateClient();
        var statuses = new List<HttpStatusCode>();
        for (var i = 0; i < 12; i++)
            statuses.Add((await client.PostAsJsonAsync("/api/auth/login", new { userName = "nobody", password = "whatever-whatever" })).StatusCode);
        Assert.Contains(HttpStatusCode.TooManyRequests, statuses);
    }
}
