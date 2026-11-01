using Microsoft.EntityFrameworkCore;
using Movies.Api.Auth;
using Movies.Api.Contracts;
using Movies.Api.Data;

namespace Movies.Api.Endpoints;

/// <summary>
/// One watch at a time (the title popup, "Watched again", the Watches page). Each answers with the title as
/// it is afterwards, its summary worked out again. Saving a title can also send its whole list (TitleUpsertRequest).
/// </summary>
public static class WatchesEndpoints
{
    public static void MapWatchesEndpoints(this IEndpointRouteBuilder app)
    {
        var write = app.MapGroup("/api").RequireAuthorization(Policies.Editor);

        write.MapPost("/titles/{titleId:int}/watches", async (int titleId, WatchRequest req, MoviesDbContext db) =>
        {
            if (req.Error() is { } error) return Results.ValidationProblem(new Dictionary<string, string[]> { ["Watch"] = [error] });
            var t = await TitlesEndpoints.WithReleases(db.Titles).FirstOrDefaultAsync(x => x.Id == titleId);
            if (t is null) return Results.NotFound();
            var w = req.ToWatch();
            t.Watches.Add(w);
            WatchSummary.Apply(t);
            await db.SaveChangesAsync();
            return Results.Created($"/api/watches/{w.Id}", new { watchId = w.Id, title = TitleDto.From(t) });
        });

        write.MapPut("/watches/{id:int}", async (int id, WatchRequest req, MoviesDbContext db) =>
        {
            if (req.Error() is { } error) return Results.ValidationProblem(new Dictionary<string, string[]> { ["Watch"] = [error] });
            var t = await TitleOfAsync(db, id);
            if (t is null) return Results.NotFound();
            req.ApplyTo(t.Watches.First(w => w.Id == id));
            WatchSummary.Apply(t);
            await db.SaveChangesAsync();
            return Results.Ok(TitleDto.From(t));
        });

        write.MapDelete("/watches/{id:int}", async (int id, MoviesDbContext db) =>
        {
            var t = await TitleOfAsync(db, id);
            if (t is null) return Results.NotFound();
            t.Watches.RemoveAll(w => w.Id == id);
            WatchSummary.Apply(t);
            await db.SaveChangesAsync();
            return Results.Ok(TitleDto.From(t));
        });

        // ---------- yearly goals (the Stats page) ----------

        app.MapGet("/api/goals", async (MoviesDbContext db) =>
            Results.Ok(await db.YearGoals.AsNoTracking().OrderBy(g => g.Year).Select(g => new { g.Year, g.Target }).ToListAsync()));

        write.MapPut("/goals/{year:int}", async (int year, GoalRequest req, MoviesDbContext db) =>
        {
            if (year is < 1900 or > 2200) return Results.ValidationProblem(new Dictionary<string, string[]> { ["Year"] = ["That year looks wrong."] });
            if (req.Target is < 1 or > 5000) return Results.ValidationProblem(new Dictionary<string, string[]> { ["Target"] = ["The goal must be between 1 and 5000 watches."] });
            var goal = await db.YearGoals.FindAsync(year);
            if (goal is null) db.YearGoals.Add(goal = new YearGoal { Year = year });
            goal.Target = req.Target;
            await db.SaveChangesAsync();
            return Results.Ok(new { goal.Year, goal.Target });
        });

        write.MapDelete("/goals/{year:int}", async (int year, MoviesDbContext db) =>
            await db.YearGoals.Where(g => g.Year == year).ExecuteDeleteAsync() == 0 ? Results.NotFound() : Results.NoContent());
    }

    private static Task<Title?> TitleOfAsync(MoviesDbContext db, int watchId) =>
        TitlesEndpoints.WithReleases(db.Titles).FirstOrDefaultAsync(t => t.Watches.Any(w => w.Id == watchId));

    public record GoalRequest(int Target);
}
