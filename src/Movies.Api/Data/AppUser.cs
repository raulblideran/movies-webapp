using Microsoft.AspNetCore.Identity;

namespace Movies.Api.Data;

/// <summary>A signed-in user, with their home address for the CeX stock tracker.</summary>
public class AppUser : IdentityUser
{
    /// <summary>As the user typed it. Only they can see it.</summary>
    public string? Address { get; set; }

    /// <summary>The postcode found in <see cref="Address"/>, e.g. "DN1 1AA". The location comes from this alone.</summary>
    public string? Postcode { get; set; }

    /// <summary>The centre of <see cref="Postcode"/>, from postcodes.io. CeX's nearest-store search uses it.</summary>
    public double? Latitude { get; set; }

    public double? Longitude { get; set; }
}
