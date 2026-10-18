using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Movies.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class DropTitleShelfColumns : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CexLinks",
                table: "Titles");

            migrationBuilder.DropColumn(
                name: "PhysicalFormats",
                table: "Titles");

            migrationBuilder.DropColumn(
                name: "PricePaid",
                table: "Titles");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "CexLinks",
                table: "Titles",
                type: "TEXT",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "PhysicalFormats",
                table: "Titles",
                type: "TEXT",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<decimal>(
                name: "PricePaid",
                table: "Titles",
                type: "TEXT",
                precision: 10,
                scale: 2,
                nullable: true);
        }
    }
}
