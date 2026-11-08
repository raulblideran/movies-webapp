using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Movies.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class ReleaseSales : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateOnly>(
                name: "BoughtOn",
                table: "PhysicalReleases",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Payout",
                table: "PhysicalReleases",
                type: "TEXT",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "SoldFor",
                table: "PhysicalReleases",
                type: "TEXT",
                precision: 10,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "SoldOn",
                table: "PhysicalReleases",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SoldVia",
                table: "PhysicalReleases",
                type: "TEXT",
                maxLength: 20,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "BoughtOn",
                table: "PhysicalReleases");

            migrationBuilder.DropColumn(
                name: "Payout",
                table: "PhysicalReleases");

            migrationBuilder.DropColumn(
                name: "SoldFor",
                table: "PhysicalReleases");

            migrationBuilder.DropColumn(
                name: "SoldOn",
                table: "PhysicalReleases");

            migrationBuilder.DropColumn(
                name: "SoldVia",
                table: "PhysicalReleases");
        }
    }
}
