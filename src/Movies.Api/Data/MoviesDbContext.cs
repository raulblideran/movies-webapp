using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace Movies.Api.Data;

public class MoviesDbContext(DbContextOptions<MoviesDbContext> options)
    : IdentityDbContext<AppUser>(options)
{
    public DbSet<Title> Titles => Set<Title>();
    public DbSet<CexItem> CexItems => Set<CexItem>();
    public DbSet<CexPriceSnapshot> CexPriceSnapshots => Set<CexPriceSnapshot>();
    public DbSet<PhysicalRelease> Releases => Set<PhysicalRelease>();
    public DbSet<TitleRelease> TitleReleases => Set<TitleRelease>();
    public DbSet<Watch> Watches => Set<Watch>();
    public DbSet<YearGoal> YearGoals => Set<YearGoal>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        builder.Entity<AppUser>(e =>
        {
            e.Property(u => u.Address).HasMaxLength(500);
            e.Property(u => u.Postcode).HasMaxLength(10);
        });

        builder.Entity<Title>(e =>
        {
            e.Property(t => t.Name).HasMaxLength(300);
            e.Property(t => t.Type).HasConversion<string>().HasMaxLength(20);
            e.Property(t => t.List).HasConversion<string>().HasMaxLength(20);
            e.Property(t => t.Rating).HasPrecision(4, 1);
            e.Property(t => t.Comments).HasMaxLength(4000);
            e.Property(t => t.TmdbMediaType).HasMaxLength(10);
            e.Property(t => t.PosterPath).HasMaxLength(200);
            e.Property(t => t.Overview).HasMaxLength(4000);
            e.Property(t => t.TrailerKey).HasMaxLength(40);
            e.Property(t => t.CollectionName).HasMaxLength(300);
            // credits are only ever read with their title, so they live in it as JSON
            e.Property(t => t.Credits)
                .HasConversion(
                    v => System.Text.Json.JsonSerializer.Serialize(v, (System.Text.Json.JsonSerializerOptions?)null),
                    s => System.Text.Json.JsonSerializer.Deserialize<List<Credit>>(s, (System.Text.Json.JsonSerializerOptions?)null) ?? new List<Credit>(),
                    new Microsoft.EntityFrameworkCore.ChangeTracking.ValueComparer<List<Credit>>(
                        (a, b) => a!.SequenceEqual(b!),
                        v => v.Aggregate(0, (h, c) => HashCode.Combine(h, c.GetHashCode())),
                        v => v.ToList()));
            e.Property(t => t.VoteAverage).HasPrecision(3, 1);
            e.Property(t => t.OriginalLanguage).HasMaxLength(10);
            e.HasIndex(t => t.Name);
            e.HasIndex(t => t.List);
        });

        builder.Entity<Watch>(e =>
        {
            e.Property(w => w.Notes).HasMaxLength(2000);
            e.HasOne(w => w.Title).WithMany(t => t.Watches).HasForeignKey(w => w.TitleId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(w => new { w.TitleId, w.Date });
        });

        builder.Entity<YearGoal>(e =>
        {
            e.HasKey(g => g.Year);
            e.Property(g => g.Year).ValueGeneratedNever();
        });

        builder.Entity<CexItem>(e =>
        {
            e.Property(c => c.Sku).HasMaxLength(40);
            e.Property(c => c.Url).HasMaxLength(500);
            e.Property(c => c.Title).HasMaxLength(300);
            e.Property(c => c.Category).HasMaxLength(100);
            e.Property(c => c.ImageUrl).HasMaxLength(500);
            e.Property(c => c.Notes).HasMaxLength(1000);
            e.Property(c => c.SellPrice).HasPrecision(10, 2);
            e.Property(c => c.CashPrice).HasPrecision(10, 2);
            e.Property(c => c.ExchangePrice).HasPrecision(10, 2);
            e.HasIndex(c => c.Sku).IsUnique();
        });

        builder.Entity<CexPriceSnapshot>(e =>
        {
            e.Property(s => s.Sku).HasMaxLength(40);
            e.Property(s => s.BoxName).HasMaxLength(300);
            e.Property(s => s.Category).HasMaxLength(100);
            e.Property(s => s.SellPrice).HasPrecision(10, 2);
            e.Property(s => s.CashPrice).HasPrecision(10, 2);
            e.Property(s => s.ExchangePrice).HasPrecision(10, 2);
            e.HasIndex(s => new { s.Sku, s.Date }).IsUnique();
        });

        builder.Entity<PhysicalRelease>(e =>
        {
            e.ToTable("PhysicalReleases");
            e.Property(r => r.Name).HasMaxLength(300);
            e.Property(r => r.Format).HasConversion<string>().HasMaxLength(20);
            e.Property(r => r.Edition).HasConversion<string>().HasMaxLength(20);
            e.Property(r => r.PurchasedFrom).HasConversion<string>().HasMaxLength(20);
            e.Property(r => r.PricePaid).HasPrecision(10, 2);
            e.Property(r => r.Notes).HasMaxLength(2000);
            e.Property(r => r.CexUrl).HasMaxLength(500);
            e.Property(r => r.CexSku).HasMaxLength(40);
            e.Property(r => r.CexBoxName).HasMaxLength(300);
            e.Property(r => r.ImageUrl).HasMaxLength(500);
            e.HasIndex(r => r.CexSku);
        });

        builder.Entity<TitleRelease>(e =>
        {
            e.HasKey(l => new { l.TitleId, l.ReleaseId });
            e.HasOne(l => l.Title).WithMany(t => t.ReleaseLinks).HasForeignKey(l => l.TitleId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(l => l.Release).WithMany(r => r.TitleLinks).HasForeignKey(l => l.ReleaseId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(l => l.ReleaseId);
        });
    }

    // Both overloads: SaveChanges() and SaveChangesAsync(ct) end up here, so every save path is covered.
    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        BeforeSave();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        BeforeSave();
        return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }

    private void BeforeSave()
    {
        TrimText();
        var now = DateTime.UtcNow;
        foreach (var entry in ChangeTracker.Entries<ITimestamped>())
        {
            var entity = entry.Entity;
            if (entry.State == EntityState.Added)
            {
                entity.CreatedAt = now;
                entity.UpdatedAt = now;
            }
            else if (entry.State == EntityState.Modified)
            {
                entity.UpdatedAt = now;
            }
        }
    }

    /// <summary>
    /// Trims every text field of the app's own records before they're written, whichever endpoint,
    /// import or background job wrote them. Optional fields left blank become null; lists of text
    /// (genres) lose blank entries. Identity's tables (users, roles, keys) are left alone.
    /// </summary>
    private void TrimText()
    {
        foreach (var entry in ChangeTracker.Entries())
        {
            if (entry.State is not (EntityState.Added or EntityState.Modified)) continue;
            if (entry.Metadata.ClrType.Namespace != typeof(Title).Namespace) continue;
            // keys are left alone: EF won't let a tracked record's key change
            foreach (var prop in entry.Properties.Where(p => !p.Metadata.IsPrimaryKey()))
            {
                switch (prop.CurrentValue)
                {
                    case string text:
                        var trimmed = text.Trim();
                        var value = trimmed.Length == 0 && prop.Metadata.IsNullable ? null : trimmed;
                        if (!Equals(value, text)) prop.CurrentValue = value;
                        break;
                    case List<string> list when list.Any(x => x.Length == 0 || x.Trim().Length != x.Length):
                        prop.CurrentValue = list.Select(x => x.Trim()).Where(x => x.Length > 0).ToList();
                        break;
                }
            }
        }
    }
}
