import type {
	HostedInternalCapabilitySummary,
	HostedInternalProfileKey,
	RepresentativeProtocol,
} from "../../constants/providers";
import { defineMessage } from "../../i18n/messages";
import { fullWidthStyle, marginBottom16Style } from "../../styles/common";

export interface DomainOption {
	id: number;
	name: string;
	status?: string;
	canReceive?: boolean;
	canSend?: boolean;
}

export interface ApiKeyOption {
	id: number;
	name: string;
	keyPrefix: string;
	status: "ACTIVE" | "DISABLED";
}

export interface UserRecord {
	id: number;
	username: string;
	email?: string | null;
	status: "ACTIVE" | "DISABLED";
	mailboxCount?: number;
}

export interface MailboxRecord {
	id: number;
	domainId: number;
	address: string;
	localPart: string;
	displayName?: string | null;
	status: "ACTIVE" | "DISABLED" | "SUSPENDED";
	provisioningMode: "MANUAL" | "API_POOL";
	batchTag?: string | null;
	ownerUserId?: number | null;
	apiUsageCount?: number;
	inboundMessageCount?: number;
	providerProfile?: HostedInternalProfileKey;
	representativeProtocol?: RepresentativeProtocol;
	profileSummaryHint?: string;
	capabilitySummary?: HostedInternalCapabilitySummary;
	domain?: {
		id: number;
		name: string;
		canSend?: boolean;
		canReceive?: boolean;
	};
	ownerUser?: { id: number; username: string } | null;
}

export interface BatchCreateResult {
	createdCount?: number;
	mailboxes?: Array<Record<string, unknown>>;
}

export interface BatchDeleteResult {
	deletedCount?: number;
}

export interface BatchAssignResult {
	userId: number;
	username: string;
	addedCount: number;
	totalAccessible: number;
}

export interface PagedListResult<T> {
	list: T[];
	total: number;
}

export interface ApiEnvelope<T> {
	code: number;
	data: T;
}

export type BatchCreateMode = "PREFIX" | "LIST";

export const domainMailboxesI18n = {
	enabled: defineMessage("domainMailboxes.enabled", "启用", "Enabled"),
	suspended: defineMessage("domainMailboxes.suspended", "已暂停", "Suspended"),
	fetchDomainsFailed: defineMessage(
		"domainMailboxes.fetchDomainsFailed",
		"获取域名失败",
		"Failed to load domains",
	),
	fetchMailboxesFailed: defineMessage(
		"domainMailboxes.fetchMailboxesFailed",
		"获取域名邮箱失败",
		"Failed to load domain mailboxes",
	),
	fetchUsersFailed: defineMessage(
		"domainMailboxes.fetchUsersFailed",
		"获取邮箱用户失败",
		"Failed to load portal users",
	),
	fetchApiKeysFailed: defineMessage(
		"domainMailboxes.fetchApiKeysFailed",
		"获取访问密钥失败",
		"Failed to load API keys",
	),
	createMailboxFailed: defineMessage(
		"domainMailboxes.createMailboxFailed",
		"创建邮箱失败",
		"Failed to create the mailbox",
	),
	updateMailboxFailed: defineMessage(
		"domainMailboxes.updateMailboxFailed",
		"更新邮箱失败",
		"Failed to update the mailbox",
	),
	batchCreateFailed: defineMessage(
		"domainMailboxes.batchCreateFailed",
		"批量创建域名邮箱失败",
		"Failed to batch create domain mailboxes",
	),
	batchCreateSuccess: defineMessage(
		"domainMailboxes.batchCreateSuccess",
		"批量创建成功，共 {count} 个邮箱",
		"Batch created {count} mailboxes",
	),
	selectMailboxesForDelete: defineMessage(
		"domainMailboxes.selectMailboxesForDelete",
		"请先勾选要删除的域名邮箱",
		"Select the domain mailboxes to delete first",
	),
	batchDeleteFailed: defineMessage(
		"domainMailboxes.batchDeleteFailed",
		"批量删除域名邮箱失败",
		"Failed to batch delete domain mailboxes",
	),
	deletedCount: defineMessage(
		"domainMailboxes.deletedCount",
		"已删除 {count} 个域名邮箱",
		"Deleted {count} domain mailboxes",
	),
	deleteByFilterFailed: defineMessage(
		"domainMailboxes.deleteByFilterFailed",
		"按条件批量删除域名邮箱失败",
		"Failed to batch delete domain mailboxes by filters",
	),
	selectMailboxesForAssign: defineMessage(
		"domainMailboxes.selectMailboxesForAssign",
		"请先勾选要加入门户的域名邮箱",
		"Select the domain mailboxes to add to a portal user first",
	),
	batchAssignFailed: defineMessage(
		"domainMailboxes.batchAssignFailed",
		"批量加入门户用户失败",
		"Failed to batch add mailboxes to the portal user",
	),
	batchAssignSuccess: defineMessage(
		"domainMailboxes.batchAssignSuccess",
		"已把 {selectedCount} 个邮箱加入门户用户 {username}，本次新增 {addedCount} 个权限",
		"Added {selectedCount} mailboxes to portal user {username}; {addedCount} permissions were newly granted",
	),
	deleteMailboxFailed: defineMessage(
		"domainMailboxes.deleteMailboxFailed",
		"删除域名邮箱失败",
		"Failed to delete the domain mailbox",
	),
	deleteSuccess: defineMessage(
		"domainMailboxes.deleteSuccess",
		"删除成功",
		"Deleted successfully",
	),
	deleteFailed: defineMessage(
		"domainMailboxes.deleteFailed",
		"删除失败",
		"Delete failed",
	),
	mailboxAddress: defineMessage(
		"domainMailboxes.mailboxAddress",
		"邮箱地址",
		"Mailbox address",
	),
	mailboxType: defineMessage("domainMailboxes.mailboxType", "类型", "Type"),
	batchDeleteConfirm: defineMessage(
		"domainMailboxes.batchDeleteConfirm",
		"确定删除已勾选的 {count} 个邮箱吗？",
		"Delete the selected {count} mailboxes?",
	),
	selectDomainRequired: defineMessage(
		"domainMailboxes.selectDomainRequired",
		"请选择域名",
		"Select a domain",
	),
	localPart: defineMessage(
		"domainMailboxes.localPart",
		"邮箱前缀",
		"Mailbox prefix",
	),
	localPartRequired: defineMessage(
		"domainMailboxes.localPartRequired",
		"请输入邮箱前缀",
		"Enter the mailbox prefix",
	),
	displayName: defineMessage(
		"domainMailboxes.displayName",
		"展示名",
		"Display name",
	),
	mailboxKind: defineMessage(
		"domainMailboxes.mailboxKind",
		"邮箱类型",
		"Mailbox type",
	),
	currentProfile: defineMessage(
		"domainMailboxes.currentProfile",
		"当前 profile：{profile}",
		"Current profile: {profile}",
	),
	domainCanSendNote: defineMessage(
		"domainMailboxes.domainCanSendNote",
		"当前域名允许发件，因此该邮箱会同时显示站内发件能力。",
		"This domain allows sending, so the mailbox will also expose hosted sending capability.",
	),
	domainInboxOnlyNote: defineMessage(
		"domainMailboxes.domainInboxOnlyNote",
		"当前域名未开启发件，因此该邮箱会按“仅收件”的站内托管邮箱处理。",
		"This domain does not allow sending, so the mailbox is treated as a hosted inbox-only mailbox.",
	),
	portalPassword: defineMessage(
		"domainMailboxes.portalPassword",
		"门户密码",
		"Portal password",
	),
	localPartPlaceholder: defineMessage(
		"domainMailboxes.localPartPlaceholder",
		"inbox",
		"inbox",
	),
	displayNamePlaceholder: defineMessage(
		"domainMailboxes.displayNamePlaceholder",
		"Support Inbox",
		"Support Inbox",
	),
	batchTagPlaceholder: defineMessage(
		"domainMailboxes.batchTagPlaceholder",
		"manual-support-20260318",
		"manual-support-20260318",
	),
	keepPasswordBlankPlaceholder: defineMessage(
		"domainMailboxes.keepPasswordBlankPlaceholder",
		"留空则不修改",
		"Leave blank to keep the current password",
	),
	setPortalPasswordPlaceholder: defineMessage(
		"domainMailboxes.setPortalPasswordPlaceholder",
		"如需门户登录可直接设置",
		"Set directly if portal login is needed",
	),
	batchCreateTitle: defineMessage(
		"domainMailboxes.batchCreateTitle",
		"批量创建域名邮箱",
		"Batch create domain mailboxes",
	),
	createType: defineMessage(
		"domainMailboxes.createType",
		"创建类型",
		"Creation type",
	),
	selectCreateTypeRequired: defineMessage(
		"domainMailboxes.selectCreateTypeRequired",
		"请选择创建类型",
		"Select a creation type",
	),
	syncDomainToApiKey: defineMessage(
		"domainMailboxes.syncDomainToApiKey",
		"同步授权域名到 API Key（可多选）",
		"Sync the domain to API keys (multiple)",
	),
	syncDomainToApiKeyPlaceholder: defineMessage(
		"domainMailboxes.syncDomainToApiKeyPlaceholder",
		"选择后会把当前域名加入这些 API Key 的 allowed domains，不会创建单邮箱级别的独占绑定",
		"Selecting API keys adds this domain to their allowed domains without creating mailbox-exclusive bindings",
	),
	batchTagExamplePlaceholder: defineMessage(
		"domainMailboxes.batchTagExamplePlaceholder",
		"api-pool-520958-20260318",
		"api-pool-520958-20260318",
	),
	createMode: defineMessage(
		"domainMailboxes.createMode",
		"生成方式",
		"Generation mode",
	),
	selectCreateModeRequired: defineMessage(
		"domainMailboxes.selectCreateModeRequired",
		"请选择生成方式",
		"Select a generation mode",
	),
	generateByPrefix: defineMessage(
		"domainMailboxes.generateByPrefix",
		"按前缀+数量生成",
		"Generate by prefix and count",
	),
	importByPrefixList: defineMessage(
		"domainMailboxes.importByPrefixList",
		"按前缀列表导入",
		"Import from a prefix list",
	),
	localPartList: defineMessage(
		"domainMailboxes.localPartList",
		"邮箱前缀列表",
		"Mailbox prefix list",
	),
	localPartListRequired: defineMessage(
		"domainMailboxes.localPartListRequired",
		"请输入邮箱前缀列表",
		"Enter the mailbox prefix list",
	),
	localPartListPlaceholder: defineMessage(
		"domainMailboxes.localPartListPlaceholder",
		"user001\nuser002\nuser003",
		"user001\nuser002\nuser003",
	),
	prefix: defineMessage("domainMailboxes.prefix", "前缀", "Prefix"),
	prefixRequired: defineMessage(
		"domainMailboxes.prefixRequired",
		"请输入前缀",
		"Enter the prefix",
	),
	prefixPlaceholder: defineMessage(
		"domainMailboxes.prefixPlaceholder",
		"demo",
		"demo",
	),
	count: defineMessage("domainMailboxes.count", "数量", "Count"),
	countRequired: defineMessage(
		"domainMailboxes.countRequired",
		"请输入数量",
		"Enter the count",
	),
	startFrom: defineMessage(
		"domainMailboxes.startFrom",
		"起始编号",
		"Start from",
	),
	padding: defineMessage(
		"domainMailboxes.padding",
		"补零位数",
		"Padding digits",
	),
	unifiedDisplayName: defineMessage(
		"domainMailboxes.unifiedDisplayName",
		"统一展示名",
		"Unified display name",
	),
	unifiedDisplayNamePlaceholder: defineMessage(
		"domainMailboxes.unifiedDisplayNamePlaceholder",
		"API Pool Mailbox",
		"API Pool Mailbox",
	),
	allowPortalLogin: defineMessage(
		"domainMailboxes.allowPortalLogin",
		"允许门户登录",
		"Allow portal login",
	),
	unifiedPassword: defineMessage(
		"domainMailboxes.unifiedPassword",
		"统一密码",
		"Unified password",
	),
	unifiedPasswordPlaceholder: defineMessage(
		"domainMailboxes.unifiedPasswordPlaceholder",
		"如需登录可统一设置",
		"Set a shared password if login is needed",
	),
	batchAssignTitle: defineMessage(
		"domainMailboxes.batchAssignTitle",
		"批量加入门户用户",
		"Batch add to portal user",
	),
	selectedDomainMailboxes: defineMessage(
		"domainMailboxes.selectedDomainMailboxes",
		"已选域名邮箱",
		"Selected domain mailboxes",
	),
	selectedMailboxCount: defineMessage(
		"domainMailboxes.selectedMailboxCount",
		"{count} 个",
		"{count} selected",
	),
	portalUser: defineMessage(
		"domainMailboxes.portalUser",
		"门户用户",
		"Portal user",
	),
	selectPortalUserRequired: defineMessage(
		"domainMailboxes.selectPortalUserRequired",
		"请选择门户用户",
		"Select a portal user",
	),
	selectPortalUserPlaceholder: defineMessage(
		"domainMailboxes.selectPortalUserPlaceholder",
		"选择要加入的门户用户",
		"Select the portal user to receive access",
	),
	batchDeleteByFilterTitle: defineMessage(
		"domainMailboxes.batchDeleteByFilterTitle",
		"按域名/批次批量删除",
		"Batch delete by domain or batch",
	),
	deleteBatchTagPlaceholder: defineMessage(
		"domainMailboxes.deleteBatchTagPlaceholder",
		"留空则删除该域名下匹配类型的所有邮箱",
		"Leave blank to delete all matching mailboxes under the domain",
	),
	onboardingTitle: defineMessage(
		"domainMailboxes.onboardingTitle",
		"域名邮箱接入建议",
		"Recommended mailbox onboarding flow",
	),
	onboardingBody: defineMessage(
		"domainMailboxes.onboardingBody",
		"先在域名页完成 Cloudflare 校验，再在这里创建第一个域名邮箱；如果需要门户登录，创建时直接设置密码；完成后回到域名配置页处理 Catch-all，最后再进入发信配置页补 Resend。",
		"Finish Cloudflare validation on the Domains page first, then create the first domain mailbox here. If portal login is needed, set the password during creation. After that, return to the domain configuration to handle catch-all, and finish Resend setup last.",
	),
	onboardingFocusedDomain: defineMessage(
		"domainMailboxes.onboardingFocusedDomain",
		"当前已按域名 {domain} 预选，可直接创建该域名下的第一个邮箱。",
		"The page is pre-filtered for {domain}, so you can create the first mailbox for that domain directly.",
	),
} as const;

export const MAX_LIST_PAGE_SIZE = 100;

export async function fetchAllPagedItems<T>(
	fetchPage: (
		page: number,
		pageSize: number,
	) => Promise<ApiEnvelope<PagedListResult<T>>>,
): Promise<ApiEnvelope<T[]>> {
	let page = 1;
	let total = 0;
	const items: T[] = [];

	do {
		const result = await fetchPage(page, MAX_LIST_PAGE_SIZE);
		items.push(...result.data.list);
		total = result.data.total;
		page += 1;
	} while (items.length < total);

	return {
		code: 200,
		data: items,
	};
}

export const domainMailboxStyles = {
	fullWidth: fullWidthStyle,
	profileHint: { color: "rgba(0, 0, 0, 0.45)", fontSize: 12 },
	filterRow: marginBottom16Style,
	batchPrefixRow: { display: "flex" },
} as const;
