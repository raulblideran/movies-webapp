using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Movies.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class PurchasePlace : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "PurchasedFrom",
                table: "PhysicalReleases",
                type: "TEXT",
                maxLength: 20,
                nullable: false,
                defaultValue: "Other");

            // Until now a CeX link meant "bought at CeX"; everything else is Other until sorted by hand.
            migrationBuilder.Sql("UPDATE PhysicalReleases SET PurchasedFrom = 'Cex' WHERE CexSku IS NOT NULL;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "PurchasedFrom",
                table: "PhysicalReleases");
        }
    }
}
