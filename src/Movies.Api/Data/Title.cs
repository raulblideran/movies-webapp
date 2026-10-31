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

    /// <summary>Full dates. The old sheet only had months, so imports pick a random day (see SheetCsv).</summary>
    public DateOnly? FirstWatch { get; set; }
    public DateOnly? LatestWatch { get; set; }
    public int WatchCount { get; set; }

    /// <summary>0–10, or 11 for an all-time favourite. Null means "?".</summary>
    public decimal? Rating { get; set; }
    public int? RewatchPotential { get; set; }

    public List<string> Genres { get; set; } = [];

    public int? Seasons { get; set; }
    public int? EpisodesTotal { get; set; }

    public bool WithBogdan { get; set; }
    public DateOnly? DateWithBogdan { get; set; }

    public string? Comments { get; set; }
    public int? ReleaseYear { get; set; }

    public int? TmdbId { get; set; }
    public string? TmdbMediaType { get; set; }
    public string? PosterPath { get; set; }

    public List<TitleRelease> ReleaseLinks { get; set; } = [];

    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
