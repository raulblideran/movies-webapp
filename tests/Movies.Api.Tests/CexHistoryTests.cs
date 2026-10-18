using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Movies.Api.Data;
using Movies.Api.Services;

namespace Movies.Api.Tests;

/// <summary>The app with CeX answered by a fake: every SKU costs £5 / £2 cash / £3 voucher, except "missing".</summary>
public class FakeCexApp : TestApp
{
    public int Calls;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.ConfigureTestServices(s =>
            s.AddHttpClient<CexClient>().ConfigurePrimaryHttpMessageHandler(() => new FakeCex(this)));
    }

    private class FakeCex(FakeCexApp app) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Interlocked.Increment(ref app.Calls);
            var body = request.RequestUri!.AbsolutePath.Contains("/missing/")
                ? """{"response":{"data":{"boxDetails":[]}}}"""
                : """{"response":{"data":{"boxDetails":[{"boxName":"Box","categoryFriendlyName":"Blu-Ray Movies","sellPrice":5,"cashPrice":2,"exchangePrice":3}]}}}""";
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") });
        }
    }
}

public class CexHistoryTests : IClassFixture<FakeCexApp>
{
    private readonly FakeCexApp _app;
    public CexHistoryTests(FakeCexApp app) => _app = app;

    [Fact]
    public async Task Snapshots_each_owned_sku_once_a_day()
    {
        using (var scope = _app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<MoviesDbContext>();
            db.Releases.AddRange(
                new PhysicalRelease { Name = "A", CexSku = "1000000000001" },
                new PhysicalRelease { Name = "A again", CexSku = "1000000000001" },
                new PhysicalRelease { Name = "B", CexSku = "missing" });
            await db.SaveChangesAsync();
        }

        using (var scope = _app.Services.CreateScope())
        {
            var history = scope.ServiceProvider.GetRequiredService<CexHistoryService>();
            Assert.Equal(1, await history.SnapshotAsync(TimeSpan.Zero));
            // second run today: the recorded SKU is skipped; the one CeX didn't know is retried (for its price and its name)
            var calls = _app.Calls;
            Assert.Equal(0, await history.SnapshotAsync(TimeSpan.Zero));
            Assert.Equal(calls + 2, _app.Calls);
        }

        using (var scope = _app.Services.CreateScope())
        {
            var rows = await scope.ServiceProvider.GetRequiredService<MoviesDbContext>().CexPriceSnapshots
                .Where(s => s.Sku == "1000000000001" || s.Sku == "missing").ToListAsync();
            var row = Assert.Single(rows);
            Assert.Equal(("1000000000001", 2m, 3m, 5m), (row.Sku, row.CashPrice, row.ExchangePrice, row.SellPrice));
            Assert.Equal(CexHistoryService.Today, row.Date);
            // both releases of that product picked up CeX's name
            var named = await scope.ServiceProvider.GetRequiredService<MoviesDbContext>().Releases.Where(r => r.CexSku == "1000000000001").ToListAsync();
            Assert.All(named, r => Assert.Equal("Box", r.CexBoxName));
        }
    }

    [Fact]
    public async Task History_is_public_and_grouped_oldest_first()
    {
        using (var scope = _app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<MoviesDbContext>();
            db.CexPriceSnapshots.AddRange(
                new CexPriceSnapshot { Sku = "2000000000002", Date = new DateOnly(2026, 1, 2), BoxName = "New name", CashPrice = 4 },
                new CexPriceSnapshot { Sku = "2000000000002", Date = new DateOnly(2026, 1, 1), BoxName = "Old name", CashPrice = 3 });
            await db.SaveChangesAsync();
        }

        var list = await _app.CreateClient().GetFromJsonAsync<JsonElement>("/api/cex/history");
        var item = list.EnumerateArray().Single(i => i.GetProperty("sku").GetString() == "2000000000002");
        Assert.Equal("New name", item.GetProperty("boxName").GetString());
        var points = item.GetProperty("points").EnumerateArray().ToList();
        Assert.Equal(["2026-01-01", "2026-01-02"], points.Select(p => p.GetProperty("date").GetString()));
        Assert.Equal(3m, points[0].GetProperty("cash").GetDecimal());
    }
}
