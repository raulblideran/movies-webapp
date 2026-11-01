using Microsoft.AspNetCore.Authorization;
using System.Security.Claims;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;
using Movies.Api.Auth;
using Movies.Api.Data;
using Movies.Api.Services;

namespace Movies.Api.Endpoints;

public record LoginRequest(string? UserName, string? Password, bool RememberMe = true);
public record MfaLoginRequest(string? Code, string? RecoveryCode, bool RememberDevice = false);
public record ChangePasswordRequest(string? CurrentPassword, string? NewPassword);
public record MfaCodeRequest(string? Code);
public record PasswordRequest(string? Password);
public record AddressRequest(string? Address);

public static class AuthEndpoints
{
    private const string Issuer = "Movies";

    public static void MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var auth = app.MapGroup("/api/auth");

        auth.MapPost("/login", async (LoginRequest req, SignInManager<AppUser> signIn) =>
        {
            if (string.IsNullOrWhiteSpace(req.UserName) || string.IsNullOrEmpty(req.Password))
                return Problem("Username and password are required.", 400);

            var result = await signIn.PasswordSignInAsync(req.UserName.Trim(), req.Password, req.RememberMe, lockoutOnFailure: true);
            if (result.Succeeded) return Results.Ok(new { requiresMfa = false });
            if (result.RequiresTwoFactor) return Results.Ok(new { requiresMfa = true });
            if (result.IsLockedOut) return Problem("Too many failed attempts. The account is locked, try again later.", 423);
            return Problem("Invalid username or password.", 401);
        }).RequireRateLimiting("login");

        auth.MapPost("/login/mfa", async (MfaLoginRequest req, SignInManager<AppUser> signIn) =>
        {
            if (await signIn.GetTwoFactorAuthenticationUserAsync() is null)
                return Problem("Your sign-in session expired, please enter your password again.", 401);

            SignInResult result;
            if (!string.IsNullOrWhiteSpace(req.RecoveryCode))
                result = await signIn.TwoFactorRecoveryCodeSignInAsync(NormalizeCode(req.RecoveryCode));
            else if (!string.IsNullOrWhiteSpace(req.Code))
                result = await signIn.TwoFactorAuthenticatorSignInAsync(NormalizeCode(req.Code), isPersistent: true, req.RememberDevice);
            else
                return Problem("Enter the code from your authenticator app or a recovery code.", 400);

            if (result.Succeeded) return Results.Ok();
            if (result.IsLockedOut) return Problem("Too many failed attempts. The account is locked, try again later.", 423);
            return Problem("Invalid code.", 401);
        }).RequireRateLimiting("login");

        auth.MapPost("/logout", async (SignInManager<AppUser> signIn) =>
        {
            await signIn.SignOutAsync();
            return Results.NoContent();
        });

        auth.MapGet("/me", async (ClaimsPrincipal principal, UserManager<AppUser> users,
            IAuthorizationService authz, IOptions<AuthOptions> authOptions) =>
        {
            if (principal.Identity?.IsAuthenticated != true || await users.GetUserAsync(principal) is not { } user)
                return Results.Ok(new { authenticated = false });

            return Results.Ok(new
            {
                authenticated = true,
                userName = user.UserName,
                roles = await users.GetRolesAsync(user),
                mfaEnabled = user.TwoFactorEnabled,
                mfaRequired = authOptions.Value.RequireMfa,
                canEdit = (await authz.AuthorizeAsync(principal, Policies.Editor)).Succeeded,
                isAdmin = (await authz.AuthorizeAsync(principal, Policies.Admin)).Succeeded,
            });
        });

        // ---- the signed-in user's own account ----
        var account = app.MapGroup("/api/account").RequireAuthorization(Policies.SignedIn);

        account.MapPost("/password", async (ChangePasswordRequest req, ClaimsPrincipal principal,
            UserManager<AppUser> users, SignInManager<AppUser> signIn) =>
        {
            var user = await users.GetUserAsync(principal);
            if (user is null) return Results.Unauthorized();
            var result = await users.ChangePasswordAsync(user, req.CurrentPassword ?? "", req.NewPassword ?? "");
            if (!result.Succeeded) return IdentityErrors(result);
            await signIn.RefreshSignInAsync(user);
            return Results.NoContent();
        });

        // Home address: the CeX tracker finds stores near its postcode. Only the user themselves can see it.
        account.MapGet("/address", async (ClaimsPrincipal principal, UserManager<AppUser> users) =>
        {
            var user = await users.GetUserAsync(principal);
            if (user is null) return Results.Unauthorized();
            return Results.Ok(new { address = user.Address, postcode = user.Postcode });
        });

        account.MapPut("/address", async (AddressRequest req, ClaimsPrincipal principal,
            UserManager<AppUser> users, PostcodeClient postcodes, CancellationToken ct) =>
        {
            var user = await users.GetUserAsync(principal);
            if (user is null) return Results.Unauthorized();
            var address = req.Address?.Replace("\r\n", "\n").Trim();
            if (string.IsNullOrEmpty(address)) return Problem("Enter your address, with its postcode.", 400);
            if (address.Length > 500) return Problem("That address is too long (500 characters at most).", 400);
            if (PostcodeClient.Find(address) is not { } postcode)
                return Problem("Include your postcode: it's how the CeX tracker finds the stores near you.", 400);

            switch (await postcodes.LookupAsync(postcode, ct))
            {
                case PostcodeLookup.Found(var found):
                    user.Address = address;
                    user.Postcode = found.Postcode;
                    user.Latitude = found.Latitude;
                    user.Longitude = found.Longitude;
                    var saved = await users.UpdateAsync(user);
                    if (!saved.Succeeded) return IdentityErrors(saved);
                    return Results.Ok(new { address, postcode = found.Postcode, place = found.Place });
                case PostcodeLookup.Unknown:
                    return Problem($"Couldn't find the postcode {postcode}. Check it for typos.", 400);
                default:
                    return Problem("Couldn't look up the postcode right now. Try again in a minute.", 502);
            }
        });

        account.MapDelete("/address", async (ClaimsPrincipal principal, UserManager<AppUser> users) =>
        {
            var user = await users.GetUserAsync(principal);
            if (user is null) return Results.Unauthorized();
            user.Address = user.Postcode = null;
            user.Latitude = user.Longitude = null;
            var saved = await users.UpdateAsync(user);
            return saved.Succeeded ? Results.NoContent() : IdentityErrors(saved);
        });

        account.MapGet("/mfa", async (ClaimsPrincipal principal, UserManager<AppUser> users, IOptions<AuthOptions> opts) =>
        {
            var user = await users.GetUserAsync(principal);
            if (user is null) return Results.Unauthorized();
            return Results.Ok(new
            {
                enabled = user.TwoFactorEnabled,
                required = opts.Value.RequireMfa,
                recoveryCodesLeft = user.TwoFactorEnabled ? await users.CountRecoveryCodesAsync(user) : 0,
            });
        });

        account.MapPost("/mfa/setup", async (ClaimsPrincipal principal, UserManager<AppUser> users) =>
        {
            var user = await users.GetUserAsync(principal);
            if (user is null) return Results.Unauthorized();
            if (user.TwoFactorEnabled) return Problem("MFA is already enabled.", 409);

            var key = await users.GetAuthenticatorKeyAsync(user);
            if (string.IsNullOrEmpty(key))
            {
                await users.ResetAuthenticatorKeyAsync(user);
                key = await users.GetAuthenticatorKeyAsync(user);
            }
            var account = Uri.EscapeDataString(user.UserName!);
            var uri = $"otpauth://totp/{Uri.EscapeDataString(Issuer)}:{account}?secret={key}&issuer={Uri.EscapeDataString(Issuer)}&digits=6";
            return Results.Ok(new { sharedKey = FormatKey(key!), otpauthUri = uri });
        });

        account.MapPost("/mfa/enable", async (MfaCodeRequest req, ClaimsPrincipal principal,
            UserManager<AppUser> users, SignInManager<AppUser> signIn) =>
        {
            var user = await users.GetUserAsync(principal);
            if (user is null) return Results.Unauthorized();
            if (user.TwoFactorEnabled) return Problem("MFA is already enabled.", 409);

            var valid = await users.VerifyTwoFactorTokenAsync(user,
                users.Options.Tokens.AuthenticatorTokenProvider, NormalizeCode(req.Code ?? ""));
            if (!valid) return Problem("That code didn't match. Check your device's clock and try again.", 400);

            await users.SetTwoFactorEnabledAsync(user, true);
            var codes = await users.GenerateNewTwoFactorRecoveryCodesAsync(user, 10);
            await signIn.RefreshSignInAsync(user); // re-issue cookie with the mfa_enrolled claim
            return Results.Ok(new { recoveryCodes = codes });
        }).RequireRateLimiting("login");

        account.MapPost("/mfa/recovery-codes", async (MfaCodeRequest req, ClaimsPrincipal principal, UserManager<AppUser> users) =>
        {
            var user = await users.GetUserAsync(principal);
            if (user is null) return Results.Unauthorized();
            if (!user.TwoFactorEnabled) return Problem("MFA is not enabled.", 409);
            var valid = await users.VerifyTwoFactorTokenAsync(user,
                users.Options.Tokens.AuthenticatorTokenProvider, NormalizeCode(req.Code ?? ""));
            if (!valid) return Problem("Invalid code.", 400);
            var codes = await users.GenerateNewTwoFactorRecoveryCodesAsync(user, 10);
            return Results.Ok(new { recoveryCodes = codes });
        }).RequireRateLimiting("login");

        account.MapPost("/mfa/disable", async (PasswordRequest req, ClaimsPrincipal principal,
            UserManager<AppUser> users, SignInManager<AppUser> signIn, IOptions<AuthOptions> opts) =>
        {
            if (opts.Value.RequireMfa) return Problem("MFA is required on this site and can't be turned off.", 409);
            var user = await users.GetUserAsync(principal);
            if (user is null) return Results.Unauthorized();
            if (!await users.CheckPasswordAsync(user, req.Password ?? "")) return Problem("Wrong password.", 400);
            await users.SetTwoFactorEnabledAsync(user, false);
            await users.ResetAuthenticatorKeyAsync(user);
            await signIn.RefreshSignInAsync(user);
            return Results.NoContent();
        });
    }

    internal static IResult Problem(string detail, int status) => Results.Problem(detail: detail, statusCode: status);

    internal static IResult IdentityErrors(IdentityResult result) =>
        Results.ValidationProblem(new Dictionary<string, string[]>
        {
            [""] = result.Errors.Select(e => e.Description).ToArray(),
        });

    private static string NormalizeCode(string code) => code.Replace(" ", "").Replace("-", "").Trim();

    private static string FormatKey(string key) =>
        string.Join(' ', Enumerable.Range(0, (key.Length + 3) / 4).Select(i => key.Substring(i * 4, Math.Min(4, key.Length - i * 4)))).ToLowerInvariant();
}
