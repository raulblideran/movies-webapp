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
    bool WatchedInCinema,
    string? Comments,
    int? ReleaseYear,
    int? TmdbId,
    string? TmdbMediaType,
    string? PosterPath,
    string? PosterUrl,
    List<ReleaseSummaryDto> Releases,
    TitleList List,
    DateOnly? WatchlistAddedOn,
    int? Runtime,
    string? Overview,
    string? TrailerKey,
    int? CollectionId,
    string? CollectionName,
    List<string> Directors,
    List<string> Cast,
    DateTime UpdatedAt,
    List<WatchDto> Watches,
    List<string> Tags,
    decimal? VoteAverage,
    int? VoteCount,
    string? OriginalLanguage,
    List<string> Countries,
    List<int> DirectorIds,
    List<int> CastIds,
    // TMDB's release date (a series: its first air date); null without a TMDB link or a date there
    DateOnly? ReleaseDate)
{
    public const string PosterBaseUrl = "https://image.tmdb.org/t/p/w500";
    /// <summary>How many of the cast the title list carries (the Stats page gets them all from /api/titles/people).</summary>
    public const int CastShown = 5;

    /// <summary>Expects ReleaseLinks → Release → TitleLinks loaded (see TitlesEndpoints.WithReleases).</summary>
    public static TitleDto From(Title t) => new(
        t.Id, t.Name, t.Type, t.FirstWatch, t.LatestWatch, t.WatchCount, t.Rating, t.RewatchPotential,
        t.Genres, t.Seasons, t.EpisodesTotal, t.WithBogdan, t.DateWithBogdan, t.WatchedInCinema,
        t.Comments, t.ReleaseYear, t.TmdbId, t.TmdbMediaType, t.PosterPath,
        t.PosterPath is null ? null : PosterBaseUrl + t.PosterPath,
        t.ReleaseLinks.Select(l => ReleaseSummaryDto.From(l.Release)).OrderBy(r => r.Name).ToList(),
        t.List,
        t.WatchlistAddedOn,
        t.Runtime,
        t.Overview,
        t.TrailerKey,
        t.CollectionId,
        t.CollectionName,
        Makers(t).Select(c => c.Name).ToList(),
        TopCast(t).Select(c => c.Name).ToList(),
        t.UpdatedAt,
        t.Watches.OrderBy(w => w.Date is null).ThenBy(w => w.Date).ThenBy(w => w.Id).Select(WatchDto.From).ToList(),
        t.Tags,
        t.VoteAverage,
        t.VoteCount,
        t.OriginalLanguage,
        t.Countries,
        Makers(t).Select(c => c.Id).ToList(),
        TopCast(t).Select(c => c.Id).ToList(),
        t.ReleaseDate);

    private static IEnumerable<Credit> Makers(Title t) => t.Credits.Where(c => c.Job != Credit.Cast);
    private static IEnumerable<Credit> TopCast(Title t) => t.Credits.Where(c => c.Job == Credit.Cast).OrderBy(c => c.Order).Take(CastShown);
}

/// <summary>One viewing. Dated ones come in date order; undated ones (date null) after them.</summary>
public record WatchDto(int Id, DateOnly? Date, bool WithBogdan, bool InCinema, string? Notes)
{
    public static WatchDto From(Watch w) => new(w.Id, w.Date, w.WithBogdan, w.InCinema, w.Notes);
}

/// <summary>A watch to add or change. On a title's save, one with the id of an existing watch changes it.</summary>
public record WatchRequest(int? Id, DateOnly? Date, bool WithBogdan, bool InCinema, string? Notes)
{
    public string? Error() =>
        Date is { } d && (d.Year < 1900 || d > UkTime.Today().AddDays(1)) ? "A watch's date can't be in the future (or before 1900)."
        : Notes?.Length > 2000 ? "A watch's notes are too long."
        : null;

    public void ApplyTo(Watch w)
    {
        w.Date = Date;
        w.WithBogdan = WithBogdan;
        w.InCinema = InCinema;
        w.Notes = string.IsNullOrWhiteSpace(Notes) ? null : Notes.Trim();
    }

    public Watch ToWatch()
    {
        var w = new Watch();
        ApplyTo(w);
        return w;
    }
}

public record PersonDto(string Name, string? PhotoUrl)
{
    public const string ProfileBaseUrl = "https://image.tmdb.org/t/p/w185";
}

/// <summary>A title's directors (or creators) and top-billed cast, as person ids.</summary>
public record TitlePeopleDto(List<int> Directors, List<int> Cast)
{
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
    string? PosterPath,
    bool WatchedInCinema = false,
    TitleList List = TitleList.Watched,
    DateOnly? WatchlistAddedOn = null,
    List<string>? Tags = null,
    List<WatchRequest>? Watches = null)
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
        if (!Enum.IsDefined(List)) Add(nameof(List), "List must be Watched or Watchlist.");
        if (WatchlistAddedOn is { } added && (added.Year < 1900 || added > UkTime.Today().AddDays(1)))
            Add(nameof(WatchlistAddedOn), "The date it went on the watchlist can't be in the future.");
        if (Tags?.Count > 30 || Tags?.Any(x => x?.Length > 60) == true) Add(nameof(Tags), "Too many tags, or a tag that's too long.");
        if (Watches?.Count > 1000) Add(nameof(Watches), "That's a lot of watches.");
        if (Watches?.Select(w => w.Error()).FirstOrDefault(e => e is not null) is { } watchError) Add(nameof(Watches), watchError);
        return errors;
    }

    private static List<string> Clean(List<string>? xs) =>
        (xs ?? []).Where(x => x is not null).Select(x => x.Trim()).Where(x => x.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();

    /// <summary>
    /// Everything but the watches. The watch fields (first and latest watch, count, Bogdan, cinema) are
    /// worked out from the watches, so they're only read from a new title sent without any (WithWatches).
    /// </summary>
    public void ApplyTo(Title t)
    {
        t.Name = Name!.Trim();
        t.Type = Type;
        t.Rating = Rating;
        t.RewatchPotential = RewatchPotential;
        t.Genres = Clean(Genres);
        if (Tags is not null) t.Tags = Clean(Tags);
        t.Seasons = Seasons;
        t.EpisodesTotal = EpisodesTotal;
        t.Comments = string.IsNullOrWhiteSpace(Comments) ? null : Comments.Trim();
        t.ReleaseYear = ReleaseYear;
        t.TmdbId = TmdbId;
        t.TmdbMediaType = TmdbMediaType;
        t.PosterPath = PosterPath;
        t.List = List;
        // The date is saved as sent (so Undo can clear it), except that something on the watchlist always
        // has one: the date it already had, or today.
        t.WatchlistAddedOn = WatchlistAddedOn ?? (List == TitleList.Watchlist ? t.WatchlistAddedOn ?? UkTime.Today() : null);
    }

    /// <summary>
    /// The title's watches as this request has them, then its summary. Watches left out (null) stay as they
    /// are; a new title sent without any gets them from the summary fields (WatchSummary.FromSummary). Sent,
    /// they're the whole list: one with an existing watch's id changes it, one without is added, and the
    /// title's other watches are removed. Expects t.Watches loaded. Returns the watches it added or gave a
    /// new date, to check against the release date (WatchSummary.BeforeRelease).
    /// </summary>
    public List<Watch> WithWatches(Title t, bool isNew)
    {
        var dated = new List<Watch>();
        if (Watches is null)
        {
            if (isNew)
            {
                (t.FirstWatch, t.LatestWatch, t.WatchCount) = (FirstWatch, LatestWatch, WatchCount);
                (t.WithBogdan, t.DateWithBogdan, t.WatchedInCinema) = (WithBogdan, DateWithBogdan, WatchedInCinema);
                t.Watches = WatchSummary.FromSummary(t);
                dated.AddRange(t.Watches);
            }
        }
        else
        {
            var kept = new HashSet<Watch>();
            foreach (var req in Watches)
            {
                var existing = req.Id is { } id ? t.Watches.FirstOrDefault(w => w.Id == id && id != 0) : null;
                if (existing is null)
                {
                    var added = AddTo(t, req);
                    kept.Add(added);
                    dated.Add(added);
                }
                else
                {
                    if (req.Date != existing.Date) dated.Add(existing);
                    req.ApplyTo(existing);
                    kept.Add(existing);
                }
            }
            t.Watches.RemoveAll(w => !kept.Contains(w));
        }
        WatchSummary.Apply(t);
        return dated;
    }

    private static Watch AddTo(Title t, WatchRequest req)
    {
        var w = req.ToWatch();
        t.Watches.Add(w);
        return w;
    }
}
