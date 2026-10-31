using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Movies.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class Watchlist : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "List",
                table: "Titles",
                type: "TEXT",
                maxLength: 20,
                nullable: false,
                defaultValue: "Watched"); // every existing title is on the Watchlog

            migrationBuilder.AddColumn<DateOnly>(
                name: "WatchlistAddedOn",
                table: "Titles",
                type: "TEXT",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Titles_List",
                table: "Titles",
                column: "List");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Titles_List",
                table: "Titles");

            migrationBuilder.DropColumn(
                name: "List",
                table: "Titles");

            migrationBuilder.DropColumn(
                name: "WatchlistAddedOn",
                table: "Titles");
        }
    }
}
