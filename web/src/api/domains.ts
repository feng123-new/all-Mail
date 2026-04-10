import {
	type ApiPagedList,
	requestDelete,
	requestGet,
	requestPatch,
	requestPost,
} from "./core";

export const domainApi = {
	getList: <T = Record<string, unknown>>(params?: {
		page?: number;
		pageSize?: number;
		keyword?: string;
		status?: string;
	}) => requestGet<ApiPagedList<T>>("/admin/domains", { params, cacheMs: 600 }),

	getById: <T = Record<string, unknown>>(id: number) =>
		requestGet<T>(`/admin/domains/${id}`),

	create: (data: {
		name: string;
		displayName?: string;
		canReceive?: boolean;
		canSend?: boolean;
		isCatchAllEnabled?: boolean;
	}) =>
		requestPost<
			Record<string, unknown>,
			{
				name: string;
				displayName?: string;
				canReceive?: boolean;
				canSend?: boolean;
				isCatchAllEnabled?: boolean;
			}
		>("/admin/domains", data, {
			invalidatePrefixes: ["/admin/domains", "/admin/dashboard/stats"],
		}),

	update: (
		id: number,
		data: {
			displayName?: string | null;
			status?: string;
			canReceive?: boolean;
			canSend?: boolean;
			isCatchAllEnabled?: boolean;
		},
	) =>
		requestPatch<
			Record<string, unknown>,
			{
				displayName?: string | null;
				status?: string;
				canReceive?: boolean;
				canSend?: boolean;
				isCatchAllEnabled?: boolean;
			}
		>(`/admin/domains/${id}`, data, {
			invalidatePrefixes: [
				"/admin/domains",
				`/admin/domains/${id}`,
				"/admin/dashboard/stats",
			],
		}),

	verify: (id: number, verificationToken?: string) =>
		requestPost<Record<string, unknown>, { verificationToken?: string }>(
			`/admin/domains/${id}/verify`,
			{ verificationToken },
			{
				invalidatePrefixes: ["/admin/domains", `/admin/domains/${id}`],
			},
		),

	saveCatchAll: (
		id: number,
		data: {
			isCatchAllEnabled: boolean;
			catchAllTargetMailboxId?: number | null;
		},
	) =>
		requestPost<
			Record<string, unknown>,
			{ isCatchAllEnabled: boolean; catchAllTargetMailboxId?: number | null }
		>(`/admin/domains/${id}/catch-all`, data, {
			invalidatePrefixes: [
				"/admin/domains",
				`/admin/domains/${id}`,
				"/admin/domain-mailboxes",
			],
		}),

	saveSendingConfig: (
		id: number,
		data: {
			provider?: "RESEND";
			fromNameDefault?: string | null;
			replyToDefault?: string | null;
			apiKey?: string;
		},
	) =>
		requestPost<
			Record<string, unknown>,
			{
				provider?: "RESEND";
				fromNameDefault?: string | null;
				replyToDefault?: string | null;
				apiKey?: string;
			}
		>(`/admin/domains/${id}/sending-config`, data, {
			invalidatePrefixes: [
				"/admin/domains",
				`/admin/domains/${id}`,
				"/admin/send/configs",
			],
		}),

	getAliases: <T = Record<string, unknown>>(
		id: number,
		params?: { mailboxId?: number },
	) => requestGet<T[]>(`/admin/domains/${id}/aliases`, { params }),

	createAlias: (
		id: number,
		data: { mailboxId: number; aliasLocalPart: string },
	) =>
		requestPost<
			Record<string, unknown>,
			{ mailboxId: number; aliasLocalPart: string }
		>(`/admin/domains/${id}/aliases`, data, {
			invalidatePrefixes: [
				`/admin/domains/${id}/aliases`,
				`/admin/domains/${id}`,
				"/admin/domain-mailboxes",
			],
		}),

	updateAlias: (id: number, aliasId: number, data: { status?: string }) =>
		requestPatch<Record<string, unknown>, { status?: string }>(
			`/admin/domains/${id}/aliases/${aliasId}`,
			data,
			{
				invalidatePrefixes: [`/admin/domains/${id}/aliases`],
			},
		),

	delete: (id: number) =>
		requestDelete<Record<string, unknown>>(`/admin/domains/${id}`, {
			invalidatePrefixes: ["/admin/domains", "/admin/dashboard/stats"],
		}),

	deleteAlias: (id: number, aliasId: number) =>
		requestDelete<Record<string, unknown>>(
			`/admin/domains/${id}/aliases/${aliasId}`,
			{ invalidatePrefixes: [`/admin/domains/${id}/aliases`] },
		),
};

export const domainMailboxApi = {
	getList: <T = Record<string, unknown>>(params?: {
		page?: number;
		pageSize?: number;
		domainId?: number;
		keyword?: string;
		status?: string;
		batchTag?: string;
		provisioningMode?: string;
	}) => requestGet<ApiPagedList<T>>("/admin/domain-mailboxes", { params }),

	getById: <T = Record<string, unknown>>(id: number) =>
		requestGet<T>(`/admin/domain-mailboxes/${id}`),

	create: (data: Record<string, unknown>) =>
		requestPost<Record<string, unknown>, Record<string, unknown>>(
			"/admin/domain-mailboxes",
			data,
			{
				invalidatePrefixes: [
					"/admin/domain-mailboxes",
					"/admin/domains",
					"/admin/mailbox-users",
					"/admin/dashboard/stats",
				],
			},
		),

	batchCreate: (data: Record<string, unknown>) =>
		requestPost<Record<string, unknown>, Record<string, unknown>>(
			"/admin/domain-mailboxes/batch-create",
			data,
			{
				invalidatePrefixes: [
					"/admin/domain-mailboxes",
					"/admin/domains",
					"/admin/mailbox-users",
					"/admin/api-keys",
					"/admin/dashboard/stats",
				],
			},
		),

	batchDelete: (data: {
		ids?: number[];
		domainId?: number;
		batchTag?: string;
		provisioningMode?: string;
	}) =>
		requestPost<
			Record<string, unknown>,
			{
				ids?: number[];
				domainId?: number;
				batchTag?: string;
				provisioningMode?: string;
			}
		>("/admin/domain-mailboxes/batch-delete", data, {
			invalidatePrefixes: [
				"/admin/domain-mailboxes",
				"/admin/domains",
				"/admin/mailbox-users",
				"/admin/dashboard/stats",
			],
		}),

	update: (id: number, data: Record<string, unknown>) =>
		requestPatch<Record<string, unknown>, Record<string, unknown>>(
			`/admin/domain-mailboxes/${id}`,
			data,
			{
				invalidatePrefixes: [
					"/admin/domain-mailboxes",
					`/admin/domain-mailboxes/${id}`,
					"/admin/domains",
					"/admin/mailbox-users",
					"/admin/dashboard/stats",
				],
			},
		),

	delete: (id: number) =>
		requestDelete<Record<string, unknown>>(`/admin/domain-mailboxes/${id}`, {
			invalidatePrefixes: [
				"/admin/domain-mailboxes",
				"/admin/domains",
				"/admin/mailbox-users",
				"/admin/dashboard/stats",
			],
		}),
};

export const mailboxUserApi = {
	getList: <T = Record<string, unknown>>(params?: {
		page?: number;
		pageSize?: number;
		keyword?: string;
		status?: string;
	}) => requestGet<ApiPagedList<T>>("/admin/mailbox-users", { params }),

	getById: <T = Record<string, unknown>>(id: number) =>
		requestGet<T>(`/admin/mailbox-users/${id}`),

	create: (data: Record<string, unknown>) =>
		requestPost<Record<string, unknown>, Record<string, unknown>>(
			"/admin/mailbox-users",
			data,
			{
				invalidatePrefixes: ["/admin/mailbox-users", "/admin/domain-mailboxes"],
			},
		),

	update: (id: number, data: Record<string, unknown>) =>
		requestPatch<Record<string, unknown>, Record<string, unknown>>(
			`/admin/mailbox-users/${id}`,
			data,
			{
				invalidatePrefixes: [
					"/admin/mailbox-users",
					`/admin/mailbox-users/${id}`,
					"/admin/domain-mailboxes",
				],
			},
		),

	addMailboxes: (id: number, mailboxIds: number[]) =>
		requestPost<Record<string, unknown>, { mailboxIds: number[] }>(
			`/admin/mailbox-users/${id}/mailboxes/batch-add`,
			{ mailboxIds },
			{
				invalidatePrefixes: [
					"/admin/mailbox-users",
					`/admin/mailbox-users/${id}`,
					"/admin/domain-mailboxes",
					"/admin/dashboard/stats",
				],
			},
		),

	delete: (id: number) =>
		requestDelete<Record<string, unknown>>(`/admin/mailbox-users/${id}`, {
			invalidatePrefixes: ["/admin/mailbox-users", "/admin/domain-mailboxes"],
		}),
};

export const domainMessageApi = {
	getList: <T = Record<string, unknown>>(params?: {
		page?: number;
		pageSize?: number;
		domainId?: number;
		mailboxId?: number;
		unreadOnly?: boolean;
	}) => requestGet<ApiPagedList<T>>("/admin/domain-messages", { params }),

	getById: <T = Record<string, unknown>>(id: string | number) =>
		requestGet<T>(`/admin/domain-messages/${id}`),

	delete: (id: string | number) =>
		requestDelete<{ deleted: number; ids: string[] }>(
			`/admin/domain-messages/${id}`,
			{
				invalidatePrefixes: ["/admin/domain-messages"],
			},
		),

	batchDelete: (ids: Array<string | number>) =>
		requestPost<
			{ deleted: number; ids: string[] },
			{ ids: Array<string | number> }
		>(
			"/admin/domain-messages/batch-delete",
			{ ids },
			{
				invalidatePrefixes: ["/admin/domain-messages"],
			},
		),
};

export const forwardingJobsApi = {
	getList: <T = Record<string, unknown>>(params?: {
		page?: number;
		pageSize?: number;
		status?: "PENDING" | "RUNNING" | "SENT" | "FAILED" | "SKIPPED";
		mode?: "COPY" | "MOVE";
		mailboxId?: number;
		domainId?: number;
		keyword?: string;
	}) => requestGet<ApiPagedList<T>>("/admin/forwarding-jobs", { params }),

	getById: <T = Record<string, unknown>>(id: string | number) =>
		requestGet<T>(`/admin/forwarding-jobs/${id}`),

	requeue: <T = Record<string, unknown>>(id: string | number) =>
		requestPost<T>(`/admin/forwarding-jobs/${id}/requeue`, undefined, {
			invalidatePrefixes: ["/admin/forwarding-jobs"],
		}),
};
