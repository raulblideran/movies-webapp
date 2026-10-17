using Movies.Api.Data;
using Movies.Api.Import;

namespace Movies.Api.Tests;

public class SheetCsvTests
{
    private const string Header =
        "Name,Type,1st Watch,Physical Format,Rating ?/10,Watch count,Latest Watch,Seasons,Episodes Total,Genre,Rewatch potential,Bogdan,Date W/Bogdi,Comments,Price (£),Cex Link\n";

    private static SheetCsv.ParseResult Parse(string rows) => SheetCsv.Parse(new StringReader(Header + rows));

    [Fact]
    public void Parses_a_typical_row()
    {
        var r = Parse("5 centimeters per second,Film,08/2022,Blu-Ray,10,1,08/2022,N/a,N/a,Anime,10,Yes,08/2022,\"2007, Really complex\",6,https://uk.webuy.com/product-detail?id=5037899082287&x=1\n");
        var t = Assert.Single(r.Titles);
        Assert.Equal(TitleType.Film, t.Type);
        Assert.Equal(new DateOnly(2022, 8, 1), t.FirstWatch);
        Assert.Equal(10m, t.Rating);
        Assert.Equal(["Anime"], t.Genres);
        Assert.Equal(["Blu-Ray"], t.PhysicalFormats);
        Assert.True(t.WithBogdan);
        Assert.Equal(2007, t.ReleaseYear);
        Assert.Equal(6m, t.PricePaid);
        Assert.Single(t.CexLinks);
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
        Assert.Equal(["4K Blu-Ray Box Set", "4K Blu-Ray Steelbook"], show.PhysicalFormats);
        Assert.Equal(["Sci-Fi", "Drama"], show.Genres);
        Assert.Equal(2, show.CexLinks.Count);
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
        Assert.Equal(new DateOnly(2023, 11, 1), r.Titles[0].FirstWatch);
        Assert.Equal(10, r.Titles[0].RewatchPotential);
        Assert.Contains(r.Anomalies, a => a.Contains("rewatch potential 100"));
        Assert.Contains(r.Anomalies, a => a.Contains("duplicate name \"Halloween\""));
    }

    [Fact]
    public void Export_round_trips()
    {
        var original = Parse("Show,Series,02/2021,\"Blu-Ray, DVD\",8.5,2,03/2022,2,20,Comedy/Drama,7,Yes,03/2022,\"Nice, really\",12.5,https://a.example/x?id=1\n").Titles;
        var again = SheetCsv.Parse(new StringReader(SheetCsv.Write(original))).Titles;
        var (a, b) = (original[0], again[0]);
        Assert.Equal(a.Name, b.Name);
        Assert.Equal(a.Rating, b.Rating);
        Assert.Equal(a.FirstWatch, b.FirstWatch);
        Assert.Equal(a.LatestWatch, b.LatestWatch);
        Assert.Equal(a.PhysicalFormats, b.PhysicalFormats);
        Assert.Equal(a.Genres, b.Genres);
        Assert.Equal(a.Comments, b.Comments);
        Assert.Equal(a.PricePaid, b.PricePaid);
        Assert.Equal(a.CexLinks, b.CexLinks);
        Assert.Equal(a.WithBogdan, b.WithBogdan);
        Assert.Equal(a.DateWithBogdan, b.DateWithBogdan);
    }
}
