using System.Text.RegularExpressions;
using Movies.Api.Auth;
using Movies.Api.Services;

namespace Movies.Api.Endpoints;

public static partial class ExternalEndpoints
{
    public static void MapExternalEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/cex/{sku}", async (string sku, CexClient cex, CancellationToken ct) =>
        {
            if (!SkuRegex().IsMatch(sku)) return Results.BadRequest();
            return await cex.GetAsync(sku, ct) is { } d ? Results.Ok(d) : Results.NotFound();
        }).RequireRateLimiting("cex");

        app.MapGet("/api/tmdb/search", async (string q, int? year, bool? anime, TmdbClient tmdb, CancellationToken ct) =>
        {
            if (!tmdb.Enabled) return Results.Problem("TMDB API key is not configured.", statusCode: 503);
            var results = await tmdb.SearchAsync(q, ct);
            var best = TmdbClient.PickBest(results, year, anime == true);
            // Put the heuristic's pick first, keep the rest in TMDB order.
            var ordered = best is null ? results : results.Where(r => r != best).Prepend(best);
            // Results without a poster stay: picking one still fills the year, type and genres.
            return Results.Ok(ordered.Take(20).Select(r => new
            {
                r.Id,
                r.MediaType,
                Title = r.DisplayTitle,
                Year = r.Date is { Length: >= 4 } d ? d[..4] : null,
                r.PosterPath,
                PosterUrl = r.PosterPath is null ? null : Contracts.TitleDto.PosterBaseUrl + r.PosterPath,
            }));
        }).RequireAuthorization(Policies.Editor);

        // Fill the add/edit form from a pasted TMDB link.
        app.MapGet("/api/tmdb/details", async (string? link, TmdbClient tmdb, CancellationToken ct) =>
        {
            if (TmdbClient.ParseLink(link) is not { } parsed)
                return Results.Problem("That isn't a TMDB film or series link, e.g. https://www.themoviedb.org/movie/603-the-matrix", statusCode: 400);
            var (mediaType, id) = parsed;
            if (!tmdb.Enabled) return Results.Problem("TMDB API key is not configured.", statusCode: 503);
            try
            {
                return await tmdb.GetDetailsAsync(mediaType, id, ct) is { } d
                    ? Results.Ok(d)
                    : Results.Problem("TMDB has nothing at that link.", statusCode: 404);
            }
            catch (TmdbUnavailableException)
            {
                return Results.Problem("TMDB couldn't be reached. Try again in a moment.", statusCode: 502);
            }
        }).RequireAuthorization(Policies.Editor);
    }

    [GeneratedRegex(@"^[A-Za-z0-9\-]{1,40}$")]
    private static partial Regex SkuRegex();
}
