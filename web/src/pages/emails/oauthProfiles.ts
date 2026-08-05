export type OAuthProvider = "GMAIL" | "OUTLOOK";
export type OAuthScopeProfile = "minimal" | "send" | "manage" | "full";

export interface OAuthProfileCapabilities {
	readMail: boolean;
	sendMail: boolean;
	manageMail: boolean;
	extendedAccess: boolean;
}

export const OAUTH_SCOPE_PROFILES: OAuthScopeProfile[] = [
	"minimal",
	"send",
	"manage",
	"full",
];

const GOOGLE_IDENTITY_SCOPES = ["openid", "email", "profile"];
const MICROSOFT_IDENTITY_SCOPES = [
	"offline_access",
	"openid",
	"profile",
	"email",
	"https://graph.microsoft.com/User.Read",
];

const OAUTH_PROFILE_SCOPES: Record<
	OAuthProvider,
	Record<OAuthScopeProfile, string[]>
> = {
	GMAIL: {
		minimal: [
			...GOOGLE_IDENTITY_SCOPES,
			"https://www.googleapis.com/auth/gmail.readonly",
		],
		send: [
			...GOOGLE_IDENTITY_SCOPES,
			"https://www.googleapis.com/auth/gmail.readonly",
			"https://www.googleapis.com/auth/gmail.send",
		],
		manage: [
			...GOOGLE_IDENTITY_SCOPES,
			"https://www.googleapis.com/auth/gmail.modify",
			"https://www.googleapis.com/auth/gmail.send",
		],
		full: [...GOOGLE_IDENTITY_SCOPES, "https://mail.google.com/"],
	},
	OUTLOOK: {
		minimal: [
			...MICROSOFT_IDENTITY_SCOPES,
			"https://graph.microsoft.com/Mail.Read",
		],
		send: [
			...MICROSOFT_IDENTITY_SCOPES,
			"https://graph.microsoft.com/Mail.Read",
			"https://graph.microsoft.com/Mail.Send",
		],
		manage: [
			...MICROSOFT_IDENTITY_SCOPES,
			"https://graph.microsoft.com/Mail.ReadWrite",
			"https://graph.microsoft.com/Mail.Send",
		],
		full: [
			...MICROSOFT_IDENTITY_SCOPES,
			"https://graph.microsoft.com/Mail.ReadWrite",
			"https://graph.microsoft.com/Mail.Send",
			"https://graph.microsoft.com/Contacts.ReadWrite",
			"https://graph.microsoft.com/Calendars.ReadWrite",
			"https://graph.microsoft.com/MailboxSettings.ReadWrite",
		],
	},
};

const OAUTH_PROFILE_CAPABILITIES: Record<
	OAuthScopeProfile,
	OAuthProfileCapabilities
> = {
	minimal: {
		readMail: true,
		sendMail: false,
		manageMail: false,
		extendedAccess: false,
	},
	send: {
		readMail: true,
		sendMail: true,
		manageMail: false,
		extendedAccess: false,
	},
	manage: {
		readMail: true,
		sendMail: true,
		manageMail: true,
		extendedAccess: false,
	},
	full: {
		readMail: true,
		sendMail: true,
		manageMail: true,
		extendedAccess: true,
	},
};

export function normalizeOAuthScopeProfile(
	value: string | null | undefined,
): OAuthScopeProfile {
	return OAUTH_SCOPE_PROFILES.includes(value as OAuthScopeProfile)
		? (value as OAuthScopeProfile)
		: "minimal";
}

export function getOAuthProfileScopes(
	provider: OAuthProvider,
	profile: OAuthScopeProfile,
): string {
	return OAUTH_PROFILE_SCOPES[provider][profile].join(" ");
}

export function getOAuthProfileCapabilities(
	profile: OAuthScopeProfile,
): OAuthProfileCapabilities {
	return { ...OAUTH_PROFILE_CAPABILITIES[profile] };
}
