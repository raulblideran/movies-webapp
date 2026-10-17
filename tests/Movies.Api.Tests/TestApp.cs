using System.Net.Http.Json;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.DependencyInjection;

namespace Movies.Api.Tests;

/// <summary>The real app on a private in-memory SQLite DB.</summary>
public class TestApp : WebApplicationFactory<Program>
{
    private readonly string _dbName = $"test-{Guid.NewGuid():N}";
    private readonly SqliteConnection _keepAlive;
    private readonly string _keysDir = Path.Combine(Path.GetTempPath(), $"movies-keys-{Guid.NewGuid():N}");

    public TestApp()
    {
        _keepAlive = new SqliteConnection(ConnectionString);
        _keepAlive.Open();
    }

    private string ConnectionString => $"Data Source=file:{_dbName}?mode=memory&cache=shared";

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        builder.UseSetting("ConnectionStrings:Movies", ConnectionString);
        builder.UseSetting("DataProtection:KeysPath", _keysDir);
        builder.UseSetting("Tmdb:ApiKey", "");
        builder.UseSetting("Auth:RequireMfa", "true");
    }

    public async Task CreateUserAsync(string userName, string password, string role)
    {
        using var scope = Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<IdentityUser>>();
        var user = new IdentityUser { UserName = userName, LockoutEnabled = true };
        var result = await users.CreateAsync(user, password);
        Assert.True(result.Succeeded, string.Join(", ", result.Errors.Select(e => e.Description)));
        await users.AddToRoleAsync(user, role);
    }

    /// <summary>Signs in and enrols MFA, returning a client whose cookie can edit.</summary>
    public async Task<HttpClient> SignedInWithMfaAsync(string userName, string password)
    {
        var client = CreateClient();
        var login = await client.PostAsJsonAsync("/api/auth/login", new { userName, password });
        login.EnsureSuccessStatusCode();
        var setup = await (await client.PostAsync("/api/account/mfa/setup", null)).Content.ReadFromJsonAsync<SetupDto>();
        var enable = await client.PostAsJsonAsync("/api/account/mfa/enable", new { code = Totp.Code(setup!.SharedKey) });
        enable.EnsureSuccessStatusCode();
        return client;
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        _keepAlive.Dispose();
        try { Directory.Delete(_keysDir, recursive: true); } catch (IOException) { }
    }

    public record SetupDto(string SharedKey, string OtpauthUri);
}

/// <summary>RFC 6238 TOTP, as an authenticator app would compute it.</summary>
public static class Totp
{
    public static string Code(string base32Key, DateTimeOffset? at = null)
    {
        var key = Base32Decode(base32Key.Replace(" ", "").ToUpperInvariant());
        var counter = (at ?? DateTimeOffset.UtcNow).ToUnixTimeSeconds() / 30;
        var msg = BitConverter.GetBytes(counter);
        if (BitConverter.IsLittleEndian) Array.Reverse(msg);
        var hash = HMACSHA1.HashData(key, msg);
        var offset = hash[^1] & 0x0f;
        var bin = ((hash[offset] & 0x7f) << 24) | (hash[offset + 1] << 16) | (hash[offset + 2] << 8) | hash[offset + 3];
        return (bin % 1_000_000).ToString("D6");
    }

    private static byte[] Base32Decode(string s)
    {
        const string alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        var output = new List<byte>();
        int buffer = 0, bits = 0;
        foreach (var c in s.TrimEnd('='))
        {
            buffer = (buffer << 5) | alphabet.IndexOf(c);
            bits += 5;
            if (bits >= 8)
            {
                output.Add((byte)(buffer >> (bits - 8)));
                bits -= 8;
            }
        }
        return [.. output];
    }
}
