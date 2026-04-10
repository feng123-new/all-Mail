import {
	type ApiPagedList,
	requestDelete,
	requestGet,
	requestPost,
	requestPut,
} from "./core";

export const adminApi = {
	getList: <T = Record<string, unknown>>(params?: {
		page?: number;
		pageSize?: number;
		status?: string;
		role?: string;
		keyword?: string;
	}) => requestGet<ApiPagedList<T>>("/admin/admins", { params }),

	getById: (id: number) =>
		requestGet<Record<string, unknown>>(`/admin/admins/${id}`),

	create: (data: {
		username: string;
		password: string;
		email?: string;
		role?: string;
		status?: string;
	}) =>
		requestPost<
			Record<string, unknown>,
			{
				username: string;
				password: string;
				email?: string;
				role?: string;
				status?: string;
			}
		>("/admin/admins", data, { invalidatePrefixes: ["/admin/admins"] }),

	update: (
		id: number,
		data: {
			username?: string;
			password?: string;
			email?: string;
			role?: string;
			status?: string;
			twoFactorEnabled?: boolean;
		},
	) =>
		requestPut<
			Record<string, unknown>,
			{
				username?: string;
				password?: string;
				email?: string;
				role?: string;
				status?: string;
				twoFactorEnabled?: boolean;
			}
		>(`/admin/admins/${id}`, data, { invalidatePrefixes: ["/admin/admins"] }),

	delete: (id: number) =>
		requestDelete<Record<string, unknown>>(`/admin/admins/${id}`, {
			invalidatePrefixes: ["/admin/admins"],
		}),
};

export const apiKeyApi = {
	getList: <T = Record<string, unknown>>(params?: {
		page?: number;
		pageSize?: number;
		status?: string;
		keyword?: string;
	}) =>
		requestGet<ApiPagedList<T>>("/admin/api-keys", { params, cacheMs: 800 }),

	getById: (id: number) =>
		requestGet<Record<string, unknown>>(`/admin/api-keys/${id}`),

	create: (data: {
		name: string;
		permissions?: Record<string, boolean>;
		rateLimit?: number;
		expiresAt?: string | null;
		allowedGroupIds?: number[];
		allowedEmailIds?: number[];
		allowedDomainIds?: number[];
	}) =>
		requestPost<
			{ key: string },
			{
				name: string;
				permissions?: Record<string, boolean>;
				rateLimit?: number;
				expiresAt?: string | null;
				allowedGroupIds?: number[];
				allowedEmailIds?: number[];
				allowedDomainIds?: number[];
			}
		>("/admin/api-keys", data, {
			invalidatePrefixes: ["/admin/api-keys", "/admin/dashboard/stats"],
		}),

	update: (
		id: number,
		data: {
			name?: string;
			permissions?: Record<string, boolean>;
			rateLimit?: number;
			status?: string;
			expiresAt?: string | null;
			allowedGroupIds?: number[];
			allowedEmailIds?: number[];
			allowedDomainIds?: number[];
		},
	) =>
		requestPut<
			Record<string, unknown>,
			{
				name?: string;
				permissions?: Record<string, boolean>;
				rateLimit?: number;
				status?: string;
				expiresAt?: string | null;
				allowedGroupIds?: number[];
				allowedEmailIds?: number[];
				allowedDomainIds?: number[];
			}
		>(`/admin/api-keys/${id}`, data, {
			invalidatePrefixes: [
				"/admin/api-keys",
				`/admin/api-keys/${id}`,
				"/admin/dashboard/stats",
			],
		}),

	delete: (id: number) =>
		requestDelete<Record<string, unknown>>(`/admin/api-keys/${id}`, {
			invalidatePrefixes: [
				"/admin/api-keys",
				`/admin/api-keys/${id}`,
				"/admin/dashboard/stats",
			],
		}),

	getAllocationStats: (id: number, groupName?: string) =>
		requestGet<{ total: number; used: number; remaining: number }>(
			`/admin/api-keys/${id}/allocation-stats`,
			{
				params: { group: groupName },
				cacheMs: 1000,
			},
		),

	resetAllocation: (id: number, groupName?: string) =>
		requestPost<Record<string, unknown>, { group?: string }>(
			`/admin/api-keys/${id}/allocation-reset`,
			{
				group: groupName,
			},
			{
				invalidatePrefixes: [
					`/admin/api-keys/${id}/usage`,
					`/admin/api-keys/${id}/assigned-mailboxes`,
				],
			},
		),

	getAssignedMailboxes: <T = Record<string, unknown>>(
		id: number,
		groupId?: number,
	) =>
		requestGet<T[]>(`/admin/api-keys/${id}/assigned-mailboxes`, {
			params: { groupId },
			cacheMs: 800,
		}),

	updateAssignedMailboxes: (id: number, emailIds: number[], groupId?: number) =>
		requestPut<{ count: number }, { emailIds: number[]; groupId?: number }>(
			`/admin/api-keys/${id}/assigned-mailboxes`,
			{
				emailIds,
				groupId,
			},
			{
				invalidatePrefixes: [
					`/admin/api-keys/${id}/usage`,
					`/admin/api-keys/${id}/assigned-mailboxes`,
				],
			},
		),
};

export const dashboardApi = {
	getStats: <T = Record<string, unknown>>() =>
		requestGet<T>("/admin/dashboard/stats"),

	getApiTrend: <T = Record<string, unknown>>(days: number = 7) =>
		requestGet<T[]>("/admin/dashboard/api-trend", {
			params: { days },
			cacheMs: 2000,
		}),

	getLogs: <T = Record<string, unknown>>(params?: {
		page?: number;
		pageSize?: number;
		action?: string;
	}) => requestGet<ApiPagedList<T>>("/admin/dashboard/logs", { params }),

	deleteLog: (id: number) =>
		requestDelete<{ deleted: boolean }>(`/admin/dashboard/logs/${id}`, {
			invalidatePrefixes: ["/admin/dashboard/logs"],
		}),

	batchDeleteLogs: (ids: number[]) =>
		requestPost<{ deleted: number }, { ids: number[] }>(
			"/admin/dashboard/logs/batch-delete",
			{ ids },
			{
				invalidatePrefixes: ["/admin/dashboard/logs"],
			},
		),
};

export const logsApi = {
	getList: <T = Record<string, unknown>>(params: {
		page?: number;
		pageSize?: number;
		action?: string;
		resource?: string;
	}) => requestGet<ApiPagedList<T>>("/admin/dashboard/logs", { params }),

	delete: (id: number) =>
		requestDelete<{ deleted: boolean }>(`/admin/dashboard/logs/${id}`, {
			invalidatePrefixes: ["/admin/dashboard/logs"],
		}),

	batchDelete: (ids: number[]) =>
		requestPost<{ deleted: number }, { ids: number[] }>(
			"/admin/dashboard/logs/batch-delete",
			{ ids },
			{
				invalidatePrefixes: ["/admin/dashboard/logs"],
			},
		),
};
