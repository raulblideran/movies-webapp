using Movies.Api.Data;

namespace Movies.Api.Contracts;

public record TitleDto(
    int Id,
    string Name,
    TitleType Type,
    DateOnly? FirstWatch,
    DateOnly? LatestWatch,
    int WatchCount,
    decimal? Rating,
    int? RewatchPotential,
    List<string> Genres,
    int? Seasons,
    int? EpisodesTotal,
    bool WithBogdan,
    DateOnly? DateWithBogdan,
    string? Comments,
    int? ReleaseYear,
    int? TmdbId,
    string? TmdbMediaType,
    string? PosterPath,
    string? PosterUrl,
    List<ReleaseSummaryDto> Releases,
    DateTime UpdatedAt)
{
    public const string PosterBaseUrl = "https://image.tmdb.org/t/p/w500";

    /// <summary>Expects ReleaseLinks → Release → TitleLinks loaded (see TitlesEndpoints.WithReleases).</summary>
    public static TitleDto From(Title t) => new(
        t.Id, t.Name, t.Type, t.FirstWatch, t.LatestWatch, t.WatchCount, t.Rating, t.RewatchPotential,
        t.Genres, t.Seasons, t.EpisodesTotal, t.WithBogdan, t.DateWithBogdan,
        t.Comments, t.ReleaseYear, t.TmdbId, t.TmdbMediaType, t.PosterPath,
        t.PosterPath is null ? null : PosterBaseUrl + t.PosterPath,
        t.ReleaseLinks.Select(l => ReleaseSummaryDto.From(l.Release)).OrderBy(r => r.Name).ToList(),
        t.UpdatedAt);
}

public record TitleUpsertRequest(
    string? Name,
    TitleType Type,
    DateOnly? FirstWatch,
    DateOnly? LatestWatch,
    int WatchCount,
    decimal? Rating,
    int? RewatchPotential,
    List<string>? Genres,
    int? Seasons,
    int? EpisodesTotal,
    bool WithBogdan,
    DateOnly? DateWithBogdan,
    string? Comments,
    int? ReleaseYear,
    int? TmdbId,
    string? TmdbMediaType,
    string? PosterPath)
{
    public Dictionary<string, string[]> Validate()
    {
        var errors = new Dictionary<string, string[]>();
        void Add(string key, string msg) => errors[key] = [msg];

        if (string.IsNullOrWhiteSpace(Name)) Add(nameof(Name), "Name is required.");
        else if (Name.Length > 300) Add(nameof(Name), "Name is too long.");
        if (!Enum.IsDefined(Type)) Add(nameof(Type), "Type must be Film or Series.");
        if (WatchCount is < 0 or > 1000) Add(nameof(WatchCount), "Watch count must be between 0 and 1000.");
        if (Rating is < 0 or > 11) Add(nameof(Rating), "Rating must be between 0 and 11.");
        if (RewatchPotential is < 0 or > 10) Add(nameof(RewatchPotential), "Rewatch potential must be between 0 and 10.");
        if (Seasons is < 0) Add(nameof(Seasons), "Seasons cannot be negative.");
        if (EpisodesTotal is < 0) Add(nameof(EpisodesTotal), "Episodes cannot be negative.");
        if (ReleaseYear is < 1870 or > 2200) Add(nameof(ReleaseYear), "Release year looks wrong.");
        if (Comments?.Length > 4000) Add(nameof(Comments), "Comments are too long.");
        if (PosterPath is not null && !System.Text.RegularExpressions.Regex.IsMatch(PosterPath, @"^/[A-Za-z0-9_\-]+\.(jpg|jpeg|png|webp)$"))
            Add(nameof(PosterPath), "Poster path must be a TMDB image path like /abc.jpg.");
        if (TmdbMediaType is not null and not ("movie" or "tv")) Add(nameof(TmdbMediaType), "Media type must be movie or tv.");
        return errors;
    }

    public void ApplyTo(Title t)
    {
        static List<string> Clean(List<string>? xs) =>
            (xs ?? []).Select(x => x.Trim()).Where(x => x.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();

        t.Name = Name!.Trim();
        t.Type = Type;
        t.FirstWatch = FirstWatch;
        t.LatestWatch = LatestWatch;
        t.WatchCount = WatchCount;
        t.Rating = Rating;
        t.RewatchPotential = RewatchPotential;
        t.Genres = Clean(Genres);
        t.Seasons = Seasons;
        t.EpisodesTotal = EpisodesTotal;
        t.WithBogdan = WithBogdan;
        t.DateWithBogdan = DateWithBogdan;
        t.Comments = string.IsNullOrWhiteSpace(Comments) ? null : Comments.Trim();
        t.ReleaseYear = ReleaseYear;
        t.TmdbId = TmdbId;
        t.TmdbMediaType = TmdbMediaType;
        t.PosterPath = PosterPath;
    }
}
