using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Movies.Api.Data;

namespace Movies.Api.Services;

/// <summary>Adding tracked CeX items from pasted links and keeping their captured data fresh.</summary>
public partial class CexItemsService(MoviesDbContext db, CexClient cex)
{
    public abstract record AddResult;
    public record Added(CexItem Item) : AddResult;
    public record Invalid(string Message) : AddResult;
    public record Duplicate(CexItem Existing) : AddResult;
    public record NotFound(string Sku) : AddResult;

    /// <summary>Accepts any CeX product link (or a bare SKU) and returns the SKU.</summary>
    public static string? ExtractSku(string? input)
    {
        if (string.IsNullOrWhiteSpace(input)) return null;
        input = input.Trim();
        var m = SkuInUrlRegex().Match(input);
        var sku = m.Success ? Uri.UnescapeDataString(m.Groups[1].Value) : input;
        return SkuRegex().IsMatch(sku) ? sku : null;
    }

    public static string CanonicalUrl(string sku) => $"https://uk.webuy.com/product-detail?id={Uri.EscapeDataString(sku)}";

    public async Task<AddResult> AddAsync(string? link, string? notes, CancellationToken ct = default)
    {
        var sku = ExtractSku(link);
        if (sku is null) return new Invalid("That doesn't look like a CeX product link (expected …webuy.com/product-detail?id=…).");

        var existing = await db.CexItems.FirstOrDefaultAsync(i => i.Sku == sku, ct);
        if (existing is not null) return new Duplicate(existing);

        var details = await cex.GetAsync(sku, bypassCache: true, ct);
        if (details is null) return new NotFound(sku);

        var item = new CexItem
        {
            Sku = sku,
            Url = CanonicalUrl(sku),
            Notes = string.IsNullOrWhiteSpace(notes) ? null : notes.Trim(),
            SortOrder = (await db.CexItems.MaxAsync(i => (int?)i.SortOrder, ct) ?? 0) + 1,
        };
        Apply(item, details);
        db.CexItems.Add(item);
        await db.SaveChangesAsync(ct);
        return new Added(item);
    }

    /// <summary>Re-captures title, image and prices. Returns false when CeX doesn't answer.</summary>
    public async Task<bool> RefreshAsync(CexItem item, CancellationToken ct = default)
    {
        var details = await cex.GetAsync(item.Sku, bypassCache: true, ct);
        if (details is null) return false;
        Apply(item, details);
        await db.SaveChangesAsync(ct);
        return true;
    }

    private static void Apply(CexItem item, CexDetails d)
    {
        item.Title = d.BoxName;
        item.Category = d.Category;
        item.ImageUrl = d.ImageUrl;
        item.SellPrice = d.SellPrice;
        item.CashPrice = d.CashPrice;
        item.ExchangePrice = d.ExchangePrice;
        item.RefreshedAt = DateTime.UtcNow;
    }

    [GeneratedRegex(@"[?&]id=([^&#\s]+)")]
    private static partial Regex SkuInUrlRegex();

    [GeneratedRegex(@"^[A-Za-z0-9\-]{1,40}$")]
    private static partial Regex SkuRegex();
}

/// <summary>Refreshes tracked items' prices every few hours.</summary>
public class CexRefreshService(IServiceScopeFactory scopes, IConfiguration config, ILogger<CexRefreshService> logger)
    : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromHours(6);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!config.GetValue("Cex:BackgroundRefresh", true)) return;
        await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken); // let startup finish
        using var timer = new PeriodicTimer(Interval);
        do
        {
            try
            {
                await RefreshStaleAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "CeX background refresh failed");
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    private async Task RefreshStaleAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MoviesDbContext>();
        var service = scope.ServiceProvider.GetRequiredService<CexItemsService>();
        var cutoff = DateTime.UtcNow - Interval + TimeSpan.FromMinutes(5);
        var stale = await db.CexItems.Where(i => i.RefreshedAt == null || i.RefreshedAt < cutoff).ToListAsync(ct);
        var refreshed = 0;
        foreach (var item in stale)
        {
            if (await service.RefreshAsync(item, ct)) refreshed++;
            await Task.Delay(TimeSpan.FromSeconds(1), ct); // be gentle with CeX
        }
        if (stale.Count > 0) logger.LogInformation("Refreshed {Refreshed}/{Total} CeX items", refreshed, stale.Count);
    }
}
