using System.Security.Claims;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Movies.Api.Auth;
using static Movies.Api.Endpoints.AuthEndpoints;

namespace Movies.Api.Endpoints;

public record CreateUserRequest(string? UserName, string? Password, string? Role);
public record SetRoleRequest(string? Role);

/// <summary>User management for Admins. There is no self-registration.</summary>
public static class UsersEndpoints
{
    public static void MapUsersEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/users").RequireAuthorization(Policies.Admin);

        g.MapGet("/", async (UserManager<IdentityUser> users) =>
        {
            var list = await users.Users.OrderBy(u => u.UserName).ToListAsync();
            var result = new List<object>();
            foreach (var u in list) result.Add(await ToDto(u, users));
            return result;
        });

        g.MapPost("/", async (CreateUserRequest req, UserManager<IdentityUser> users) =>
        {
            if (string.IsNullOrWhiteSpace(req.UserName)) return Problem("Username is required.", 400);
            if (!Roles.All.Contains(req.Role)) return Problem("Role must be Admin or Editor.", 400);
            var user = new IdentityUser { UserName = req.UserName.Trim(), LockoutEnabled = true };
            var created = await users.CreateAsync(user, req.Password ?? "");
            if (!created.Succeeded) return IdentityErrors(created);
            await users.AddToRoleAsync(user, req.Role!);
            return Results.Ok(await ToDto(user, users));
        });

        g.MapPut("/{id}/role", async (string id, SetRoleRequest req, ClaimsPrincipal me, UserManager<IdentityUser> users) =>
        {
            if (!Roles.All.Contains(req.Role)) return Problem("Role must be Admin or Editor.", 400);
            if (await users.FindByIdAsync(id) is not { } user) return Results.NotFound();
            if (IsSelf(me, user, users) && req.Role != Roles.Admin) return Problem("You can't remove your own Admin role.", 409);
            var current = await users.GetRolesAsync(user);
            await users.RemoveFromRolesAsync(user, current);
            await users.AddToRoleAsync(user, req.Role!);
            await users.UpdateSecurityStampAsync(user);
            return Results.Ok(await ToDto(user, users));
        });

        g.MapPost("/{id}/lock", async (string id, ClaimsPrincipal me, UserManager<IdentityUser> users) =>
        {
            if (await users.FindByIdAsync(id) is not { } user) return Results.NotFound();
            if (IsSelf(me, user, users)) return Problem("You can't lock yourself out.", 409);
            await users.SetLockoutEnabledAsync(user, true);
            await users.SetLockoutEndDateAsync(user, DateTimeOffset.MaxValue);
            await users.UpdateSecurityStampAsync(user); // kills existing sessions
            return Results.Ok(await ToDto(user, users));
        });

        g.MapPost("/{id}/unlock", async (string id, UserManager<IdentityUser> users) =>
        {
            if (await users.FindByIdAsync(id) is not { } user) return Results.NotFound();
            await users.SetLockoutEndDateAsync(user, null);
            await users.ResetAccessFailedCountAsync(user);
            return Results.Ok(await ToDto(user, users));
        });

        g.MapPost("/{id}/reset-password", async (string id, PasswordRequest req, UserManager<IdentityUser> users) =>
        {
            if (await users.FindByIdAsync(id) is not { } user) return Results.NotFound();
            var token = await users.GeneratePasswordResetTokenAsync(user);
            var result = await users.ResetPasswordAsync(user, token, req.Password ?? "");
            return result.Succeeded ? Results.Ok(await ToDto(user, users)) : IdentityErrors(result);
        });

        g.MapPost("/{id}/reset-mfa", async (string id, ClaimsPrincipal me, UserManager<IdentityUser> users) =>
        {
            if (await users.FindByIdAsync(id) is not { } user) return Results.NotFound();
            if (IsSelf(me, user, users)) return Problem("Reset your own MFA from your account instead.", 409);
            await users.SetTwoFactorEnabledAsync(user, false);
            await users.ResetAuthenticatorKeyAsync(user); // also rotates the security stamp
            return Results.Ok(await ToDto(user, users));
        });

        g.MapDelete("/{id}", async (string id, ClaimsPrincipal me, UserManager<IdentityUser> users) =>
        {
            if (await users.FindByIdAsync(id) is not { } user) return Results.NotFound();
            if (IsSelf(me, user, users)) return Problem("You can't delete yourself.", 409);
            var result = await users.DeleteAsync(user);
            return result.Succeeded ? Results.NoContent() : IdentityErrors(result);
        });
    }

    private static bool IsSelf(ClaimsPrincipal me, IdentityUser user, UserManager<IdentityUser> users) =>
        users.GetUserId(me) == user.Id;

    private static async Task<object> ToDto(IdentityUser u, UserManager<IdentityUser> users) => new
    {
        id = u.Id,
        userName = u.UserName,
        roles = await users.GetRolesAsync(u),
        mfaEnabled = u.TwoFactorEnabled,
        lockedOut = u.LockoutEnd is { } end && end > DateTimeOffset.UtcNow,
    };
}
