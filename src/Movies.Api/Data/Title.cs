namespace Movies.Api.Data;

public enum TitleType
{
    Film,
    Series,
}

public class Title
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public TitleType Type { get; set; }

    /// <summary>Month precision; stored as the 1st of the month.</summary>
    public DateOnly? FirstWatch { get; set; }
    public DateOnly? LatestWatch { get; set; }
    public int WatchCount { get; set; }

    /// <summary>0–10, or 11 for an all-time favourite. Null means "?".</summary>
    public decimal? Rating { get; set; }
    public int? RewatchPotential { get; set; }

    public List<string> Genres { get; set; } = [];
    public List<string> PhysicalFormats { get; set; } = [];

    public int? Seasons { get; set; }
    public int? EpisodesTotal { get; set; }

    public bool WithBogdan { get; set; }
    public DateOnly? DateWithBogdan { get; set; }

    public string? Comments { get; set; }
    public int? ReleaseYear { get; set; }

    public decimal? PricePaid { get; set; }
    public List<string> CexLinks { get; set; } = [];

    public int? TmdbId { get; set; }
    public string? TmdbMediaType { get; set; }
    public string? PosterPath { get; set; }

    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
