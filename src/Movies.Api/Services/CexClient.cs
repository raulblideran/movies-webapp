using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;

namespace Movies.Api.Services;

public record CexDetails(string Sku, string BoxName, decimal SellPrice, decimal CashPrice, decimal ExchangePrice);

/// <summary>Server-side CeX price lookup (replaces the browser CORS-proxy chain).</summary>
public class CexClient(HttpClient http, IMemoryCache cache, ILogger<CexClient> logger)
{
    private static readonly TimeSpan CacheFor = TimeSpan.FromHours(6);

    public async Task<CexDetails?> GetAsync(string sku, CancellationToken ct = default)
    {
        if (cache.TryGetValue<CexDetails>(sku, out var cached)) return cached;
        try
        {
            using var resp = await http.GetAsync($"v3/boxes/{Uri.EscapeDataString(sku)}/detail", ct);
            if (!resp.IsSuccessStatusCode)
            {
                logger.LogWarning("CeX returned {Status} for {Sku}", (int)resp.StatusCode, sku);
                return null;
            }
            using var doc = await JsonDocument.ParseAsync(await resp.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
            if (!doc.RootElement.TryGetProperty("response", out var r)
                || !r.TryGetProperty("data", out var data)
                || data.ValueKind != JsonValueKind.Object
                || !data.TryGetProperty("boxDetails", out var boxes)
                || boxes.GetArrayLength() == 0)
                return null;

            var b = boxes[0];
            static decimal Dec(JsonElement e, string p) =>
                e.TryGetProperty(p, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDecimal() : 0;
            var details = new CexDetails(
                sku,
                b.TryGetProperty("boxName", out var n) ? n.GetString() ?? sku : sku,
                Dec(b, "sellPrice"), Dec(b, "cashPrice"), Dec(b, "exchangePrice"));
            cache.Set(sku, details, CacheFor);
            return details;
        }
        catch (Exception ex) when (ex is HttpRequestException or JsonException or TaskCanceledException)
        {
            logger.LogWarning(ex, "CeX lookup failed for {Sku}", sku);
            return null;
        }
    }
}
