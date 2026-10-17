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

        titles.MapGet("/", async (MoviesDbContext db) =>
        {
            var all = await db.Titles.AsNoTracking().OrderBy(t => t.Name).ToListAsync();
            return all.Select(TitleDto.From);
        });

        titles.MapGet("/{id:int}", async (int id, MoviesDbContext db) =>
            await db.Titles.AsNoTracking().FirstOrDefaultAsync(t => t.Id == id) is { } t
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
            var t = await db.Titles.FindAsync(id);
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
            var all = await db.Titles.AsNoTracking().OrderBy(t => t.Name).ToListAsync();
            var csv = SheetCsv.Write(all);
            return Results.File(System.Text.Encoding.UTF8.GetBytes(csv), "text/csv",
                $"movies-{DateTime.UtcNow:yyyy-MM-dd}.csv");
        }).RequireAuthorization(Policies.Editor);
    }
}
