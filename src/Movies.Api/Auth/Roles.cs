namespace Movies.Api.Auth;

public static class Roles
{
    public const string Admin = "Admin";
    public const string Editor = "Editor";
    public static readonly string[] All = [Admin, Editor];
}

public static class Policies
{
    /// <summary>Signed in (password step done), MFA enrolment not yet required. Used for account/MFA setup.</summary>
    public const string SignedIn = "SignedIn";
    /// <summary>Can add/edit/delete titles.</summary>
    public const string Editor = "Editor";
    /// <summary>Can manage users.</summary>
    public const string Admin = "Admin";
}

public static class AppClaims
{
    /// <summary>Present with value "true" when the user has an authenticator enrolled.</summary>
    public const string MfaEnrolled = "mfa_enrolled";
}

public class AuthOptions
{
    /// <summary>When true, Editor/Admin actions require the user to have MFA enrolled.</summary>
    public bool RequireMfa { get; set; } = true;
}
