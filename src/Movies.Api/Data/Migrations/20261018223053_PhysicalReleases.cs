using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Movies.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class PhysicalReleases : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "PhysicalReleases",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Name = table.Column<string>(type: "TEXT", maxLength: 300, nullable: false),
                    Format = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    Edition = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    PricePaid = table.Column<decimal>(type: "TEXT", precision: 10, scale: 2, nullable: true),
                    Notes = table.Column<string>(type: "TEXT", maxLength: 2000, nullable: true),
                    CexUrl = table.Column<string>(type: "TEXT", maxLength: 500, nullable: true),
                    CexSku = table.Column<string>(type: "TEXT", maxLength: 40, nullable: true),
                    CexBoxName = table.Column<string>(type: "TEXT", maxLength: 300, nullable: true),
                    ImageUrl = table.Column<string>(type: "TEXT", maxLength: 500, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PhysicalReleases", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "TitleReleases",
                columns: table => new
                {
                    TitleId = table.Column<int>(type: "INTEGER", nullable: false),
                    ReleaseId = table.Column<int>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TitleReleases", x => new { x.TitleId, x.ReleaseId });
                    table.ForeignKey(
                        name: "FK_TitleReleases_PhysicalReleases_ReleaseId",
                        column: x => x.ReleaseId,
                        principalTable: "PhysicalReleases",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_TitleReleases_Titles_TitleId",
                        column: x => x.TitleId,
                        principalTable: "Titles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PhysicalReleases_CexSku",
                table: "PhysicalReleases",
                column: "CexSku");

            migrationBuilder.CreateIndex(
                name: "IX_TitleReleases_ReleaseId",
                table: "TitleReleases",
                column: "ReleaseId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "TitleReleases");

            migrationBuilder.DropTable(
                name: "PhysicalReleases");
        }
    }
}
