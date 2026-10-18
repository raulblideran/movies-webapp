namespace Movies.Api.Data;

/// <summary>One day's CeX prices for a product linked from the collection, so the stats page can chart value over time.</summary>
public class CexPriceSnapshot
{
    public int Id { get; set; }
    public required string Sku { get; set; }
    public DateOnly Date { get; set; }

    public string? BoxName { get; set; }
    public string? Category { get; set; }
    public decimal SellPrice { get; set; }
    public decimal CashPrice { get; set; }
    public decimal ExchangePrice { get; set; }
}
