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
            return Results.Ok(ordered.Where(r => r.PosterPath is not null).Take(20).Select(r => new
            {
                r.Id,
                r.MediaType,
                Title = r.DisplayTitle,
                Year = r.Date is { Length: >= 4 } d ? d[..4] : null,
                r.PosterPath,
                PosterUrl = Contracts.TitleDto.PosterBaseUrl + r.PosterPath,
            }));
        }).RequireAuthorization(Policies.Editor);
    }

    [GeneratedRegex(@"^[A-Za-z0-9\-]{1,40}$")]
    private static partial Regex SkuRegex();
}
