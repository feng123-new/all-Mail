import { readFile } from "node:fs/promises";
import { env } from "../../config/env.js";
import { decrypt, encrypt } from "../../lib/crypto.js";
import prisma from "../../lib/prisma.js";
import { AppError } from "../../plugins/error.js";
export type ManagedOAuthProvider = "GMAIL" | "OUTLOOK";

interface ProviderConfigRecord {
	provider: ManagedOAuthProvider;
	clientId?: string | null;
	clientSecret?: string | null;
	redirectUri?: string | null;
	scopes?: string | null;
	tenant?: string | null;
}

export interface ProviderConfigSummary {
	provider: ManagedOAuthProvider;
	configured: boolean;
	source: "database" | "environment" | "none";
	clientId: string | null;
	redirectUri: string | null;
	scopes: string | null;
	tenant: string | null;
	hasClientSecret: boolean;
}

interface SaveProviderConfigInput {
	provider: ManagedOAuthProvider;
	clientId?: string | null;
	clientSecret?: string | null;
	redirectUri?: string | null;
	scopes?: string | null;
	tenant?: string | null;
}

interface ParsedGoogleClientSecret {
	clientId: string;
	clientSecret: string;
	redirectUri: string;
	redirectUris: string[];
	projectId: string | null;
}

function normalizeScopeList(value: string): string[] {
	return Array.from(
		new Set(
			value
				.split(/\s+/)
				.map((item) => item.trim())
				.filter(Boolean),
		),
	);
}

function normalizeOptionalString(
	value: string | null | undefined,
): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function normalizeProviderRedirectUri(
	provider: ManagedOAuthProvider,
	value: string | null | undefined,
): string | null {
	const normalized = normalizeOptionalString(value);
	if (provider !== "OUTLOOK" || !normalized) {
		return normalized;
	}

	try {
		const parsed = new URL(normalized);
		if (
			parsed.protocol === "https:" &&
			(parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
		) {
			parsed.protocol = "http:";
			return parsed.toString();
		}
	} catch {
		return normalized;
	}

	return normalized;
}

function normalizeProviderScopes(
	provider: ManagedOAuthProvider,
	value: string | null | undefined,
): string | null {
	const normalized = normalizeOptionalString(value);
	if (provider !== "OUTLOOK" || !normalized) {
		return normalized;
	}
	return normalizeScopeList(normalized).join(" ");
}

function parseManagedProvider(value: string): ManagedOAuthProvider {
	const normalized = value.trim().toUpperCase();
	if (normalized === "GMAIL" || normalized === "GOOGLE") {
		return "GMAIL";
	}
	if (normalized === "OUTLOOK" || normalized === "MICROSOFT") {
		return "OUTLOOK";
	}
	throw new AppError(
		"OAUTH_PROVIDER_UNSUPPORTED",
		`Unsupported OAuth provider: ${value}`,
		400,
	);
}

function decryptOptionalSecret(
	encrypted: string | null | undefined,
): string | null {
	if (!encrypted) {
		return null;
	}
	try {
		return decrypt(encrypted);
	} catch {
		throw new AppError(
			"OAUTH_CONFIG_INVALID",
			"Stored OAuth client secret is invalid",
			500,
		);
	}
}

function buildEnvConfig(provider: ManagedOAuthProvider): ProviderConfigRecord {
	if (provider === "GMAIL") {
		return {
			provider,
			clientId: normalizeOptionalString(env.GOOGLE_OAUTH_CLIENT_ID),
			clientSecret: normalizeOptionalString(env.GOOGLE_OAUTH_CLIENT_SECRET),
			redirectUri: normalizeProviderRedirectUri(
				provider,
				env.GOOGLE_OAUTH_REDIRECT_URI,
			),
			scopes: normalizeOptionalString(env.GOOGLE_OAUTH_SCOPES),
			tenant: null,
		};
	}

	return {
		provider,
		clientId: normalizeOptionalString(env.MICROSOFT_OAUTH_CLIENT_ID),
		clientSecret: normalizeOptionalString(env.MICROSOFT_OAUTH_CLIENT_SECRET),
		redirectUri: normalizeProviderRedirectUri(
			provider,
			env.MICROSOFT_OAUTH_REDIRECT_URI,
		),
		scopes: normalizeProviderScopes(provider, env.MICROSOFT_OAUTH_SCOPES),
		tenant: normalizeOptionalString(env.MICROSOFT_OAUTH_TENANT),
	};
}

function isProviderConfigured(config: ProviderConfigRecord): boolean {
	return Boolean(config.clientId && config.clientSecret && config.redirectUri);
}

async function getDatabaseConfig(
	provider: ManagedOAuthProvider,
): Promise<ProviderConfigRecord | null> {
	const record = await prisma.providerOAuthConfig.findUnique({
		where: { provider },
		select: {
			provider: true,
			clientId: true,
			clientSecret: true,
			redirectUri: true,
			scopes: true,
			tenant: true,
		},
	});

	if (!record) {
		return null;
	}

	return {
		provider,
		clientId: normalizeOptionalString(record.clientId),
		clientSecret: decryptOptionalSecret(record.clientSecret),
		redirectUri: normalizeProviderRedirectUri(provider, record.redirectUri),
		scopes: normalizeProviderScopes(provider, record.scopes),
		tenant: normalizeOptionalString(record.tenant),
	};
}

function toSummary(
	config: ProviderConfigRecord,
	source: ProviderConfigSummary["source"],
): ProviderConfigSummary {
	return {
		provider: config.provider,
		configured: isProviderConfigured(config),
		source,
		clientId: config.clientId || null,
		redirectUri: config.redirectUri || null,
		scopes: config.scopes || null,
		tenant: config.tenant || null,
		hasClientSecret: Boolean(config.clientSecret),
	};
}

function parseGoogleClientSecretJson(
	input: string,
	callbackUri?: string | null,
): ParsedGoogleClientSecret {
	const parsed = JSON.parse(input) as {
		web?: {
			client_id?: unknown;
			client_secret?: unknown;
			redirect_uris?: unknown;
			project_id?: unknown;
		};
	};
	const webClient = parsed.web;
	if (!webClient || typeof webClient !== "object") {
		throw new AppError(
			"GOOGLE_CLIENT_SECRET_JSON_INVALID",
			"Google client secret JSON must contain a web object",
			400,
		);
	}

	const clientId = normalizeOptionalString(
		typeof webClient.client_id === "string" ? webClient.client_id : null,
	);
	const clientSecret = normalizeOptionalString(
		typeof webClient.client_secret === "string"
			? webClient.client_secret
			: null,
	);
	const redirectUris = Array.isArray(webClient.redirect_uris)
		? webClient.redirect_uris
				.filter(
					(item): item is string =>
						typeof item === "string" && item.trim().length > 0,
				)
				.map((item) => item.trim())
		: [];

	if (!clientId || !clientSecret || redirectUris.length === 0) {
		throw new AppError(
			"GOOGLE_CLIENT_SECRET_JSON_INVALID",
			"Google client secret JSON is missing client_id, client_secret, or redirect_uris",
			400,
		);
	}

	const normalizedCallbackUri = normalizeOptionalString(callbackUri);
	if (normalizedCallbackUri && !redirectUris.includes(normalizedCallbackUri)) {
		throw new AppError(
			"GOOGLE_REDIRECT_URI_MISMATCH",
			`Callback URI does not exist in Google client secret JSON. Available redirect URIs: ${redirectUris.join(", ")}`,
			400,
		);
	}

	return {
		clientId,
		clientSecret,
		redirectUri: normalizedCallbackUri || redirectUris[0],
		redirectUris,
		projectId: normalizeOptionalString(
			typeof webClient.project_id === "string" ? webClient.project_id : null,
		),
	};
}

export const emailOAuthConfigService = {
	parseProvider: parseManagedProvider,

	async getEffectiveConfig(provider: string): Promise<{
		config: ProviderConfigRecord;
		source: ProviderConfigSummary["source"];
	}> {
		const normalizedProvider = parseManagedProvider(provider);
		const databaseConfig = await getDatabaseConfig(normalizedProvider);
		if (databaseConfig && isProviderConfigured(databaseConfig)) {
			return { config: databaseConfig, source: "database" };
		}

		const envConfig = buildEnvConfig(normalizedProvider);
		if (isProviderConfigured(envConfig)) {
			return { config: envConfig, source: "environment" };
		}

		return { config: { provider: normalizedProvider }, source: "none" };
	},

	async listConfigSummaries(): Promise<
		Record<ManagedOAuthProvider, ProviderConfigSummary>
	> {
		const gmail = await this.getEffectiveConfig("GMAIL");
		const outlook = await this.getEffectiveConfig("OUTLOOK");
		return {
			GMAIL: toSummary(gmail.config, gmail.source),
			OUTLOOK: toSummary(outlook.config, outlook.source),
		};
	},

	async saveProviderConfig(
		input: SaveProviderConfigInput,
	): Promise<ProviderConfigSummary> {
		const provider = parseManagedProvider(input.provider);
		const current = await getDatabaseConfig(provider);
		const nextClientId =
			input.clientId === undefined
				? current?.clientId || null
				: normalizeOptionalString(input.clientId);
		const nextRedirectUri =
			input.redirectUri === undefined
				? current?.redirectUri || null
				: normalizeProviderRedirectUri(provider, input.redirectUri);
		const nextScopes =
			input.scopes === undefined
				? current?.scopes || null
				: normalizeProviderScopes(provider, input.scopes);
		const nextTenant =
			provider === "OUTLOOK"
				? input.tenant === undefined
					? current?.tenant || null
					: normalizeOptionalString(input.tenant)
				: null;
		const nextClientSecret =
			input.clientSecret !== undefined
				? normalizeOptionalString(input.clientSecret)
				: current?.clientSecret || null;

		const upserted = await prisma.providerOAuthConfig.upsert({
			where: { provider },
			update: {
				clientId: nextClientId,
				clientSecret: nextClientSecret ? encrypt(nextClientSecret) : null,
				redirectUri: nextRedirectUri,
				scopes: nextScopes,
				tenant: nextTenant,
			},
			create: {
				provider,
				clientId: nextClientId,
				clientSecret: nextClientSecret ? encrypt(nextClientSecret) : null,
				redirectUri: nextRedirectUri,
				scopes: nextScopes,
				tenant: nextTenant,
			},
			select: {
				provider: true,
				clientId: true,
				clientSecret: true,
				redirectUri: true,
				scopes: true,
				tenant: true,
			},
		});

		return toSummary(
			{
				provider,
				clientId: normalizeOptionalString(upserted.clientId),
				clientSecret: decryptOptionalSecret(upserted.clientSecret),
				redirectUri: normalizeProviderRedirectUri(
					provider,
					upserted.redirectUri,
				),
				scopes: normalizeProviderScopes(provider, upserted.scopes),
				tenant: normalizeOptionalString(upserted.tenant),
			},
			"database",
		);
	},

	async parseGoogleClientSecret(input: {
		filePath?: string | null;
		jsonText?: string | null;
		callbackUri?: string | null;
	}): Promise<ParsedGoogleClientSecret> {
		const jsonText = normalizeOptionalString(input.jsonText);
		if (jsonText) {
			return parseGoogleClientSecretJson(jsonText, input.callbackUri);
		}

		const filePath = normalizeOptionalString(input.filePath);
		if (!filePath) {
			throw new AppError(
				"GOOGLE_CLIENT_SECRET_SOURCE_REQUIRED",
				"Provide either Google client secret JSON text or a readable file path",
				400,
			);
		}

		let fileContent: string;
		try {
			fileContent = await readFile(filePath, "utf8");
		} catch {
			throw new AppError(
				"GOOGLE_CLIENT_SECRET_PATH_UNREADABLE",
				`Cannot read Google client secret JSON from path: ${filePath}`,
				400,
			);
		}

		return parseGoogleClientSecretJson(fileContent, input.callbackUri);
	},
};
