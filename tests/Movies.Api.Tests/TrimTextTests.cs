using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Movies.Api.Data;

namespace Movies.Api.Tests;

/// <summary>Text is trimmed when it's saved, whichever code path saves it (MoviesDbContext.TrimText).</summary>
public class TrimTextTests : IClassFixture<TestApp>
{
    private readonly TestApp _app;
    public TrimTextTests(TestApp app) => _app = app;

    [Fact]
    public async Task Text_is_trimmed_and_blank_optional_text_becomes_null_on_insert_and_update()
    {
        int titleId, releaseId, itemId;
        using (var scope = _app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<MoviesDbContext>();
            var title = new Title { Name = "  Padded Film \t", Comments = "  nice one \n", Genres = [" Drama ", "  ", "Comedy"], TmdbMediaType = " " };
            var release = new PhysicalRelease { Name = " Padded Box ", Notes = "   ", CexBoxName = " Box Name " };
            var item = new CexItem { Sku = " 5012345678900 ", Url = " https://uk.webuy.com/product-detail?id=1 ", Notes = "\t" };
            db.AddRange(title, release, item);
            await db.SaveChangesAsync();
            (titleId, releaseId, itemId) = (title.Id, release.Id, item.Id);
        }

        using (var scope = _app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<MoviesDbContext>();
            var title = await db.Titles.AsNoTracking().SingleAsync(t => t.Id == titleId);
            Assert.Equal("Padded Film", title.Name);
            Assert.Equal("nice one", title.Comments);
            Assert.Equal(new[] { "Drama", "Comedy" }, title.Genres);
            Assert.Null(title.TmdbMediaType);

            var release = await db.Releases.AsNoTracking().SingleAsync(r => r.Id == releaseId);
            Assert.Equal("Padded Box", release.Name);
            Assert.Null(release.Notes);
            Assert.Equal("Box Name", release.CexBoxName);

            var item = await db.CexItems.AsNoTracking().SingleAsync(i => i.Id == itemId);
            Assert.Equal("5012345678900", item.Sku);
            Assert.Equal("https://uk.webuy.com/product-detail?id=1", item.Url);
            Assert.Null(item.Notes);
        }

        // an update is trimmed too (the synchronous SaveChanges path as well)
        using (var scope = _app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<MoviesDbContext>();
            var title = await db.Titles.SingleAsync(t => t.Id == titleId);
            title.Comments = "  edited  ";
            db.SaveChanges();
        }
        using (var scope = _app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<MoviesDbContext>();
            Assert.Equal("edited", (await db.Titles.AsNoTracking().SingleAsync(t => t.Id == titleId)).Comments);
        }
    }
}
