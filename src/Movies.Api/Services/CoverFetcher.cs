using System.Net;
using System.Net.Sockets;

namespace Movies.Api.Services;

/// <summary>
/// Fetches a picture from a link an editor pasted (a cover found on another site), so the release editor can
/// show it and save a copy: a hotlinked picture could vanish or be blocked later. Only the public internet is
/// reachable: every connection, redirects included, goes to an address checked by <see cref="IsPublic"/>, on
/// port 80 or 443, so a link can't reach the server itself or anything else on its network.
/// </summary>
public class CoverFetcher(HttpClient http)
{
    public const int MaxBytes = 10 * 1024 * 1024;

    public record Result(byte[]? Data, string? ContentType, string? Error);

    public async Task<Result> FetchAsync(string? link, CancellationToken ct = default)
    {
        if (!Uri.TryCreate(link?.Trim(), UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https"))
            return new(null, null, "That isn't a web link (it should start with https://).");
        if (!uri.IsDefaultPort) return new(null, null, "Links to an unusual port aren't fetched.");
        if (IPAddress.TryParse(uri.IdnHost, out var literal) && !IsPublic(literal))
            return new(null, null, "That address isn't on the public internet.");

        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, uri);
            req.Headers.Accept.ParseAdd("image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8");
            using var resp = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
            if (!resp.IsSuccessStatusCode) return new(null, null, $"The site answered {(int)resp.StatusCode} for that link.");
            if (resp.Content.Headers.ContentLength > MaxBytes) return new(null, null, "That picture is too big (over 10 MB).");

            await using var stream = await resp.Content.ReadAsStreamAsync(ct);
            using var buffer = new MemoryStream();
            var chunk = new byte[81920];
            int read;
            while ((read = await stream.ReadAsync(chunk, ct)) > 0)
            {
                if (buffer.Length + read > MaxBytes) return new(null, null, "That picture is too big (over 10 MB).");
                buffer.Write(chunk, 0, read);
            }
            var data = buffer.ToArray();
            var type = SniffAny(data);
            return type is null
                ? new(null, null, "That link isn't a picture: open the picture on its own and copy its address.")
                : new(data, type, null);
        }
        catch (HttpRequestException e) when (e.InnerException is BlockedAddressException)
        {
            return new(null, null, "That address isn't on the public internet.");
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or IOException)
        {
            return new(null, null, "Couldn't fetch that picture: the site didn't answer.");
        }
    }

    /// <summary>What a cover can be saved as (Data.ReleaseCover.Sniff), plus GIF and AVIF, which the browser turns into a JPEG.</summary>
    private static string? SniffAny(byte[] b) =>
        Data.ReleaseCover.Sniff(b)
        ?? (b.Length >= 6 && (b.AsSpan(0, 6).SequenceEqual("GIF87a"u8) || b.AsSpan(0, 6).SequenceEqual("GIF89a"u8)) ? "image/gif"
            : b.Length >= 12 && b.AsSpan(4, 4).SequenceEqual("ftyp"u8) && (b.AsSpan(8, 4).SequenceEqual("avif"u8) || b.AsSpan(8, 4).SequenceEqual("avis"u8)) ? "image/avif"
            : null);

    /// <summary>The handler's connection step: resolve the name, refuse anything but public addresses on 80/443, connect.</summary>
    public static async ValueTask<Stream> ConnectPublicOnly(SocketsHttpConnectionContext context, CancellationToken ct)
    {
        var (host, port) = (context.DnsEndPoint.Host, context.DnsEndPoint.Port);
        if (port is not (80 or 443)) throw new BlockedAddressException();
        var addresses = IPAddress.TryParse(host, out var ip) ? [ip] : await Dns.GetHostAddressesAsync(host, ct);
        // every address the name has must be public, so a name can't mix in a private one
        if (addresses.Length == 0 || !addresses.All(IsPublic)) throw new BlockedAddressException();

        var target = addresses[0];
        var socket = new Socket(target.AddressFamily, SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
        try
        {
            await socket.ConnectAsync(new IPEndPoint(target, port), ct);
            return new NetworkStream(socket, ownsSocket: true);
        }
        catch
        {
            socket.Dispose();
            throw;
        }
    }

    /// <summary>
    /// A public internet address: not loopback, private, link-local (cloud metadata lives there), carrier-grade NAT,
    /// multicast, reserved or documentation ranges, in IPv4, IPv6 or IPv4 inside IPv6.
    /// </summary>
    public static bool IsPublic(IPAddress address)
    {
        if (address.IsIPv4MappedToIPv6) address = address.MapToIPv4();
        if (address.AddressFamily == AddressFamily.InterNetwork)
        {
            var b = address.GetAddressBytes();
            return !(b[0] is 0 or 10 or 127 or >= 224
                     || (b[0] == 100 && b[1] is >= 64 and <= 127)
                     || (b[0] == 169 && b[1] == 254)
                     || (b[0] == 172 && b[1] is >= 16 and <= 31)
                     || (b[0] == 192 && b[1] == 168)
                     || (b[0] == 192 && b[1] == 0 && b[2] is 0 or 2)
                     || (b[0] == 198 && b[1] is 18 or 19)
                     || (b[0] == 198 && b[1] == 51 && b[2] == 100)
                     || (b[0] == 203 && b[1] == 0 && b[2] == 113));
        }
        if (address.AddressFamily != AddressFamily.InterNetworkV6) return false;
        if (IPAddress.IsLoopback(address) || address.Equals(IPAddress.IPv6Any) || address.IsIPv6LinkLocal
            || address.IsIPv6SiteLocal || address.IsIPv6Multicast) return false;
        var v6 = address.GetAddressBytes();
        if ((v6[0] & 0xFE) == 0xFC) return false; // unique local, fc00::/7
        if (v6[0] == 0x20 && v6[1] == 0x01 && v6[2] == 0x0D && v6[3] == 0xB8) return false; // documentation, 2001:db8::/32
        // NAT64 (64:ff9b::/96) carries an IPv4 address in its last four bytes
        if (v6[0] == 0x00 && v6[1] == 0x64 && v6[2] == 0xFF && v6[3] == 0x9B && v6.AsSpan(4, 8).IndexOfAnyExcept((byte)0) < 0)
            return IsPublic(new IPAddress(v6.AsSpan(12, 4)));
        return true;
    }

    private class BlockedAddressException() : Exception("Not a public internet address.");
}
