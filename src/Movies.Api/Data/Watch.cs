namespace Movies.Api.Data;

/// <summary>
/// One viewing of a title. The title's FirstWatch, LatestWatch, WatchCount, WithBogdan, DateWithBogdan and
/// WatchedInCinema are a summary of its watches, worked out again whenever they change (WatchSummary).
/// </summary>
public class Watch : ITimestamped
{
    public int Id { get; set; }
    public int TitleId { get; set; }
    public Title Title { get; set; } = null!;

    /// <summary>The day, or null when it isn't known (most watches from before the site).</summary>
    public DateOnly? Date { get; set; }

    public bool WithBogdan { get; set; }
    public bool InCinema { get; set; }
    public string? Notes { get; set; }

    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>A year's target number of watches, for the Stats page.</summary>
public class YearGoal : ITimestamped
{
    public int Year { get; set; }
    public int Target { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
