using Microsoft.EntityFrameworkCore;
using Movies.Api.Data;

namespace Movies.Api.Services;

/// <summary>
/// Fills in what TMDB knows about a title (runtime, synopsis, trailer, collection, credits): when its
/// TMDB link is saved, and for older titles from a daily background pass (TmdbMetadataRefreshService).
/// </summary>
public class TmdbMetadataService(MoviesDbContext db, TmdbClient tmdb, ILogger<TmdbMetadataService> logger)
{
    /// <summary>Metadata older than this is fetched again (trailers and cast lists do change).</summary>
    public static readonly TimeSpan MaxAge = TimeSpan.FromDays(30);

    public static void Clear(Title t)
    {
        t.Runtime = null;
        t.Overview = null;
        t.ReleaseDate = null;
        t.TrailerKey = null;
        t.CollectionId = null;
        t.CollectionName = null;
        t.Credits = [];
        t.VoteAverage = null;
        t.VoteCount = null;
        t.OriginalLanguage = null;
        t.Countries = [];
        t.TmdbSyncedAt = null;
    }

    public static void Apply(Title t, TmdbDetails d)
    {
        t.Runtime = d.Runtime;
        t.Overview = d.Overview is { Length: > 4000 } o ? o[..4000] : d.Overview;
        t.ReleaseDate = d.ReleaseDate;
        t.TrailerKey = d.TrailerKey;
        t.CollectionId = d.CollectionId;
        t.CollectionName = d.CollectionName;
        t.Credits = d.Credits ?? [];
        t.VoteAverage = d.VoteAverage;
        t.VoteCount = d.VoteCount;
        t.OriginalLanguage = d.OriginalLanguage;
        t.Countries = d.Countries ?? [];
        t.TmdbSyncedAt = DateTime.UtcNow;
    }

    /// <summary>
    /// After a title is saved: a changed (or never fetched) TMDB link is looked up now, best effort, and
    /// a removed one clears what came from it. Returns true when the title changed.
    /// </summary>
    public async Task<bool> RefreshAfterSaveAsync(Title t, bool tmdbChanged, CancellationToken ct = default)
    {
        if (t.TmdbId is null || t.TmdbMediaType is null)
        {
            if (t.TmdbSyncedAt is null && t.Credits.Count == 0 && t.Runtime is null) return false;
            Clear(t);
            return true;
        }
        if (!tmdbChanged && t.TmdbSyncedAt is not null) return false;
        return await SyncAsync(t, ct);
    }

    /// <summary>Fetches and applies TMDB's details. False when TMDB is off or couldn't be reached (it's tried again later).</summary>
    public async Task<bool> SyncAsync(Title t, CancellationToken ct = default)
    {
        if (!tmdb.Enabled || t.TmdbId is not { } id || t.TmdbMediaType is not { } type) return false;
        try
        {
            var d = await tmdb.GetDetailsAsync(type, id, ct);
            if (d is null)
            {
                // TMDB has nothing at that id any more: keep the link, drop what came from it
                Clear(t);
                t.TmdbSyncedAt = DateTime.UtcNow;
            }
            else Apply(t, d);
            return true;
        }
        catch (TmdbUnavailableException)
        {
            return false;
        }
    }

    /// <summary>Every title with a TMDB link that was never fetched, or not for a while. Saves as it goes.</summary>
    public async Task<int> SyncStaleAsync(TimeSpan delay, CancellationToken ct)
    {
        if (!tmdb.Enabled) return 0;
        var cutoff = DateTime.UtcNow - MaxAge;
        var ids = await db.Titles
            .Where(t => t.TmdbId != null && t.TmdbMediaType != null && (t.TmdbSyncedAt == null || t.TmdbSyncedAt < cutoff))
            .OrderBy(t => t.TmdbSyncedAt != null).ThenBy(t => t.TmdbSyncedAt)
            .Select(t => t.Id)
            .ToListAsync(ct);
        int done = 0, failures = 0;
        foreach (var id in ids)
        {
            var t = await db.Titles.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (t is null) continue;
            if (await SyncAsync(t, ct))
            {
                await db.SaveChangesAsync(ct);
                done++;
                failures = 0;
            }
            else if (++failures >= 3)
            {
                logger.LogWarning("TMDB metadata sync stopped after 3 failures in a row ({Done} of {Total} done)", done, ids.Count);
                break;
            }
            db.ChangeTracker.Clear();
            await Task.Delay(delay, ct);
        }
        if (done > 0) logger.LogInformation("TMDB metadata refreshed for {Done} titles", done);
        return done;
    }
}

/// <summary>Brings TMDB metadata up to date shortly after startup, then once a day.</summary>
public class TmdbMetadataRefreshService(IServiceScopeFactory scopes, IConfiguration config, ILogger<TmdbMetadataRefreshService> logger)
    : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!config.GetValue("Tmdb:BackgroundSync", true)) return;
        await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
        using var timer = new PeriodicTimer(TimeSpan.FromDays(1));
        do
        {
            try
            {
                using var scope = scopes.CreateScope();
                await scope.ServiceProvider.GetRequiredService<TmdbMetadataService>().SyncStaleAsync(TimeSpan.FromMilliseconds(250), stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "TMDB metadata refresh failed");
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
