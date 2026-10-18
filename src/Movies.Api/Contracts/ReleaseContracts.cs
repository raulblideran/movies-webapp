using Movies.Api.Data;
using Movies.Api.Services;

namespace Movies.Api.Contracts;

/// <summary>A release as listed on a title.</summary>
public record ReleaseSummaryDto(
    int Id, string Name, ReleaseFormat Format, ReleaseEdition Edition, decimal? PricePaid, string? CexUrl, string? CexSku, int TitleCount)
{
    public static ReleaseSummaryDto From(PhysicalRelease r) =>
        new(r.Id, r.Name, r.Format, r.Edition, r.PricePaid, r.CexUrl, r.CexSku, r.TitleLinks.Count);
}

public record ReleaseDto(
    int Id,
    string Name,
    ReleaseFormat Format,
    ReleaseEdition Edition,
    decimal? PricePaid,
    string? Notes,
    string? CexUrl,
    string? CexSku,
    string? CexBoxName,
    string? ImageUrl,
    List<int> TitleIds,
    DateTime CreatedAt,
    DateTime UpdatedAt)
{
    public static ReleaseDto From(PhysicalRelease r) => new(
        r.Id, r.Name, r.Format, r.Edition, r.PricePaid, r.Notes, r.CexUrl, r.CexSku, r.CexBoxName, r.ImageUrl,
        r.TitleLinks.Select(l => l.TitleId).Order().ToList(), r.CreatedAt, r.UpdatedAt);
}

public record ReleaseUpsertRequest(
    string? Name,
    ReleaseFormat Format,
    ReleaseEdition Edition,
    decimal? PricePaid,
    string? Notes,
    string? CexUrl,
    List<int>? TitleIds)
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
        if (Notes?.Length > 2000) Add(nameof(Notes), "Notes are too long.");
        if (!string.IsNullOrWhiteSpace(CexUrl) && CexItemsService.ExtractSku(CexUrl) is null)
            Add(nameof(CexUrl), "That doesn't look like a CeX product link (expected …webuy.com/product-detail?id=…).");
        return errors;
    }
}
