using System.Text.Json.Serialization;

namespace Movies.Api.Services;

public class TmdbOptions
{
    public string? ApiKey { get; set; }
}

public record TmdbResult(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("media_type")] string? MediaType,
    [property: JsonPropertyName("title")] string? Title,
    [property: JsonPropertyName("name")] string? Name,
    [property: JsonPropertyName("release_date")] string? ReleaseDate,
    [property: JsonPropertyName("first_air_date")] string? FirstAirDate,
    [property: JsonPropertyName("poster_path")] string? PosterPath,
    [property: JsonPropertyName("original_language")] string? OriginalLanguage,
    [property: JsonPropertyName("origin_country")] List<string>? OriginCountry,
    [property: JsonPropertyName("overview")] string? Overview)
{
    public string DisplayTitle => Title ?? Name ?? "";
    public string? Date => string.IsNullOrEmpty(ReleaseDate) ? FirstAirDate : ReleaseDate;
}

file record TmdbSearchResponse([property: JsonPropertyName("results")] List<TmdbResult>? Results);

public record TmdbGenre([property: JsonPropertyName("name")] string Name);

public record TmdbCollectionRef(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("name")] string? Name);

public record TmdbVideo(
    [property: JsonPropertyName("key")] string? Key,
    [property: JsonPropertyName("site")] string? Site,
    [property: JsonPropertyName("type")] string? Type,
    [property: JsonPropertyName("official")] bool Official,
    [property: JsonPropertyName("iso_639_1")] string? Language,
    [property: JsonPropertyName("published_at")] string? PublishedAt);

public record TmdbVideos([property: JsonPropertyName("results")] List<TmdbVideo>? Results);

public record TmdbPerson(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("name")] string? Name,
    [property: JsonPropertyName("profile_path")] string? ProfilePath,
    [property: JsonPropertyName("order")] int? Order,
    [property: JsonPropertyName("job")] string? Job,
    [property: JsonPropertyName("total_episode_count")] int? TotalEpisodeCount);

/// <summary>/movie credits, and a series' aggregate_credits (cast across every season).</summary>
public record TmdbCredits(
    [property: JsonPropertyName("cast")] List<TmdbPerson>? Cast,
    [property: JsonPropertyName("crew")] List<TmdbPerson>? Crew);

public record TmdbEpisode([property: JsonPropertyName("runtime")] int? Runtime);

/// <summary>The fields we use from TMDB's /movie/{id} and /tv/{id} responses (with videos and credits appended).</summary>
public record TmdbDetailsResponse(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("title")] string? Title,
    [property: JsonPropertyName("name")] string? Name,
    [property: JsonPropertyName("release_date")] string? ReleaseDate,
    [property: JsonPropertyName("first_air_date")] string? FirstAirDate,
    [property: JsonPropertyName("poster_path")] string? PosterPath,
    [property: JsonPropertyName("original_language")] string? OriginalLanguage,
    [property: JsonPropertyName("origin_country")] List<string>? OriginCountry,
    [property: JsonPropertyName("genres")] List<TmdbGenre>? Genres,
    [property: JsonPropertyName("number_of_seasons")] int? NumberOfSeasons,
    [property: JsonPropertyName("number_of_episodes")] int? NumberOfEpisodes,
    [property: JsonPropertyName("overview")] string? Overview = null,
    [property: JsonPropertyName("runtime")] int? Runtime = null,
    [property: JsonPropertyName("episode_run_time")] List<int>? EpisodeRunTime = null,
    [property: JsonPropertyName("last_episode_to_air")] TmdbEpisode? LastEpisode = null,
    [property: JsonPropertyName("belongs_to_collection")] TmdbCollectionRef? Collection = null,
    [property: JsonPropertyName("videos")] TmdbVideos? Videos = null,
    [property: JsonPropertyName("credits")] TmdbCredits? Credits = null,
    [property: JsonPropertyName("aggregate_credits")] TmdbCredits? AggregateCredits = null,
    [property: JsonPropertyName("created_by")] List<TmdbPerson>? CreatedBy = null);

public record TmdbCollectionPart(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("title")] string? Title,
    [property: JsonPropertyName("release_date")] string? ReleaseDate,
    [property: JsonPropertyName("poster_path")] string? PosterPath);

public record TmdbCollectionResponse(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("name")] string? Name,
    [property: JsonPropertyName("parts")] List<TmdbCollectionPart>? Parts);

/// <summary>A franchise and its films in release order (unreleased ones have no date, or one in the future).</summary>
public record TmdbCollection(int Id, string Name, List<TmdbCollection.Part> Parts)
{
    public record Part(int Id, string Title, string? ReleaseDate, int? Year, string? PosterPath, string? PosterUrl);

    public static TmdbCollection From(TmdbCollectionResponse c) => new(
        c.Id,
        c.Name ?? "",
        (c.Parts ?? [])
            .OrderBy(p => string.IsNullOrEmpty(p.ReleaseDate) ? "9999" : p.ReleaseDate)
            .Select(p => new Part(p.Id, p.Title ?? "", string.IsNullOrEmpty(p.ReleaseDate) ? null : p.ReleaseDate,
                p.ReleaseDate is { Length: >= 4 } d && int.TryParse(d[..4], out var y) ? y : null,
                p.PosterPath, p.PosterPath is null ? null : Contracts.TitleDto.PosterBaseUrl + p.PosterPath))
            .ToList());
}

/// <summary>A film or series as the add/edit form wants it, plus what TmdbMetadataService stores.</summary>
public record TmdbDetails(
    int Id,
    string MediaType,
    string Title,
    int? Year,
    List<string> Genres,
    string? PosterPath,
    int? Seasons,
    int? Episodes,
    bool IsAnime,
    int? Runtime = null,
    string? Overview = null,
    string? TrailerKey = null,
    int? CollectionId = null,
    string? CollectionName = null,
    List<Data.Credit>? Credits = null)
{
    /// <summary>How many of the cast are kept: the top-billed (a series: the most episodes).</summary>
    public const int CastKept = 10;

    public string Type => MediaType == "tv" ? "Series" : "Film";
    public string? PosterUrl => PosterPath is null ? null : Contracts.TitleDto.PosterBaseUrl + PosterPath;

    public static TmdbDetails From(string mediaType, TmdbDetailsResponse d)
    {
        var date = string.IsNullOrEmpty(d.ReleaseDate) ? d.FirstAirDate : d.ReleaseDate;
        // TV genres come combined ("Action & Adventure", "Sci-Fi & Fantasy"); split them so they
        // line up with film genres.
        var genres = (d.Genres ?? [])
            .SelectMany(g => g.Name.Split(" & ", StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        var japanese = d.OriginalLanguage == "ja" || d.OriginCountry?.Contains("JP") == true;
        var tv = mediaType == "tv";
        return new(
            d.Id,
            mediaType,
            d.Title ?? d.Name ?? "",
            date is { Length: >= 4 } && int.TryParse(date[..4], out var y) ? y : null,
            genres,
            d.PosterPath,
            tv ? d.NumberOfSeasons : null,
            tv ? d.NumberOfEpisodes : null,
            japanese && genres.Contains("Animation", StringComparer.OrdinalIgnoreCase),
            Runtime: tv
                ? d.EpisodeRunTime?.FirstOrDefault(m => m > 0) is > 0 and var ep ? ep : d.LastEpisode?.Runtime is > 0 and var last ? last : null
                : d.Runtime is > 0 ? d.Runtime : null,
            Overview: string.IsNullOrWhiteSpace(d.Overview) ? null : d.Overview.Trim(),
            TrailerKey: PickTrailer(d.Videos?.Results),
            CollectionId: tv ? null : d.Collection?.Id,
            CollectionName: tv ? null : d.Collection?.Name,
            Credits: CreditsOf(d, tv));
    }

    /// <summary>A YouTube trailer: official first, then English, then the newest. A teaser if there's no trailer.</summary>
    public static string? PickTrailer(List<TmdbVideo>? videos) =>
        (videos ?? [])
            .Where(v => v.Site == "YouTube" && !string.IsNullOrEmpty(v.Key) && v.Type is "Trailer" or "Teaser")
            .OrderBy(v => v.Type == "Trailer" ? 0 : 1)
            .ThenByDescending(v => v.Official)
            .ThenBy(v => v.Language == "en" ? 0 : 1)
            .ThenByDescending(v => v.PublishedAt)
            .Select(v => v.Key)
            .FirstOrDefault();

    /// <summary>A film's directors or a series' creators, then the top-billed cast (a series: by episodes).</summary>
    private static List<Data.Credit> CreditsOf(TmdbDetailsResponse d, bool tv)
    {
        var makers = tv
            ? (d.CreatedBy ?? []).Select(p => (p, Data.Credit.Creator))
            : (d.Credits?.Crew ?? []).Where(p => p.Job == "Director").Select(p => (p, Data.Credit.Director));
        var castFrom = tv ? d.AggregateCredits?.Cast ?? d.Credits?.Cast : d.Credits?.Cast;
        var cast = (castFrom ?? [])
            .OrderBy(p => tv ? -(p.TotalEpisodeCount ?? 0) : 0)
            .ThenBy(p => p.Order ?? int.MaxValue)
            .Take(CastKept);
        var list = new List<Data.Credit>();
        foreach (var (p, job) in makers)
            if (!string.IsNullOrWhiteSpace(p.Name) && list.All(c => c.Id != p.Id || c.Job != job))
                list.Add(new(p.Id, p.Name.Trim(), p.ProfilePath, job, list.Count));
        var i = 0;
        foreach (var p in cast)
            if (!string.IsNullOrWhiteSpace(p.Name) && list.All(c => c.Id != p.Id || c.Job != Data.Credit.Cast))
                list.Add(new(p.Id, p.Name.Trim(), p.ProfilePath, Data.Credit.Cast, i++));
        return list;
    }
}

public class TmdbClient(HttpClient http, Microsoft.Extensions.Options.IOptions<TmdbOptions> options, ILogger<TmdbClient> logger)
{
    public bool Enabled => !string.IsNullOrWhiteSpace(options.Value.ApiKey);

    /// <summary>Movie/TV results only (people are dropped).</summary>
    public async Task<List<TmdbResult>> SearchAsync(string query, CancellationToken ct = default)
    {
        if (!Enabled || string.IsNullOrWhiteSpace(query)) return [];
        try
        {
            var url = $"3/search/multi?api_key={Uri.EscapeDataString(options.Value.ApiKey!)}&query={Uri.EscapeDataString(query)}";
            var resp = await http.GetFromJsonAsync<TmdbSearchResponse>(url, ct);
            return (resp?.Results ?? []).Where(r => r.MediaType is "movie" or "tv").ToList();
        }
        catch (Exception ex) when (ex is HttpRequestException or System.Text.Json.JsonException or TaskCanceledException)
        {
            logger.LogWarning(ex, "TMDB search failed for {Query}", query);
            return [];
        }
    }

    /// <summary>
    /// Ported from the original site's fetchMoviePoster: prefer results matching the release year,
    /// and for anime prefer Japanese productions; otherwise take TMDB's top hit.
    /// </summary>
    public static TmdbResult? PickBest(IReadOnlyList<TmdbResult> results, int? year, bool isAnime)
    {
        if (results.Count == 0) return null;
        IEnumerable<TmdbResult> candidates = results;
        if (year is not null)
        {
            var byYear = results.Where(r => r.Date?.StartsWith(year.Value.ToString()) == true).ToList();
            if (byYear.Count > 0) candidates = byYear;
        }
        var list = candidates.ToList();
        if (isAnime)
        {
            var jp = list.FirstOrDefault(r => r.OriginCountry?.Contains("JP") == true || r.OriginalLanguage == "ja");
            if (jp is not null) return jp;
        }
        return list[0];
    }

    /// <summary>
    /// Reads a TMDB link such as https://www.themoviedb.org/movie/603-the-matrix or
    /// https://www.themoviedb.org/tv/1399-game-of-thrones/season/1 (any language prefix, with or
    /// without the slug), or the short form "movie/603". Returns ("movie" | "tv", id).
    /// </summary>
    public static (string MediaType, int Id)? ParseLink(string? link)
    {
        if (string.IsNullOrWhiteSpace(link)) return null;
        link = link.Trim();
        string path;
        if (Uri.TryCreate(link, UriKind.Absolute, out var uri))
        {
            if (uri.Scheme is not ("http" or "https")) return null;
            var host = uri.Host.ToLowerInvariant();
            if (host != "themoviedb.org" && !host.EndsWith(".themoviedb.org")) return null;
            path = uri.AbsolutePath;
        }
        else if (!link.Contains("://") && !link.Contains(' '))
        {
            path = "/" + link.TrimStart('/');
        }
        else return null;

        var m = System.Text.RegularExpressions.Regex.Match(path, @"^/(?:[a-z]{2,3}(?:-[A-Za-z]{2,4})?/)?(movie|tv)/(\d{1,9})(?:[-/]|$)");
        return m.Success && int.TryParse(m.Groups[2].Value, out var id) && id > 0 ? (m.Groups[1].Value, id) : null;
    }

    /// <summary>Film or series details, or null if TMDB has no such id (or can't be reached).</summary>
    public async Task<TmdbDetails?> GetDetailsAsync(string mediaType, int id, CancellationToken ct = default)
    {
        if (!Enabled || mediaType is not ("movie" or "tv")) return null;
        try
        {
            var extra = mediaType == "tv" ? "videos,aggregate_credits" : "videos,credits";
            var url = $"3/{mediaType}/{id}?api_key={Uri.EscapeDataString(options.Value.ApiKey!)}&append_to_response={extra}";
            using var resp = await http.GetAsync(url, ct);
            if (resp.StatusCode == System.Net.HttpStatusCode.NotFound) return null;
            resp.EnsureSuccessStatusCode();
            var d = await resp.Content.ReadFromJsonAsync<TmdbDetailsResponse>(ct);
            return d is null ? null : TmdbDetails.From(mediaType, d);
        }
        catch (Exception ex) when (ex is HttpRequestException or System.Text.Json.JsonException or TaskCanceledException)
        {
            logger.LogWarning(ex, "TMDB details failed for {MediaType}/{Id}", mediaType, id);
            throw new TmdbUnavailableException(ex);
        }
    }

    /// <summary>A franchise and its films, or null if TMDB has no such collection.</summary>
    public async Task<TmdbCollection?> GetCollectionAsync(int id, CancellationToken ct = default)
    {
        if (!Enabled) return null;
        try
        {
            using var resp = await http.GetAsync($"3/collection/{id}?api_key={Uri.EscapeDataString(options.Value.ApiKey!)}", ct);
            if (resp.StatusCode == System.Net.HttpStatusCode.NotFound) return null;
            resp.EnsureSuccessStatusCode();
            var c = await resp.Content.ReadFromJsonAsync<TmdbCollectionResponse>(ct);
            return c is null ? null : TmdbCollection.From(c);
        }
        catch (Exception ex) when (ex is HttpRequestException or System.Text.Json.JsonException or TaskCanceledException)
        {
            logger.LogWarning(ex, "TMDB collection {Id} failed", id);
            throw new TmdbUnavailableException(ex);
        }
    }

    public async Task<TmdbResult?> FindBestAsync(string name, int? year, bool isAnime, CancellationToken ct = default) =>
        PickBest(await SearchAsync(name, ct), year, isAnime);
}

public class TmdbUnavailableException(Exception inner) : Exception("TMDB could not be reached.", inner);
