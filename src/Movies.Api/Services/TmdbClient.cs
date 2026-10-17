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

    public async Task<TmdbResult?> FindBestAsync(string name, int? year, bool isAnime, CancellationToken ct = default) =>
        PickBest(await SearchAsync(name, ct), year, isAnime);
}
