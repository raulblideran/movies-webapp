using System.Globalization;
using System.Text.RegularExpressions;
using CsvHelper;
using CsvHelper.Configuration;
using Movies.Api.Data;

namespace Movies.Api.Import;

/// <summary>Reads and writes the column layout of the original Google Sheet.</summary>
public static partial class SheetCsv
{
    public static readonly string[] Headers =
    [
        "Name", "Type", "1st Watch", "Physical Format", "Rating ?/10", "Watch count", "Latest Watch",
        "Seasons", "Episodes Total", "Genre", "Rewatch potential", "Bogdan", "Date W/Bogdi",
        "Comments", "Price (£)", "Cex Link",
    ];

    public record ParseResult(List<Title> Titles, List<string> Anomalies);

    /// <param name="rng">Picks the day for month-only dates (the old sheet has no days). Seed it for repeatable results.</param>
    public static ParseResult Parse(TextReader reader, Random? rng = null)
    {
        rng ??= Random.Shared;
        var config = new CsvConfiguration(CultureInfo.InvariantCulture)
        {
            MissingFieldFound = null,
            HeaderValidated = null,
            BadDataFound = null,
            TrimOptions = TrimOptions.Trim,
        };
        using var csv = new CsvReader(reader, config);
        csv.Read();
        csv.ReadHeader();

        var titles = new List<Title>();
        var anomalies = new List<string>();

        while (csv.Read())
        {
            string Get(string h) => (csv.GetField(h) ?? "").Trim();
            var name = Get("Name");
            if (name.Length == 0) continue;
            var row = csv.Parser.Row;
            void Warn(string msg) => anomalies.Add($"row {row} \"{name}\": {msg}");

            var t = new Title { Name = name };

            var type = Get("Type");
            if (type.Equals("Series", StringComparison.OrdinalIgnoreCase)) t.Type = TitleType.Series;
            else
            {
                t.Type = TitleType.Film;
                if (!type.Equals("Film", StringComparison.OrdinalIgnoreCase)) Warn($"unknown type '{type}', using Film");
            }

            var first = ParseDate(Get("1st Watch"), "1st Watch", Warn);
            var latest = ParseDate(Get("Latest Watch"), "Latest Watch", Warn);
            var bogdanDate = ParseDate(Get("Date W/Bogdi"), "Date W/Bogdi", Warn);

            t.Rating = ParseDecimal(Get("Rating ?/10"), "Rating", Warn);
            if (t.Rating is < 0 or > 11) { Warn($"rating {t.Rating} out of range, cleared"); t.Rating = null; }

            t.WatchCount = ParseInt(Get("Watch count"), "Watch count", Warn) ?? 0;

            // Month-only dates get a random day. Dates in the same month stay consistent: a single watch
            // is one day, a rewatch in the same month is on or after the first, and the date with Bogdan
            // is one of the watches.
            t.FirstWatch = Fill(first, null, rng);
            t.LatestWatch = latest is { Day: null } && t.FirstWatch is { } f && SameMonth(latest, f)
                ? (t.WatchCount <= 1 ? f : Fill(latest, f.Day, rng))
                : Fill(latest, null, rng);
            t.DateWithBogdan = bogdanDate is { Day: null }
                ? new[] { t.FirstWatch, t.LatestWatch }.FirstOrDefault(d => d is { } v && SameMonth(bogdanDate, v)) ?? Fill(bogdanDate, null, rng)
                : Fill(bogdanDate, null, rng);

            var rewatch = ParseInt(Get("Rewatch potential"), "Rewatch potential", Warn);
            if (rewatch is > 10) { Warn($"rewatch potential {rewatch} out of range, clamped to 10"); rewatch = 10; }
            if (rewatch is < 0) { Warn($"rewatch potential {rewatch} out of range, cleared"); rewatch = null; }
            t.RewatchPotential = rewatch;

            t.Seasons = ParseInt(Get("Seasons"), "Seasons", Warn);
            t.EpisodesTotal = ParseInt(Get("Episodes Total"), "Episodes Total", Warn);

            t.Genres = SplitList(Get("Genre"), '/');
            t.PhysicalFormats = SplitList(Get("Physical Format").Trim('"'), ',');
            t.CexLinks = SplitList(Get("Cex Link"), ',').Where(l => l.StartsWith("http")).ToList();

            var bogdan = Get("Bogdan");
            t.WithBogdan = bogdan.Equals("Yes", StringComparison.OrdinalIgnoreCase);

            var comments = Get("Comments");
            t.Comments = comments.Length == 0 ? null : comments;
            if (comments.Length > 0 && YearRegex().Match(comments) is { Success: true } y)
                t.ReleaseYear = int.Parse(y.Value, CultureInfo.InvariantCulture);

            var price = Get("Price (£)").Replace("£", "").Replace(",", "").Trim();
            t.PricePaid = ParseDecimal(price, "Price", Warn);

            titles.Add(t);
        }

        foreach (var dup in titles.GroupBy(t => (t.Name.ToLowerInvariant(), t.Type)).Where(g => g.Count() > 1))
            anomalies.Add($"duplicate name \"{dup.First().Name}\" ×{dup.Count()} (years: {string.Join(", ", dup.Select(d => d.ReleaseYear?.ToString() ?? "?"))})");

        return new ParseResult(titles, anomalies);
    }

    public static string Write(IEnumerable<Title> titles)
    {
        using var sw = new StringWriter();
        using var csv = new CsvWriter(sw, CultureInfo.InvariantCulture);
        foreach (var h in Headers) csv.WriteField(h);
        csv.NextRecord();

        static string Date(DateOnly? d) => d is { } v ? v.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture) : "N/a";
        static string Num<T>(T? v) where T : struct, IFormattable => v?.ToString(null, CultureInfo.InvariantCulture) ?? "N/a";

        foreach (var t in titles)
        {
            csv.WriteField(t.Name);
            csv.WriteField(t.Type.ToString());
            csv.WriteField(Date(t.FirstWatch));
            csv.WriteField(string.Join(", ", t.PhysicalFormats));
            csv.WriteField(t.Rating?.ToString("0.#", CultureInfo.InvariantCulture) ?? "?");
            csv.WriteField(t.WatchCount);
            csv.WriteField(Date(t.LatestWatch));
            csv.WriteField(Num(t.Seasons));
            csv.WriteField(Num(t.EpisodesTotal));
            csv.WriteField(string.Join("/", t.Genres));
            csv.WriteField(t.RewatchPotential?.ToString(CultureInfo.InvariantCulture) ?? "");
            csv.WriteField(t.WithBogdan ? "Yes" : "No");
            csv.WriteField(t.DateWithBogdan is null ? "" : Date(t.DateWithBogdan));
            csv.WriteField(t.Comments ?? "");
            csv.WriteField(t.PricePaid?.ToString("0.##", CultureInfo.InvariantCulture) ?? "");
            csv.WriteField(string.Join(", ", t.CexLinks));
            csv.NextRecord();
        }
        return sw.ToString();
    }

    private static bool IsEmpty(string s) =>
        s.Length == 0 || s.Equals("N/a", StringComparison.OrdinalIgnoreCase) || s == "?" || s == "-";

    /// <summary>A date from the sheet: "dd/MM/yyyy", or "MM/yyyy" (Day is null).</summary>
    private record SheetDate(int Year, int Month, int? Day);

    private static SheetDate? ParseDate(string s, string field, Action<string> warn)
    {
        if (IsEmpty(s)) return null;
        var m = DateRegex().Match(s);
        if (m.Success)
        {
            var month = int.Parse(m.Groups[2].Value, CultureInfo.InvariantCulture);
            var year = int.Parse(m.Groups[3].Value, CultureInfo.InvariantCulture);
            if (month is >= 1 and <= 12)
            {
                if (m.Value != s || s.Contains("//")) warn($"{field} '{s}' normalised");
                int? day = m.Groups[1].Success ? int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture) : null;
                if (day is { } d && (d < 1 || d > DateTime.DaysInMonth(year, month)))
                {
                    warn($"{field} '{s}' has no such day, picking one");
                    day = null;
                }
                return new SheetDate(year, month, day);
            }
        }
        warn($"{field} '{s}' not understood, cleared");
        return null;
    }

    private static bool SameMonth(SheetDate s, DateOnly d) => s.Year == d.Year && s.Month == d.Month;

    /// <summary>The date, picking a random day (at least <paramref name="minDay"/>, never in the future) if it has none.</summary>
    private static DateOnly? Fill(SheetDate? s, int? minDay, Random rng)
    {
        if (s is null) return null;
        if (s.Day is { } day) return new DateOnly(s.Year, s.Month, day);
        var today = DateOnly.FromDateTime(DateTime.Today);
        var max = s.Year == today.Year && s.Month == today.Month ? today.Day : DateTime.DaysInMonth(s.Year, s.Month);
        var min = Math.Min(minDay ?? 1, max);
        return new DateOnly(s.Year, s.Month, rng.Next(min, max + 1));
    }

    private static int? ParseInt(string s, string field, Action<string> warn)
    {
        if (IsEmpty(s)) return null;
        if (int.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out var v)) return v;
        warn($"{field} '{s}' not a number, cleared");
        return null;
    }

    private static decimal? ParseDecimal(string s, string field, Action<string> warn)
    {
        if (IsEmpty(s)) return null;
        if (decimal.TryParse(s, NumberStyles.Number, CultureInfo.InvariantCulture, out var v)) return v;
        warn($"{field} '{s}' not a number, cleared");
        return null;
    }

    private static List<string> SplitList(string s, char sep) =>
        s.Split(sep, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(x => !x.Equals("N/a", StringComparison.OrdinalIgnoreCase))
            .ToList();

    [GeneratedRegex(@"(?:(\d{1,2})/+)?(\d{1,2})/+(\d{4})")]
    private static partial Regex DateRegex();

    [GeneratedRegex(@"\b(19\d{2}|20\d{2})\b")]
    private static partial Regex YearRegex();
}
