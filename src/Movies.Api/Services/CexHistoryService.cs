using Microsoft.EntityFrameworkCore;
using Movies.Api.Data;

namespace Movies.Api.Services;

/// <summary>Records a daily CeX price snapshot for every product linked from the collection.</summary>
public class CexHistoryService(MoviesDbContext db, CexClient cex, ILogger<CexHistoryService> logger)
{
    public static DateOnly Today => DateOnly.FromDateTime(DateTime.UtcNow);

    /// <summary>Distinct CeX SKUs of the releases on the shelf.</summary>
    public async Task<List<string>> OwnedSkusAsync(CancellationToken ct = default) =>
        await db.Releases.Where(r => r.CexSku != null).Select(r => r.CexSku!).Distinct().ToListAsync(ct);

    /// <summary>
    /// Snapshots today's prices for owned SKUs that don't have one yet, so a run that CeX cut short
    /// is finished by the next one. Returns how many were recorded.
    /// </summary>
    public async Task<int> SnapshotAsync(TimeSpan pause, CancellationToken ct = default)
    {
        var today = Today;
        var done = (await db.CexPriceSnapshots.Where(s => s.Date == today).Select(s => s.Sku).ToListAsync(ct)).ToHashSet();
        var todo = (await OwnedSkusAsync(ct)).Where(s => !done.Contains(s)).ToList();
        var recorded = 0;
        foreach (var sku in todo)
        {
            var d = await cex.GetAsync(sku, bypassCache: true, ct);
            if (d is not null)
            {
                db.CexPriceSnapshots.Add(new CexPriceSnapshot
                {
                    Sku = sku,
                    Date = today,
                    BoxName = d.BoxName,
                    Category = d.Category,
                    SellPrice = d.SellPrice,
                    CashPrice = d.CashPrice,
                    ExchangePrice = d.ExchangePrice,
                });
                // keep the releases' CeX name and picture current
                foreach (var r in await db.Releases.Where(r => r.CexSku == sku).ToListAsync(ct))
                {
                    r.CexBoxName = d.BoxName;
                    r.ImageUrl = d.ImageUrl ?? r.ImageUrl;
                }
                await db.SaveChangesAsync(ct);
                recorded++;
            }
            if (pause > TimeSpan.Zero) await Task.Delay(pause, ct); // be gentle with CeX
        }
        if (todo.Count > 0) logger.LogInformation("Recorded CeX prices for {Recorded}/{Total} owned items", recorded, todo.Count);

        // Releases still without CeX's name and picture (new links, converted releases) get them now rather than tomorrow.
        foreach (var r in await db.Releases.Where(r => r.CexSku != null && r.CexBoxName == null).ToListAsync(ct))
        {
            if (await cex.GetAsync(r.CexSku!, ct) is { } d)
            {
                r.CexBoxName = d.BoxName;
                r.ImageUrl = d.ImageUrl ?? r.ImageUrl;
                await db.SaveChangesAsync(ct);
            }
            if (pause > TimeSpan.Zero) await Task.Delay(pause, ct);
        }
        return recorded;
    }
}

/// <summary>Checks hourly and takes the day's snapshot once (retrying items CeX didn't answer for).</summary>
public class CexHistoryRefreshService(IServiceScopeFactory scopes, IConfiguration config, ILogger<CexHistoryRefreshService> logger)
    : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!config.GetValue("Cex:BackgroundRefresh", true)) return;
        await Task.Delay(TimeSpan.FromMinutes(2), stoppingToken); // after startup and the tracker's own refresh
        using var timer = new PeriodicTimer(TimeSpan.FromHours(1));
        do
        {
            try
            {
                using var scope = scopes.CreateScope();
                await scope.ServiceProvider.GetRequiredService<CexHistoryService>().SnapshotAsync(TimeSpan.FromSeconds(1), stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "CeX price snapshot failed");
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
