using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Movies.Api.Auth;
using Movies.Api.Data;
using Movies.Api.Import;
using Movies.Api.Services;

namespace Movies.Api;

/// <summary>
///   import (--file path.csv | --url https://…csv) [--replace] [--no-posters]
///   create-user &lt;username&gt; [--role Admin|Editor]     (password read from stdin / prompt)
/// </summary>
public static class Cli
{
    public static bool IsCommand(string arg) => arg is "import" or "create-user" or "cex-add";

    public static async Task<int> RunAsync(IServiceProvider services, string[] args)
    {
        using var scope = services.CreateScope();
        var sp = scope.ServiceProvider;
        try
        {
            return args[0] switch
            {
                "import" => await ImportAsync(sp, args[1..]),
                "create-user" => await CreateUserAsync(sp, args[1..]),
                "cex-add" => await CexAddAsync(sp, args[1..]),
                _ => 1,
            };
        }
        catch (CliException ex)
        {
            Console.Error.WriteLine(ex.Message);
            return 1;
        }
    }

    private static string? Option(string[] args, string name)
    {
        var i = Array.IndexOf(args, name);
        return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
    }

    private static async Task<int> ImportAsync(IServiceProvider sp, string[] args)
    {
        var file = Option(args, "--file");
        var url = Option(args, "--url");
        // Allow `import path-or-url` without a flag.
        if (file is null && url is null && args.Length > 0 && !args[0].StartsWith("--"))
        {
            if (args[0].StartsWith("http")) url = args[0]; else file = args[0];
        }
        if (file is null && url is null) throw new CliException("Usage: import (--file path.csv | --url https://…) [--replace] [--no-posters]");

        string csvText;
        if (url is not null)
        {
            using var http = new HttpClient();
            csvText = await http.GetStringAsync(url);
        }
        else
        {
            if (!File.Exists(file)) throw new CliException($"File not found: {file}");
            csvText = await File.ReadAllTextAsync(file!);
        }

        var parsed = SheetCsv.Parse(new StringReader(csvText));
        var db = sp.GetRequiredService<MoviesDbContext>();
        var existing = await db.Titles.CountAsync();
        if (existing > 0 && !args.Contains("--replace"))
            throw new CliException($"The database already has {existing} titles. Re-run with --replace to delete them and import again.");

        var tmdb = sp.GetRequiredService<TmdbClient>();
        var resolvePosters = tmdb.Enabled && !args.Contains("--no-posters");
        if (!tmdb.Enabled) Console.WriteLine("Tmdb__ApiKey not set: skipping poster lookup.");

        if (resolvePosters)
        {
            Console.Write($"Looking up posters for {parsed.Titles.Count} titles ");
            var missing = new List<string>();
            foreach (var t in parsed.Titles)
            {
                var anime = t.Genres.Any(g => g.Contains("anime", StringComparison.OrdinalIgnoreCase));
                var best = await tmdb.FindBestAsync(t.Name, t.ReleaseYear, anime);
                if (best?.PosterPath is not null)
                {
                    t.TmdbId = best.Id;
                    t.TmdbMediaType = best.MediaType;
                    t.PosterPath = best.PosterPath;
                }
                else missing.Add(t.Name);
                Console.Write('.');
                await Task.Delay(30); // stay well under TMDB's rate limit
            }
            Console.WriteLine();
            foreach (var m in missing) parsed.Anomalies.Add($"no poster found for \"{m}\"");
        }

        await using var tx = await db.Database.BeginTransactionAsync();
        if (existing > 0) await db.Titles.ExecuteDeleteAsync();
        db.Titles.AddRange(parsed.Titles);
        await db.SaveChangesAsync();
        await tx.CommitAsync();

        Console.WriteLine($"Imported {parsed.Titles.Count} titles{(existing > 0 ? $" (replaced {existing})" : "")}.");
        if (parsed.Anomalies.Count > 0)
        {
            Console.WriteLine($"{parsed.Anomalies.Count} things to check:");
            foreach (var a in parsed.Anomalies) Console.WriteLine("  - " + a);
        }
        return 0;
    }

    private static async Task<int> CreateUserAsync(IServiceProvider sp, string[] args)
    {
        if (args.Length == 0 || args[0].StartsWith("--")) throw new CliException("Usage: create-user <username> [--role Admin|Editor]");
        var userName = args[0];
        var role = Option(args, "--role") ?? Roles.Admin;
        if (!Roles.All.Contains(role)) throw new CliException("Role must be Admin or Editor.");

        var users = sp.GetRequiredService<UserManager<IdentityUser>>();
        if (await users.FindByNameAsync(userName) is not null) throw new CliException($"User '{userName}' already exists.");

        var password = ReadPassword("Password: ");
        if (!Console.IsInputRedirected && ReadPassword("Confirm:  ") != password) throw new CliException("Passwords don't match.");

        var user = new IdentityUser { UserName = userName, LockoutEnabled = true };
        var result = await users.CreateAsync(user, password);
        if (!result.Succeeded) throw new CliException(string.Join(Environment.NewLine, result.Errors.Select(e => e.Description)));
        await users.AddToRoleAsync(user, role);
        Console.WriteLine($"Created {role} '{userName}'. Sign in on the site and you'll be asked to set up MFA.");
        return 0;
    }

    /// <summary>cex-add &lt;link&gt; [&lt;link&gt; …]: track CeX products on the stock tracker page.</summary>
    private static async Task<int> CexAddAsync(IServiceProvider sp, string[] links)
    {
        if (links.Length == 0) throw new CliException("Usage: cex-add <cex-link> [<cex-link> …]");
        var service = sp.GetRequiredService<CexItemsService>();
        var failed = 0;
        foreach (var link in links)
        {
            var result = await service.AddAsync(link, null);
            Console.WriteLine(result switch
            {
                CexItemsService.Added a => $"  + {a.Item.Title} (£{a.Item.SellPrice})",
                CexItemsService.Duplicate d => $"  = already tracked: {d.Existing.Title}",
                CexItemsService.NotFound n => $"  ! CeX doesn't know {n.Sku}",
                CexItemsService.Invalid i => $"  ! {link}: {i.Message}",
                _ => "  ?",
            });
            if (result is CexItemsService.NotFound or CexItemsService.Invalid) failed++;
            await Task.Delay(300);
        }
        return failed == 0 ? 0 : 1;
    }

    private static string ReadPassword(string prompt)
    {
        if (Console.IsInputRedirected) return Console.ReadLine() ?? "";
        Console.Write(prompt);
        var chars = new System.Text.StringBuilder();
        while (true)
        {
            var key = Console.ReadKey(intercept: true);
            if (key.Key == ConsoleKey.Enter) break;
            if (key.Key == ConsoleKey.Backspace) { if (chars.Length > 0) chars.Length--; }
            else if (!char.IsControl(key.KeyChar)) chars.Append(key.KeyChar);
        }
        Console.WriteLine();
        return chars.ToString();
    }

    private class CliException(string message) : Exception(message);
}
