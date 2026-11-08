using Microsoft.EntityFrameworkCore;
using Movies.Api.Auth;
using Movies.Api.Contracts;
using Movies.Api.Data;
using Movies.Api.Services;

namespace Movies.Api.Endpoints;

/// <summary>Physical releases: public read, Editor write.</summary>
public static class ReleasesEndpoints
{
    public static void MapReleasesEndpoints(this IEndpointRouteBuilder app)
    {
        var releases = app.MapGroup("/api/releases");

        releases.MapGet("/", async (MoviesDbContext db) =>
            (await db.Releases.AsNoTracking().Include(r => r.TitleLinks).OrderBy(r => r.Name).ToListAsync())
                .Select(ReleaseDto.From));

        releases.MapGet("/{id:int}", async (int id, MoviesDbContext db) =>
            await db.Releases.AsNoTracking().Include(r => r.TitleLinks).FirstOrDefaultAsync(r => r.Id == id) is { } r
                ? Results.Ok(ReleaseDto.From(r))
                : Results.NotFound());

        var write = releases.MapGroup("").RequireAuthorization(Policies.Editor);

        write.MapPost("/", async (ReleaseUpsertRequest req, MoviesDbContext db, CexClient cex, CancellationToken ct) =>
        {
            var r = new PhysicalRelease { Name = "" };
            if (await ApplyAsync(req, r, db, cex, ct) is { } problem) return problem;
            db.Releases.Add(r);
            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/releases/{r.Id}", ReleaseDto.From(r));
        });

        write.MapPut("/{id:int}", async (int id, ReleaseUpsertRequest req, MoviesDbContext db, CexClient cex, CancellationToken ct) =>
        {
            var r = await db.Releases.Include(x => x.TitleLinks).FirstOrDefaultAsync(x => x.Id == id, ct);
            if (r is null) return Results.NotFound();
            if (await ApplyAsync(req, r, db, cex, ct) is { } problem) return problem;
            await db.SaveChangesAsync(ct);
            return Results.Ok(ReleaseDto.From(r));
        });

        write.MapDelete("/{id:int}", async (int id, MoviesDbContext db) =>
        {
            var deleted = await db.Releases.Where(r => r.Id == id).ExecuteDeleteAsync();
            return deleted == 0 ? Results.NotFound() : Results.NoContent();
        });

        // ---------- your own cover (ReleaseCover), shown instead of CeX's picture ----------

        // Anyone can see it. Its link carries a version (ReleaseDto.CoverUrl), so it can be cached for good.
        releases.MapGet("/{id:int}/cover", async (int id, MoviesDbContext db, HttpContext ctx) =>
        {
            var c = await db.ReleaseCovers.AsNoTracking().FirstOrDefaultAsync(x => x.ReleaseId == id);
            if (c is null) return Results.NotFound();
            ctx.Response.Headers.CacheControl = "public, max-age=31536000, immutable";
            return Results.File(c.Data, c.ContentType);
        });

        // The body is the picture itself: the release editor shrinks it to a JPEG first.
        write.MapPut("/{id:int}/cover", async (int id, HttpRequest request, MoviesDbContext db, CancellationToken ct) =>
        {
            var r = await db.Releases.Include(x => x.TitleLinks).FirstOrDefaultAsync(x => x.Id == id, ct);
            if (r is null) return Results.NotFound();
            var data = await ReadUpToAsync(request.Body, MaxCoverBytes, ct);
            if (data is null) return CoverProblem("That picture is too big (over 3 MB).");
            if (ReleaseCover.Sniff(data) is not { } type) return CoverProblem("That isn't a JPEG, PNG or WebP picture.");

            var now = DateTime.UtcNow;
            var cover = await db.ReleaseCovers.FirstOrDefaultAsync(c => c.ReleaseId == id, ct);
            if (cover is null) db.ReleaseCovers.Add(new ReleaseCover { ReleaseId = id, ContentType = type, Data = data, UpdatedAt = now });
            else (cover.ContentType, cover.Data, cover.UpdatedAt) = (type, data, now);
            r.CoverUpdatedAt = now;
            await db.SaveChangesAsync(ct);
            return Results.Ok(ReleaseDto.From(r));
        });

        // Back to CeX's picture (or the titles' posters).
        write.MapDelete("/{id:int}/cover", async (int id, MoviesDbContext db, CancellationToken ct) =>
        {
            var r = await db.Releases.Include(x => x.TitleLinks).FirstOrDefaultAsync(x => x.Id == id, ct);
            if (r is null) return Results.NotFound();
            await db.ReleaseCovers.Where(c => c.ReleaseId == id).ExecuteDeleteAsync(ct);
            r.CoverUpdatedAt = null;
            await db.SaveChangesAsync(ct);
            return Results.Ok(ReleaseDto.From(r));
        });

        // A picture from a link pasted in the editor. The browser can't read another site's pictures, so the server
        // fetches it (public internet only: CoverFetcher) and the editor shows and shrinks it before saving it.
        write.MapGet("/cover-from", async (string? url, CoverFetcher fetcher, HttpContext ctx, CancellationToken ct) =>
        {
            var got = await fetcher.FetchAsync(url, ct);
            if (got.Data is null) return CoverProblem(got.Error!);
            ctx.Response.Headers.CacheControl = "no-store";
            return Results.File(got.Data, got.ContentType);
        });
    }

    private const int MaxCoverBytes = 3 * 1024 * 1024;

    private static IResult CoverProblem(string message) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { ["Cover"] = [message] });

    /// <summary>The whole body, or null once it's over max bytes.</summary>
    private static async Task<byte[]?> ReadUpToAsync(Stream body, int max, CancellationToken ct)
    {
        using var buffer = new MemoryStream();
        var chunk = new byte[81920];
        int read;
        while ((read = await body.ReadAsync(chunk, ct)) > 0)
        {
            if (buffer.Length + read > max) return null;
            buffer.Write(chunk, 0, read);
        }
        return buffer.ToArray();
    }

    /// <summary>Validates and copies the request onto the release. Returns a problem result, or null when it applied.</summary>
    private static async Task<IResult?> ApplyAsync(ReleaseUpsertRequest req, PhysicalRelease r, MoviesDbContext db, CexClient cex, CancellationToken ct)
    {
        var errors = req.Validate();
        var titleIds = (req.TitleIds ?? []).Distinct().ToList();
        if (titleIds.Count > 0)
        {
            var known = await db.Titles.Where(t => titleIds.Contains(t.Id)).Select(t => t.Id).ToListAsync(ct);
            if (known.Count != titleIds.Count) errors["TitleIds"] = ["Some of those titles don't exist."];
        }
        if (errors.Count > 0) return Results.ValidationProblem(errors);

        var sku = string.IsNullOrWhiteSpace(req.CexUrl) ? null : CexItemsService.ExtractSku(req.CexUrl);
        CexDetails? linked = null;
        if (sku != r.CexSku)
        {
            r.CexSku = sku;
            r.CexUrl = sku is null ? null : CexItemsService.CanonicalUrl(sku);
            r.CexBoxName = null;
            r.ImageUrl = null;
            // Best effort: the name and picture come from CeX; the daily price snapshot fills them in otherwise.
            // Fresh rather than cached, as it also becomes today's price below.
            if (sku is not null && await cex.GetAsync(sku, bypassCache: true, ct) is { } d)
            {
                linked = d;
                r.CexBoxName = d.BoxName;
                r.ImageUrl = d.ImageUrl;
            }
        }

        r.Name = string.IsNullOrWhiteSpace(req.Name) ? r.CexBoxName ?? sku ?? "Untitled release" : req.Name.Trim();
        r.Format = req.Format;
        r.Edition = req.Edition;
        r.PricePaid = req.PricePaid;
        r.PurchasedFrom = req.PurchasedFrom;
        r.Notes = string.IsNullOrWhiteSpace(req.Notes) ? null : req.Notes.Trim();
        r.BoughtOn = req.BoughtOn;

        // Unticking "Traded in or sold" (no channel) clears the rest; cash or voucher is only a CeX thing.
        r.SoldVia = req.SoldVia;
        r.SoldOn = r.IsSold ? req.SoldOn : null;
        r.SoldFor = r.IsSold ? req.SoldFor : null;
        r.Payout = r.SoldVia == SaleChannel.Cex ? req.Payout : null;

        // A newly linked release on the shelf gets today's CeX price now, so the stats count it straight away
        // instead of after the next hourly snapshot run.
        if (linked is not null && !r.IsSold
            && !await db.CexPriceSnapshots.AnyAsync(s => s.Sku == linked.Sku && s.Date == CexHistoryService.Today, ct))
            db.CexPriceSnapshots.Add(CexHistoryService.SnapshotOf(linked, CexHistoryService.Today));

        r.TitleLinks.RemoveAll(l => !titleIds.Contains(l.TitleId));
        foreach (var id in titleIds.Where(id => r.TitleLinks.All(l => l.TitleId != id)))
            r.TitleLinks.Add(new TitleRelease { TitleId = id });
        return null;
    }
}
