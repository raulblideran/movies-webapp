namespace Movies.Api.Data;

public enum ReleaseFormat
{
    Dvd,
    BluRay,
    UltraHdBluRay,
}

public enum ReleaseEdition
{
    Standard,
    Steelbook,
    BoxSet,
}

/// <summary>Where a release was bought. Other comes first so a request that leaves it out means Other.</summary>
public enum PurchasePlace
{
    Other,
    Cex,
    Hmv,
    Ebay,
    Zavvi,
    Amazon,
    ForbiddenPlanet,
}

/// <summary>A disc (or set of discs) on the shelf. A box set holds several titles; a title can be owned on several releases.</summary>
public class PhysicalRelease : ITimestamped
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public ReleaseFormat Format { get; set; }
    public ReleaseEdition Edition { get; set; }
    public decimal? PricePaid { get; set; }
    public PurchasePlace PurchasedFrom { get; set; }
    public string? Notes { get; set; }

    /// <summary>
    /// The CeX product page, wherever the release was bought: it's what the CeX value and the daily price history
    /// use. The SKU is kept alongside for lookups.
    /// </summary>
    public string? CexUrl { get; set; }
    public string? CexSku { get; set; }

    // Captured from CeX when the link is saved, refreshed by the daily price snapshot.
    public string? CexBoxName { get; set; }
    public string? ImageUrl { get; set; }

    public List<TitleRelease> TitleLinks { get; set; } = [];

    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>The many-to-many link between titles and the releases they're on.</summary>
public class TitleRelease
{
    public int TitleId { get; set; }
    public Title Title { get; set; } = null!;
    public int ReleaseId { get; set; }
    public PhysicalRelease Release { get; set; } = null!;
}
