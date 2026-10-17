using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace Movies.Api.Data;

public class MoviesDbContext(DbContextOptions<MoviesDbContext> options)
    : IdentityDbContext<IdentityUser>(options)
{
    public DbSet<Title> Titles => Set<Title>();

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
    }

    public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        var now = DateTime.UtcNow;
        foreach (var entry in ChangeTracker.Entries<Title>())
        {
            if (entry.State == EntityState.Added)
            {
                entry.Entity.CreatedAt = now;
                entry.Entity.UpdatedAt = now;
            }
            else if (entry.State == EntityState.Modified)
            {
                entry.Entity.UpdatedAt = now;
            }
        }
        return base.SaveChangesAsync(cancellationToken);
    }
}
