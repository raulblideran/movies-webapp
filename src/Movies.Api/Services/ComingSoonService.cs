using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Movies.Api.Data;

namespace Movies.Api.Services;

/// <summary>TMDB lookups that anyone can trigger (the popup, person pages, Coming soon), kept for a day.</summary>
public static class TmdbCached
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromHours(24);

    public static async Task<TmdbCollection?> CollectionAsync(TmdbClient tmdb, IMemoryCache cache, int id, CancellationToken ct)
    {
        if (cache.TryGetValue($"tmdb-collection:{id}", out TmdbCollection? hit)) return hit;
        var c = await tmdb.GetCollectionAsync(id, ct);
        if (c is not null) cache.Set($"tmdb-collection:{id}", c, Lifetime);
        return c;
    }

    public static async Task<TmdbPersonDetails?> PersonAsync(TmdbClient tmdb, IMemoryCache cache, int id, CancellationToken ct)
    {
        if (cache.TryGetValue($"tmdb-person:{id}", out TmdbPersonDetails? hit)) return hit;
        var p = await tmdb.GetPersonAsync(id, ct);
        if (p is not null) cache.Set($"tmdb-person:{id}", p, Lifetime);
        return p;
    }
}

/// <summary>
/// Films not out yet that you'd want to know about: the next ones in franchises you've started, and the next
/// ones from the directors you've watched most. Worked out at most twice a day (it's a TMDB call per
/// franchise and director).
/// </summary>
public class ComingSoonService(MoviesDbContext db, TmdbClient tmdb, IMemoryCache cache, ILogger<ComingSoonService> logger)
{
    public record Item(int Id, string Title, string? ReleaseDate, string? PosterUrl, List<string> Reasons);

    /// <summary>How many of the directors you've watched most are followed (each with at least two titles watched).</summary>
    public const int Directors = 12;

    private const string CacheKey = "coming-soon";
    private static readonly SemaphoreSlim Gate = new(1, 1);

    public async Task<List<Item>> GetAsync(CancellationToken ct)
    {
        if (cache.TryGetValue(CacheKey, out List<Item>? hit)) return hit!;
        await Gate.WaitAsync(ct);
        try
        {
            if (cache.TryGetValue(CacheKey, out hit)) return hit!;
            var (items, complete) = await BuildAsync(ct);
            // when TMDB failed part-way, try again sooner
            cache.Set(CacheKey, items, complete ? TimeSpan.FromHours(12) : TimeSpan.FromMinutes(30));
            return items;
        }
        finally
        {
            Gate.Release();
        }
    }

    private async Task<(List<Item>, bool Complete)> BuildAsync(CancellationToken ct)
    {
        var titles = await db.Titles.AsNoTracking()
            .Select(t => new { t.TmdbId, t.TmdbMediaType, t.CollectionId, t.List, t.Credits })
            .ToListAsync(ct);
        var have = titles.Where(t => t.TmdbId is not null && t.TmdbMediaType == "movie").Select(t => t.TmdbId!.Value).ToHashSet();
        var today = UkTime.Today().ToString("yyyy-MM-dd");
        var items = new Dictionary<int, Item>();
        var complete = true;

        void Add(int id, string title, string? date, string? poster, string reason)
        {
            if (have.Contains(id) || (date is not null && string.CompareOrdinal(date, today) <= 0)) return;
            if (items.TryGetValue(id, out var item)) { if (!item.Reasons.Contains(reason)) item.Reasons.Add(reason); }
            else items[id] = new Item(id, title, date, poster, [reason]);
        }

        foreach (var id in titles.Where(t => t.CollectionId is not null).Select(t => t.CollectionId!.Value).Distinct())
        {
            try
            {
                var c = await TmdbCached.CollectionAsync(tmdb, cache, id, ct);
                // only a franchise you've started: one you have a film of (every collection here is)
                foreach (var p in c?.Parts ?? []) Add(p.Id, p.Title, p.ReleaseDate, p.PosterUrl, $"Next in {c!.Name}");
            }
            catch (TmdbUnavailableException)
            {
                complete = false;
            }
        }

        var directors = titles.Where(t => t.List == TitleList.Watched)
            .SelectMany(t => t.Credits.Where(c => c.Job == Credit.Director).Select(c => (c.Id, c.Name)).Distinct())
            .GroupBy(c => c.Id)
            .Where(g => g.Count() >= 2)
            .OrderByDescending(g => g.Count())
            .Take(Directors)
            .Select(g => g.First());
        foreach (var (id, name) in directors)
        {
            try
            {
                var p = await TmdbCached.PersonAsync(tmdb, cache, id, ct);
                foreach (var w in p?.Works ?? [])
                    if (w.MediaType == "movie" && w.Roles.Contains("Director"))
                        Add(w.Id, w.Title, w.ReleaseDate, w.PosterUrl?.Replace("/w342", "/w500"), $"Directed by {name}");
            }
            catch (TmdbUnavailableException)
            {
                complete = false;
            }
        }
        if (!complete) logger.LogWarning("Coming soon: TMDB failed for some franchises or directors");

        // dated first, soonest first; then the ones TMDB has no date for yet
        var list = items.Values.OrderBy(i => i.ReleaseDate is null).ThenBy(i => i.ReleaseDate).ThenBy(i => i.Title).ToList();
        return (list, complete);
    }
}
