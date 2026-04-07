import { Prisma } from "@prisma/client";
import { decrypt, encrypt } from "../../lib/crypto.js";
import prisma from "../../lib/prisma.js";
import { AppError } from "../../plugins/error.js";
import {
	type EmailAuthType,
	type EmailProvider,
	emailProviders,
	enrichMailCredentials,
	getDefaultAuthType,
	getImportProviderConfigForProfile,
	getImportTokenForProfile,
	getProfilesForRepresentativeProtocol,
	getProviderProfileMetadata,
	getProviderProfileSummary,
	type MailboxCheckpoint,
	type MailCredentials,
	type MailFetchStrategy,
	type MailProviderConfig,
	mergeProviderConfigForProfile,
	type ProviderProfile,
	type RepresentativeProtocol,
	resolveProviderProfile,
	resolveProviderProfileByImportToken,
} from "../mail/providers/types.js";
import type {
	CreateEmailInput,
	ImportEmailInput,
	ListEmailInput,
	RevealEmailSecretsInput,
	UpdateEmailInput,
} from "./email.schema.js";

interface EmailAccountView {
	id: number;
	email: string;
	provider: EmailProvider;
	authType: EmailAuthType;
	clientId: string | null;
	clientSecret: string | null;
	refreshToken: string | null;
	password: string | null;
	accountLoginPassword: string | null;
	providerConfig: Prisma.JsonValue | null;
	capabilities: Prisma.JsonValue | null;
	status: "ACTIVE" | "ERROR" | "DISABLED";
	groupId: number | null;
	group?: {
		id?: number;
		name?: string;
		fetchStrategy?: MailFetchStrategy;
	} | null;
	lastCheckAt?: Date | null;
	mailboxStatus?: Prisma.JsonValue | null;
	errorMessage?: string | null;
	createdAt?: Date;
	updatedAt?: Date;
}

export type EmailMailboxName = "INBOX" | "SENT" | "Junk";
export type RevealableEmailSecretField = RevealEmailSecretsInput["fields"][number];

export interface EmailSecretRevealResult {
	secrets: Partial<Record<RevealableEmailSecretField, string | null>>;
	availableFields: RevealableEmailSecretField[];
}

export interface EmailMailboxState {
	latestMessageId: string | null;
	latestMessageDate: string | null;
	messageCount: number;
	hasNew: boolean;
	lastSyncedAt: string | null;
	lastViewedAt: string | null;
	uidValidity: number | null;
	lastUid: number | null;
}

export type EmailMailboxStatus = Record<EmailMailboxName, EmailMailboxState>;

function createEmptyMailboxState(): EmailMailboxState {
	return {
		latestMessageId: null,
		latestMessageDate: null,
		messageCount: 0,
		hasNew: false,
		lastSyncedAt: null,
		lastViewedAt: null,
		uidValidity: null,
		lastUid: null,
	};
}

function createEmptyMailboxStatus(): EmailMailboxStatus {
	return {
		INBOX: createEmptyMailboxState(),
		SENT: createEmptyMailboxState(),
		Junk: createEmptyMailboxState(),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeMailboxState(value: unknown): EmailMailboxState {
	const source = isRecord(value) ? value : {};
	const messageCount =
		typeof source.messageCount === "number" &&
		Number.isFinite(source.messageCount)
			? source.messageCount
			: 0;

	return {
		latestMessageId:
			typeof source.latestMessageId === "string" &&
			source.latestMessageId.trim()
				? source.latestMessageId
				: null,
		latestMessageDate:
			typeof source.latestMessageDate === "string" &&
			source.latestMessageDate.trim()
				? source.latestMessageDate
				: null,
		messageCount,
		hasNew: Boolean(source.hasNew),
		lastSyncedAt:
			typeof source.lastSyncedAt === "string" && source.lastSyncedAt.trim()
				? source.lastSyncedAt
				: null,
		lastViewedAt:
			typeof source.lastViewedAt === "string" && source.lastViewedAt.trim()
				? source.lastViewedAt
				: null,
		uidValidity:
			typeof source.uidValidity === "number" &&
			Number.isInteger(source.uidValidity) &&
			source.uidValidity > 0
				? source.uidValidity
				: null,
		lastUid:
			typeof source.lastUid === "number" &&
			Number.isInteger(source.lastUid) &&
			source.lastUid > 0
				? source.lastUid
				: null,
	};
}

function parseMailboxStatus(
	value: Prisma.JsonValue | null | undefined,
): EmailMailboxStatus {
	const source = isRecord(value) ? value : {};
	const defaults = createEmptyMailboxStatus();
	return {
		INBOX: { ...defaults.INBOX, ...normalizeMailboxState(source.INBOX) },
		SENT: { ...defaults.SENT, ...normalizeMailboxState(source.SENT) },
		Junk: { ...defaults.Junk, ...normalizeMailboxState(source.Junk) },
	};
}

function toMailboxStatusJson(value: EmailMailboxStatus): Prisma.InputJsonValue {
	return value as unknown as Prisma.InputJsonValue;
}

function buildEmailWhere(
	input: Pick<
		ListEmailInput,
		| "status"
		| "keyword"
		| "groupId"
		| "groupName"
		| "provider"
		| "representativeProtocol"
	>,
): Prisma.EmailAccountWhereInput {
	const {
		status,
		keyword,
		groupId,
		groupName,
		provider,
		representativeProtocol,
	} = input;
	const conditions: Prisma.EmailAccountWhereInput[] = [];

	if (status) conditions.push({ status });
	if (provider) conditions.push({ provider });
	if (keyword) conditions.push({ email: { contains: keyword } });
	if (groupId) conditions.push({ groupId });
	else if (groupName) conditions.push({ group: { name: groupName } });

	if (representativeProtocol) {
		const profileFilters = getProfilesForRepresentativeProtocol(
			representativeProtocol as RepresentativeProtocol,
		).map((profile) => {
			const metadata = getProviderProfileMetadata(profile);
			return {
				provider: metadata.provider,
				authType: metadata.authType,
			} satisfies Prisma.EmailAccountWhereInput;
		});

		if (profileFilters.length === 0) {
			conditions.push({ id: { in: [] } });
		} else {
			conditions.push({ OR: profileFilters });
		}
	}

	if (conditions.length === 0) {
		return {};
	}

	if (conditions.length === 1) {
		return conditions[0];
	}

	return { AND: conditions };
}

function getLatestMailboxMessage(
	messages: Array<{ id: string; date: string }>,
) {
	const latest = messages[0];
	if (!latest || !latest.id) {
		return { latestMessageId: null, latestMessageDate: null };
	}
	return {
		latestMessageId: latest.id,
		latestMessageDate: latest.date || null,
	};
}

function parseJsonObject(
	value: Prisma.JsonValue | null | undefined,
): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	return value as Record<string, unknown>;
}

function sanitizeProviderConfig(
	profile: ProviderProfile,
	value?: Record<string, unknown> | null,
): Prisma.InputJsonValue {
	return mergeProviderConfigForProfile(
		profile,
		value as MailProviderConfig | null | undefined,
	) as unknown as Prisma.InputJsonValue;
}

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

function sanitizeCapabilities(
	value?: Record<string, unknown> | null,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
	if (!value) {
		return Prisma.JsonNull;
	}
	return value as Prisma.InputJsonValue;
}

function decryptOptional(value: string | null | undefined): string | undefined {
	if (!value) return undefined;
	return decrypt(value);
}

function encryptOptional(value: string | null | undefined): string | null {
	if (!value || !value.trim()) return null;
	return encrypt(value);
}

function getAllowedRevealFields(account: Pick<EmailAccountView, "provider" | "authType">): RevealableEmailSecretField[] {
	const profileSummary = getProviderProfileSummary(
		resolveProviderProfile(account.provider, account.authType),
	);
	return profileSummary.capabilitySummary.usesOAuth
		? ["refreshToken", "accountLoginPassword"]
		: ["password", "accountLoginPassword"];
}

function normalizeEmailAccount(
	account: EmailAccountView,
	includeSecrets: boolean,
) {
	const profileSummary = getProviderProfileSummary(
		resolveProviderProfile(account.provider, account.authType),
	);
	const hasStoredPassword = Boolean(account.password?.trim());
	const hasStoredAccountLoginPassword = Boolean(account.accountLoginPassword?.trim());
	const normalized = {
		...account,
		...profileSummary,
		hasStoredPassword,
		hasStoredAccountLoginPassword,
		providerConfig: parseJsonObject(account.providerConfig),
		capabilities: parseJsonObject(account.capabilities),
		mailboxStatus: parseMailboxStatus(account.mailboxStatus),
		group: account.group
			? { ...account.group, fetchStrategy: account.group.fetchStrategy }
			: null,
	};
	if (!includeSecrets) {
		return {
			...normalized,
			clientSecret: undefined,
			refreshToken: undefined,
			password: undefined,
			accountLoginPassword: undefined,
		};
	}
	return {
		...normalized,
		clientSecret: decryptOptional(account.clientSecret),
		refreshToken: decryptOptional(account.refreshToken),
		password: decryptOptional(account.password),
		accountLoginPassword: decryptOptional(account.accountLoginPassword),
	};
}

function normalizeCreateInput(input: CreateEmailInput) {
	const provider = input.provider;
	const authType = input.authType || getDefaultAuthType(provider);
	const providerProfile = resolveProviderProfile(provider, authType);
	return {
		...input,
		provider,
		authType,
		providerConfig: sanitizeProviderConfig(
			providerProfile,
			input.providerConfig || null,
		),
		capabilities: sanitizeCapabilities(input.capabilities || null),
	};
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
				) || /\.apps\.googleusercontent\.com$/i.test(value)),
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
		if (["outlook.com", "hotmail.com", "live.com", "msn.com"].includes(domain)) {
			return hasOAuthFields ? "outlook-oauth" : null;
		}
		if (domain === "gmail.com") {
			return hasOAuthFields ? "gmail-oauth" : "gmail-app-password";
		}
		if (domain === "qq.com") return "qq-imap-smtp";
		if (domain === "163.com") return "netease-163-imap-smtp";
		if (domain === "126.com") return "netease-126-imap-smtp";
		if (["icloud.com", "me.com", "mac.com"].includes(domain)) return "icloud-imap-smtp";
		if (domain === "yahoo.com") return "yahoo-imap-smtp";
		if (domain === "zoho.com") return "zoho-imap-smtp";
		if (domain === "aliyun.com") return "aliyun-imap-smtp";
		if (domain === "fastmail.com") return "fastmail-imap-smtp";
		if (domain === "aol.com") return "aol-imap-smtp";
		if (domain === "gmx.com") return "gmx-imap-smtp";
		if (domain === "mail.com") return "mailcom-imap-smtp";
		if (["yandex.com", "yandex.ru", "ya.ru"].includes(domain)) return "yandex-imap-smtp";
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
				providerConfig: getImportProviderConfigForProfile(inferredPasswordProfile),
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
				providerConfig: getImportProviderConfigForProfile(inferredPasswordProfile),
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

export const emailService = {
	async list(input: ListEmailInput) {
		const {
			page,
			pageSize,
			status,
			keyword,
			groupId,
			groupName,
			provider,
			representativeProtocol,
		} = input;
		const skip = (page - 1) * pageSize;
		const where = buildEmailWhere({
			status,
			keyword,
			groupId,
			groupName,
			provider,
			representativeProtocol,
		});

		const [list, total] = await Promise.all([
			prisma.emailAccount.findMany({
				where,
				select: {
					id: true,
					email: true,
					provider: true,
					authType: true,
					clientId: true,
					password: true,
					accountLoginPassword: true,
					providerConfig: true,
					status: true,
					groupId: true,
					group: { select: { id: true, name: true, fetchStrategy: true } },
					lastCheckAt: true,
					mailboxStatus: true,
					errorMessage: true,
					createdAt: true,
				},
				skip,
				take: pageSize,
				orderBy: { id: "desc" },
			}),
			prisma.emailAccount.count({ where }),
		]);

		return {
			list: list.map((item) =>
				normalizeEmailAccount(item as EmailAccountView, false),
			),
			total,
			page,
			pageSize,
		};
	},

	async getById(id: number, includeSecrets = false) {
		const email = await prisma.emailAccount.findUnique({
			where: { id },
			select: {
				id: true,
				email: true,
				provider: true,
				authType: true,
				clientId: true,
				clientSecret: true,
				password: true,
				accountLoginPassword: true,
				refreshToken: true,
				providerConfig: true,
				capabilities: true,
				status: true,
				groupId: true,
				group: { select: { id: true, name: true, fetchStrategy: true } },
				lastCheckAt: true,
				mailboxStatus: true,
				errorMessage: true,
				createdAt: true,
				updatedAt: true,
			},
		});
		if (!email) throw new AppError("NOT_FOUND", "Email account not found", 404);
		return normalizeEmailAccount(email as EmailAccountView, includeSecrets);
	},

	async getByEmail(emailAddress: string) {
		const email = await prisma.emailAccount.findUnique({
			where: { email: emailAddress },
			select: {
				id: true,
				email: true,
				provider: true,
				authType: true,
				clientId: true,
				clientSecret: true,
				refreshToken: true,
				password: true,
				accountLoginPassword: true,
				providerConfig: true,
				capabilities: true,
				status: true,
				groupId: true,
				group: { select: { fetchStrategy: true } },
				mailboxStatus: true,
			},
		});
		if (!email) return null;
		const normalized = normalizeEmailAccount(email as EmailAccountView, true);
		return {
			...normalized,
			fetchStrategy: email.group?.fetchStrategy || "GRAPH_FIRST",
		};
	},

	async revealSecrets(id: number, fields: RevealEmailSecretsInput["fields"]): Promise<EmailSecretRevealResult> {
		const email = await prisma.emailAccount.findUnique({
			where: { id },
			select: {
				id: true,
				provider: true,
				authType: true,
				refreshToken: true,
				password: true,
				accountLoginPassword: true,
			},
		});

		if (!email) {
			throw new AppError("NOT_FOUND", "Email account not found", 404);
		}

		const uniqueFields = Array.from(new Set(fields));
		const availableFields = getAllowedRevealFields(email as Pick<EmailAccountView, "provider" | "authType">);
		for (const field of uniqueFields) {
			if (!availableFields.includes(field)) {
				throw new AppError(
					"SECRET_REVEAL_NOT_ALLOWED",
					`${field} is not available for this mailbox auth flow`,
					400,
				);
			}
		}

		const secrets: Partial<Record<RevealableEmailSecretField, string | null>> = {};
		for (const field of uniqueFields) {
			if (field === "password" && !email.password) {
				throw new AppError(
					"PASSWORD_NOT_PRESENT",
					"No stored login password for this mailbox",
					400,
				);
			}
			if (field === "accountLoginPassword" && !email.accountLoginPassword) {
				throw new AppError(
					"ACCOUNT_LOGIN_PASSWORD_NOT_PRESENT",
					"No stored account login password for this mailbox",
					400,
				);
			}
			secrets[field] = field === "refreshToken"
				? decryptOptional(email.refreshToken) ?? null
				: field === "accountLoginPassword"
					? decryptOptional(email.accountLoginPassword) ?? null
				: decryptOptional(email.password) ?? null;
		}

		return {
			secrets,
			availableFields,
		};
	},

	async getBatchTargets(input: {
		ids?: number[];
		status?: ListEmailInput["status"];
		keyword?: string;
		groupId?: number;
		groupName?: string;
		provider?: EmailProvider;
		representativeProtocol?: RepresentativeProtocol;
	}) {
		const ids = Array.isArray(input.ids)
			? Array.from(
					new Set(
						input.ids.filter((item) => Number.isInteger(item) && item > 0),
					),
				)
			: [];

		const where =
			ids.length > 0
				? { id: { in: ids } }
				: buildEmailWhere({
						status: input.status,
						keyword: input.keyword,
						groupId: input.groupId,
						groupName: input.groupName,
						provider: input.provider,
						representativeProtocol: input.representativeProtocol,
					});

		const accounts = await prisma.emailAccount.findMany({
			where,
			select: {
				id: true,
				email: true,
				provider: true,
				authType: true,
				clientId: true,
				clientSecret: true,
				refreshToken: true,
				password: true,
				providerConfig: true,
				capabilities: true,
				status: true,
				groupId: true,
				mailboxStatus: true,
				group: { select: { id: true, name: true, fetchStrategy: true } },
			},
			orderBy: { id: "desc" },
		});

		return accounts.map((account) => {
			const normalized = normalizeEmailAccount(
				account as EmailAccountView,
				true,
			);
			return {
				...normalized,
				fetchStrategy: account.group?.fetchStrategy || "GRAPH_FIRST",
			};
		});
	},

	async updateMailboxStatus(
		id: number,
		mailbox: EmailMailboxName,
		messages: Array<{ id: string; date: string }>,
		options?: {
			markAsSeen?: boolean;
			mailboxCheckpoint?: MailboxCheckpoint | null;
		},
	) {
		const existing = await prisma.emailAccount.findUnique({
			where: { id },
			select: { mailboxStatus: true },
		});
		if (!existing) {
			throw new AppError("NOT_FOUND", "Email account not found", 404);
		}

		const mailboxStatus = parseMailboxStatus(existing.mailboxStatus);
		const previous = mailboxStatus[mailbox] || createEmptyMailboxState();
		const { latestMessageId, latestMessageDate } =
			getLatestMailboxMessage(messages);
		const now = new Date().toISOString();

		let hasNew = false;
		if (options?.markAsSeen) {
			hasNew = false;
		} else if (!latestMessageId) {
			hasNew = false;
		} else if (!previous.lastSyncedAt) {
			hasNew = false;
		} else if (
			previous.latestMessageId &&
			previous.latestMessageId !== latestMessageId
		) {
			hasNew = true;
		} else {
			hasNew = previous.hasNew;
		}

		mailboxStatus[mailbox] = {
			latestMessageId,
			latestMessageDate,
			messageCount: messages.length,
			hasNew,
			lastSyncedAt: now,
			lastViewedAt: options?.markAsSeen ? now : previous.lastViewedAt,
			uidValidity:
				options?.mailboxCheckpoint?.uidValidity ?? previous.uidValidity,
			lastUid: options?.mailboxCheckpoint?.lastUid ?? previous.lastUid,
		};

		await prisma.emailAccount.update({
			where: { id },
			data: {
				mailboxStatus: toMailboxStatusJson(mailboxStatus),
			},
		});

		return mailboxStatus;
	},

	async updateResolvedMailboxFolder(
		id: number,
		mailbox: EmailMailboxName,
		resolvedMailbox: string,
	) {
		if (!resolvedMailbox.trim()) {
			return null;
		}

		const existing = await prisma.emailAccount.findUnique({
			where: { id },
			select: { provider: true, authType: true, providerConfig: true },
		});
		if (!existing) {
			throw new AppError("NOT_FOUND", "Email account not found", 404);
		}

		const providerProfile = resolveProviderProfile(
			existing.provider,
			existing.authType,
		);
		const providerConfig = mergeProviderConfigForProfile(
			providerProfile,
			parseJsonObject(existing.providerConfig) as
				| MailProviderConfig
				| null
				| undefined,
		);
		const folderKey =
			mailbox.toLowerCase() === "sent"
				? "sent"
				: mailbox.toLowerCase() === "junk"
					? "junk"
					: "inbox";

		if (providerConfig.folders?.[folderKey] === resolvedMailbox) {
			return providerConfig;
		}

		const nextConfig: MailProviderConfig = {
			...providerConfig,
			folders: {
				...(providerConfig.folders || {}),
				[folderKey]: resolvedMailbox,
			},
		};

		await prisma.emailAccount.update({
			where: { id },
			data: {
				providerConfig: sanitizeProviderConfig(providerProfile, nextConfig),
			},
		});

		return nextConfig;
	},

	async clearMailboxStatus(id: number, mailbox: EmailMailboxName) {
		const existing = await prisma.emailAccount.findUnique({
			where: { id },
			select: { mailboxStatus: true },
		});
		if (!existing) {
			throw new AppError("NOT_FOUND", "Email account not found", 404);
		}

		const mailboxStatus = parseMailboxStatus(existing.mailboxStatus);
		const now = new Date().toISOString();
		mailboxStatus[mailbox] = {
			latestMessageId: null,
			latestMessageDate: null,
			messageCount: 0,
			hasNew: false,
			lastSyncedAt: now,
			lastViewedAt: now,
			uidValidity: null,
			lastUid: null,
		};

		await prisma.emailAccount.update({
			where: { id },
			data: {
				mailboxStatus: toMailboxStatusJson(mailboxStatus),
			},
		});

		return mailboxStatus;
	},

	toMailCredentials(
		account: {
			id: number;
			email: string;
			provider: EmailProvider;
			authType: EmailAuthType;
			clientId?: string | null;
			clientSecret?: string | null;
			refreshToken?: string | null;
			password?: string | null;
			providerConfig?: Record<string, unknown> | null;
			capabilities?: Record<string, unknown> | null;
			fetchStrategy?: MailFetchStrategy;
		},
		autoAssigned = false,
	): MailCredentials {
		return enrichMailCredentials({
			id: account.id,
			email: account.email,
			provider: account.provider,
			authType: account.authType,
			clientId: account.clientId || undefined,
			clientSecret: account.clientSecret || undefined,
			refreshToken: account.refreshToken || undefined,
			password: account.password || undefined,
			autoAssigned,
			fetchStrategy: account.fetchStrategy,
			providerConfig: account.providerConfig as
				| MailProviderConfig
				| null
				| undefined,
			capabilities: account.capabilities || null,
		});
	},

	async create(input: CreateEmailInput) {
		const normalized = normalizeCreateInput(input);
		const {
			email,
			provider,
			authType,
			clientId,
			refreshToken,
			clientSecret,
			password,
			accountLoginPassword,
			groupId,
			providerConfig,
			capabilities,
		} = normalized;
		const exists = await prisma.emailAccount.findUnique({ where: { email } });
		if (exists)
			throw new AppError("DUPLICATE_EMAIL", "Email already exists", 400);

		return prisma.emailAccount.create({
			data: {
				email,
				provider,
				authType,
				clientId: clientId || null,
				refreshToken: encryptOptional(refreshToken),
				clientSecret: encryptOptional(clientSecret),
				password: encryptOptional(password),
				accountLoginPassword: encryptOptional(accountLoginPassword),
				groupId: groupId || null,
				providerConfig,
				capabilities,
			},
			select: {
				id: true,
				email: true,
				provider: true,
				authType: true,
				clientId: true,
				status: true,
				groupId: true,
				createdAt: true,
			},
		});
	},

	async update(id: number, input: UpdateEmailInput) {
		const exists = await prisma.emailAccount.findUnique({ where: { id } });
		if (!exists)
			throw new AppError("NOT_FOUND", "Email account not found", 404);
		const provider = input.provider || (exists.provider as EmailProvider);
		const authType = input.authType || (exists.authType as EmailAuthType);
		const providerProfile = resolveProviderProfile(provider, authType);
		const updateData: Prisma.EmailAccountUncheckedUpdateInput = {
			email: input.email,
			provider,
			authType,
			status: input.status,
			groupId: input.groupId === undefined ? undefined : input.groupId,
		};
		if (input.clientId !== undefined)
			updateData.clientId = input.clientId || null;
		if (input.refreshToken !== undefined)
			updateData.refreshToken = encryptOptional(input.refreshToken);
		if (input.clientSecret !== undefined)
			updateData.clientSecret = encryptOptional(
				input.clientSecret || undefined,
			);
		if (input.password !== undefined)
			updateData.password = encryptOptional(
				typeof input.password === "string" ? input.password : undefined,
			);
		if (input.accountLoginPassword !== undefined)
			updateData.accountLoginPassword = encryptOptional(
				typeof input.accountLoginPassword === "string"
					? input.accountLoginPassword
					: undefined,
			);
		if (input.providerConfig !== undefined)
			updateData.providerConfig = sanitizeProviderConfig(
				providerProfile,
				input.providerConfig ?? null,
			);
		if (input.capabilities !== undefined)
			updateData.capabilities =
				input.capabilities === null
					? Prisma.JsonNull
					: sanitizeCapabilities(input.capabilities);

		return prisma.emailAccount.update({
			where: { id },
			data: updateData,
			select: {
				id: true,
				email: true,
				provider: true,
				authType: true,
				clientId: true,
				status: true,
				updatedAt: true,
			},
		});
	},

	async updateStatus(
		id: number,
		status: "ACTIVE" | "ERROR" | "DISABLED",
		errorMessage?: string | null,
	) {
		await prisma.emailAccount.update({
			where: { id },
			data: {
				status,
				errorMessage: errorMessage || null,
				lastCheckAt: new Date(),
			},
		});
	},

	async delete(id: number) {
		const exists = await prisma.emailAccount.findUnique({ where: { id } });
		if (!exists)
			throw new AppError("NOT_FOUND", "Email account not found", 404);
		await prisma.emailAccount.delete({ where: { id } });
		return { success: true };
	},

	async batchDelete(ids: number[]) {
		await prisma.emailAccount.deleteMany({ where: { id: { in: ids } } });
		return { deleted: ids.length };
	},

	async import(input: ImportEmailInput) {
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
	},

	async export(
		ids?: number[],
		separator = "----",
		groupId?: number,
		rawSecrets = false,
	) {
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
			const profile = resolveProviderProfile(
				account.provider,
				account.authType,
			);
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
	},

	async getStats() {
		const [total, active, error, providerCounts] = await Promise.all([
			prisma.emailAccount.count(),
			prisma.emailAccount.count({ where: { status: "ACTIVE" } }),
			prisma.emailAccount.count({ where: { status: "ERROR" } }),
			Promise.all(
				emailProviders.map(
					async (provider) =>
						[
							provider,
							await prisma.emailAccount.count({ where: { provider } }),
						] as const,
				),
			),
		]);
		return {
			total,
			active,
			error,
			providers: Object.fromEntries(providerCounts) as Record<
				EmailProvider,
				number
			>,
		};
	},
};
