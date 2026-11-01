using Microsoft.EntityFrameworkCore;
using Movies.Api.Auth;
using Movies.Api.Contracts;
using Movies.Api.Data;
using Movies.Api.Import;
using Movies.Api.Services;

namespace Movies.Api.Endpoints;

public static class TitlesEndpoints
{
    public static void MapTitlesEndpoints(this IEndpointRouteBuilder app)
    {
        var titles = app.MapGroup("/api/titles");

        // ?list=watched or ?list=watchlist for one page's titles; without it, both lists
        titles.MapGet("/", async (string? list, MoviesDbContext db) =>
        {
            var q = db.Titles.AsNoTrackingWithIdentityResolution();
            if (list is not null)
            {
                if (!Enum.TryParse<TitleList>(list, ignoreCase: true, out var which) || !Enum.IsDefined(which))
                    return Results.Problem("list must be watched or watchlist.", statusCode: 400);
                q = q.Where(t => t.List == which);
            }
            var all = await WithReleases(q).OrderBy(t => t.Name).ToListAsync();
            return Results.Ok(all.Select(TitleDto.From));
        });

        titles.MapGet("/{id:int}", async (int id, MoviesDbContext db) =>
            await WithReleases(db.Titles.AsNoTrackingWithIdentityResolution()).FirstOrDefaultAsync(t => t.Id == id) is { } t
                ? Results.Ok(TitleDto.From(t))
                : Results.NotFound());

        var write = titles.MapGroup("").RequireAuthorization(Policies.Editor);

        write.MapPost("/", async (TitleUpsertRequest req, MoviesDbContext db, TmdbMetadataService meta, CancellationToken ct) =>
        {
            var errors = req.Validate();
            if (errors.Count > 0) return Results.ValidationProblem(errors);
            var t = new Title { Name = "" };
            req.ApplyTo(t);
            var dated = req.WithWatches(t, isNew: true);
            await meta.RefreshAfterSaveAsync(t, tmdbChanged: true, ct);
            if (WatchSummary.BeforeRelease(t, dated) is { } early) return Results.ValidationProblem(new Dictionary<string, string[]> { ["Watches"] = [early] });
            db.Titles.Add(t);
            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/titles/{t.Id}", TitleDto.From(t));
        });

        write.MapPut("/{id:int}", async (int id, TitleUpsertRequest req, MoviesDbContext db, TmdbMetadataService meta, CancellationToken ct) =>
        {
            var errors = req.Validate();
            if (errors.Count > 0) return Results.ValidationProblem(errors);
            var t = await WithReleases(db.Titles).FirstOrDefaultAsync(x => x.Id == id, ct);
            if (t is null) return Results.NotFound();
            var (oldId, oldType) = (t.TmdbId, t.TmdbMediaType);
            req.ApplyTo(t);
            var dated = req.WithWatches(t, isNew: false);
            await meta.RefreshAfterSaveAsync(t, tmdbChanged: t.TmdbId != oldId || t.TmdbMediaType != oldType, ct);
            // checked once the TMDB link (and so the release date) is up to date; returning unsaved drops the changes
            if (WatchSummary.BeforeRelease(t, dated) is { } early) return Results.ValidationProblem(new Dictionary<string, string[]> { ["Watches"] = [early] });
            await db.SaveChangesAsync(ct);
            return Results.Ok(TitleDto.From(t));
        });

        // Who made and starred in what, for the Stats page's people: everyone once, and each title's ids.
        titles.MapGet("/people", async (MoviesDbContext db) =>
        {
            // credits only ever come from a TMDB sync (they're JSON, so the count can't be asked of the DB)
            var rows = await db.Titles.AsNoTracking().Where(t => t.TmdbSyncedAt != null)
                .Select(t => new { t.Id, t.Credits }).ToListAsync();
            rows = rows.Where(r => r.Credits.Count > 0).ToList();
            var people = new Dictionary<int, PersonDto>();
            foreach (var c in rows.SelectMany(r => r.Credits))
                people.TryAdd(c.Id, new PersonDto(c.Name, c.ProfilePath is null ? null : PersonDto.ProfileBaseUrl + c.ProfilePath));
            return Results.Ok(new
            {
                people,
                titles = rows.ToDictionary(r => r.Id, r => new TitlePeopleDto(
                    r.Credits.Where(c => c.Job != Credit.Cast).Select(c => c.Id).ToList(),
                    r.Credits.Where(c => c.Job == Credit.Cast).OrderBy(c => c.Order).Select(c => c.Id).ToList())),
            });
        });

        write.MapDelete("/{id:int}", async (int id, MoviesDbContext db) =>
        {
            var deleted = await db.Titles.Where(t => t.Id == id).ExecuteDeleteAsync();
            return deleted == 0 ? Results.NotFound() : Results.NoContent();
        });

        app.MapGet("/api/export.csv", async (MoviesDbContext db) =>
        {
            // the old sheet's format, so only the Watchlog
            var all = await WithReleases(db.Titles.AsNoTrackingWithIdentityResolution().Where(t => t.List == TitleList.Watched))
                .OrderBy(t => t.Name).ToListAsync();
            var csv = SheetCsv.Write(all);
            return Results.File(System.Text.Encoding.UTF8.GetBytes(csv), "text/csv",
                $"movies-{DateTime.UtcNow:yyyy-MM-dd}.csv");
        }).RequireAuthorization(Policies.Editor);
    }

    /// <summary>Titles with their watches and releases (and each release's title count) for TitleDto.</summary>
    public static IQueryable<Title> WithReleases(IQueryable<Title> q) =>
        q.Include(t => t.Watches).Include(t => t.ReleaseLinks).ThenInclude(l => l.Release).ThenInclude(r => r.TitleLinks).AsSplitQuery();
}
