using Microsoft.EntityFrameworkCore;
using Movies.Api.Auth;
using Movies.Api.Data;
using Movies.Api.Services;

namespace Movies.Api.Endpoints;

public record CexItemRequest(string? Url, string? Notes);

public record CexItemDto(
    int Id, string Sku, string Url, string? Title, string? Category, string? ImageUrl,
    decimal? SellPrice, decimal? CashPrice, decimal? ExchangePrice, string? Notes, DateTime? RefreshedAt)
{
    public static CexItemDto From(CexItem i) => new(
        i.Id, i.Sku, i.Url, i.Title, i.Category, i.ImageUrl, i.SellPrice, i.CashPrice, i.ExchangePrice, i.Notes, i.RefreshedAt);
}

/// <summary>The CeX stock tracker page: tracked items (public read, Editor write) and live store stock.</summary>
public static class CexTrackerEndpoints
{
    public static void MapCexTrackerEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/cex/stores", async (CexClient cex, CancellationToken ct) =>
            await cex.GetStoresAsync(ct) is { } stores ? Results.Ok(stores) : Results.Problem("CeX is not responding.", statusCode: 502))
            .RequireRateLimiting("cex");

        app.MapGet("/api/cex/{sku}/stores", async (string sku, double lat, double lon, CexClient cex, CancellationToken ct) =>
        {
            if (CexItemsService.ExtractSku(sku) != sku || lat is < -90 or > 90 || lon is < -180 or > 180)
                return Results.BadRequest();
            return await cex.GetNearestStockAsync(sku, lat, lon, ct) is { } stock
                ? Results.Ok(stock)
                : Results.Problem("CeX is not responding.", statusCode: 502);
        }).RequireRateLimiting("cex");

        var items = app.MapGroup("/api/cex-items");

        items.MapGet("/", async (MoviesDbContext db) =>
            (await db.CexItems.AsNoTracking().OrderBy(i => i.SortOrder).ThenBy(i => i.Id).ToListAsync())
                .Select(CexItemDto.From));

        var write = items.MapGroup("").RequireAuthorization(Policies.Editor);

        write.MapPost("/", async (CexItemRequest req, CexItemsService service, CancellationToken ct) =>
            await service.AddAsync(req.Url, req.Notes, ct) switch
            {
                CexItemsService.Added a => Results.Created($"/api/cex-items/{a.Item.Id}", CexItemDto.From(a.Item)),
                CexItemsService.Duplicate d => Results.Problem($"Already tracking \"{d.Existing.Title ?? d.Existing.Sku}\".", statusCode: 409),
                CexItemsService.NotFound n => Results.Problem($"CeX doesn't know product {n.Sku} (or isn't responding).", statusCode: 422),
                CexItemsService.Invalid i => Results.Problem(i.Message, statusCode: 400),
                _ => Results.StatusCode(500),
            });

        write.MapPut("/{id:int}", async (int id, CexItemRequest req, MoviesDbContext db, CexItemsService service, CancellationToken ct) =>
        {
            var item = await db.CexItems.FindAsync([id], ct);
            if (item is null) return Results.NotFound();

            if (req.Url is not null)
            {
                var sku = CexItemsService.ExtractSku(req.Url);
                if (sku is null) return Results.Problem("That doesn't look like a CeX product link.", statusCode: 400);
                if (sku != item.Sku)
                {
                    if (await db.CexItems.AnyAsync(i => i.Sku == sku && i.Id != id, ct))
                        return Results.Problem("Another card already tracks that product.", statusCode: 409);
                    item.Sku = sku;
                    item.Url = CexItemsService.CanonicalUrl(sku);
                    if (!await service.RefreshAsync(item, ct))
                        return Results.Problem($"CeX doesn't know product {sku} (or isn't responding).", statusCode: 422);
                }
            }
            if (req.Notes is not null && req.Notes.Length > 1000) return Results.Problem("Notes are too long.", statusCode: 400);
            item.Notes = string.IsNullOrWhiteSpace(req.Notes) ? null : req.Notes.Trim();
            await db.SaveChangesAsync(ct);
            return Results.Ok(CexItemDto.From(item));
        });

        write.MapPost("/{id:int}/refresh", async (int id, MoviesDbContext db, CexItemsService service, CancellationToken ct) =>
        {
            var item = await db.CexItems.FindAsync([id], ct);
            if (item is null) return Results.NotFound();
            return await service.RefreshAsync(item, ct)
                ? Results.Ok(CexItemDto.From(item))
                : Results.Problem("CeX isn't responding, try again later.", statusCode: 502);
        });

        write.MapDelete("/{id:int}", async (int id, MoviesDbContext db) =>
            await db.CexItems.Where(i => i.Id == id).ExecuteDeleteAsync() == 0 ? Results.NotFound() : Results.NoContent());
    }
}
