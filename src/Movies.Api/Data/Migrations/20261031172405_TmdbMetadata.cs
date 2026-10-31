using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Movies.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class TmdbMetadata : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "CollectionId",
                table: "Titles",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CollectionName",
                table: "Titles",
                type: "TEXT",
                maxLength: 300,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Credits",
                table: "Titles",
                type: "TEXT",
                nullable: false,
                defaultValue: "[]"); // JSON: no credits yet

            migrationBuilder.AddColumn<string>(
                name: "Overview",
                table: "Titles",
                type: "TEXT",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Runtime",
                table: "Titles",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "TmdbSyncedAt",
                table: "Titles",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TrailerKey",
                table: "Titles",
                type: "TEXT",
                maxLength: 40,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CollectionId",
                table: "Titles");

            migrationBuilder.DropColumn(
                name: "CollectionName",
                table: "Titles");

            migrationBuilder.DropColumn(
                name: "Credits",
                table: "Titles");

            migrationBuilder.DropColumn(
                name: "Overview",
                table: "Titles");

            migrationBuilder.DropColumn(
                name: "Runtime",
                table: "Titles");

            migrationBuilder.DropColumn(
                name: "TmdbSyncedAt",
                table: "Titles");

            migrationBuilder.DropColumn(
                name: "TrailerKey",
                table: "Titles");
        }
    }
}
