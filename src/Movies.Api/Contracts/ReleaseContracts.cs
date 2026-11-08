using Movies.Api.Data;
using Movies.Api.Services;

namespace Movies.Api.Contracts;

/// <summary>A release as listed on a title. The pages split them: SoldVia null is on the shelf, the rest is history.</summary>
public record ReleaseSummaryDto(
    int Id, string Name, ReleaseFormat Format, ReleaseEdition Edition, decimal? PricePaid, PurchasePlace PurchasedFrom,
    string? CexUrl, string? CexSku, int TitleCount,
    DateOnly? BoughtOn, SaleChannel? SoldVia, DateOnly? SoldOn, decimal? SoldFor, TradeInPayout? Payout)
{
    public static ReleaseSummaryDto From(PhysicalRelease r) =>
        new(r.Id, r.Name, r.Format, r.Edition, r.PricePaid, r.PurchasedFrom, r.CexUrl, r.CexSku, r.TitleLinks.Count,
            r.BoughtOn, r.SoldVia, r.SoldOn, r.SoldFor, r.Payout);
}

public record ReleaseDto(
    int Id,
    string Name,
    ReleaseFormat Format,
    ReleaseEdition Edition,
    decimal? PricePaid,
    PurchasePlace PurchasedFrom,
    string? Notes,
    string? CexUrl,
    string? CexSku,
    string? CexBoxName,
    string? ImageUrl,
    List<int> TitleIds,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    DateOnly? BoughtOn,
    SaleChannel? SoldVia,
    DateOnly? SoldOn,
    decimal? SoldFor,
    TradeInPayout? Payout)
{
    public static ReleaseDto From(PhysicalRelease r) => new(
        r.Id, r.Name, r.Format, r.Edition, r.PricePaid, r.PurchasedFrom, r.Notes, r.CexUrl, r.CexSku, r.CexBoxName, r.ImageUrl,
        r.TitleLinks.Select(l => l.TitleId).Order().ToList(), r.CreatedAt, r.UpdatedAt,
        r.BoughtOn, r.SoldVia, r.SoldOn, r.SoldFor, r.Payout);
}

public record ReleaseUpsertRequest(
    string? Name,
    ReleaseFormat Format,
    ReleaseEdition Edition,
    decimal? PricePaid,
    PurchasePlace PurchasedFrom,
    string? Notes,
    string? CexUrl,
    List<int>? TitleIds,
    // Traded in or sold. A PUT is the whole release, so leaving these out puts it back on the shelf.
    DateOnly? BoughtOn = null,
    SaleChannel? SoldVia = null,
    DateOnly? SoldOn = null,
    decimal? SoldFor = null,
    TradeInPayout? Payout = null)
{
    public Dictionary<string, string[]> Validate()
    {
        var errors = new Dictionary<string, string[]>();
        void Add(string key, string msg) => errors[key] = [msg];

        if (string.IsNullOrWhiteSpace(Name) && string.IsNullOrWhiteSpace(CexUrl)) Add(nameof(Name), "Name is required (or a CeX link to take it from).");
        else if (Name?.Length > 300) Add(nameof(Name), "Name is too long.");
        if (!Enum.IsDefined(Format)) Add(nameof(Format), "Format must be Dvd, BluRay or UltraHdBluRay.");
        if (!Enum.IsDefined(Edition)) Add(nameof(Edition), "Edition must be Standard, Steelbook or BoxSet.");
        if (PricePaid is < 0) Add(nameof(PricePaid), "Price cannot be negative.");
        if (!Enum.IsDefined(PurchasedFrom)) Add(nameof(PurchasedFrom), "Unknown shop.");
        if (Notes?.Length > 2000) Add(nameof(Notes), "Notes are too long.");
        if (!string.IsNullOrWhiteSpace(CexUrl) && CexItemsService.ExtractSku(CexUrl) is null)
            Add(nameof(CexUrl), "That doesn't look like a CeX product link (expected …webuy.com/product-detail?id=…).");

        // a day's slack, as for watches: a browser elsewhere can be a day ahead of the UK
        var latest = UkTime.Today().AddDays(1);
        if (BoughtOn is { } bought && (bought.Year < 1900 || bought > latest)) Add(nameof(BoughtOn), "The date you bought it can't be in the future.");
        if (SoldVia is { } via)
        {
            // the rest only counts when it's sold: without a channel, the date, price and payout are cleared
            if (!Enum.IsDefined(via)) Add(nameof(SoldVia), "Unknown place to sell (CeX, eBay, Facebook Marketplace or Other).");
            if (SoldOn is not { } sold) Add(nameof(SoldOn), "When did it go? A date is needed.");
            else if (sold.Year < 1900 || sold > latest) Add(nameof(SoldOn), "The date it went can't be in the future.");
            else if (BoughtOn is { } b && sold < b) Add(nameof(SoldOn), "It can't have gone before you bought it.");
            if (SoldFor is < 0) Add(nameof(SoldFor), "The price you got cannot be negative.");
            if (Payout is { } payout && !Enum.IsDefined(payout)) Add(nameof(Payout), "A trade-in is paid in Cash or Voucher.");
        }
        return errors;
    }
}
