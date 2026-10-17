using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace Movies.Api.Data;

public class MoviesDbContext(DbContextOptions<MoviesDbContext> options)
    : IdentityDbContext<IdentityUser>(options)
{
    public DbSet<Title> Titles => Set<Title>();
    public DbSet<CexItem> CexItems => Set<CexItem>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        builder.Entity<Title>(e =>
        {
            e.Property(t => t.Name).HasMaxLength(300);
            e.Property(t => t.Type).HasConversion<string>().HasMaxLength(20);
            e.Property(t => t.Rating).HasPrecision(4, 1);
            e.Property(t => t.PricePaid).HasPrecision(10, 2);
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
