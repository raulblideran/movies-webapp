using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Movies.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class Watches : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Countries",
                table: "Titles",
                type: "TEXT",
                nullable: false,
                defaultValue: "[]");

            migrationBuilder.AddColumn<string>(
                name: "OriginalLanguage",
                table: "Titles",
                type: "TEXT",
                maxLength: 10,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Tags",
                table: "Titles",
                type: "TEXT",
                nullable: false,
                defaultValue: "[]");

            migrationBuilder.AddColumn<decimal>(
                name: "VoteAverage",
                table: "Titles",
                type: "TEXT",
                precision: 3,
                scale: 1,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "VoteCount",
                table: "Titles",
                type: "INTEGER",
                nullable: true);


            migrationBuilder.CreateTable(
                name: "Watches",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    TitleId = table.Column<int>(type: "INTEGER", nullable: false),
                    Date = table.Column<DateOnly>(type: "TEXT", nullable: true),
                    WithBogdan = table.Column<bool>(type: "INTEGER", nullable: false),
                    InCinema = table.Column<bool>(type: "INTEGER", nullable: false),
                    Notes = table.Column<string>(type: "TEXT", maxLength: 2000, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Watches", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Watches_Titles_TitleId",
                        column: x => x.TitleId,
                        principalTable: "Titles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "YearGoals",
                columns: table => new
                {
                    Year = table.Column<int>(type: "INTEGER", nullable: false),
                    Target = table.Column<int>(type: "INTEGER", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_YearGoals", x => x.Year);
                });

            // fetch every title's TMDB details again (in the background), for its score, language and countries
            migrationBuilder.Sql("UPDATE Titles SET TmdbSyncedAt = NULL WHERE TmdbId IS NOT NULL;");

            migrationBuilder.CreateIndex(
                name: "IX_Watches_TitleId_Date",
                table: "Watches",
                columns: new[] { "TitleId", "Date" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Watches");

            migrationBuilder.DropTable(
                name: "YearGoals");

            migrationBuilder.DropColumn(
                name: "Countries",
                table: "Titles");

            migrationBuilder.DropColumn(
                name: "OriginalLanguage",
                table: "Titles");

            migrationBuilder.DropColumn(
                name: "Tags",
                table: "Titles");

            migrationBuilder.DropColumn(
                name: "VoteAverage",
                table: "Titles");

            migrationBuilder.DropColumn(
                name: "VoteCount",
                table: "Titles");
        }
    }
}
