using Movies.Api.Data;
using Movies.Api.Services;

namespace Movies.Api.Import;

/// <summary>
/// Turns the old per-title shelf fields (format labels like "4K Blu-Ray Steelbook", a price, CeX links)
/// into releases. Used once to convert the existing database, and by the CSV import.
/// </summary>
public static class ReleaseConversion
{
    public record Shelf(int TitleId, string TitleName, List<string> Formats, decimal? PricePaid, List<string> CexLinks);

    public record Planned(PhysicalRelease Release, List<int> TitleIds);

    /// <summary>"4K Blu-Ray Box Set" → (UltraHdBluRay, BoxSet). Null for anything that isn't a disc format.</summary>
    public static (ReleaseFormat Format, ReleaseEdition Edition)? ParseLabel(string label)
    {
        var l = label.ToLowerInvariant();
        ReleaseFormat? format = l.Contains("4k") || l.Contains("uhd") ? ReleaseFormat.UltraHdBluRay
            : l.Contains("blu") ? ReleaseFormat.BluRay
            : l.Contains("dvd") ? ReleaseFormat.Dvd
            : null;
        if (format is null) return null;
        var edition = l.Contains("steelbook") ? ReleaseEdition.Steelbook
            : l.Contains("box") ? ReleaseEdition.BoxSet
            : ReleaseEdition.Standard;
        return (format.Value, edition);
    }

    /// <summary>The sheet's spelling of a format, for the CSV export.</summary>
    public static string Label(ReleaseFormat format, ReleaseEdition edition) =>
        (format switch { ReleaseFormat.Dvd => "DVD", ReleaseFormat.BluRay => "Blu-Ray", _ => "4K Blu-Ray" })
        + (edition switch { ReleaseEdition.Steelbook => " Steelbook", ReleaseEdition.BoxSet => " Box Set", _ => "" });

    /// <summary>CeX links carry a category ("BLU-RAY-4K", "DVD-KIDS", …) that says which disc a link is.</summary>
    private static ReleaseFormat? FormatHint(string link)
    {
        var i = link.IndexOf("categoryName=", StringComparison.OrdinalIgnoreCase);
        if (i < 0) return null;
        var cat = link[(i + 13)..].Split('&')[0].ToUpperInvariant();
        return cat.Contains("4K") ? ReleaseFormat.UltraHdBluRay
            : cat.StartsWith("DVD") ? ReleaseFormat.Dvd
            : cat.Contains("BLU-RAY") ? ReleaseFormat.BluRay
            : null;
    }

    /// <summary>
    /// One release per CeX product (titles sharing a product share the release: a box set), plus one per
    /// remaining format label. The sheet only linked what was bought at CeX, so those are marked as from CeX. A title's price is split evenly across the releases it's on; a box set's
    /// price is the sum of what its titles paid.
    /// </summary>
    public static List<Planned> Plan(IEnumerable<Shelf> shelves)
    {
        var planned = new List<Planned>();
        var bySku = new Dictionary<string, Planned>(StringComparer.OrdinalIgnoreCase);
        var names = new Dictionary<int, string>();

        foreach (var s in shelves)
        {
            names[s.TitleId] = s.TitleName;
            var unused = s.Formats.Select(ParseLabel).OfType<(ReleaseFormat Format, ReleaseEdition Edition)>().ToList();
            var mine = new List<Planned>();

            foreach (var link in s.CexLinks)
            {
                var sku = CexItemsService.ExtractSku(link);
                if (sku is null) continue;
                var hint = FormatHint(link);
                if (bySku.TryGetValue(sku, out var shared))
                {
                    if (mine.Contains(shared)) continue;
                    var same = unused.FindIndex(u => u.Format == shared.Release.Format);
                    if (same >= 0) unused.RemoveAt(same);
                    shared.TitleIds.Add(s.TitleId);
                    mine.Add(shared);
                    continue;
                }
                var pick = unused.FindIndex(u => hint is null || u.Format == hint);
                if (pick < 0 && unused.Count > 0) pick = 0;
                var (format, edition) = pick >= 0 ? unused[pick] : (hint ?? ReleaseFormat.BluRay, ReleaseEdition.Standard);
                if (pick >= 0) unused.RemoveAt(pick);
                var p = new Planned(New(format, edition), [s.TitleId]);
                p.Release.CexSku = sku;
                p.Release.CexUrl = CexItemsService.CanonicalUrl(sku);
                p.Release.PurchasedFrom = PurchasePlace.Cex;
                bySku[sku] = p;
                planned.Add(p);
                mine.Add(p);
            }

            foreach (var (format, edition) in unused)
            {
                var p = new Planned(New(format, edition), [s.TitleId]);
                planned.Add(p);
                mine.Add(p);
            }

            // A price with nothing on the shelf still came from somewhere: keep it on a release to sort out later.
            if (mine.Count == 0 && s.PricePaid is > 0)
            {
                var p = new Planned(New(ReleaseFormat.BluRay, ReleaseEdition.Standard), [s.TitleId]);
                p.Release.Notes = "Converted from a price with no format: check the format.";
                planned.Add(p);
                mine.Add(p);
            }

            if (s.PricePaid is { } price && mine.Count > 0)
            {
                var share = Math.Round(price / mine.Count, 2);
                for (var i = 0; i < mine.Count; i++)
                {
                    // the first takes the rounding remainder so the shares add up to the price
                    var part = i == 0 ? price - share * (mine.Count - 1) : share;
                    mine[i].Release.PricePaid = (mine[i].Release.PricePaid ?? 0) + part;
                }
            }
        }

        foreach (var p in planned)
        {
            var titles = p.TitleIds.Select(id => names[id]).Order(StringComparer.OrdinalIgnoreCase).ToList();
            p.Release.Name = titles.Count == 1 ? titles[0] : $"{titles[0]} collection";
        }
        return planned;
    }

    private static PhysicalRelease New(ReleaseFormat format, ReleaseEdition edition) =>
        new() { Name = "", Format = format, Edition = edition };
}
