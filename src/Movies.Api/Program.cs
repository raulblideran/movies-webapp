using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Movies.Api;
using Movies.Api.Auth;
using Movies.Api.Data;
using Movies.Api.Endpoints;
using Movies.Api.Services;

var builder = WebApplication.CreateBuilder(args);
var config = builder.Configuration;

builder.Services.AddDbContext<MoviesDbContext>(o =>
    o.UseSqlite(config.GetConnectionString("Movies") ?? "Data Source=movies.db"));

// Keys that protect auth cookies and MFA tokens. Must survive restarts, so keep them next to the DB.
var keysPath = config["DataProtection:KeysPath"] ?? Path.Combine(builder.Environment.ContentRootPath, "keys");
builder.Services.AddDataProtection()
    .SetApplicationName("movies-webapp")
    .PersistKeysToFileSystem(new DirectoryInfo(keysPath));

// ---- Identity: users, roles, lockout, TOTP MFA ----
builder.Services.Configure<AuthOptions>(config.GetSection("Auth"));
var requireMfa = config.GetValue("Auth:RequireMfa", true);

builder.Services
    .AddIdentity<IdentityUser, IdentityRole>(o =>
    {
        o.Password.RequiredLength = 12;
        o.Password.RequireNonAlphanumeric = false;
        o.Password.RequireUppercase = false;
        o.Password.RequireLowercase = false;
        o.Password.RequireDigit = false;
        o.Lockout.MaxFailedAccessAttempts = 5;
        o.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
        o.Lockout.AllowedForNewUsers = true;
        o.User.RequireUniqueEmail = false;
        o.SignIn.RequireConfirmedAccount = false;
    })
    .AddEntityFrameworkStores<MoviesDbContext>()
    .AddDefaultTokenProviders()
    .AddClaimsPrincipalFactory<AppClaimsPrincipalFactory>();

// Re-validate cookies against the DB every minute so locks/role changes/resets apply quickly.
builder.Services.Configure<SecurityStampValidatorOptions>(o => o.ValidationInterval = TimeSpan.FromMinutes(1));

void HardenCookie(CookieAuthenticationOptions o)
{
    o.Cookie.HttpOnly = true;
    o.Cookie.SameSite = SameSiteMode.Strict;
    o.Cookie.SecurePolicy = builder.Environment.IsDevelopment()
        ? CookieSecurePolicy.SameAsRequest
        : CookieSecurePolicy.Always;
}

builder.Services.ConfigureApplicationCookie(o =>
{
    HardenCookie(o);
    o.Cookie.Name = "movies.auth";
    o.ExpireTimeSpan = TimeSpan.FromDays(14);
    o.SlidingExpiration = true;
    // This is an API: answer with status codes instead of redirecting to a login page.
    o.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = 401; return Task.CompletedTask; };
    o.Events.OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = 403; return Task.CompletedTask; };
});
builder.Services.Configure<CookieAuthenticationOptions>(IdentityConstants.TwoFactorUserIdScheme, o =>
{
    HardenCookie(o);
    o.Cookie.Name = "movies.2fa";
});
builder.Services.Configure<CookieAuthenticationOptions>(IdentityConstants.TwoFactorRememberMeScheme, o =>
{
    HardenCookie(o);
    o.Cookie.Name = "movies.2fa.remember";
    o.ExpireTimeSpan = TimeSpan.FromDays(30);
});

builder.Services.AddAuthorizationBuilder()
    .AddPolicy(Policies.SignedIn, p => p.RequireAuthenticatedUser())
    .AddPolicy(Policies.Editor, p =>
    {
        p.RequireAuthenticatedUser().RequireRole(Roles.Admin, Roles.Editor);
        if (requireMfa) p.RequireClaim(AppClaims.MfaEnrolled, "true");
    })
    .AddPolicy(Policies.Admin, p =>
    {
        p.RequireAuthenticatedUser().RequireRole(Roles.Admin);
        if (requireMfa) p.RequireClaim(AppClaims.MfaEnrolled, "true");
    });

// ---- rate limiting ----
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    static string Ip(HttpContext ctx) => ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown";
    o.AddPolicy("login", ctx => RateLimitPartition.GetFixedWindowLimiter(Ip(ctx),
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1) }));
    o.AddPolicy("cex", ctx => RateLimitPartition.GetFixedWindowLimiter(Ip(ctx),
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 300, Window = TimeSpan.FromMinutes(1) }));
});

// ---- external services ----
builder.Services.AddMemoryCache();
builder.Services.Configure<TmdbOptions>(config.GetSection("Tmdb"));
builder.Services.AddHttpClient<TmdbClient>(c =>
{
    c.BaseAddress = new Uri("https://api.themoviedb.org/");
    c.Timeout = TimeSpan.FromSeconds(10);
});
builder.Services.AddHttpClient<CexClient>(c =>
{
    c.BaseAddress = new Uri("https://wss2.cex.uk.webuy.io/");
    c.Timeout = TimeSpan.FromSeconds(10);
    c.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (compatible; movies-webapp)");
});

builder.Services.ConfigureHttpJsonOptions(o =>
    o.SerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter()));

var app = builder.Build();

await Startup.MigrateAndSeedAsync(app.Services);

// CLI commands (import, create-user) run against the same DB and exit.
if (args.Length > 0 && Cli.IsCommand(args[0]))
    return await Cli.RunAsync(app.Services, args);

// Behind the Cloudflare Tunnel every request arrives from cloudflared, so take the visitor's IP
// (used by the login rate limiter) and scheme from Cloudflare's headers. Only enable this when
// the app's port is reachable solely through the tunnel.
if (config.GetValue("Proxy:TrustCloudflare", false))
{
    app.Use((ctx, next) =>
    {
        if (ctx.Request.Headers.TryGetValue("CF-Connecting-IP", out var ip)
            && System.Net.IPAddress.TryParse(ip, out var address))
            ctx.Connection.RemoteIpAddress = address;
        if (ctx.Request.Headers["X-Forwarded-Proto"] == "https")
            ctx.Request.Scheme = "https";
        return next();
    });
}

app.UseDefaultFiles();
app.UseStaticFiles();
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();

app.MapGet("/healthz", () => Results.Ok("ok"));
app.MapTitlesEndpoints();
app.MapExternalEndpoints();
app.MapAuthEndpoints();
app.MapUsersEndpoints();

await app.RunAsync();
return 0;

public partial class Program;
