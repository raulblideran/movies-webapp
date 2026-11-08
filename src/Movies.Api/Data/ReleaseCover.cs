namespace Movies.Api.Data;

/// <summary>
/// Your own picture of a release (a photo of the case, or a cover found elsewhere), shown instead of CeX's. A table
/// of its own, so listing releases never loads the pictures, and kept in the database so the backups have them.
/// </summary>
public class ReleaseCover
{
    public int ReleaseId { get; set; }
    public PhysicalRelease Release { get; set; } = null!;
    public required string ContentType { get; set; }
    public required byte[] Data { get; set; }
    public DateTime UpdatedAt { get; set; }

    /// <summary>The picture formats a cover can be: what the bytes say, not what the request claims. Null otherwise.</summary>
    public static string? Sniff(ReadOnlySpan<byte> b) =>
        b.Length >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF ? "image/jpeg"
        : b.Length >= 8 && b[..8].SequenceEqual((ReadOnlySpan<byte>)[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) ? "image/png"
        : b.Length >= 12 && b[..4].SequenceEqual("RIFF"u8) && b[8..12].SequenceEqual("WEBP"u8) ? "image/webp"
        : null;
}
