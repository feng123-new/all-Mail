import type { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma.js";
import { AppError } from "../../plugins/error.js";
import {
	type EmailAuthType,
	type EmailProvider,
	getImportProviderConfigForProfile,
	getImportTokenForProfile,
	getProviderProfileMetadata,
	getProviderProfileSummary,
	type MailProviderConfig,
	mergeProviderConfigForProfile,
	type ProviderProfile,
	resolveProviderProfile,
	resolveProviderProfileByImportToken,
} from "../mail/providers/types.js";
import type { ImportEmailInput } from "./email.schema.js";
import {
	decryptOptional,
	encryptOptional,
	parseJsonObject,
	sanitizeProviderConfig,
} from "./email.service.helpers.js";

function buildExtendedImapImportProviderConfig(
	parts: string[],
): Record<string, unknown> {
	const imapPort = Number(parts[4]);
	const smtpPort = Number(parts[7]);
	return {
		readMode: "IMAP",
		imapHost: parts[3],
		imapPort: Number.isFinite(imapPort) ? imapPort : 993,
		imapTls: parts[5] ? parts[5].toLowerCase() !== "false" : true,
		smtpHost: parts[6],
		smtpPort: Number.isFinite(smtpPort) ? smtpPort : 465,
		smtpSecure: parts[8] ? parts[8].toLowerCase() !== "false" : true,
		folders: {
			inbox: parts[9] || "INBOX",
			junk: parts[10] || "Junk",
			sent: parts[11] || "Sent",
		},
	};
}

function shouldUseExtendedImapExport(
	profile: ProviderProfile,
	storedConfig: Prisma.JsonValue | null | undefined,
): boolean {
	const defaults = getImportProviderConfigForProfile(profile);
	const merged = mergeProviderConfigForProfile(
		profile,
		parseJsonObject(storedConfig) as MailProviderConfig | null | undefined,
	);

	if (!defaults.imapHost || !defaults.smtpHost) {
		return true;
	}

	return (
		merged.imapHost !== defaults.imapHost ||
		merged.imapPort !== defaults.imapPort ||
		merged.imapTls !== defaults.imapTls ||
		merged.smtpHost !== defaults.smtpHost ||
		merged.smtpPort !== defaults.smtpPort ||
		merged.smtpSecure !== defaults.smtpSecure ||
		merged.folders?.inbox !== defaults.folders?.inbox ||
		merged.folders?.junk !== defaults.folders?.junk ||
		merged.folders?.sent !== defaults.folders?.sent
	);
}

function parseImportLine(
	line: string,
	separator: string,
): {
	email: string;
	provider: EmailProvider;
	authType: EmailAuthType;
	clientId?: string;
	clientSecret?: string;
	refreshToken?: string;
	password?: string;
	accountLoginPassword?: string;
	providerConfig?: Record<string, unknown>;
} {
	const parts = line
		.trim()
		.split(separator)
		.map((item) => item.trim());
	if (parts.length < 2) throw new Error("Invalid format");

	const looksLikeEmail = (value: string | undefined) =>
		Boolean(value?.includes("@"));
	const looksLikeClientId = (value: string | undefined) =>
		Boolean(
			value &&
				(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
					value,
				) ||
					/\.apps\.googleusercontent\.com$/i.test(value)),
		);
	const looksLikeRefreshToken = (value: string | undefined) =>
		Boolean(
			value &&
				(value.startsWith("M.") ||
					value.startsWith("1//") ||
					value.startsWith("ya29.")),
		);
	const resolveProfileByDomain = (
		emailValue: string,
		hasOAuthFields: boolean,
	) => {
		const domain = emailValue.split("@")[1]?.toLowerCase();
		if (!domain) {
			return null;
		}
		if (
			["outlook.com", "hotmail.com", "live.com", "msn.com"].includes(domain)
		) {
			return hasOAuthFields ? "outlook-oauth" : null;
		}
		if (domain === "gmail.com") {
			return hasOAuthFields ? "gmail-oauth" : "gmail-app-password";
		}
		if (domain === "qq.com") return "qq-imap-smtp";
		if (domain === "163.com") return "netease-163-imap-smtp";
		if (domain === "126.com") return "netease-126-imap-smtp";
		if (["icloud.com", "me.com", "mac.com"].includes(domain))
			return "icloud-imap-smtp";
		if (domain === "yahoo.com") return "yahoo-imap-smtp";
		if (domain === "zoho.com") return "zoho-imap-smtp";
		if (domain === "aliyun.com") return "aliyun-imap-smtp";
		if (domain === "fastmail.com") return "fastmail-imap-smtp";
		if (domain === "aol.com") return "aol-imap-smtp";
		if (domain === "gmx.com") return "gmx-imap-smtp";
		if (domain === "mail.com") return "mailcom-imap-smtp";
		if (["yandex.com", "yandex.ru", "ya.ru"].includes(domain))
			return "yandex-imap-smtp";
		return null;
	};

	const head = parts[0].toUpperCase();
	const importedProfile = resolveProviderProfileByImportToken(head);
	if (importedProfile) {
		const metadata = getProviderProfileMetadata(importedProfile);
		if (metadata.authType === "APP_PASSWORD") {
			if (parts.length >= 12) {
				return {
					provider: metadata.provider,
					authType: metadata.authType,
					email: parts[1],
					password: parts[2],
					accountLoginPassword: parts[12] || undefined,
					providerConfig: buildExtendedImapImportProviderConfig(parts),
				};
			}
			if (parts.length < 3)
				throw new Error(
					`${head} format should be ${head}----email----password`,
				);
			return {
				provider: metadata.provider,
				authType: metadata.authType,
				email: parts[1],
				password: parts[2],
				accountLoginPassword: parts[3] || undefined,
				providerConfig: getImportProviderConfigForProfile(importedProfile),
			};
		}

		if (parts.length < 5)
			throw new Error(
				`${head} format should be ${head}----email----clientId----clientSecret----refreshToken`,
			);
		return {
			provider: metadata.provider,
			authType: metadata.authType,
			email: parts[1],
			clientId: parts[2],
			clientSecret: parts[3] || undefined,
			refreshToken: parts[4],
			accountLoginPassword: parts[5] || undefined,
			providerConfig: getImportProviderConfigForProfile(importedProfile),
		};
	}

	if (looksLikeEmail(parts[0])) {
		const email = parts[0];
		const inferredOauthProfile = resolveProfileByDomain(email, true);
		const inferredPasswordProfile = resolveProfileByDomain(email, false);
		if (
			inferredOauthProfile &&
			parts.length === 3 &&
			looksLikeClientId(parts[1]) &&
			looksLikeRefreshToken(parts[2])
		) {
			const metadata = getProviderProfileMetadata(inferredOauthProfile);
			return {
				provider: metadata.provider,
				authType: metadata.authType,
				email,
				clientId: parts[1] || undefined,
				refreshToken: parts[2] || undefined,
				providerConfig: getImportProviderConfigForProfile(inferredOauthProfile),
			};
		}
		if (inferredOauthProfile && parts.length >= 4) {
			const metadata = getProviderProfileMetadata(inferredOauthProfile);
			return {
				provider: metadata.provider,
				authType: metadata.authType,
				email,
				accountLoginPassword: parts[1] || undefined,
				clientId: parts[2] || undefined,
				refreshToken: parts[3] || undefined,
				clientSecret: parts[4] || undefined,
				providerConfig: getImportProviderConfigForProfile(inferredOauthProfile),
			};
		}
		if (inferredPasswordProfile && parts.length === 2) {
			const metadata = getProviderProfileMetadata(inferredPasswordProfile);
			return {
				provider: metadata.provider,
				authType: metadata.authType,
				email,
				password: parts[1],
				providerConfig: getImportProviderConfigForProfile(
					inferredPasswordProfile,
				),
			};
		}
		if (inferredPasswordProfile && parts.length === 3) {
			const metadata = getProviderProfileMetadata(inferredPasswordProfile);
			return {
				provider: metadata.provider,
				authType: metadata.authType,
				email,
				password: parts[1],
				accountLoginPassword: parts[2] || undefined,
				providerConfig: getImportProviderConfigForProfile(
					inferredPasswordProfile,
				),
			};
		}
		if (inferredOauthProfile) {
			throw new Error(
				`OAuth format should be email${separator}password${separator}clientId${separator}refreshToken`,
			);
		}
	}

	if (parts.length < 3)
		throw new Error("Legacy format requires at least 3 columns");
	let email: string | undefined;
	let clientId: string | undefined;
	let refreshToken: string | undefined;
	let password: string | undefined;
	let clientSecret: string | undefined;

	if (
		parts.length === 4 &&
		looksLikeEmail(parts[0]) &&
		looksLikeRefreshToken(parts[2]) &&
		looksLikeClientId(parts[3])
	) {
		return {
			provider: "OUTLOOK",
			authType: "MICROSOFT_OAUTH",
			email: parts[0],
			clientId: parts[3],
			refreshToken: parts[2],
			clientSecret: undefined,
			providerConfig: getImportProviderConfigForProfile("outlook-oauth"),
		};
	}

	if (parts.length >= 5 && parts[3].toLowerCase() === "oauth") {
		email = parts[0];
		clientId = parts[1];
		clientSecret = parts[2];
		refreshToken = parts[4];
	} else if (parts.length >= 5) {
		email = parts[0];
		clientId = parts[1];
		refreshToken = parts[4];
	} else if (parts.length === 4) {
		email = parts[0];
		password = parts[1];
		clientId = parts[2];
		refreshToken = parts[3];
	} else {
		email = parts[0];
		clientId = parts[1];
		refreshToken = parts[2];
	}
	if (!email || !clientId || !refreshToken)
		throw new Error("Missing required fields");
	return {
		provider: "OUTLOOK",
		authType: "MICROSOFT_OAUTH",
		email,
		clientId,
		clientSecret,
		refreshToken,
		accountLoginPassword: password,
		providerConfig: getImportProviderConfigForProfile("outlook-oauth"),
	};
}

export async function importEmails(input: ImportEmailInput) {
	const { content, separator, groupId } = input;
	const lines = content.split("\n").filter((line) => line.trim());
	if (groupId !== undefined) {
		const group = await prisma.emailGroup.findUnique({
			where: { id: groupId },
		});
		if (!group)
			throw new AppError("GROUP_NOT_FOUND", "Email group not found", 404);
	}
	let success = 0;
	let failed = 0;
	const errors: string[] = [];

	for (const line of lines) {
		try {
			const parsed = parseImportLine(line, separator);
			const updateData: Prisma.EmailAccountUncheckedUpdateInput = {
				provider: parsed.provider,
				authType: parsed.authType,
				clientId: parsed.clientId || null,
				refreshToken: encryptOptional(parsed.refreshToken),
				clientSecret: encryptOptional(parsed.clientSecret),
				password: encryptOptional(parsed.password),
				accountLoginPassword: encryptOptional(parsed.accountLoginPassword),
				providerConfig: sanitizeProviderConfig(
					resolveProviderProfile(parsed.provider, parsed.authType),
					parsed.providerConfig || null,
				),
				status: "ACTIVE",
				groupId: groupId === undefined ? undefined : groupId,
			};
			const exists = await prisma.emailAccount.findUnique({
				where: { email: parsed.email },
			});
			if (exists) {
				await prisma.emailAccount.update({
					where: { email: parsed.email },
					data: updateData,
				});
			} else {
				await prisma.emailAccount.create({
					data: {
						email: parsed.email,
						provider: parsed.provider,
						authType: parsed.authType,
						clientId: parsed.clientId || null,
						refreshToken: encryptOptional(parsed.refreshToken),
						clientSecret: encryptOptional(parsed.clientSecret),
						password: encryptOptional(parsed.password),
						accountLoginPassword: encryptOptional(parsed.accountLoginPassword),
						providerConfig: sanitizeProviderConfig(
							resolveProviderProfile(parsed.provider, parsed.authType),
							parsed.providerConfig || null,
						),
						status: "ACTIVE",
						groupId: groupId || null,
					},
				});
			}
			success += 1;
		} catch (error) {
			failed += 1;
			errors.push(
				`Line "${line.substring(0, 50)}...": ${(error as Error).message}`,
			);
		}
	}

	if (success === 0 && failed > 0) {
		throw new AppError(
			"IMPORT_FAILED",
			`Import failed for all ${failed} lines`,
			400,
		);
	}

	return { success, failed, errors };
}

export async function exportEmails(options: {
	ids?: number[];
	separator?: string;
	groupId?: number;
	rawSecrets?: boolean;
}) {
	const { ids, separator = "----", groupId, rawSecrets = false } = options;

	const where: Prisma.EmailAccountWhereInput = {};
	if (ids?.length) where.id = { in: ids };
	if (groupId !== undefined) where.groupId = groupId;
	const accounts = await prisma.emailAccount.findMany({
		where,
		select: {
			email: true,
			provider: true,
			authType: true,
			clientId: true,
			clientSecret: true,
			refreshToken: true,
			password: true,
			accountLoginPassword: true,
			providerConfig: true,
		},
	});

	const lines = accounts.map((account) => {
		const profile = resolveProviderProfile(account.provider, account.authType);
		const head = getImportTokenForProfile(profile);
		if (!getProviderProfileSummary(profile).capabilitySummary.usesOAuth) {
			if (shouldUseExtendedImapExport(profile, account.providerConfig)) {
				const config = mergeProviderConfigForProfile(
					profile,
					parseJsonObject(account.providerConfig) as
						| MailProviderConfig
						| null
						| undefined,
				);
				return [
					head,
					account.email,
					decryptOptional(account.password) || "",
					config.imapHost || "",
					String(config.imapPort || 993),
					String(config.imapTls !== false),
					config.smtpHost || "",
					String(config.smtpPort || 465),
					String(config.smtpSecure !== false),
					config.folders?.inbox || "INBOX",
					config.folders?.junk || "Junk",
					config.folders?.sent || "Sent",
					...(rawSecrets && decryptOptional(account.accountLoginPassword)
						? [decryptOptional(account.accountLoginPassword) || ""]
						: []),
				].join(separator);
			}
			return [
				head,
				account.email,
				decryptOptional(account.password) || "",
				...(rawSecrets && decryptOptional(account.accountLoginPassword)
					? [decryptOptional(account.accountLoginPassword) || ""]
					: []),
			].join(separator);
		}
		const parts = [
			head,
			account.email,
			account.clientId || "",
			decryptOptional(account.clientSecret) || "",
			decryptOptional(account.refreshToken) || "",
		];
		if (rawSecrets) {
			parts.push(decryptOptional(account.accountLoginPassword) || "");
		}
		return parts.join(separator);
	});
	return lines.join("\n");
}
