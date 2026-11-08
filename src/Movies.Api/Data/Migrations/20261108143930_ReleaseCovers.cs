using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Movies.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class ReleaseCovers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "CoverUpdatedAt",
                table: "PhysicalReleases",
                type: "TEXT",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ReleaseCovers",
                columns: table => new
                {
                    ReleaseId = table.Column<int>(type: "INTEGER", nullable: false),
                    ContentType = table.Column<string>(type: "TEXT", maxLength: 40, nullable: false),
                    Data = table.Column<byte[]>(type: "BLOB", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReleaseCovers", x => x.ReleaseId);
                    table.ForeignKey(
                        name: "FK_ReleaseCovers_PhysicalReleases_ReleaseId",
                        column: x => x.ReleaseId,
                        principalTable: "PhysicalReleases",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ReleaseCovers");

            migrationBuilder.DropColumn(
                name: "CoverUpdatedAt",
                table: "PhysicalReleases");
        }
    }
}
