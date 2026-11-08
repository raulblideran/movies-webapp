using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Movies.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class UkReleaseDate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateOnly>(
                name: "UkReleaseDate",
                table: "Titles",
                type: "TEXT",
                nullable: true);

            // watchlist films are looked up again on TMDB's next pass (shortly after startup), for their UK date
            migrationBuilder.Sql("UPDATE Titles SET TmdbSyncedAt = NULL WHERE List = 'Watchlist' AND TmdbMediaType = 'movie';");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "UkReleaseDate",
                table: "Titles");
        }
    }
}
