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
    DoorwayToDorkness,
}

/// <summary>Where a release went when it left the shelf. Null on a release means it's still on the shelf.</summary>
public enum SaleChannel
{
    Cex,
    Ebay,
    FacebookMarketplace,
    Other,
}

/// <summary>What CeX paid for a trade-in: cash, or the (higher) voucher price.</summary>
public enum TradeInPayout
{
    Cash,
    Voucher,
}

/// <summary>
/// A disc (or set of discs) on the shelf. A box set holds several titles; a title can be owned on several releases.
/// A release that was traded in or sold stays as history (SoldVia set), but isn't on the shelf any more.
/// </summary>
public class PhysicalRelease : ITimestamped
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public ReleaseFormat Format { get; set; }
    public ReleaseEdition Edition { get; set; }
    public decimal? PricePaid { get; set; }
    public PurchasePlace PurchasedFrom { get; set; }
    /// <summary>When it was bought, if known (releases imported from the sheet don't have it).</summary>
    public DateOnly? BoughtOn { get; set; }
    public string? Notes { get; set; }

    // Traded in or sold: where (null = still on the shelf), when, for how much, and for a CeX trade-in, cash or voucher.
    public SaleChannel? SoldVia { get; set; }
    public DateOnly? SoldOn { get; set; }
    public decimal? SoldFor { get; set; }
    public TradeInPayout? Payout { get; set; }
    public bool IsSold => SoldVia is not null;

    /// <summary>
    /// The CeX product page, wherever the release was bought: it's what the CeX value and the daily price history
    /// use. The SKU is kept alongside for lookups.
    /// </summary>
    public string? CexUrl { get; set; }
    public string? CexSku { get; set; }

    // Captured from CeX when the link is saved, refreshed by the daily price snapshot.
    public string? CexBoxName { get; set; }
    public string? ImageUrl { get; set; }

    /// <summary>
    /// When your own picture (ReleaseCover) was last set; null without one. It's part of the picture's link, so a
    /// new one is never served from a cache.
    /// </summary>
    public DateTime? CoverUpdatedAt { get; set; }

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
