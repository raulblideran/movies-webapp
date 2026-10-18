using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace Movies.Api.Data;

public class MoviesDbContext(DbContextOptions<MoviesDbContext> options)
    : IdentityDbContext<IdentityUser>(options)
{
    public DbSet<Title> Titles => Set<Title>();
    public DbSet<CexItem> CexItems => Set<CexItem>();
    public DbSet<CexPriceSnapshot> CexPriceSnapshots => Set<CexPriceSnapshot>();
    public DbSet<PhysicalRelease> Releases => Set<PhysicalRelease>();
    public DbSet<TitleRelease> TitleReleases => Set<TitleRelease>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        builder.Entity<Title>(e =>
        {
            e.Property(t => t.Name).HasMaxLength(300);
            e.Property(t => t.Type).HasConversion<string>().HasMaxLength(20);
            e.Property(t => t.Rating).HasPrecision(4, 1);
            e.Property(t => t.Comments).HasMaxLength(4000);
            e.Property(t => t.TmdbMediaType).HasMaxLength(10);
            e.Property(t => t.PosterPath).HasMaxLength(200);
            e.HasIndex(t => t.Name);
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

    public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
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
        return base.SaveChangesAsync(cancellationToken);
    }
}
