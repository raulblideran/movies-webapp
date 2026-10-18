using Microsoft.EntityFrameworkCore;
using Movies.Api.Auth;
using Movies.Api.Contracts;
using Movies.Api.Data;
using Movies.Api.Services;

namespace Movies.Api.Endpoints;

/// <summary>Physical releases: public read, Editor write.</summary>
public static class ReleasesEndpoints
{
    public static void MapReleasesEndpoints(this IEndpointRouteBuilder app)
    {
        var releases = app.MapGroup("/api/releases");

        releases.MapGet("/", async (MoviesDbContext db) =>
            (await db.Releases.AsNoTracking().Include(r => r.TitleLinks).OrderBy(r => r.Name).ToListAsync())
                .Select(ReleaseDto.From));

        releases.MapGet("/{id:int}", async (int id, MoviesDbContext db) =>
            await db.Releases.AsNoTracking().Include(r => r.TitleLinks).FirstOrDefaultAsync(r => r.Id == id) is { } r
                ? Results.Ok(ReleaseDto.From(r))
                : Results.NotFound());

        var write = releases.MapGroup("").RequireAuthorization(Policies.Editor);

        write.MapPost("/", async (ReleaseUpsertRequest req, MoviesDbContext db, CexClient cex, CancellationToken ct) =>
        {
            var r = new PhysicalRelease { Name = "" };
            if (await ApplyAsync(req, r, db, cex, ct) is { } problem) return problem;
            db.Releases.Add(r);
            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/releases/{r.Id}", ReleaseDto.From(r));
        });

        write.MapPut("/{id:int}", async (int id, ReleaseUpsertRequest req, MoviesDbContext db, CexClient cex, CancellationToken ct) =>
        {
            var r = await db.Releases.Include(x => x.TitleLinks).FirstOrDefaultAsync(x => x.Id == id, ct);
            if (r is null) return Results.NotFound();
            if (await ApplyAsync(req, r, db, cex, ct) is { } problem) return problem;
            await db.SaveChangesAsync(ct);
            return Results.Ok(ReleaseDto.From(r));
        });

        write.MapDelete("/{id:int}", async (int id, MoviesDbContext db) =>
        {
            var deleted = await db.Releases.Where(r => r.Id == id).ExecuteDeleteAsync();
            return deleted == 0 ? Results.NotFound() : Results.NoContent();
        });
    }

    /// <summary>Validates and copies the request onto the release. Returns a problem result, or null when it applied.</summary>
    private static async Task<IResult?> ApplyAsync(ReleaseUpsertRequest req, PhysicalRelease r, MoviesDbContext db, CexClient cex, CancellationToken ct)
    {
        var errors = req.Validate();
        var titleIds = (req.TitleIds ?? []).Distinct().ToList();
        if (titleIds.Count > 0)
        {
            var known = await db.Titles.Where(t => titleIds.Contains(t.Id)).Select(t => t.Id).ToListAsync(ct);
            if (known.Count != titleIds.Count) errors["TitleIds"] = ["Some of those titles don't exist."];
        }
        if (errors.Count > 0) return Results.ValidationProblem(errors);

        var sku = string.IsNullOrWhiteSpace(req.CexUrl) ? null : CexItemsService.ExtractSku(req.CexUrl);
        if (sku != r.CexSku)
        {
            r.CexSku = sku;
            r.CexUrl = sku is null ? null : CexItemsService.CanonicalUrl(sku);
            r.CexBoxName = null;
            r.ImageUrl = null;
            // Best effort: the name and picture come from CeX; the daily price snapshot fills them in otherwise.
            if (sku is not null && await cex.GetAsync(sku, ct) is { } d)
            {
                r.CexBoxName = d.BoxName;
                r.ImageUrl = d.ImageUrl;
            }
        }

        r.Name = string.IsNullOrWhiteSpace(req.Name) ? r.CexBoxName ?? sku ?? "Untitled release" : req.Name.Trim();
        r.Format = req.Format;
        r.Edition = req.Edition;
        r.PricePaid = req.PricePaid;
        r.Notes = string.IsNullOrWhiteSpace(req.Notes) ? null : req.Notes.Trim();

        r.TitleLinks.RemoveAll(l => !titleIds.Contains(l.TitleId));
        foreach (var id in titleIds.Where(id => r.TitleLinks.All(l => l.TitleId != id)))
            r.TitleLinks.Add(new TitleRelease { TitleId = id });
        return null;
    }
}
