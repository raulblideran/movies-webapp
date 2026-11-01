using System.Text.Json;
using System.Text.RegularExpressions;

namespace Movies.Api.Services;

public record PostcodeLocation(string Postcode, double Latitude, double Longitude, string? Place);

public abstract record PostcodeLookup
{
    public sealed record Found(PostcodeLocation Location) : PostcodeLookup;
    public sealed record Unknown : PostcodeLookup;
    public sealed record Unavailable : PostcodeLookup;
}

/// <summary>
/// UK postcodes to coordinates, via postcodes.io (free, no key). Only the postcode is sent, never the rest of the address.
/// </summary>
public partial class PostcodeClient(HttpClient http, ILogger<PostcodeClient> logger)
{
    // Outward code (DN1, SW1A, M1) and inward code (1AA), with or without the space.
    [GeneratedRegex(@"\b([A-Z]{1,2}[0-9][A-Z0-9]?)\s*([0-9][A-Z]{2})\b", RegexOptions.IgnoreCase)]
    private static partial Regex PostcodePattern();

    /// <summary>The last UK postcode in an address, as "DN1 1AA", or null when there isn't one.</summary>
    public static string? Find(string? address)
    {
        if (string.IsNullOrWhiteSpace(address)) return null;
        var m = PostcodePattern().Matches(address).LastOrDefault();
        return m is null ? null : $"{m.Groups[1].Value} {m.Groups[2].Value}".ToUpperInvariant();
    }

    public async Task<PostcodeLookup> LookupAsync(string postcode, CancellationToken ct = default)
    {
        try
        {
            using var resp = await http.GetAsync($"postcodes/{Uri.EscapeDataString(postcode.Replace(" ", ""))}", ct);
            if (resp.StatusCode == System.Net.HttpStatusCode.NotFound) return new PostcodeLookup.Unknown();
            if (!resp.IsSuccessStatusCode)
            {
                logger.LogWarning("postcodes.io returned {Status}", (int)resp.StatusCode);
                return new PostcodeLookup.Unavailable();
            }
            using var doc = await JsonDocument.ParseAsync(await resp.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
            if (!doc.RootElement.TryGetProperty("result", out var r)
                || r.ValueKind != JsonValueKind.Object
                || r.GetProperty("latitude").ValueKind != JsonValueKind.Number
                || r.GetProperty("longitude").ValueKind != JsonValueKind.Number)
                return new PostcodeLookup.Unknown(); // a real postcode with no location, e.g. a PO box
            return new PostcodeLookup.Found(new PostcodeLocation(
                r.TryGetProperty("postcode", out var pc) && pc.GetString() is { } p ? p : postcode,
                r.GetProperty("latitude").GetDouble(),
                r.GetProperty("longitude").GetDouble(),
                r.TryGetProperty("admin_district", out var place) && place.ValueKind == JsonValueKind.String ? place.GetString() : null));
        }
        catch (Exception ex) when (ex is HttpRequestException or JsonException or TaskCanceledException or KeyNotFoundException or InvalidOperationException)
        {
            logger.LogWarning(ex, "postcodes.io lookup failed");
            return new PostcodeLookup.Unavailable();
        }
    }
}
