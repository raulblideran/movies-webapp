using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;

namespace Movies.Api.Services;

public record CexDetails(
    string Sku,
    string BoxName,
    decimal SellPrice,
    decimal CashPrice,
    decimal ExchangePrice,
    string? Category = null,
    string? ImageUrl = null);

public record CexStore(int StoreId, string StoreName, double Latitude, double Longitude);

public record CexStoreStock(string StoreName, int Quantity, double DistanceKm);

/// <summary>Server-side CeX lookups (replaces the browser CORS-proxy chain).</summary>
public class CexClient(HttpClient http, IMemoryCache cache, ILogger<CexClient> logger)
{
    private static readonly TimeSpan DetailsCacheFor = TimeSpan.FromHours(6);
    private static readonly TimeSpan StoresCacheFor = TimeSpan.FromHours(24);
    private static readonly TimeSpan StockCacheFor = TimeSpan.FromMinutes(15);

    public Task<CexDetails?> GetAsync(string sku, CancellationToken ct = default) =>
        GetAsync(sku, bypassCache: false, ct);

    public async Task<CexDetails?> GetAsync(string sku, bool bypassCache, CancellationToken ct = default)
    {
        var key = $"cex:detail:{sku}";
        if (!bypassCache && cache.TryGetValue<CexDetails>(key, out var cached)) return cached;

        var data = await GetDataAsync($"v3/boxes/{Uri.EscapeDataString(sku)}/detail", ct);
        if (data is not { } d || !d.TryGetProperty("boxDetails", out var boxes) || boxes.GetArrayLength() == 0)
            return null;

        var b = boxes[0];
        string? image = null;
        if (b.TryGetProperty("imageUrls", out var images) && images.ValueKind == JsonValueKind.Object)
            image = Str(images, "large") ?? Str(images, "medium");

        var details = new CexDetails(
            sku,
            Str(b, "boxName") ?? sku,
            Dec(b, "sellPrice"), Dec(b, "cashPrice"), Dec(b, "exchangePrice"),
            Str(b, "categoryFriendlyName") ?? Str(b, "categoryName"),
            image);
        cache.Set(key, details, DetailsCacheFor);
        return details;
    }

    /// <summary>All CeX stores, alphabetically.</summary>
    public async Task<List<CexStore>?> GetStoresAsync(CancellationToken ct = default)
    {
        const string key = "cex:stores";
        if (cache.TryGetValue<List<CexStore>>(key, out var cached)) return cached;

        var data = await GetDataAsync("v3/stores", ct);
        if (data is not { } d || !d.TryGetProperty("stores", out var arr)) return null;

        var stores = arr.EnumerateArray()
            .Select(s => new CexStore(
                (int)Dec(s, "storeId"), Str(s, "storeName") ?? "", Dbl(s, "latitude"), Dbl(s, "longitude")))
            .Where(s => s.StoreName.Length > 0)
            .OrderBy(s => s.StoreName, StringComparer.OrdinalIgnoreCase)
            .ToList();
        cache.Set(key, stores, StoresCacheFor);
        return stores;
    }

    /// <summary>Stores with the item in stock, nearest first. Empty when it's out of stock everywhere; null on failure.</summary>
    public async Task<List<CexStoreStock>?> GetNearestStockAsync(string sku, double lat, double lon, CancellationToken ct = default)
    {
        var key = $"cex:stock:{sku}:{lat:F3}:{lon:F3}";
        if (cache.TryGetValue<List<CexStoreStock>>(key, out var cached)) return cached;

        var url = string.Create(CultureInfo.InvariantCulture,
            $"v3/boxes/{Uri.EscapeDataString(sku)}/neareststores?latitude={lat}&longitude={lon}");
        var response = await GetResponseAsync(url, ct);
        if (response is not { } r) return null;

        var stock = new List<CexStoreStock>();
        // CeX answers data: null when nothing is in stock.
        if (r.TryGetProperty("data", out var d) && d.ValueKind == JsonValueKind.Object
            && d.TryGetProperty("nearestStores", out var arr) && arr.ValueKind == JsonValueKind.Array)
        {
            stock = arr.EnumerateArray()
                .Select(s => new CexStoreStock(Str(s, "storeName") ?? "", (int)Dec(s, "quantityOnHand"), Dbl(s, "distance")))
                .Where(s => s.StoreName.Length > 0)
                .OrderBy(s => s.DistanceKm)
                .ToList();
        }
        cache.Set(key, stock, StockCacheFor);
        return stock;
    }

    private async Task<JsonElement?> GetDataAsync(string url, CancellationToken ct)
    {
        var response = await GetResponseAsync(url, ct);
        return response is { } r && r.TryGetProperty("data", out var d) && d.ValueKind == JsonValueKind.Object ? d : null;
    }

    private async Task<JsonElement?> GetResponseAsync(string url, CancellationToken ct)
    {
        try
        {
            using var resp = await http.GetAsync(url, ct);
            if (!resp.IsSuccessStatusCode)
            {
                logger.LogWarning("CeX returned {Status} for {Url}", (int)resp.StatusCode, url);
                return null;
            }
            using var doc = await JsonDocument.ParseAsync(await resp.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
            return doc.RootElement.TryGetProperty("response", out var r) ? r.Clone() : null;
        }
        catch (Exception ex) when (ex is HttpRequestException or JsonException or TaskCanceledException)
        {
            logger.LogWarning(ex, "CeX request failed for {Url}", url);
            return null;
        }
    }

    private static string? Str(JsonElement e, string p) =>
        e.TryGetProperty(p, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    // CeX mixes numbers and numeric strings ("quantityOnHand": "1").
    private static decimal Dec(JsonElement e, string p)
    {
        if (!e.TryGetProperty(p, out var v)) return 0;
        if (v.ValueKind == JsonValueKind.Number) return v.GetDecimal();
        return v.ValueKind == JsonValueKind.String
            && decimal.TryParse(v.GetString(), NumberStyles.Number, CultureInfo.InvariantCulture, out var d) ? d : 0;
    }

    private static double Dbl(JsonElement e, string p) => (double)Dec(e, p);
}
