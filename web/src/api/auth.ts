import type { Admin } from "../stores/authStore";
import type { MailboxUser } from "../stores/mailboxAuthStore";
import {
	type ApiPagedList,
	MAILBOX_PORTAL_PREFIX,
	requestGet,
	requestPost,
	requestPut,
} from "./core";

export interface MailboxPortalTwoFactorStatus {
	enabled: boolean;
	pending: boolean;
}

export interface MailboxPortalTwoFactorSetup {
	secret: string;
	otpauthUrl: string;
}

export interface MailboxPortalTwoFactorResult {
	enabled: boolean;
}

export const authApi = {
	login: (username: string, password: string, otp?: string) =>
		requestPost<
			{ admin: Admin },
			{ username: string; password: string; otp?: string }
		>("/admin/auth/login", { username, password, otp }),

	logout: () => requestPost<Record<string, unknown>>("/admin/auth/logout"),

	getMe: () => requestGet<Admin>("/admin/auth/me"),

	changePassword: (oldPassword: string, newPassword: string) =>
		requestPost<
			Record<string, unknown>,
			{ oldPassword: string; newPassword: string }
		>("/admin/auth/change-password", { oldPassword, newPassword }),

	getTwoFactorStatus: () =>
		requestGet<{ enabled: boolean; pending: boolean }>(
			"/admin/auth/2fa/status",
		),

	setupTwoFactor: () =>
		requestPost<{ secret: string; otpauthUrl: string }>(
			"/admin/auth/2fa/setup",
		),

	enableTwoFactor: (otp: string) =>
		requestPost<{ enabled: boolean }, { otp: string }>(
			"/admin/auth/2fa/enable",
			{ otp },
		),

	disableTwoFactor: (password: string, otp: string) =>
		requestPost<{ enabled: boolean }, { password: string; otp: string }>(
			"/admin/auth/2fa/disable",
			{ password, otp },
		),
};

export const oauthApi = {
	getProviderStatuses: () =>
		requestGet<{
			GMAIL: {
				configured: boolean;
				redirectUri: string | null;
				source: "database" | "environment" | "none";
				clientId: string | null;
				scopes: string | null;
				scopeProfile: "minimal" | "send" | "manage" | "full";
				tenant: string | null;
				hasClientSecret: boolean;
			};
			OUTLOOK: {
				configured: boolean;
				redirectUri: string | null;
				source: "database" | "environment" | "none";
				clientId: string | null;
				scopes: string | null;
				scopeProfile: "minimal" | "send" | "manage" | "full";
				tenant: string | null;
				hasClientSecret: boolean;
			};
		}>("/admin/oauth/providers"),

	getConfigs: () =>
		requestGet<{
			GMAIL: {
				configured: boolean;
				redirectUri: string | null;
				source: "database" | "environment" | "none";
				clientId: string | null;
				scopes: string | null;
				scopeProfile: "minimal" | "send" | "manage" | "full";
				tenant: string | null;
				hasClientSecret: boolean;
			};
			OUTLOOK: {
				configured: boolean;
				redirectUri: string | null;
				source: "database" | "environment" | "none";
				clientId: string | null;
				scopes: string | null;
				scopeProfile: "minimal" | "send" | "manage" | "full";
				tenant: string | null;
				hasClientSecret: boolean;
			};
		}>("/admin/oauth/configs"),

	saveConfig: (
		provider: "GMAIL" | "OUTLOOK",
		data: {
			clientId?: string | null;
			clientSecret?: string | null;
			redirectUri?: string | null;
			scopes?: string | null;
			scopeProfile?: "minimal" | "send" | "manage" | "full";
			tenant?: string | null;
		},
	) =>
		requestPut<
			{
				configured: boolean;
				redirectUri: string | null;
				source: "database" | "environment" | "none";
				clientId: string | null;
				scopes: string | null;
				scopeProfile: "minimal" | "send" | "manage" | "full";
				tenant: string | null;
				hasClientSecret: boolean;
			},
			{
				clientId?: string | null;
				clientSecret?: string | null;
				redirectUri?: string | null;
				scopes?: string | null;
				scopeProfile?: "minimal" | "send" | "manage" | "full";
				tenant?: string | null;
			}
		>(
			`/admin/oauth/configs/${provider === "GMAIL" ? "google" : "outlook"}`,
			data,
		),

	parseGoogleClientSecret: (data: {
		jsonText?: string | null;
		callbackUri?: string | null;
	}) =>
		requestPost<
			{
				clientId: string;
				clientSecret: string;
				redirectUri: string;
				redirectUris: string[];
				projectId: string | null;
			},
			{
						jsonText?: string | null;
				callbackUri?: string | null;
			}
		>("/admin/oauth/google/parse-client-secret", data),

	startAuthorization: (
		provider: "GMAIL" | "OUTLOOK",
		data?: { groupId?: number; emailId?: number },
	) =>
		requestPost<
			{
				provider: "GMAIL" | "OUTLOOK";
				state: string;
				authUrl: string;
				expiresIn: number;
				expiresAt: number;
			},
			{ groupId?: number; emailId?: number }
		>(
			`/admin/oauth/${provider === "GMAIL" ? "google" : "outlook"}/start`,
			data,
		),

	getAuthorizationStatus: (provider: "GMAIL" | "OUTLOOK", state: string) =>
		requestGet<{
			provider: "GMAIL" | "OUTLOOK";
			state: string;
			status: "pending" | "processing" | "completed" | "expired";
			expiresAt?: number;
			completedAt?: number;
			result?: {
				provider: "GMAIL" | "OUTLOOK";
				status: "success" | "warning" | "error";
				email?: string;
				action?: string;
				message: string;
			};
		}>(`/admin/oauth/${provider === "GMAIL" ? "google" : "outlook"}/status`, {
			params: { state },
		}),
};

export const mailboxPortalApi = {
	login: (username: string, password: string, otp?: string) =>
		requestPost<
			{ mailboxUser: MailboxUser },
			{ username: string; password: string; otp?: string }
		>(`${MAILBOX_PORTAL_PREFIX}/login`, {
			username,
			password,
			otp,
		}),

	logout: () =>
		requestPost<Record<string, unknown>>(`${MAILBOX_PORTAL_PREFIX}/logout`),

	getSession: <T = Record<string, unknown>>() =>
		requestGet<T>(`${MAILBOX_PORTAL_PREFIX}/session`),

	getMailboxes: <T = Record<string, unknown>>() =>
		requestGet<T[]>(`${MAILBOX_PORTAL_PREFIX}/mailboxes`),

	getMessages: <T = Record<string, unknown>>(params?: {
		mailboxId?: number;
		page?: number;
		pageSize?: number;
		unreadOnly?: boolean;
	}) =>
		requestGet<ApiPagedList<T>>(`${MAILBOX_PORTAL_PREFIX}/messages`, {
			params,
		}),

	getMessage: <T = Record<string, unknown>>(id: string | number) =>
		requestGet<T>(`${MAILBOX_PORTAL_PREFIX}/messages/${id}`),

	getSentMessages: <T = Record<string, unknown>>(params: {
		mailboxId: number;
		page?: number;
		pageSize?: number;
	}) =>
		requestGet<ApiPagedList<T>>(`${MAILBOX_PORTAL_PREFIX}/sent-messages`, {
			params,
		}),

	getSentMessage: <T = Record<string, unknown>>(id: string | number) =>
		requestGet<T>(`${MAILBOX_PORTAL_PREFIX}/sent-messages/${id}`),

	getForwardingJobs: <T = Record<string, unknown>>(params?: {
		mailboxId?: number;
		page?: number;
		pageSize?: number;
	}) =>
		requestGet<ApiPagedList<T>>(`${MAILBOX_PORTAL_PREFIX}/forwarding-jobs`, {
			params,
		}),

	sendMessage: (data: {
		mailboxId: number;
		to: string[];
		subject: string;
		html?: string;
		text?: string;
	}) =>
		requestPost<
			Record<string, unknown>,
			{
				mailboxId: number;
				to: string[];
				subject: string;
				html?: string;
				text?: string;
			}
		>(`${MAILBOX_PORTAL_PREFIX}/send`, data),

	changePassword: (oldPassword: string, newPassword: string) =>
		requestPost<
			Record<string, unknown>,
			{ oldPassword: string; newPassword: string }
		>(`${MAILBOX_PORTAL_PREFIX}/change-password`, {
			oldPassword,
			newPassword,
		}),

	getTwoFactorStatus: () =>
		requestGet<MailboxPortalTwoFactorStatus>(
			`${MAILBOX_PORTAL_PREFIX}/2fa/status`,
		),

	setupTwoFactor: () =>
		requestPost<MailboxPortalTwoFactorSetup>(
			`${MAILBOX_PORTAL_PREFIX}/2fa/setup`,
		),

	enableTwoFactor: (otp: string) =>
		requestPost<MailboxPortalTwoFactorResult, { otp: string }>(
			`${MAILBOX_PORTAL_PREFIX}/2fa/enable`,
			{ otp },
		),

	disableTwoFactor: (password: string, otp: string) =>
		requestPost<MailboxPortalTwoFactorResult, { password: string; otp: string }>(
			`${MAILBOX_PORTAL_PREFIX}/2fa/disable`,
			{ password, otp },
		),

	updateForwarding: (data: {
		mailboxId: number;
		forwardMode: "DISABLED" | "COPY" | "MOVE";
		forwardTo?: string | null;
	}) =>
		requestPost<
			Record<string, unknown>,
			{
				mailboxId: number;
				forwardMode: "DISABLED" | "COPY" | "MOVE";
				forwardTo?: string | null;
			}
		>(`${MAILBOX_PORTAL_PREFIX}/forwarding`, data),
};
