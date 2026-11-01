namespace Movies.Api.Data;

/// <summary>A title's watch fields, worked out from its watches.</summary>
public static class WatchSummary
{
    /// <summary>Expects t.Watches loaded. Sets FirstWatch, LatestWatch, WatchCount, WithBogdan, DateWithBogdan and WatchedInCinema.</summary>
    public static void Apply(Title t)
    {
        var dated = t.Watches.Where(w => w.Date is not null).Select(w => w.Date!.Value).ToList();
        t.WatchCount = t.Watches.Count;
        t.FirstWatch = dated.Count > 0 ? dated.Min() : null;
        t.LatestWatch = dated.Count > 0 ? dated.Max() : null;
        t.WithBogdan = t.Watches.Any(w => w.WithBogdan);
        t.DateWithBogdan = t.Watches.Where(w => w.WithBogdan && w.Date is not null).Max(w => w.Date);
        t.WatchedInCinema = t.Watches.Any(w => w.InCinema);
    }

    /// <summary>
    /// Watches for a title that only has the old summary (first and latest watch, a count, Bogdan, cinema),
    /// without guessing any dates:
    /// <list type="bullet">
    /// <item>the first and latest watch are dated watches, and the rest of the count are undated;</item>
    /// <item>a count of 1 with two different dates is one watch on the first, its notes keeping the other date;</item>
    /// <item>"with Bogdan" goes on the watch on that date. A date that isn't one of them takes an undated watch, or
    /// is a watch of its own when there's none. With no date, it goes on an undated watch, or the first;</item>
    /// <item>"in cinema" goes on the first watch.</item>
    /// </list>
    /// A title with dates but a count of 0 still gets its dated watch.
    /// </summary>
    public static List<Watch> FromSummary(Title t)
    {
        var dates = new List<DateOnly>();
        if (t.FirstWatch is { } first) dates.Add(first);
        if (t.LatestWatch is { } latest && latest != t.FirstWatch) dates.Add(latest);
        var count = Math.Max(t.WatchCount, dates.Count > 0 ? 1 : 0);
        var watches = new List<Watch>();
        if (count == 0) return watches;

        if (dates.Count > count)
            watches.Add(new Watch { Date = dates[0], Notes = $"The old record also had a latest watch on {dates[1]:dd/MM/yyyy}." });
        else
        {
            watches.AddRange(dates.Select(d => new Watch { Date = d }));
            while (watches.Count < count) watches.Add(new Watch());
        }

        if (t.WithBogdan)
        {
            var undated = watches.FirstOrDefault(w => w.Date is null);
            if (t.DateWithBogdan is { } day)
            {
                var onThatDay = watches.FirstOrDefault(w => w.Date == day);
                if (onThatDay is not null) onThatDay.WithBogdan = true;
                else if (undated is not null) (undated.Date, undated.WithBogdan) = (day, true);
                else watches.Add(new Watch { Date = day, WithBogdan = true });
            }
            else (undated ?? watches[0]).WithBogdan = true;
        }

        if (t.WatchedInCinema)
            (watches.Where(w => w.Date is not null).MinBy(w => w.Date) ?? watches[0]).InCinema = true;
        return watches;
    }
}
