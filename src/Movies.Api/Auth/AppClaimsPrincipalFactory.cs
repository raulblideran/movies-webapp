using System.Security.Claims;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;
using Movies.Api.Data;

namespace Movies.Api.Auth;

/// <summary>Adds an MFA-enrolment claim to the cookie so policies can check it without a DB hit.</summary>
public class AppClaimsPrincipalFactory(
    UserManager<AppUser> userManager,
    RoleManager<IdentityRole> roleManager,
    IOptions<IdentityOptions> options)
    : UserClaimsPrincipalFactory<AppUser, IdentityRole>(userManager, roleManager, options)
{
    protected override async Task<ClaimsIdentity> GenerateClaimsAsync(AppUser user)
    {
        var identity = await base.GenerateClaimsAsync(user);
        if (await UserManager.GetTwoFactorEnabledAsync(user))
            identity.AddClaim(new Claim(AppClaims.MfaEnrolled, "true"));
        return identity;
    }
}
