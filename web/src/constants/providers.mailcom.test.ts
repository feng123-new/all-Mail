import { describe, expect, it } from "vitest";
import { getProviderDefinition, getProviderProfileDefinition } from "./providers";

describe("Mail.com provider profile", () => {
	it("requires Premium protocol access and uses official server/folder defaults", () => {
		const provider = getProviderDefinition("MAILCOM");
		const profile = getProviderProfileDefinition("MAILCOM", "APP_PASSWORD");

		expect(provider.classificationNote).toContain("Premium");
		expect(profile.secretHelpText).toContain("Premium");
		expect(profile.providerConfigDefaults).toMatchObject({
			imapHost: "imap.mail.com",
			imapPort: 993,
			imapTls: true,
			smtpHost: "smtp.mail.com",
			smtpPort: 587,
			smtpSecure: false,
			folders: { junk: "Junk email", sent: "Sent Items" },
		});
	});
});
