import { randomBytes } from "node:crypto";
import { proxyFetch } from "../../lib/proxy.js";
import { getRedis } from "../../lib/redis.js";
import { AppError } from "../../plugins/error.js";
import { mailService } from "../mail/mail.service.js";
import {
	getDefaultAuthType,
	mergeProviderConfig,
} from "../mail/providers/types.js";
import { emailOAuthConfigService } from "./email.oauth-config.service.js";
import { emailService } from "./email.service.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const GMAIL_PROFILE_URL =
	"https://gmail.googleapis.com/gmail/v1/users/me/profile";
const MICROSOFT_GRAPH_ME_URL =
	"https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName";
const OAUTH_STATE_TTL_SECONDS = 10 * 60;
const OAUTH_RESULT_TTL_SECONDS = 15 * 60;
const GOOGLE_DEFAULT_SCOPES =
	"openid email profile https://www.googleapis.com/auth/gmail.modify https://mail.google.com/";
const MICROSOFT_DEFAULT_SCOPES =
	"offline_access openid profile email https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Contacts.ReadWrite https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/MailboxSettings.ReadWrite";

type OAuthProvider = "GMAIL" | "OUTLOOK";
type OAuthResultStatus = "success" | "warning" | "error";
type OAuthStatusPhase = "pending" | "processing" | "completed" | "expired";

interface OAuthStateRecord {
	adminId: number;
	provider: OAuthProvider;
	groupId?: number;
	emailId?: number;
	createdAt: number;
}

interface OAuthProviderConfig {
	provider: OAuthProvider;
	providerLabel: string;
	clientId: string;
	clientSecret: string;
	redirectUri: string;
	authUrl: string;
	tokenUrl: string;
	scopes: string;
	prompt?: string;
}

interface OAuthCompletionResult {
	provider: OAuthProvider;
	status: OAuthResultStatus;
	code: string;
	email?: string;
	action?: string;
}

interface OAuthStatusSnapshot {
	adminId: number;
	provider: OAuthProvider;
	phase: "processing" | "completed";
	createdAt: number;
	expiresAt: number;
	completedAt?: number;
	result?: OAuthCompletionResult;
}

interface OAuthStatusResult {
	provider: OAuthProvider;
	state: string;
	status: OAuthStatusPhase;
	expiresAt?: number;
	completedAt?: number;
	result?: OAuthCompletionResult;
}

const localOAuthStateStore = new Map<
	string,
	OAuthStateRecord & { expiresAt: number }
>();
const localOAuthStatusStore = new Map<string, OAuthStatusSnapshot>();

function cleanupExpiredLocalState() {
	const now = Date.now();
	for (const [key, value] of Array.from(localOAuthStateStore.entries())) {
		if (value.expiresAt <= now) {
			localOAuthStateStore.delete(key);
		}
	}
}

function cleanupExpiredLocalStatus() {
	const now = Date.now();
	for (const [key, value] of Array.from(localOAuthStatusStore.entries())) {
		if (value.expiresAt <= now) {
			localOAuthStatusStore.delete(key);
		}
	}
}

function buildOAuthStateKey(state: string): string {
	return `admin:oauth:state:${state}`;
}

function buildOAuthStatusKey(state: string): string {
	return `admin:oauth:status:${state}`;
}

async function saveOAuthState(
	state: string,
	value: OAuthStateRecord,
): Promise<void> {
	const redis = getRedis();
	const payload = JSON.stringify(value);
	if (redis) {
		try {
			await redis.setex(
				buildOAuthStateKey(state),
				OAUTH_STATE_TTL_SECONDS,
				payload,
			);
			return;
		} catch {
			// 回退到本地状态存储
		}
	}

	cleanupExpiredLocalState();
	localOAuthStateStore.set(state, {
		...value,
		expiresAt: Date.now() + OAUTH_STATE_TTL_SECONDS * 1000,
	});
}

async function takeOAuthState(state: string): Promise<OAuthStateRecord | null> {
	const redis = getRedis();
	if (redis) {
		try {
			const key = buildOAuthStateKey(state);
			const payload = await redis.get(key);
			if (!payload) {
				return null;
			}
			await redis.del(key);
			return JSON.parse(payload) as OAuthStateRecord;
		} catch {
			// 回退到本地状态存储
		}
	}

	cleanupExpiredLocalState();
	const local = localOAuthStateStore.get(state);
	if (!local) {
		return null;
	}
	localOAuthStateStore.delete(state);
	return {
		adminId: local.adminId,
		provider: local.provider,
		groupId: local.groupId,
		emailId: local.emailId,
		createdAt: local.createdAt,
	};
}

async function peekOAuthState(state: string): Promise<OAuthStateRecord | null> {
	const redis = getRedis();
	if (redis) {
		try {
			const payload = await redis.get(buildOAuthStateKey(state));
			if (!payload) {
				return null;
			}
			return JSON.parse(payload) as OAuthStateRecord;
		} catch {
			// 回退到本地状态存储
		}
	}

	cleanupExpiredLocalState();
	const local = localOAuthStateStore.get(state);
	if (!local) {
		return null;
	}
	return {
		adminId: local.adminId,
		provider: local.provider,
		groupId: local.groupId,
		emailId: local.emailId,
		createdAt: local.createdAt,
	};
}

async function saveOAuthStatusSnapshot(
	state: string,
	value: OAuthStatusSnapshot,
): Promise<void> {
	const redis = getRedis();
	const payload = JSON.stringify(value);
	const ttlSeconds = Math.max(
		60,
		Math.ceil((value.expiresAt - Date.now()) / 1000),
	);
	if (redis) {
		try {
			await redis.setex(buildOAuthStatusKey(state), ttlSeconds, payload);
			return;
		} catch {
			// 回退到本地状态存储
		}
	}

	cleanupExpiredLocalStatus();
	localOAuthStatusStore.set(state, value);
}

async function getOAuthStatusSnapshot(
	state: string,
): Promise<OAuthStatusSnapshot | null> {
	const redis = getRedis();
	if (redis) {
		try {
			const payload = await redis.get(buildOAuthStatusKey(state));
			if (!payload) {
				return null;
			}
			return JSON.parse(payload) as OAuthStatusSnapshot;
		} catch {
			// 回退到本地状态存储
		}
	}

	cleanupExpiredLocalStatus();
	return localOAuthStatusStore.get(state) || null;
}

function normalizeOptionalNumber(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return undefined;
	}
	return value;
}

function parseJwtPayload(
	token: string | null | undefined,
): Record<string, unknown> {
	if (!token) {
		return {};
	}
	const parts = token.split(".");
	if (parts.length !== 3) {
		return {};
	}
	try {
		const payload = parts[1];
		const normalized = payload + "=".repeat((4 - (payload.length % 4)) % 4);
		return JSON.parse(
			Buffer.from(normalized, "base64url").toString("utf8"),
		) as Record<string, unknown>;
	} catch {
		return {};
	}
}

function pickString(
	record: Record<string, unknown>,
	keys: string[],
): string | null {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) {
			return value.trim();
		}
	}
	return null;
}

async function requestJson(url: string, init?: RequestInit): Promise<unknown> {
	const response = await proxyFetch(url, init);
	const text = await response.text();
	const payload = text ? (JSON.parse(text) as unknown) : null;
	if (!response.ok) {
		const record =
			typeof payload === "object" && payload
				? (payload as Record<string, unknown>)
				: {};
		const message =
			pickString(record, ["error_description", "error", "message"]) ||
			`Request failed with status ${response.status}`;
		throw new AppError("OAUTH_REMOTE_REQUEST_FAILED", message, 502);
	}
	return payload;
}

async function exchangeCode(
	providerConfig: OAuthProviderConfig,
	code: string,
): Promise<Record<string, unknown>> {
	const form = new URLSearchParams({
		client_id: providerConfig.clientId,
		client_secret: providerConfig.clientSecret,
		code,
		redirect_uri: providerConfig.redirectUri,
		grant_type: "authorization_code",
	});
	if (providerConfig.provider === "OUTLOOK") {
		form.set("scope", providerConfig.scopes);
	}

	return requestJson(providerConfig.tokenUrl, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: form.toString(),
	}) as Promise<Record<string, unknown>>;
}

async function detectGoogleEmail(
	tokenPayload: Record<string, unknown>,
): Promise<string> {
	const idTokenClaims = parseJwtPayload(pickString(tokenPayload, ["id_token"]));
	const fromClaims = pickString(idTokenClaims, [
		"email",
		"preferred_username",
		"upn",
	]);
	if (fromClaims) {
		return fromClaims;
	}

	const accessToken = pickString(tokenPayload, ["access_token"]);
	if (!accessToken) {
		throw new AppError(
			"GOOGLE_EMAIL_DETECTION_FAILED",
			"Google OAuth succeeded but email address could not be detected",
			502,
		);
	}

	try {
		const userInfo = (await requestJson(GOOGLE_USERINFO_URL, {
			headers: { Authorization: `Bearer ${accessToken}` },
		})) as Record<string, unknown>;
		const fromUserInfo = pickString(userInfo, ["email"]);
		if (fromUserInfo) {
			return fromUserInfo;
		}
	} catch {
		// 回退到 Gmail profile
	}

	const profile = (await requestJson(GMAIL_PROFILE_URL, {
		headers: { Authorization: `Bearer ${accessToken}` },
	})) as Record<string, unknown>;
	const fromProfile = pickString(profile, ["emailAddress"]);
	if (!fromProfile) {
		throw new AppError(
			"GOOGLE_EMAIL_DETECTION_FAILED",
			"Google OAuth succeeded but Gmail profile did not return an email address",
			502,
		);
	}
	return fromProfile;
}

async function detectOutlookEmail(
	tokenPayload: Record<string, unknown>,
): Promise<string> {
	const idTokenClaims = parseJwtPayload(pickString(tokenPayload, ["id_token"]));
	const fromClaims = pickString(idTokenClaims, [
		"preferred_username",
		"email",
		"upn",
	]);
	if (fromClaims) {
		return fromClaims;
	}

	const accessToken = pickString(tokenPayload, ["access_token"]);
	if (!accessToken) {
		throw new AppError(
			"OUTLOOK_EMAIL_DETECTION_FAILED",
			"Microsoft OAuth succeeded but email address could not be detected",
			502,
		);
	}

	const profile = (await requestJson(MICROSOFT_GRAPH_ME_URL, {
		headers: { Authorization: `Bearer ${accessToken}` },
	})) as Record<string, unknown>;
	const email = pickString(profile, ["mail", "userPrincipalName"]);
	if (!email) {
		throw new AppError(
			"OUTLOOK_EMAIL_DETECTION_FAILED",
			"Microsoft OAuth succeeded but profile did not return an email address",
			502,
		);
	}
	return email;
}

async function getProviderConfig(
	provider: OAuthProvider,
): Promise<OAuthProviderConfig> {
	const { config } = await emailOAuthConfigService.getEffectiveConfig(provider);
	if (!config.clientId || !config.clientSecret || !config.redirectUri) {
		throw new AppError(
			"OAUTH_CONFIG_MISSING",
			`${provider === "GMAIL" ? "Google" : "Microsoft"} OAuth is not configured on the server`,
			400,
		);
	}

	if (provider === "GMAIL") {
		return {
			provider,
			providerLabel: "Google",
			clientId: config.clientId,
			clientSecret: config.clientSecret,
			redirectUri: config.redirectUri,
			authUrl: GOOGLE_AUTH_URL,
			tokenUrl: GOOGLE_TOKEN_URL,
			scopes: config.scopes || GOOGLE_DEFAULT_SCOPES,
			prompt: "consent",
		};
	}

	const tenant = config.tenant || "consumers";
	return {
		provider,
		providerLabel: "Microsoft",
		clientId: config.clientId,
		clientSecret: config.clientSecret,
		redirectUri: config.redirectUri,
		authUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
		tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
		scopes: config.scopes || MICROSOFT_DEFAULT_SCOPES,
		prompt: "select_account",
	};
}

function buildAuthorizationUrl(
	providerConfig: OAuthProviderConfig,
	state: string,
): string {
	const params = new URLSearchParams({
		client_id: providerConfig.clientId,
		redirect_uri: providerConfig.redirectUri,
		response_type: "code",
		scope: providerConfig.scopes,
		state,
	});

	if (providerConfig.provider === "GMAIL") {
		params.set("access_type", "offline");
		params.set("include_granted_scopes", "true");
		params.set("prompt", providerConfig.prompt || "consent");
	} else {
		params.set("response_mode", "query");
		params.set("prompt", providerConfig.prompt || "select_account");
	}

	return `${providerConfig.authUrl}?${params.toString()}`;
}

function buildCallbackRedirectUrl(result: OAuthCompletionResult): string {
	const params = new URLSearchParams({
		oauth_status: result.status,
		oauth_provider: result.provider,
		oauth_code: result.code,
	});
	if (result.email) {
		params.set("oauth_email", result.email);
	}
	if (result.action) {
		params.set("oauth_action", result.action);
	}
	return `/emails?${params.toString()}`;
}

async function persistOAuthCompletion(
	state: string,
	stateRecord: OAuthStateRecord,
	result: OAuthCompletionResult,
): Promise<void> {
	await saveOAuthStatusSnapshot(state, {
		adminId: stateRecord.adminId,
		provider: stateRecord.provider,
		phase: "completed",
		createdAt: stateRecord.createdAt,
		completedAt: Date.now(),
		expiresAt: Date.now() + OAUTH_RESULT_TTL_SECONDS * 1000,
		result,
	});
}

async function upsertOAuthMailbox(input: {
	provider: OAuthProvider;
	email: string;
	clientId: string;
	clientSecret: string;
	refreshToken: string;
	groupId?: number;
	emailId?: number;
}) {
	const providerConfig = mergeProviderConfig(input.provider);
	const authType = getDefaultAuthType(input.provider);
	const exactEmail = await emailService.getByEmail(input.email);

	if (exactEmail) {
		const updated = await emailService.update(exactEmail.id, {
			email: input.email,
			provider: input.provider,
			authType,
			clientId: input.clientId,
			clientSecret: input.clientSecret,
			refreshToken: input.refreshToken,
			password: null,
			status: "ACTIVE",
			groupId: input.groupId ?? exactEmail.groupId ?? null,
			providerConfig,
		});
		return {
			id: updated.id,
			email: updated.email,
			action: "updated_exact_email",
		};
	}

	if (input.emailId) {
		try {
			const target = await emailService.getById(input.emailId, false);
			if (
				target.email.trim().toLowerCase() === input.email.trim().toLowerCase()
			) {
				const updated = await emailService.update(target.id, {
					email: input.email,
					provider: input.provider,
					authType,
					clientId: input.clientId,
					clientSecret: input.clientSecret,
					refreshToken: input.refreshToken,
					password: null,
					status: "ACTIVE",
					groupId: input.groupId ?? target.groupId ?? null,
					providerConfig,
				});
				return {
					id: updated.id,
					email: updated.email,
					action: "updated_target_id",
				};
			}
		} catch {
			// 指定邮箱不存在时回退为新建
		}
	}

	const created = await emailService.create({
		email: input.email,
		provider: input.provider,
		authType,
		clientId: input.clientId,
		clientSecret: input.clientSecret,
		refreshToken: input.refreshToken,
		groupId: input.groupId,
		providerConfig,
	});
	return { id: created.id, email: created.email, action: "created_new_email" };
}

async function verifyOAuthMailbox(emailId: number) {
	const detail = await emailService.getById(emailId, true);
	const credentials = mailService.buildCredentialsFromRecord(
		{
			...detail,
			fetchStrategy: detail.group?.fetchStrategy,
		},
		false,
	);
	try {
		const result = await mailService.getEmails(credentials, {
			mailbox: "INBOX",
			limit: 1,
		});
		await emailService.updateStatus(emailId, "ACTIVE", null);
		return {
			ok: true,
			count: result.count,
			method: result.method,
		};
	} catch (error) {
		const message =
			error instanceof Error && error.message
				? error.message
				: "Mailbox verification failed";
		await emailService.updateStatus(emailId, "ERROR", message);
		return {
			ok: false,
			message,
		};
	}
}

function parseProvider(value: string): OAuthProvider {
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

export const emailOAuthService = {
	parseProvider,

	async getProviderStatuses() {
		return emailOAuthConfigService.listConfigSummaries();
	},

	async startAuthorization(input: {
		provider: string;
		adminId: number;
		groupId?: number;
		emailId?: number;
	}) {
		const provider = parseProvider(input.provider);
		const providerConfig = await getProviderConfig(provider);
		const state = randomBytes(24).toString("base64url");
		const createdAt = Date.now();
		await saveOAuthState(state, {
			adminId: input.adminId,
			provider,
			groupId: normalizeOptionalNumber(input.groupId),
			emailId: normalizeOptionalNumber(input.emailId),
			createdAt,
		});

		return {
			provider,
			state,
			authUrl: buildAuthorizationUrl(providerConfig, state),
			expiresIn: OAUTH_STATE_TTL_SECONDS,
			expiresAt: createdAt + OAUTH_STATE_TTL_SECONDS * 1000,
		};
	},

	async getAuthorizationStatus(input: {
		provider: string;
		state: string;
		adminId: number;
	}): Promise<OAuthStatusResult> {
		const provider = parseProvider(input.provider);
		const state = input.state.trim();
		const completion = await getOAuthStatusSnapshot(state);
		if (completion && completion.provider === provider) {
			if (completion.adminId !== input.adminId) {
				throw new AppError(
					"OAUTH_STATUS_FORBIDDEN",
					"OAuth status does not belong to current admin",
					403,
				);
			}
			return {
				provider,
				state,
				status: completion.phase,
				expiresAt: completion.expiresAt,
				completedAt: completion.completedAt,
				result: completion.result,
			};
		}

		const pending = await peekOAuthState(state);
		if (!pending || pending.provider !== provider) {
			return {
				provider,
				state,
				status: "expired",
			};
		}
		if (pending.adminId !== input.adminId) {
			throw new AppError(
				"OAUTH_STATUS_FORBIDDEN",
				"OAuth status does not belong to current admin",
				403,
			);
		}
		return {
			provider,
			state,
			status: "pending",
			expiresAt: pending.createdAt + OAUTH_STATE_TTL_SECONDS * 1000,
		};
	},

	async completeAuthorization(input: {
		provider: string;
		state?: string;
		code?: string;
		error?: string;
		errorDescription?: string;
	}): Promise<OAuthCompletionResult> {
		const provider = parseProvider(input.provider);

		if (!input.state) {
			return {
				provider,
				status: "error",
				code: "OAUTH_CALLBACK_MISSING_STATE",
			};
		}

		const stateRecord = await takeOAuthState(input.state);
		if (!stateRecord || stateRecord.provider !== provider) {
			return {
				provider,
				status: "error",
				code: "OAUTH_STATE_INVALID",
			};
		}

		await saveOAuthStatusSnapshot(input.state, {
			adminId: stateRecord.adminId,
			provider,
			phase: "processing",
			createdAt: stateRecord.createdAt,
			expiresAt: Date.now() + OAUTH_RESULT_TTL_SECONDS * 1000,
		});

		if (input.error) {
			const result: OAuthCompletionResult = {
				provider,
				status: "error",
				code: "OAUTH_PROVIDER_AUTH_FAILED",
			};
			await persistOAuthCompletion(input.state, stateRecord, result);
			return result;
		}

		if (!input.code) {
			const result: OAuthCompletionResult = {
				provider,
				status: "error",
				code: "OAUTH_CALLBACK_MISSING_CODE",
			};
			await persistOAuthCompletion(input.state, stateRecord, result);
			return result;
		}

		try {
			const providerConfig = await getProviderConfig(provider);
			const tokenPayload = await exchangeCode(providerConfig, input.code);
			const email =
				provider === "GMAIL"
					? await detectGoogleEmail(tokenPayload)
					: await detectOutlookEmail(tokenPayload);
			const refreshToken = pickString(tokenPayload, ["refresh_token"]);
			if (!refreshToken) {
				throw new AppError(
					"OAUTH_REFRESH_TOKEN_MISSING",
					`${providerConfig.providerLabel} OAuth succeeded but refresh token is missing`,
					502,
				);
			}

			const mailbox = await upsertOAuthMailbox({
				provider,
				email,
				clientId: providerConfig.clientId,
				clientSecret: providerConfig.clientSecret,
				refreshToken,
				groupId: stateRecord.groupId,
				emailId: stateRecord.emailId,
			});
			const verifyResult = await verifyOAuthMailbox(mailbox.id);

			if (!verifyResult.ok) {
				const result: OAuthCompletionResult = {
					provider,
					status: "warning",
					email,
					action: mailbox.action,
					code: "OAUTH_AUTHORIZED_VERIFY_FAILED",
				};
				await persistOAuthCompletion(input.state, stateRecord, result);
				return result;
			}

			const result: OAuthCompletionResult = {
				provider,
				status: "success",
				email,
				action: mailbox.action,
				code: "OAUTH_AUTHORIZED_SUCCESS",
			};
			await persistOAuthCompletion(input.state, stateRecord, result);
			return result;
		} catch (error) {
			const code =
				error instanceof AppError ? error.code : "OAUTH_PROCESS_FAILED";
			const result: OAuthCompletionResult = {
				provider,
				status: "error",
				code,
			};
			await persistOAuthCompletion(input.state, stateRecord, result);
			return result;
		}
	},

	buildRedirectUrl(result: OAuthCompletionResult) {
		return buildCallbackRedirectUrl(result);
	},
};
