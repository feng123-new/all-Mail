import { defineMessage } from "../../i18n/messages";

export interface DomainOption {
	id: number;
	name: string;
	canSend?: boolean;
}

export interface MailboxOption {
	id: number;
	address: string;
	domain?: { id: number; name: string; canSend?: boolean };
}

export interface SendConfigRecord {
	id: number;
	provider: string;
	fromNameDefault?: string | null;
	replyToDefault?: string | null;
	status: string;
	domain?: { id: number; name: string; canSend?: boolean };
}

export interface OutboundMessageRecord {
	id: string;
	providerMessageId?: string | null;
	fromAddress: string;
	subject?: string | null;
	status: string;
	lastError?: string | null;
	createdAt: string;
	domain?: { id: number; name: string } | null;
}

export const RESEND_DOCS = {
	domains: "https://resend.com/docs/dashboard/domains/introduction",
	cloudflareDns: "https://resend.com/docs/knowledge-base/cloudflare",
	apiKeys: "https://resend.com/docs/dashboard/api-keys/introduction",
	sendEmail: "https://resend.com/docs/api-reference/emails/send-email",
	verifyTroubleshooting:
		"https://resend.com/docs/knowledge-base/what-if-my-domain-is-not-verifying",
} as const;

export const sendingConfigsI18n = {
	fetchConfigsFailed: defineMessage(
		"sendingConfigs.fetchConfigsFailed",
		"获取发信配置失败",
		"Failed to load sending configs",
	),
	fetchHistoryFailed: defineMessage(
		"sendingConfigs.fetchHistoryFailed",
		"获取发件历史失败",
		"Failed to load sent history",
	),
	fetchDomainsFailed: defineMessage(
		"sendingConfigs.fetchDomainsFailed",
		"获取域名失败",
		"Failed to load domains",
	),
	fetchMailboxesFailed: defineMessage(
		"sendingConfigs.fetchMailboxesFailed",
		"获取邮箱失败",
		"Failed to load mailboxes",
	),
	sendTestFailed: defineMessage(
		"sendingConfigs.sendTestFailed",
		"发送测试邮件失败",
		"Failed to send the test email",
	),
	deleteConfigFailed: defineMessage(
		"sendingConfigs.deleteConfigFailed",
		"删除发信配置失败",
		"Failed to delete the sending config",
	),
	deletedConfig: defineMessage(
		"sendingConfigs.deletedConfig",
		"已删除 {domain} 的发信配置",
		"Deleted the sending config for {domain}",
	),
	currentDomain: defineMessage(
		"sendingConfigs.currentDomain",
		"该域名",
		"that domain",
	),
	deleteHistoryFailed: defineMessage(
		"sendingConfigs.deleteHistoryFailed",
		"删除发件历史失败",
		"Failed to delete the sent-history entry",
	),
	clearedHistory: defineMessage(
		"sendingConfigs.clearedHistory",
		"已清理 {count} 条发件历史",
		"Cleared {count} sent-history entries",
	),
	selectHistoryBeforeDelete: defineMessage(
		"sendingConfigs.selectHistoryBeforeDelete",
		"请先选择要清理的发件历史",
		"Select the sent-history entries to clear first",
	),
	batchDeleteHistoryFailed: defineMessage(
		"sendingConfigs.batchDeleteHistoryFailed",
		"批量清理发件历史失败",
		"Failed to clear the selected sent-history entries",
	),
	deleteConfigConfirm: defineMessage(
		"sendingConfigs.deleteConfigConfirm",
		"确定要删除这条发信配置吗？",
		"Delete this sending config?",
	),
	deleteConfigDescription: defineMessage(
		"sendingConfigs.deleteConfigDescription",
		"删除后该域名将无法继续从 all-Mail 直接发信。",
		"After deletion, that domain can no longer send directly from all-Mail.",
	),
	senderDomain: defineMessage(
		"sendingConfigs.senderDomain",
		"发件域名",
		"Sending domain",
	),
	senderAddress: defineMessage(
		"sendingConfigs.senderAddress",
		"发件地址",
		"From address",
	),
	time: defineMessage("sendingConfigs.time", "时间", "Time"),
	deleteHistoryConfirm: defineMessage(
		"sendingConfigs.deleteHistoryConfirm",
		"确定要清理这条发件历史吗？",
		"Clear this sent-history entry?",
	),
	deleteHistoryDescription: defineMessage(
		"sendingConfigs.deleteHistoryDescription",
		"这只会删除历史记录，不会撤回已经发出的邮件。",
		"This only deletes the history record; it does not recall mail that was already sent.",
	),
	batchDeleteHistoryConfirm: defineMessage(
		"sendingConfigs.batchDeleteHistoryConfirm",
		"确定要清理选中的 {count} 条发件历史吗？",
		"Clear the selected {count} sent-history entries?",
	),
	batchDeleteHistoryDescription: defineMessage(
		"sendingConfigs.batchDeleteHistoryDescription",
		"仅清理历史记录，不会影响真实发件结果。",
		"Only history records are cleared; real send results are not affected.",
	),
	noSubject: defineMessage(
		"sendingConfigs.noSubject",
		"(无主题)",
		"(No subject)",
	),
	selectDomainRequired: defineMessage(
		"sendingConfigs.selectDomainRequired",
		"请选择域名",
		"Select a domain",
	),
	senderMailbox: defineMessage(
		"sendingConfigs.senderMailbox",
		"发件邮箱",
		"Sender mailbox",
	),
	senderAddressRequired: defineMessage(
		"sendingConfigs.senderAddressRequired",
		"请输入发件地址",
		"Enter the sender address",
	),
	validEmailRequired: defineMessage(
		"sendingConfigs.validEmailRequired",
		"请输入有效邮箱地址",
		"Enter a valid email address",
	),
	recipients: defineMessage(
		"sendingConfigs.recipients",
		"收件人（逗号分隔）",
		"Recipients (comma-separated)",
	),
	recipientsRequired: defineMessage(
		"sendingConfigs.recipientsRequired",
		"请输入收件人",
		"Enter at least one recipient",
	),
	recipientsInvalid: defineMessage(
		"sendingConfigs.recipientsInvalid",
		"请检查收件人邮箱格式，支持逗号、分号或换行分隔多个地址",
		"Check the recipient email format. You can separate multiple addresses with commas, semicolons, or new lines.",
	),
	recipientsExtra: defineMessage(
		"sendingConfigs.recipientsExtra",
		"支持使用逗号、分号或换行分隔多个收件人地址。",
		"You can separate multiple recipient addresses with commas, semicolons, or new lines.",
	),
	recipientsPlaceholder: defineMessage(
		"sendingConfigs.recipientsPlaceholder",
		"例如：alice@example.com, bob@example.com",
		"For example: alice@example.com, bob@example.com",
	),
	subjectRequired: defineMessage(
		"sendingConfigs.subjectRequired",
		"请输入主题",
		"Enter a subject",
	),
	textBody: defineMessage(
		"sendingConfigs.textBody",
		"纯文本内容",
		"Plain-text body",
	),
	htmlBody: defineMessage("sendingConfigs.htmlBody", "HTML 内容", "HTML body"),
	setupGuideTitle: defineMessage(
		"sendingConfigs.setupGuideTitle",
		"Resend 配置指引",
		"Resend setup guide",
	),
	setupGuideBody: defineMessage(
		"sendingConfigs.setupGuideBody",
		"推荐顺序：先在域名页完成 Cloudflare 挂载校验，再在 Resend 中添加并验证发送域名，确认 DNS 通过后创建发送专用 API Key，最后回到 all-Mail 保存发信配置并发送测试邮件。",
		"Recommended order: complete Cloudflare validation on the Domains page first, then add and verify the sending domain in Resend. After DNS verification passes, create a sending API key and return to all-Mail to save the sending configuration and send a test email.",
	),
	docsDomain: defineMessage(
		"sendingConfigs.docsDomain",
		"Resend 域名管理",
		"Resend domain management",
	),
	docsCloudflare: defineMessage(
		"sendingConfigs.docsCloudflare",
		"Resend × Cloudflare DNS 指南",
		"Resend × Cloudflare DNS guide",
	),
	docsApiKeys: defineMessage(
		"sendingConfigs.docsApiKeys",
		"Resend API Keys",
		"Resend API keys",
	),
	docsSendEmail: defineMessage(
		"sendingConfigs.docsSendEmail",
		"Resend Send Email API",
		"Resend Send Email API",
	),
	docsVerification: defineMessage(
		"sendingConfigs.docsVerification",
		"Resend 域名验证排障",
		"Resend domain verification troubleshooting",
	),
} as const;
