import {
	type ApiPagedList,
	requestDelete,
	requestGet,
	requestPost,
} from "./core";

export const sendingApi = {
	getConfigs: <T = Record<string, unknown>>(params?: { domainId?: number }) =>
		requestGet<{ list: T[]; filters: Record<string, unknown> }>(
			"/admin/send/configs",
			{ params },
		),

	deleteConfig: (id: number) =>
		requestDelete<{ deleted: boolean; id: number }>(
			`/admin/send/configs/${id}`,
			{
				invalidatePrefixes: ["/admin/send/configs", "/admin/domains"],
			},
		),

	getMessages: <T = Record<string, unknown>>(params?: {
		page?: number;
		pageSize?: number;
		domainId?: number;
		mailboxId?: number;
	}) => requestGet<ApiPagedList<T>>("/admin/send/messages", { params }),

	deleteMessage: (id: string | number) =>
		requestDelete<{ deleted: number; ids: string[] }>(
			`/admin/send/messages/${id}`,
			{
				invalidatePrefixes: ["/admin/send/messages"],
			},
		),

	batchDeleteMessages: (ids: Array<string | number>) =>
		requestPost<
			{ deleted: number; ids: string[] },
			{ ids: Array<string | number> }
		>(
			"/admin/send/messages/batch-delete",
			{ ids },
			{
				invalidatePrefixes: ["/admin/send/messages"],
			},
		),

	send: (data: {
		domainId: number;
		mailboxId?: number;
		from: string;
		to: string[];
		subject: string;
		html?: string;
		text?: string;
	}) =>
		requestPost<
			Record<string, unknown>,
			{
				domainId: number;
				mailboxId?: number;
				from: string;
				to: string[];
				subject: string;
				html?: string;
				text?: string;
			}
		>("/admin/send/messages", data, {
			invalidatePrefixes: ["/admin/send/messages"],
		}),
};
