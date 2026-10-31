using Microsoft.EntityFrameworkCore;
using Movies.Api.Auth;
using Movies.Api.Contracts;
using Movies.Api.Data;
using Movies.Api.Import;

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

        write.MapPost("/", async (TitleUpsertRequest req, MoviesDbContext db) =>
        {
            var errors = req.Validate();
            if (errors.Count > 0) return Results.ValidationProblem(errors);
            var t = new Title { Name = "" };
            req.ApplyTo(t);
            db.Titles.Add(t);
            await db.SaveChangesAsync();
            return Results.Created($"/api/titles/{t.Id}", TitleDto.From(t));
        });

        write.MapPut("/{id:int}", async (int id, TitleUpsertRequest req, MoviesDbContext db) =>
        {
            var errors = req.Validate();
            if (errors.Count > 0) return Results.ValidationProblem(errors);
            var t = await WithReleases(db.Titles).FirstOrDefaultAsync(x => x.Id == id);
            if (t is null) return Results.NotFound();
            req.ApplyTo(t);
            await db.SaveChangesAsync();
            return Results.Ok(TitleDto.From(t));
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

    /// <summary>Titles with their releases (and each release's title count) for TitleDto.</summary>
    public static IQueryable<Title> WithReleases(IQueryable<Title> q) =>
        q.Include(t => t.ReleaseLinks).ThenInclude(l => l.Release).ThenInclude(r => r.TitleLinks).AsSplitQuery();
}
