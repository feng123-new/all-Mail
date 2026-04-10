import type {
	EmailAuthType,
	EmailProvider,
	RepresentativeProtocol,
} from "../constants/providers";
import {
	type ApiPagedList,
	LONG_RUNNING_CHECK_TIMEOUT_MS,
	requestDelete,
	requestGet,
	requestPost,
	requestPut,
} from "./core";

export const emailApi = {
	getList: <T = Record<string, unknown>>(params?: {
		page?: number;
		pageSize?: number;
		status?: string;
		keyword?: string;
		groupId?: number;
		provider?: EmailProvider;
		representativeProtocol?: RepresentativeProtocol;
	}) => requestGet<ApiPagedList<T>>("/admin/emails", { params, cacheMs: 800 }),

	getStats: <T = Record<string, unknown>>() =>
		requestGet<T>("/admin/emails/stats"),

	getById: <T = Record<string, unknown>>(
		id: number,
		includeSecrets?: boolean,
	) =>
		requestGet<T>(`/admin/emails/${id}`, {
			params: { secrets: includeSecrets },
		}),

	revealUnlock: (data: { otp: string }) =>
		requestPost<{ grantToken: string; expiresAt: string }, { otp: string }>(
			"/admin/emails/reveal-unlock",
			data,
		),

	revealSecrets: (
		id: number,
		data: {
			otp?: string;
			grantToken?: string;
			fields: Array<"password" | "refreshToken" | "accountLoginPassword">;
		},
	) =>
		requestPost<
			{
				secrets: Partial<
					Record<
						"password" | "refreshToken" | "accountLoginPassword",
						string | null
					>
				>;
				availableFields: Array<
					"password" | "refreshToken" | "accountLoginPassword"
				>;
			},
			{
				otp?: string;
				grantToken?: string;
				fields: Array<"password" | "refreshToken" | "accountLoginPassword">;
			}
		>(`/admin/emails/${id}/reveal-secrets`, data),

	create: (data: {
		email: string;
		provider: EmailProvider;
		authType?: EmailAuthType;
		clientId?: string;
		refreshToken?: string;
		clientSecret?: string;
		password?: string;
		accountLoginPassword?: string;
		groupId?: number;
		providerConfig?: Record<string, unknown>;
	}) =>
		requestPost<
			Record<string, unknown>,
			{
				email: string;
				provider: EmailProvider;
				authType?: EmailAuthType;
				clientId?: string;
				refreshToken?: string;
				clientSecret?: string;
				password?: string;
				accountLoginPassword?: string;
				groupId?: number;
				providerConfig?: Record<string, unknown>;
			}
		>("/admin/emails", data, {
			invalidatePrefixes: [
				"/admin/emails",
				"/admin/email-groups",
				"/admin/api-keys",
				"/admin/dashboard/stats",
			],
		}),

	import: (content: string, separator?: string, groupId?: number) =>
		requestPost<
			Record<string, unknown>,
			{ content: string; separator?: string; groupId?: number }
		>(
			"/admin/emails/import",
			{ content, separator, groupId },
			{
				invalidatePrefixes: [
					"/admin/emails",
					"/admin/email-groups",
					"/admin/api-keys",
					"/admin/dashboard/stats",
				],
			},
		),

	export: (ids?: number[], separator?: string, groupId?: number) =>
		requestGet<{ content: string }>("/admin/emails/export", {
			params: { ids: ids?.join(","), separator, groupId },
		}),

	update: (
		id: number,
		data: {
			email?: string;
			provider?: EmailProvider;
			authType?: EmailAuthType;
			clientId?: string | null;
			refreshToken?: string | null;
			clientSecret?: string | null;
			password?: string | null;
			accountLoginPassword?: string | null;
			accountPasswordGrantToken?: string;
			status?: string;
			groupId?: number | null;
			providerConfig?: Record<string, unknown> | null;
		},
	) =>
		requestPut<
			Record<string, unknown>,
			{
				email?: string;
				provider?: EmailProvider;
				authType?: EmailAuthType;
				clientId?: string | null;
				refreshToken?: string | null;
				clientSecret?: string | null;
				password?: string | null;
				accountLoginPassword?: string | null;
				accountPasswordGrantToken?: string;
				status?: string;
				groupId?: number | null;
				providerConfig?: Record<string, unknown> | null;
			}
		>(`/admin/emails/${id}`, data, {
			invalidatePrefixes: [
				"/admin/emails",
				"/admin/email-groups",
				"/admin/api-keys",
				"/admin/dashboard/stats",
			],
		}),

	delete: (id: number) =>
		requestDelete<Record<string, unknown>>(`/admin/emails/${id}`, {
			invalidatePrefixes: [
				"/admin/emails",
				"/admin/email-groups",
				"/admin/api-keys",
				"/admin/dashboard/stats",
			],
		}),

	batchDelete: (ids: number[]) =>
		requestPost<{ deleted: number }, { ids: number[] }>(
			"/admin/emails/batch-delete",
			{ ids },
			{
				invalidatePrefixes: [
					"/admin/emails",
					"/admin/email-groups",
					"/admin/api-keys",
					"/admin/dashboard/stats",
				],
			},
		),

	viewMails: <T = Record<string, unknown>>(
		id: number,
		mailbox?: string,
		markAsSeen: boolean = false,
	) =>
		requestGet<{ messages: T[] }>(`/admin/emails/${id}/mails`, {
			params: { mailbox, markAsSeen },
		}),

	deleteSelectedMails: <T = Record<string, unknown>>(
		id: number,
		data: { mailbox: "INBOX" | "SENT" | "Junk"; messageIds: string[] },
	) =>
		requestPost<
			{ deletedCount: number; remainingCount: number; messages: T[] },
			{ mailbox: "INBOX" | "SENT" | "Junk"; messageIds: string[] }
		>(`/admin/emails/${id}/mails/delete`, data, {
			invalidatePrefixes: ["/admin/emails"],
		}),

	batchFetchMailboxes: (data: {
		ids?: number[];
		keyword?: string;
		groupId?: number;
		provider?: EmailProvider;
		representativeProtocol?: RepresentativeProtocol;
		status?: string;
		mailboxes?: Array<"INBOX" | "SENT" | "Junk">;
	}) =>
		requestPost<
			{
				targeted: number;
				successCount: number;
				partialCount: number;
				errorCount: number;
				skippedCount: number;
				results: Array<{
					id: number;
					email: string;
					status: "success" | "partial" | "error" | "skipped";
					mailboxResults: Array<{
						mailbox: string;
						status: "success" | "error";
						count?: number;
						message?: string;
					}>;
					message?: string;
				}>;
			},
			{
				ids?: number[];
				keyword?: string;
				groupId?: number;
				provider?: EmailProvider;
				representativeProtocol?: RepresentativeProtocol;
				status?: string;
				mailboxes?: Array<"INBOX" | "SENT" | "Junk">;
			}
		>("/admin/emails/batch-fetch-mails", data, {
			invalidatePrefixes: ["/admin/emails"],
			timeout: LONG_RUNNING_CHECK_TIMEOUT_MS,
		}),

	batchClearMailbox: (data: {
		ids?: number[];
		keyword?: string;
		groupId?: number;
		provider?: EmailProvider;
		representativeProtocol?: RepresentativeProtocol;
		status?: string;
		mailbox: "INBOX" | "Junk";
	}) =>
		requestPost<
			{
				targeted: number;
				deletedCount: number;
				successCount: number;
				errorCount: number;
				skippedCount: number;
				results: Array<{
					id: number;
					email: string;
					status: "success" | "error" | "skipped";
					deletedCount: number;
					message: string;
				}>;
			},
			{
				ids?: number[];
				keyword?: string;
				groupId?: number;
				provider?: EmailProvider;
				representativeProtocol?: RepresentativeProtocol;
				status?: string;
				mailbox: "INBOX" | "Junk";
			}
		>("/admin/emails/batch-clear-mailbox", data, {
			invalidatePrefixes: ["/admin/emails"],
		}),

	sendMail: (
		id: number,
		data: {
			fromName?: string;
			to: string[];
			subject: string;
			text?: string;
			html?: string;
			socks5?: string;
			http?: string;
		},
	) =>
		requestPost<
			Record<string, unknown>,
			{
				fromName?: string;
				to: string[];
				subject: string;
				text?: string;
				html?: string;
				socks5?: string;
				http?: string;
			}
		>(`/admin/emails/${id}/send`, data),

	clearMailbox: (id: number, mailbox?: string) =>
		requestPost<{ deletedCount: number }, { mailbox?: string }>(
			`/admin/emails/${id}/clear`,
			{ mailbox },
		),
};

export const groupApi = {
	getList: <T = Record<string, unknown>>() =>
		requestGet<T[]>("/admin/email-groups", { cacheMs: 5000 }),

	getById: (id: number) =>
		requestGet<Record<string, unknown>>(`/admin/email-groups/${id}`),

	create: (data: {
		name: string;
		description?: string;
		fetchStrategy: "GRAPH_FIRST" | "IMAP_FIRST" | "GRAPH_ONLY" | "IMAP_ONLY";
	}) =>
		requestPost<
			Record<string, unknown>,
			{
				name: string;
				description?: string;
				fetchStrategy:
					| "GRAPH_FIRST"
					| "IMAP_FIRST"
					| "GRAPH_ONLY"
					| "IMAP_ONLY";
			}
		>("/admin/email-groups", data, {
			invalidatePrefixes: [
				"/admin/email-groups",
				"/admin/emails",
				"/admin/api-keys",
			],
		}),

	update: (
		id: number,
		data: {
			name?: string;
			description?: string;
			fetchStrategy?: "GRAPH_FIRST" | "IMAP_FIRST" | "GRAPH_ONLY" | "IMAP_ONLY";
		},
	) =>
		requestPut<
			Record<string, unknown>,
			{
				name?: string;
				description?: string;
				fetchStrategy?:
					| "GRAPH_FIRST"
					| "IMAP_FIRST"
					| "GRAPH_ONLY"
					| "IMAP_ONLY";
			}
		>(`/admin/email-groups/${id}`, data, {
			invalidatePrefixes: [
				"/admin/email-groups",
				"/admin/emails",
				"/admin/api-keys",
			],
		}),

	delete: (id: number) =>
		requestDelete<Record<string, unknown>>(`/admin/email-groups/${id}`, {
			invalidatePrefixes: [
				"/admin/email-groups",
				"/admin/emails",
				"/admin/api-keys",
			],
		}),

	assignEmails: (groupId: number, emailIds: number[]) =>
		requestPost<{ count: number }, { emailIds: number[] }>(
			`/admin/email-groups/${groupId}/assign`,
			{
				emailIds,
			},
			{
				invalidatePrefixes: [
					"/admin/email-groups",
					"/admin/emails",
					"/admin/api-keys",
				],
			},
		),

	removeEmails: (groupId: number, emailIds: number[]) =>
		requestPost<{ count: number }, { emailIds: number[] }>(
			`/admin/email-groups/${groupId}/remove`,
			{
				emailIds,
			},
			{
				invalidatePrefixes: [
					"/admin/email-groups",
					"/admin/emails",
					"/admin/api-keys",
				],
			},
		),
};
