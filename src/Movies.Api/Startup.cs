using System.Globalization;
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Movies.Api.Auth;
using Movies.Api.Data;
using Movies.Api.Import;

namespace Movies.Api;

public static class Startup
{
    public static async Task MigrateAndSeedAsync(IServiceProvider services)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MoviesDbContext>();
        if (db.Database.IsRelational()) await MigrateAsync(db);
        else await db.Database.EnsureCreatedAsync();

        var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole>>();
        foreach (var role in Roles.All)
            if (!await roles.RoleExistsAsync(role))
                await roles.CreateAsync(new IdentityRole(role));
    }

    /// <summary>
    /// Applies migrations. Titles used to hold their formats, price and CeX links; when the migration that
    /// drops those columns is still to come, the database is first taken to the one that adds releases,
    /// the old fields are converted into releases, and only then are the columns dropped.
    /// </summary>
    public static async Task MigrateAsync(MoviesDbContext db)
    {
        var pending = (await db.Database.GetPendingMigrationsAsync()).ToList();
        if (pending.Any(m => m.EndsWith("_DropTitleShelfColumns")))
        {
            await db.GetService<IMigrator>().MigrateAsync("PhysicalReleases");
            await ConvertShelvesAsync(db);
        }
        await db.Database.MigrateAsync();
    }

    private static async Task ConvertShelvesAsync(MoviesDbContext db)
    {
        if (await db.Releases.AnyAsync()) return;

        var shelves = new List<ReleaseConversion.Shelf>();
        var conn = db.Database.GetDbConnection();
        await db.Database.OpenConnectionAsync();
        try
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT Id, Name, PhysicalFormats, PricePaid, CexLinks FROM Titles ORDER BY Name";
            await using var r = await cmd.ExecuteReaderAsync();
            static List<string> List(object v) => v is string s && s.Length > 0 ? JsonSerializer.Deserialize<List<string>>(s) ?? [] : [];
            while (await r.ReadAsync())
            {
                decimal? price = r.IsDBNull(3) ? null : Convert.ToDecimal(r.GetValue(3), CultureInfo.InvariantCulture);
                shelves.Add(new(r.GetInt32(0), r.GetString(1), List(r.GetValue(2)), price, List(r.GetValue(4))));
            }
        }
        finally
        {
            await db.Database.CloseConnectionAsync();
        }

        foreach (var p in ReleaseConversion.Plan(shelves))
        {
            p.Release.TitleLinks = p.TitleIds.Select(id => new TitleRelease { TitleId = id }).ToList();
            db.Releases.Add(p.Release);
        }
        await db.SaveChangesAsync();
    }
}
