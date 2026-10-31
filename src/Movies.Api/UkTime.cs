namespace Movies.Api;

/// <summary>The site's clock: UK time (GMT/BST), which is what "today" means to its owner.</summary>
public static class UkTime
{
    public static readonly TimeZoneInfo Zone = Find();

    private static TimeZoneInfo Find()
    {
        try { return TimeZoneInfo.FindSystemTimeZoneById("Europe/London"); }
        catch (TimeZoneNotFoundException) { return TimeZoneInfo.Utc; }
    }

    public static DateTime Now() => TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, Zone);
    public static DateOnly Today() => DateOnly.FromDateTime(Now());
}
