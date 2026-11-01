using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Movies.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class ReleaseDate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateOnly>(
                name: "ReleaseDate",
                table: "Titles",
                type: "TEXT",
                nullable: true);

            // The date comes from TMDB: marking every synced title as stale has the background pass
            // (TmdbMetadataRefreshService) fetch them all again soon after startup. Not null, so they keep
            // counting as synced (the Stats page's people) until then.
            migrationBuilder.Sql("UPDATE Titles SET TmdbSyncedAt = '2000-01-01 00:00:00' WHERE TmdbId IS NOT NULL AND TmdbSyncedAt IS NOT NULL;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ReleaseDate",
                table: "Titles");
        }
    }
}
