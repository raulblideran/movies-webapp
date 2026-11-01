namespace Movies.Api.Data;

public enum TitleType
{
    Film,
    Series,
}

/// <summary>Which page a title is on. Watched comes first, so a request that leaves it out means the Watchlog.</summary>
public enum TitleList
{
    /// <summary>The Watchlog: films and series you've watched.</summary>
    Watched,

    /// <summary>The Watchlist: ones to watch. A title can be on it with watches already (a rewatch).</summary>
    Watchlist,
}

/// <summary>Someone who made or is in a title, from TMDB: its directors (a series' creators) and top-billed cast.</summary>
public record Credit(int Id, string Name, string? ProfilePath, string Job, int Order)
{
    public const string Director = "Director";
    public const string Creator = "Creator";
    public const string Cast = "Cast";
}

public interface ITimestamped
{
    DateTime CreatedAt { get; set; }
    DateTime UpdatedAt { get; set; }
}

public class Title : ITimestamped
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public TitleType Type { get; set; }

    public TitleList List { get; set; }

    /// <summary>When it last went on the watchlist. Kept after it's watched, so its history shows the wait.</summary>
    public DateOnly? WatchlistAddedOn { get; set; }

    /// <summary>Every viewing. The watch fields below are worked out from these (WatchSummary), never typed in.</summary>
    public List<Watch> Watches { get; set; } = [];

    /// <summary>The earliest and latest dated watch. The old sheet only had months, so imports pick a random day (see SheetCsv).</summary>
    public DateOnly? FirstWatch { get; set; }
    public DateOnly? LatestWatch { get; set; }
    public int WatchCount { get; set; }

    /// <summary>0–10, or 11 for an all-time favourite. Null means "?".</summary>
    public decimal? Rating { get; set; }
    public int? RewatchPotential { get; set; }

    public List<string> Genres { get; set; } = [];

    /// <summary>Your own labels (Christmas, Comfort films…), unlike genres never from TMDB.</summary>
    public List<string> Tags { get; set; } = [];

    public int? Seasons { get; set; }
    public int? EpisodesTotal { get; set; }

    public bool WithBogdan { get; set; }
    public DateOnly? DateWithBogdan { get; set; }

    /// <summary>Seen at the cinema (at least once).</summary>
    public bool WatchedInCinema { get; set; }

    public string? Comments { get; set; }
    public int? ReleaseYear { get; set; }

    public int? TmdbId { get; set; }
    public string? TmdbMediaType { get; set; }
    public string? PosterPath { get; set; }

    // From TMDB, refreshed by TmdbMetadataService (never typed in): see TmdbSyncedAt.
    /// <summary>Minutes: a film's length, or a series' episode length.</summary>
    public int? Runtime { get; set; }
    public string? Overview { get; set; }
    /// <summary>TMDB's release date (a series: its first air date). Watches can't be dated before it (WatchSummary.ReleasedOn).</summary>
    public DateOnly? ReleaseDate { get; set; }
    /// <summary>The YouTube id of its trailer.</summary>
    public string? TrailerKey { get; set; }
    /// <summary>The TMDB collection (franchise) a film belongs to, e.g. "Alien Collection".</summary>
    public int? CollectionId { get; set; }
    public string? CollectionName { get; set; }
    public List<Credit> Credits { get; set; } = [];
    /// <summary>TMDB's average score out of 10, and how many votes it's from.</summary>
    public decimal? VoteAverage { get; set; }
    public int? VoteCount { get; set; }
    /// <summary>ISO 639-1, e.g. "en", "ja".</summary>
    public string? OriginalLanguage { get; set; }
    /// <summary>ISO 3166-1 codes of the countries it's from, e.g. ["GB", "US"].</summary>
    public List<string> Countries { get; set; } = [];
    /// <summary>When the fields above were last fetched from TMDB; null means never.</summary>
    public DateTime? TmdbSyncedAt { get; set; }

    public List<TitleRelease> ReleaseLinks { get; set; } = [];

    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
