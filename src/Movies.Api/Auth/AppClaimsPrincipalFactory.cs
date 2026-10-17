using System.Security.Claims;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;

namespace Movies.Api.Auth;

/// <summary>Adds an MFA-enrolment claim to the cookie so policies can check it without a DB hit.</summary>
public class AppClaimsPrincipalFactory(
    UserManager<IdentityUser> userManager,
    RoleManager<IdentityRole> roleManager,
    IOptions<IdentityOptions> options)
    : UserClaimsPrincipalFactory<IdentityUser, IdentityRole>(userManager, roleManager, options)
{
    protected override async Task<ClaimsIdentity> GenerateClaimsAsync(IdentityUser user)
    {
        var identity = await base.GenerateClaimsAsync(user);
        if (await UserManager.GetTwoFactorEnabledAsync(user))
            identity.AddClaim(new Claim(AppClaims.MfaEnrolled, "true"));
        return identity;
    }
}
