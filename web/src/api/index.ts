export { adminApi, apiKeyApi, dashboardApi, logsApi } from "./admin";
export { authApi, mailboxPortalApi, oauthApi } from "./auth";
export type {
	ApiPagedList,
	ApiResponse,
	MutationConfig,
	RequestGetConfig,
} from "./core";
export {
	api,
	default,
	LONG_RUNNING_CHECK_TIMEOUT_MS,
	MAILBOX_PORTAL_PREFIX,
	requestDelete,
	requestGet,
	requestPatch,
	requestPost,
	requestPut,
} from "./core";
export {
	domainApi,
	domainMailboxApi,
	domainMessageApi,
	forwardingJobsApi,
	mailboxUserApi,
} from "./domains";
export { emailApi, groupApi } from "./emails";
export { sendingApi } from "./sending";
