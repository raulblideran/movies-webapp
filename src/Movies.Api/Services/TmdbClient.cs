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

/// <summary>The fields we use from TMDB's /movie/{id} and /tv/{id} responses.</summary>
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
    [property: JsonPropertyName("number_of_episodes")] int? NumberOfEpisodes);

/// <summary>A film or series as the add/edit form wants it.</summary>
public record TmdbDetails(
    int Id,
    string MediaType,
    string Title,
    int? Year,
    List<string> Genres,
    string? PosterPath,
    int? Seasons,
    int? Episodes,
    bool IsAnime)
{
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
        return new(
            d.Id,
            mediaType,
            d.Title ?? d.Name ?? "",
            date is { Length: >= 4 } && int.TryParse(date[..4], out var y) ? y : null,
            genres,
            d.PosterPath,
            mediaType == "tv" ? d.NumberOfSeasons : null,
            mediaType == "tv" ? d.NumberOfEpisodes : null,
            japanese && genres.Contains("Animation", StringComparer.OrdinalIgnoreCase));
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
            var url = $"3/{mediaType}/{id}?api_key={Uri.EscapeDataString(options.Value.ApiKey!)}";
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

    public async Task<TmdbResult?> FindBestAsync(string name, int? year, bool isAnime, CancellationToken ct = default) =>
        PickBest(await SearchAsync(name, ct), year, isAnime);
}

public class TmdbUnavailableException(Exception inner) : Exception("TMDB could not be reached.", inner);
