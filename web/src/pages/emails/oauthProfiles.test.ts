import { describe, expect, it } from "vitest";
import {
	getOAuthProfileCapabilities,
	getOAuthProfileScopes,
	normalizeOAuthScopeProfile,
	OAUTH_SCOPE_PROFILES,
} from "./oauthProfiles";

describe("OAuth scope profiles", () => {
	it("keeps minimal as the fail-closed default", () => {
		expect(normalizeOAuthScopeProfile(undefined)).toBe("minimal");
		expect(normalizeOAuthScopeProfile("unknown")).toBe("minimal");
		expect(getOAuthProfileCapabilities("minimal")).toEqual({
			readMail: true,
			sendMail: false,
			manageMail: false,
			extendedAccess: false,
		});
	});

	it("maps every profile to cumulative capabilities", () => {
		expect(OAUTH_SCOPE_PROFILES).toEqual([
			"minimal",
			"send",
			"manage",
			"full",
		]);
		expect(getOAuthProfileCapabilities("send").sendMail).toBe(true);
		expect(getOAuthProfileCapabilities("send").manageMail).toBe(false);
		expect(getOAuthProfileCapabilities("manage").manageMail).toBe(true);
		expect(getOAuthProfileCapabilities("full").extendedAccess).toBe(true);
	});

	it("matches the canonical Gmail and Microsoft scope families", () => {
		expect(getOAuthProfileScopes("GMAIL", "minimal")).toContain(
		"gmail.readonly",
	);
		expect(getOAuthProfileScopes("GMAIL", "send")).toContain("gmail.send");
		expect(getOAuthProfileScopes("GMAIL", "manage")).toContain("gmail.modify");
		expect(getOAuthProfileScopes("GMAIL", "full")).toContain(
		"https://mail.google.com/",
	);

		const outlookMinimal = getOAuthProfileScopes("OUTLOOK", "minimal");
		expect(outlookMinimal).toContain("Mail.Read");
		expect(outlookMinimal).not.toContain("Mail.Send");
		expect(getOAuthProfileScopes("OUTLOOK", "send")).toContain("Mail.Send");
		expect(getOAuthProfileScopes("OUTLOOK", "manage")).toContain(
		"Mail.ReadWrite",
	);
		expect(getOAuthProfileScopes("OUTLOOK", "full")).toContain(
		"MailboxSettings.ReadWrite",
	);
	});
});
