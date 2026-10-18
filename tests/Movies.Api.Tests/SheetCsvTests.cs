using Movies.Api.Data;
using Movies.Api.Import;

namespace Movies.Api.Tests;

public class SheetCsvTests
{
    private const string Header =
        "Name,Type,1st Watch,Physical Format,Rating ?/10,Watch count,Latest Watch,Seasons,Episodes Total,Genre,Rewatch potential,Bogdan,Date W/Bogdi,Comments,Price (£),Cex Link\n";

    private static SheetCsv.ParseResult Parse(string rows) => SheetCsv.Parse(new StringReader(Header + rows), new Random(42));

    private static void AssertInMonth(int year, int month, DateOnly? d)
    {
        Assert.NotNull(d);
        Assert.Equal((year, month), (d.Value.Year, d.Value.Month));
    }

    [Fact]
    public void Parses_a_typical_row()
    {
        var r = Parse("5 centimeters per second,Film,08/2022,Blu-Ray,10,1,08/2022,N/a,N/a,Anime,10,Yes,08/2022,\"2007, Really complex\",6,https://uk.webuy.com/product-detail?id=5037899082287&x=1\n");
        var t = Assert.Single(r.Titles);
        Assert.Equal(TitleType.Film, t.Type);
        AssertInMonth(2022, 8, t.FirstWatch);
        Assert.Equal(t.FirstWatch, t.LatestWatch);
        Assert.Equal(t.FirstWatch, t.DateWithBogdan);
        Assert.Equal(10m, t.Rating);
        Assert.Equal(["Anime"], t.Genres);
        var shelf = Assert.Single(r.Shelves);
        Assert.Equal(["Blu-Ray"], shelf.Formats);
        Assert.True(t.WithBogdan);
        Assert.Equal(2007, t.ReleaseYear);
        Assert.Equal(6m, shelf.PricePaid);
        Assert.Single(shelf.CexLinks);
        Assert.Null(t.Seasons);
        Assert.Empty(r.Anomalies);
    }

    [Fact]
    public void Handles_unknowns_lists_and_gold_rating()
    {
        var r = Parse("Show,Series,N/a,\"4K Blu-Ray Box Set, 4K Blu-Ray Steelbook\",?,3,N/a,4,52,Sci-Fi/Drama,8,No,,,,\"https://a.example/x?id=1, https://a.example/x?id=2\"\n" +
                      "Fave,Film,01/2020,,11,10,01/2020,N/a,N/a,Drama,10,No,,,,\n");
        var show = r.Titles[0];
        Assert.Equal(TitleType.Series, show.Type);
        Assert.Null(show.Rating);
        Assert.Null(show.FirstWatch);
        Assert.Equal(["4K Blu-Ray Box Set", "4K Blu-Ray Steelbook"], r.Shelves[0].Formats);
        Assert.Equal(["Sci-Fi", "Drama"], show.Genres);
        Assert.Equal(2, r.Shelves[0].CexLinks.Count);
        Assert.Equal(4, show.Seasons);
        Assert.Equal(52, show.EpisodesTotal);
        Assert.Equal(11m, r.Titles[1].Rating);
    }

    [Fact]
    public void Reports_and_fixes_anomalies()
    {
        var r = Parse("A Silent Voice,Film,11//2023,,10,1,11//2023,N/a,N/a,Anime,100,No,,,,\n" +
                      "Halloween,Film,10/2018,,8,1,10/2018,N/a,N/a,Horror,8,No,,2018,,\n" +
                      "Halloween,Film,10/2019,,8,1,10/2019,N/a,N/a,Horror,8,No,,1978,,\n");
        AssertInMonth(2023, 11, r.Titles[0].FirstWatch);
        Assert.Equal(10, r.Titles[0].RewatchPotential);
        Assert.Contains(r.Anomalies, a => a.Contains("rewatch potential 100"));
        Assert.Contains(r.Anomalies, a => a.Contains("duplicate name \"Halloween\""));
    }

    [Fact]
    public void Export_round_trips()
    {
        var parsed = Parse("Show,Series,02/2021,\"Blu-Ray, DVD\",8.5,2,03/2022,2,20,Comedy/Drama,7,Yes,03/2022,\"Nice, really\",12.5,https://uk.webuy.com/product-detail?id=1&categoryName=DVD-KIDS\n");
        var original = parsed.Titles;
        // what the import does: the shelf becomes releases linked to the title
        original[0].Id = 1;
        foreach (var p in ReleaseConversion.Plan([new(1, original[0].Name, parsed.Shelves[0].Formats, parsed.Shelves[0].PricePaid, parsed.Shelves[0].CexLinks)]))
        {
            var link = new TitleRelease { TitleId = 1, Title = original[0], Release = p.Release };
            p.Release.TitleLinks.Add(link);
            original[0].ReleaseLinks.Add(link);
        }
        var reparsed = SheetCsv.Parse(new StringReader(SheetCsv.Write(original)));
        var (a, b) = (original[0], reparsed.Titles[0]);
        Assert.Equal(a.Name, b.Name);
        Assert.Equal(a.Rating, b.Rating);
        Assert.Equal(a.FirstWatch, b.FirstWatch);
        Assert.Equal(a.LatestWatch, b.LatestWatch);
        Assert.Equal(a.Genres, b.Genres);
        Assert.Equal(a.Comments, b.Comments);
        Assert.Equal(["Blu-Ray", "DVD"], reparsed.Shelves[0].Formats.Order());
        Assert.Equal(12.5m, reparsed.Shelves[0].PricePaid);
        Assert.Equal(["https://uk.webuy.com/product-detail?id=1"], reparsed.Shelves[0].CexLinks);
        Assert.Equal(a.WithBogdan, b.WithBogdan);
        Assert.Equal(a.DateWithBogdan, b.DateWithBogdan);
    }

    [Fact]
    public void Keeps_full_dates()
    {
        var t = Parse("Film,Film,15/04/2020,,8,2,03/05/2021,N/a,N/a,Drama,8,Yes,03/05/2021,,,\n").Titles[0];
        Assert.Equal(new DateOnly(2020, 4, 15), t.FirstWatch);
        Assert.Equal(new DateOnly(2021, 5, 3), t.LatestWatch);
        Assert.Equal(new DateOnly(2021, 5, 3), t.DateWithBogdan);
    }

    [Fact]
    public void Rewatch_in_the_same_month_is_not_before_the_first_watch()
    {
        for (var seed = 0; seed < 50; seed++)
        {
            var t = SheetCsv.Parse(new StringReader(Header + "Film,Film,02/2021,,8,3,02/2021,N/a,N/a,Drama,8,Yes,02/2021,,,\n"), new Random(seed)).Titles[0];
            AssertInMonth(2021, 2, t.LatestWatch);
            Assert.True(t.LatestWatch >= t.FirstWatch);
            Assert.Equal(t.FirstWatch, t.DateWithBogdan);
        }
    }

    [Fact]
    public void Never_picks_a_day_in_the_future()
    {
        var today = DateOnly.FromDateTime(DateTime.Today);
        for (var seed = 0; seed < 50; seed++)
        {
            var t = SheetCsv.Parse(new StringReader(Header + $"Film,Film,{today:MM/yyyy},,8,1,{today:MM/yyyy},N/a,N/a,Drama,8,No,,,,\n"), new Random(seed)).Titles[0];
            Assert.True(t.FirstWatch <= today);
        }
    }
}
