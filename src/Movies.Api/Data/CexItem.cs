namespace Movies.Api.Data;

/// <summary>A CeX product being watched on the stock tracker page.</summary>
public class CexItem : ITimestamped
{
    public int Id { get; set; }
    public required string Sku { get; set; }
    public required string Url { get; set; }

    // Captured from CeX when the link is added, refreshed in the background.
    public string? Title { get; set; }
    public string? Category { get; set; }
    public string? ImageUrl { get; set; }
    public decimal? SellPrice { get; set; }
    public decimal? CashPrice { get; set; }
    public decimal? ExchangePrice { get; set; }
    public DateTime? RefreshedAt { get; set; }

    public string? Notes { get; set; }
    public int SortOrder { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
