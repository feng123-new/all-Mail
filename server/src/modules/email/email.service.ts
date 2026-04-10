import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma.js";
import { AppError } from "../../plugins/error.js";
import {
	type EmailAuthType,
	type EmailProvider,
	emailProviders,
	enrichMailCredentials,
	getDefaultAuthType,
	getProfilesForRepresentativeProtocol,
	getProviderProfileMetadata,
	getProviderProfileSummary,
	type MailCredentials,
	type MailFetchStrategy,
	type MailProviderConfig,
	mergeProviderConfigForProfile,
	type RepresentativeProtocol,
	resolveProviderProfile,
} from "../mail/providers/types.js";
import { exportEmails, importEmails } from "./email.import-export.js";
import {
	clearMailboxStatus,
	type EmailMailboxName,
	parseMailboxStatus,
	updateMailboxStatus,
} from "./email.mailbox-status.js";
import type {
	CreateEmailInput,
	ImportEmailInput,
	ListEmailInput,
	RevealEmailSecretsInput,
	UpdateEmailInput,
} from "./email.schema.js";
import {
	decryptOptional,
	encryptOptional,
	parseJsonObject,
	sanitizeCapabilities,
	sanitizeProviderConfig,
} from "./email.service.helpers.js";

export type {
	EmailMailboxName,
	EmailMailboxState,
	EmailMailboxStatus,
} from "./email.mailbox-status.js";

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

export type RevealableEmailSecretField =
	RevealEmailSecretsInput["fields"][number];

export interface EmailSecretRevealResult {
	secrets: Partial<Record<RevealableEmailSecretField, string | null>>;
	availableFields: RevealableEmailSecretField[];
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

function getAllowedRevealFields(
	account: Pick<EmailAccountView, "provider" | "authType">,
): RevealableEmailSecretField[] {
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
	const hasStoredAccountLoginPassword = Boolean(
		account.accountLoginPassword?.trim(),
	);
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

	async revealSecrets(
		id: number,
		fields: RevealEmailSecretsInput["fields"],
	): Promise<EmailSecretRevealResult> {
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
		const availableFields = getAllowedRevealFields(
			email as Pick<EmailAccountView, "provider" | "authType">,
		);
		for (const field of uniqueFields) {
			if (!availableFields.includes(field)) {
				throw new AppError(
					"SECRET_REVEAL_NOT_ALLOWED",
					`${field} is not available for this mailbox auth flow`,
					400,
				);
			}
		}

		const secrets: Partial<Record<RevealableEmailSecretField, string | null>> =
			{};
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
			secrets[field] =
				field === "refreshToken"
					? (decryptOptional(email.refreshToken) ?? null)
					: field === "accountLoginPassword"
						? (decryptOptional(email.accountLoginPassword) ?? null)
						: (decryptOptional(email.password) ?? null);
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

	updateMailboxStatus,

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

	clearMailboxStatus,

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
		return importEmails(input);
	},

	async export(
		ids?: number[],
		separator = "----",
		groupId?: number,
		rawSecrets = false,
	) {
		return exportEmails({ ids, separator, groupId, rawSecrets });
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
