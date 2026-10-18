using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Movies.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class CexPriceHistory : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CexPriceSnapshots",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Sku = table.Column<string>(type: "TEXT", maxLength: 40, nullable: false),
                    Date = table.Column<DateOnly>(type: "TEXT", nullable: false),
                    BoxName = table.Column<string>(type: "TEXT", maxLength: 300, nullable: true),
                    Category = table.Column<string>(type: "TEXT", maxLength: 100, nullable: true),
                    SellPrice = table.Column<decimal>(type: "TEXT", precision: 10, scale: 2, nullable: false),
                    CashPrice = table.Column<decimal>(type: "TEXT", precision: 10, scale: 2, nullable: false),
                    ExchangePrice = table.Column<decimal>(type: "TEXT", precision: 10, scale: 2, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CexPriceSnapshots", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CexPriceSnapshots_Sku_Date",
                table: "CexPriceSnapshots",
                columns: new[] { "Sku", "Date" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CexPriceSnapshots");
        }
    }
}
