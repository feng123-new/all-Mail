import {
	DeleteOutlined,
	DownloadOutlined,
	EditOutlined,
	GroupOutlined,
	InboxOutlined,
	MoreOutlined,
	PlusOutlined,
	ReloadOutlined,
	SafetyCertificateOutlined,
	SearchOutlined,
	SendOutlined,
	UploadOutlined,
} from "@ant-design/icons";
import {
	Alert,
	Button,
	Checkbox,
	Dropdown,
	Form,
	Input,
	Modal,
	message,
	Pagination,
	Popconfirm,
	Select,
	Space,
	Spin,
	Table,
	Tabs,
	Tag,
	Tooltip,
	Typography,
	Upload,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import {
	type FC,
	type Key,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader, SurfaceCard } from "../../components";
import {
	EMAIL_AUTH_TYPE_OPTIONS,
	EMAIL_PROVIDER_OPTIONS,
	type EmailAuthType,
	type EmailProvider,
	EXTERNAL_REPRESENTATIVE_PROTOCOLS,
	getDefaultAuthType,
	getDefaultProfileForRepresentativeProtocol,
	getProviderDefinition,
	getProviderImportTemplates,
	getProviderProfileDefinition,
	getProviderProfileDefinitionByKey,
	getProviderProfilesByRepresentativeProtocol,
	getRepresentativeProtocolTagColor,
	type MailProviderConfig,
	type ProviderProfileCapabilities,
	type ProviderProfileKey,
	type RepresentativeProtocol,
	type SecondaryProtocol,
} from "../../constants/providers";
import { emailsContract } from "../../contracts/admin/emails";
import { useAuthStore } from "../../stores/authStore";
import {
	displayBlockMarginBottom4Style,
	displayBlockMarginBottom6Style,
	displayBlockMarginBottom12Style,
	flexBetweenFullWidthStyle,
	flexBetweenWrapStyle,
	fullWidthStyle,
	marginBottom8Style,
	marginBottom12Style,
	marginBottom16Style,
	marginTop8Style,
	maxHeight450AutoStyle,
	preWrapBreakWordStyle,
	secondaryMutedOffsetTextStyle,
	secondaryMutedTextStyle,
	width140Style,
	width150Style,
	width160Style,
	width170Style,
	width200Style,
	width260Style,
	widthFullMarginTop8Style,
} from "../../styles/common";
import { getErrorMessage } from "../../utils/error";
import {
	renderPlainTextWithLinks,
	renderSanitizedEmailHtml,
} from "../../utils/mailContent";
import { adminI18n } from "../../i18n/catalog/admin";
import {
	getAuthTypeLabelMessage,
	getProviderEmailPlaceholderMessage,
	getProviderLabelMessage,
	getProviderProfileDescriptionMessage,
	getProviderProfileLabelMessage,
	getProviderProfileSecretHelpTextMessage,
	getProviderProfileSecretLabelMessage,
	getProviderProfileSecretPlaceholderMessage,
	getProviderProfileServerConfigHelpTextMessage,
	getProviderProfileSummaryHintMessage,
	getRepresentativeProtocolConnectionLabelMessage,
	getRepresentativeProtocolDescriptionMessage,
	getRepresentativeProtocolLabelMessage,
	getSecondaryProtocolLabelMessage,
} from "../../i18n/catalog/providers";
import { providerSetupI18n } from "../../i18n/catalog/providerSetup";
import { useI18n } from "../../i18n";
import { defineMessage, type TranslationInput } from "../../i18n/messages";
import { requestData } from "../../utils/request";
import { emailsInlineI18n } from "./inlineMessages";

const emailsPageI18n = {
	fetchStrategyGraphFirstVerbose: defineMessage(
		"emails.fetchStrategy.graphFirstVerbose",
		"Graph 优先（失败回退 IMAP）",
		"Graph first (fallback to IMAP on failure)",
	),
	fetchStrategyImapFirstVerbose: defineMessage(
		"emails.fetchStrategy.imapFirstVerbose",
		"IMAP 优先（失败回退 Graph）",
		"IMAP first (fallback to Graph on failure)",
	),
	fetchStrategyGraphOnly: defineMessage(
		"emails.fetchStrategy.graphOnly",
		"仅 Graph",
		"Graph only",
	),
	fetchStrategyImapOnly: defineMessage(
		"emails.fetchStrategy.imapOnly",
		"仅 IMAP",
		"IMAP only",
	),
	fetchStrategyGraphFirstShort: defineMessage(
		"emails.fetchStrategy.graphFirstShort",
		"Graph 优先",
		"Graph first",
	),
	fetchStrategyImapFirstShort: defineMessage(
		"emails.fetchStrategy.imapFirstShort",
		"IMAP 优先",
		"IMAP first",
	),
	statusError: defineMessage("emails.status.error", "异常", "Error"),
	mailboxJunk: defineMessage("emails.mailbox.junk", "垃圾箱", "Junk"),
	capabilityGroupReceive: defineMessage(
		"emails.capabilityGroup.receive",
		"收取能力",
		"Receive capabilities",
	),
	capabilityGroupOperate: defineMessage(
		"emails.capabilityGroup.operate",
		"操作能力",
		"Operational capabilities",
	),
	capabilityGroupConnect: defineMessage(
		"emails.capabilityGroup.connect",
		"连接能力",
		"Connection capabilities",
	),
	capabilityReadInbox: defineMessage(
		"emails.capability.readInbox",
		"收件箱",
		"Inbox",
	),
	capabilityReadJunk: defineMessage(
		"emails.capability.readJunk",
		"垃圾箱",
		"Junk",
	),
	capabilityReadSent: defineMessage(
		"emails.capability.readSent",
		"已发送",
		"Sent",
	),
	capabilityClearMailbox: defineMessage(
		"emails.capability.clearMailbox",
		"批量清空",
		"Bulk clear",
	),
	capabilitySendMail: defineMessage(
		"emails.capability.sendMail",
		"发信",
		"Send mail",
	),
	capabilityUsesOAuth: defineMessage(
		"emails.capability.usesOAuth",
		"OAuth",
		"OAuth",
	),
	capabilityReceiveMail: defineMessage(
		"emails.capability.receiveMail",
		"可收件",
		"Receives mail",
	),
	capabilityApiAccess: defineMessage(
		"emails.capability.apiAccess",
		"API Access",
		"API access",
	),
	capabilityForwarding: defineMessage(
		"emails.capability.forwarding",
		"Forwarding",
		"Forwarding",
	),
	capabilitySearch: defineMessage(
		"emails.capability.search",
		"搜索",
		"Search",
	),
	capabilityRefreshToken: defineMessage(
		"emails.capability.refreshToken",
		"Refresh Token",
		"Refresh token",
	),
	capabilityWebhook: defineMessage(
		"emails.capability.webhook",
		"Webhook",
		"Webhook",
	),
	capabilityAliasSupport: defineMessage(
		"emails.capability.aliasSupport",
		"Alias",
		"Alias",
	),
	capabilityModes: defineMessage(
		"emails.capability.modes",
		"Modes",
		"Modes",
	),
	capabilitySupported: defineMessage(
		"emails.capability.supported",
		"支持",
		"Supported",
	),
	capabilityUnsupported: defineMessage(
		"emails.capability.unsupported",
		"否",
		"No",
	),
	capabilityNoModes: defineMessage(
		"emails.capability.noModes",
		"无",
		"None",
	),
	providerProfileHeading: defineMessage(
		"emails.providerProfile.heading",
		"Provider Profile",
		"Provider profile",
	),
	selectedProtocolAlertTitle: defineMessage(
		"emails.selectedProtocol.alertTitle",
		"当前选择会按 {protocol} 主分类展示",
		"The current selection will be shown under the {protocol} primary family",
	),
	currentProfileInline: defineMessage(
		"emails.selectedProtocol.currentProfileInline",
		"当前 profile：{profile}",
		"Current profile: {profile}",
	),
	representativeProtocolInline: defineMessage(
		"emails.selectedProtocol.representativeInline",
		"代表协议：{protocol}",
		"Representative protocol: {protocol}",
	),
	profileInline: defineMessage(
		"emails.selectedProtocol.profileInline",
		"Profile：{profile}",
		"Profile: {profile}",
	),
	secondaryProtocolInline: defineMessage(
		"emails.selectedProtocol.secondaryInline",
		"辅助协议：{protocol}",
		"Secondary protocol: {protocol}",
	),
	connectionPathHint: defineMessage(
		"emails.selectedProtocol.connectionPathHint",
		"当前连接路径遵循“协议家族 → provider profile → capability”顺序：先确定是 OAuth API 还是 IMAP / SMTP，再落到具体 provider profile。",
		"This connection path follows protocol family → provider profile → capability: first decide between OAuth API and IMAP / SMTP, then land on the specific provider profile.",
	),
	capabilityMatrixHeading: defineMessage(
		"emails.capabilityMatrix.heading",
		"Capability Matrix",
		"Capability matrix",
	),
	capabilityMatrixDescription: defineMessage(
		"emails.capabilityMatrix.description",
		"当前 profile 的能力矩阵会直接决定列表页的可检查、可发信、可清空和后续扩展边界。",
		"The current profile’s capability matrix directly defines what the list can check, send, clear, and extend later.",
	),
	editMailboxTitle: defineMessage(
		"emails.modal.editMailboxTitle",
		"编辑邮箱",
		"Edit mailbox",
	),
	manualSaveAdvanced: defineMessage(
		"emails.modal.manualSaveAdvanced",
		"手动保存（高级）",
		"Manual save (advanced)",
	),
	save: defineMessage("emails.modal.save", "保存", "Save"),
	emailAddressLabel: defineMessage(
		"emails.form.emailAddressLabel",
		"邮箱地址",
		"Mailbox address",
	),
	emailAddressRequired: defineMessage(
		"emails.form.emailAddressRequired",
		"请输入邮箱地址",
		"Enter the mailbox address",
	),
	validEmailRequired: defineMessage(
		"emails.form.validEmailRequired",
		"请输入有效的邮箱地址",
		"Enter a valid email address",
	),
} as const;

const { Text } = Typography;
const { TextArea } = Input;
const { Dragger } = Upload;
const MAIL_FETCH_STRATEGY_OPTIONS = [
	{ value: "GRAPH_FIRST", label: emailsPageI18n.fetchStrategyGraphFirstVerbose },
	{ value: "IMAP_FIRST", label: emailsPageI18n.fetchStrategyImapFirstVerbose },
	{ value: "GRAPH_ONLY", label: emailsPageI18n.fetchStrategyGraphOnly },
	{ value: "IMAP_ONLY", label: emailsPageI18n.fetchStrategyImapOnly },
] as const;

type MailFetchStrategy = (typeof MAIL_FETCH_STRATEGY_OPTIONS)[number]["value"];

const MAIL_FETCH_STRATEGY_LABELS: Record<MailFetchStrategy, TranslationInput> = {
	GRAPH_FIRST: emailsPageI18n.fetchStrategyGraphFirstShort,
	IMAP_FIRST: emailsPageI18n.fetchStrategyImapFirstShort,
	GRAPH_ONLY: emailsPageI18n.fetchStrategyGraphOnly,
	IMAP_ONLY: emailsPageI18n.fetchStrategyImapOnly,
};

type EmailAccountStatus = EmailAccount["status"];

const EMAIL_STATUS_FILTER_OPTIONS: Array<{
	value: EmailAccountStatus;
	label: TranslationInput;
}> = [
	{ value: "ACTIVE", label: adminI18n.common.healthy },
	{ value: "ERROR", label: emailsPageI18n.statusError },
	{ value: "DISABLED", label: adminI18n.common.disabled },
];

function parseEmailStatus(
	value: string | null | undefined,
): EmailAccountStatus | undefined {
	if (!value) {
		return undefined;
	}
	const normalized = value.toUpperCase();
	return normalized === "ACTIVE" ||
		normalized === "ERROR" ||
		normalized === "DISABLED"
		? normalized
		: undefined;
}

function parsePositiveInt(
	value: string | null | undefined,
): number | undefined {
	if (!value) {
		return undefined;
	}
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

const emailStyles = {
	pageTitle: { margin: "0 0 16px" },
	filterToolbar: flexBetweenWrapStyle,
	capabilityBox: {
		marginBottom: 16,
		padding: 16,
		borderRadius: 12,
		border: "1px solid #f0f0f0",
		background: "#fafafa",
	},
	modalSectionHeading: { fontWeight: 600, marginBottom: 4 },
	modalSectionHeadingWide: { fontWeight: 600, marginBottom: 8 },
	secondaryBlock: displayBlockMarginBottom12Style,
	secondaryColumnBlock: { ...fullWidthStyle, marginBottom: 16 },
	listTopActions: marginBottom16Style,
	mailSummaryLink: secondaryMutedTextStyle,
	primaryMailSummaryLink: { color: "#1890ff" },
	mailSummaryCount: secondaryMutedOffsetTextStyle,
	selectedMailList: maxHeight450AutoStyle,
	messagePreviewText: { maxWidth: 600 },
	detailPanel: {
		border: "1px solid #eee",
		borderRadius: 8,
		padding: 16,
		background: "#fafafa",
	},
	addressCell: {
		display: "grid",
		gap: 4,
	},
	addressText: {
		fontWeight: 680,
		color: "#0f172a",
		fontSize: 14,
		whiteSpace: "nowrap",
	},
	metaText: {
		fontSize: 12,
		color: "#64748b",
		lineHeight: 1.5,
	},
	errorText: {
		fontSize: 12,
		color: "#b91c1c",
		lineHeight: 1.5,
	},
	contractCell: {
		display: "grid",
		gap: 6,
	},
	clientIdText: {
		fontSize: 12,
		color: "#334155",
		lineHeight: 1.5,
		wordBreak: "break-all",
	},
	actionCell: {
		display: "grid",
		gap: 8,
	},
	selectionAlert: {
		marginBottom: 16,
	},
	selectionBar: {
		marginBottom: 16,
	},
} as const;

function getEmailStatusMeta(
	status: EmailAccountStatus,
	t: (source: TranslationInput, params?: Record<string, number | string>) => string,
) {
	const colors: Record<EmailAccountStatus, string> = {
		ACTIVE: "green",
		ERROR: "red",
		DISABLED: "default",
	};
	const labels: Record<EmailAccountStatus, string> = {
		ACTIVE: t(adminI18n.common.healthy),
		ERROR: t(emailsPageI18n.statusError),
		DISABLED: t(adminI18n.common.disabled),
	};
	return { color: colors[status], label: labels[status] };
}

interface GroupPayload {
	name: string;
	description?: string;
	fetchStrategy: MailFetchStrategy;
}

const normalizeGroupPayload = (values: GroupFormValues): GroupPayload => ({
	...values,
	description:
		typeof values.description === "string" ? values.description : undefined,
});

interface EmailGroup {
	id: number;
	name: string;
	description: string | null;
	fetchStrategy: MailFetchStrategy;
	emailCount: number;
	createdAt: string;
	updatedAt: string;
}

interface GroupFormValues {
	name: string;
	description?: string | null;
	fetchStrategy: MailFetchStrategy;
}

interface EmailAccount {
	id: number;
	email: string;
	provider: EmailProvider;
	authType: EmailAuthType;
	hasStoredPassword: boolean;
	hasStoredAccountLoginPassword: boolean;
	providerConfig?: MailProviderConfig | null;
	providerProfile?: string;
	representativeProtocol?: RepresentativeProtocol;
	secondaryProtocols?: SecondaryProtocol[];
	profileSummaryHint?: string;
	capabilitySummary?: ProviderProfileCapabilities;
	clientId: string | null;
	status: "ACTIVE" | "ERROR" | "DISABLED";
	groupId: number | null;
	group: { id: number; name: string } | null;
	lastCheckAt: string | null;
	mailboxStatus?: MailboxStatus | null;
	errorMessage: string | null;
	createdAt: string;
}

const canRevealStoredAccountLoginPassword = (
	record: Pick<EmailAccount, "hasStoredAccountLoginPassword">,
) => Boolean(record.hasStoredAccountLoginPassword);

interface EmailListResult {
	list: EmailAccount[];
	total: number;
}

interface BatchFetchMailboxResult {
	targeted: number;
	successCount: number;
	partialCount: number;
	errorCount: number;
	skippedCount: number;
}

interface MailItem {
	id: string;
	from: string;
	to: string;
	subject: string;
	text: string;
	html: string;
	date: string;
}

type MailboxName = "INBOX" | "SENT" | "Junk";

interface MailboxState {
	latestMessageId: string | null;
	latestMessageDate: string | null;
	messageCount: number;
	hasNew: boolean;
	lastSyncedAt: string | null;
	lastViewedAt: string | null;
}

interface MailboxStatus {
	INBOX: MailboxState;
	SENT: MailboxState;
	Junk: MailboxState;
}

const createEmptyMailboxState = (): MailboxState => ({
	latestMessageId: null,
	latestMessageDate: null,
	messageCount: 0,
	hasNew: false,
	lastSyncedAt: null,
	lastViewedAt: null,
});

const EMPTY_MAILBOX_STATUS: MailboxStatus = {
	INBOX: createEmptyMailboxState(),
	SENT: createEmptyMailboxState(),
	Junk: createEmptyMailboxState(),
};

const MAILBOX_LABELS: Record<MailboxName, TranslationInput> = {
	INBOX: adminI18n.emails.inbox,
	SENT: adminI18n.emails.sent,
	Junk: emailsPageI18n.mailboxJunk,
};

const CAPABILITY_GROUPS: Array<{
	key: string;
	title: TranslationInput;
	keys: Array<keyof ProviderProfileCapabilities>;
}> = [
	{
		key: "receive",
		title: emailsPageI18n.capabilityGroupReceive,
		keys: ["readInbox", "readJunk", "readSent", "receiveMail"],
	},
	{
		key: "operate",
		title: emailsPageI18n.capabilityGroupOperate,
		keys: ["clearMailbox", "sendMail", "search", "aliasSupport"],
	},
	{
		key: "connect",
		title: emailsPageI18n.capabilityGroupConnect,
		keys: ["usesOAuth", "refreshToken", "webhook", "apiAccess", "forwarding"],
	},
];

const CAPABILITY_LABELS: Record<keyof ProviderProfileCapabilities, TranslationInput> = {
	readInbox: emailsPageI18n.capabilityReadInbox,
	readJunk: emailsPageI18n.capabilityReadJunk,
	readSent: emailsPageI18n.capabilityReadSent,
	clearMailbox: emailsPageI18n.capabilityClearMailbox,
	sendMail: emailsPageI18n.capabilitySendMail,
	usesOAuth: emailsPageI18n.capabilityUsesOAuth,
	receiveMail: emailsPageI18n.capabilityReceiveMail,
	apiAccess: emailsPageI18n.capabilityApiAccess,
	forwarding: emailsPageI18n.capabilityForwarding,
	search: emailsPageI18n.capabilitySearch,
	refreshToken: emailsPageI18n.capabilityRefreshToken,
	webhook: emailsPageI18n.capabilityWebhook,
	aliasSupport: emailsPageI18n.capabilityAliasSupport,
	modes: emailsPageI18n.capabilityModes,
};

const renderCapabilityMatrix = (
	capabilitySummary: ProviderProfileCapabilities,
	t: (source: TranslationInput, params?: Record<string, number | string>) => string,
	compact = false,
) => (
	<Space orientation="vertical" size={compact ? 8 : 12} style={fullWidthStyle}>
		{CAPABILITY_GROUPS.map((group) => (
			<div key={group.key}>
				<Text strong style={displayBlockMarginBottom6Style}>
					{t(group.title)}
				</Text>
				<Space wrap>
					{group.keys.map((key) => (
						<Tag
							key={key}
							color={capabilitySummary[key] ? "success" : "default"}
						>
							{t(CAPABILITY_LABELS[key])}：{capabilitySummary[key] ? t(emailsPageI18n.capabilitySupported) : t(emailsPageI18n.capabilityUnsupported)}
						</Tag>
					))}
				</Space>
			</div>
		))}
		<div>
			<Text strong style={displayBlockMarginBottom6Style}>
				{t(emailsPageI18n.capabilityModes)}
			</Text>
			<Space wrap>
				{capabilitySummary.modes.length > 0 ? (
					capabilitySummary.modes.map((mode) => (
						<Tag key={mode} color="processing">
							{mode}
						</Tag>
					))
				) : (
					<Tag>{t(emailsPageI18n.capabilityNoModes)}</Tag>
				)}
			</Space>
		</div>
	</Space>
);

const toOptionalNumber = (value: unknown): number | undefined => {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
};

const trimOptionalString = (value: unknown): string | undefined => {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed ? trimmed : undefined;
};

const buildProviderConfigFormValues = (
	config?: Partial<MailProviderConfig> | null,
) => ({
	providerConfig: {
		imapHost: trimOptionalString(config?.imapHost),
		imapPort: config?.imapPort,
		imapTls: config?.imapTls ?? true,
		smtpHost: trimOptionalString(config?.smtpHost),
		smtpPort: config?.smtpPort,
		smtpSecure: config?.smtpSecure ?? true,
		folders: {
			inbox: trimOptionalString(config?.folders?.inbox),
			junk: trimOptionalString(config?.folders?.junk),
			sent: trimOptionalString(config?.folders?.sent),
		},
	},
});

const normalizeProviderConfigInput = (
	value: unknown,
): Record<string, unknown> | undefined => {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}

	const config = value as MailProviderConfig;
	const normalized: MailProviderConfig = {
		readMode: "IMAP",
		imapHost: trimOptionalString(config.imapHost),
		imapPort: toOptionalNumber(config.imapPort),
		imapTls: config.imapTls !== false,
		smtpHost: trimOptionalString(config.smtpHost),
		smtpPort: toOptionalNumber(config.smtpPort),
		smtpSecure: config.smtpSecure !== false,
	};

	const folders = {
		inbox: trimOptionalString(config.folders?.inbox),
		junk: trimOptionalString(config.folders?.junk),
		sent: trimOptionalString(config.folders?.sent),
	};

	if (folders.inbox || folders.junk || folders.sent) {
		normalized.folders = folders;
	}

	return normalized as Record<string, unknown>;
};

const normalizeMailboxStatus = (
	status?: Partial<MailboxStatus> | null,
): MailboxStatus => ({
	INBOX: { ...createEmptyMailboxState(), ...(status?.INBOX || {}) },
	SENT: { ...createEmptyMailboxState(), ...(status?.SENT || {}) },
	Junk: { ...createEmptyMailboxState(), ...(status?.Junk || {}) },
});

interface ComposeMailValues {
	fromName?: string;
	to: string;
	subject: string;
	text: string;
}

interface EmailDetailsResult extends EmailAccount {
	refreshToken?: string | null;
	clientSecret?: string | null;
	password?: string | null;
	accountLoginPassword?: string | null;
}

type RevealableEmailSecretField = "password" | "refreshToken" | "accountLoginPassword";

interface RevealSecretsResult {
	secrets: Partial<Record<RevealableEmailSecretField, string | null>>;
	availableFields: RevealableEmailSecretField[];
}

interface RevealUnlockResult {
	grantToken: string;
	expiresAt: string;
}

interface OAuthProviderStatus {
	configured: boolean;
	redirectUri: string | null;
	source: "database" | "environment" | "none";
	clientId: string | null;
	scopes: string | null;
	tenant: string | null;
	hasClientSecret: boolean;
}

interface GoogleClientSecretParseResult {
	clientId: string;
	clientSecret: string;
	redirectUri: string;
	redirectUris: string[];
	projectId: string | null;
}

interface OAuthCompletionPayload {
	provider: "GMAIL" | "OUTLOOK";
	status: "success" | "warning" | "error";
	code: string;
	email?: string;
	action?: string;
}

interface OAuthAuthorizationStartResult {
	provider: "GMAIL" | "OUTLOOK";
	state: string;
	authUrl: string;
	expiresIn: number;
	expiresAt: number;
}

interface OAuthAuthorizationStatusResult {
	provider: "GMAIL" | "OUTLOOK";
	state: string;
	status: "pending" | "processing" | "completed" | "expired";
	expiresAt?: number;
	completedAt?: number;
	result?: OAuthCompletionPayload;
}

const DEFAULT_GOOGLE_OAUTH_SCOPES =
	"openid email profile https://www.googleapis.com/auth/gmail.modify https://mail.google.com/";
const DEFAULT_OUTLOOK_OAUTH_SCOPES =
	"offline_access openid profile email https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Contacts.ReadWrite https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/MailboxSettings.ReadWrite";
const DEFAULT_OUTLOOK_OAUTH_TENANT = "consumers";

const EMPTY_OAUTH_PROVIDER_STATUS: OAuthProviderStatus = {
	configured: false,
	redirectUri: null,
	source: "none",
	clientId: null,
	scopes: null,
	tenant: null,
	hasClientSecret: false,
};

const getGoogleOAuthFormDefaults = (status: OAuthProviderStatus) => ({
	gmailOAuthCallbackUri: status.redirectUri || "",
	gmailOAuthClientId: status.clientId || "",
	gmailOAuthClientSecret: "",
	gmailOAuthScopes: status.scopes || DEFAULT_GOOGLE_OAUTH_SCOPES,
	gmailOAuthJsonText: "",
});

const getOutlookOAuthFormDefaults = (status: OAuthProviderStatus) => ({
	outlookOAuthCallbackUri: status.redirectUri || "",
	outlookOAuthClientId: status.clientId || "",
	outlookOAuthClientSecret: "",
	outlookOAuthTenant: status.tenant || DEFAULT_OUTLOOK_OAUTH_TENANT,
	outlookOAuthScopes: status.scopes || DEFAULT_OUTLOOK_OAUTH_SCOPES,
});

const EmailsPage: FC = () => {
	const { t } = useI18n();
	const getOAuthProviderLabel = useCallback(
		(provider: "GMAIL" | "OUTLOOK") =>
			t(getProviderLabelMessage(provider)),
		[t],
	);
	const getOAuthActionLabel = useCallback(
		(action?: string) => {
			if (action === "created_new_email") {
				return t(providerSetupI18n["emails.oauth.actionCreated"]);
			}
			if (action === "updated_exact_email" || action === "updated_target_id") {
				return t(providerSetupI18n["emails.oauth.actionUpdated"]);
			}
			return t(providerSetupI18n["emails.oauth.actionUpdated"]);
		},
		[t],
	);
	const navigate = useNavigate();
	const { admin } = useAuthStore();
	const [searchParams] = useSearchParams();
	const initialKeyword = searchParams.get("keyword")?.trim() || "";
	const initialFilterStatus = parseEmailStatus(searchParams.get("status"));
	const initialFocusedEmailId = parsePositiveInt(searchParams.get("emailId"));
	const [loading, setLoading] = useState(false);
	const [data, setData] = useState<EmailAccount[]>([]);
	const [total, setTotal] = useState(0);
	const [page, setPage] = useState(1);
	const [pageSize, setPageSize] = useState(10);
	const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
	const [modalVisible, setModalVisible] = useState(false);
	const [importModalVisible, setImportModalVisible] = useState(false);
	const [mailModalVisible, setMailModalVisible] = useState(false);
	const [editingId, setEditingId] = useState<number | null>(null);
	const [keyword, setKeyword] = useState(initialKeyword);
	const [debouncedKeyword, setDebouncedKeyword] = useState(initialKeyword);
	const [filterGroupId, setFilterGroupId] = useState<number | undefined>(
		undefined,
	);
	const [filterRepresentativeProtocol, setFilterRepresentativeProtocol] =
		useState<RepresentativeProtocol | undefined>(undefined);
	const [filterProvider, setFilterProvider] = useState<
		EmailProvider | undefined
	>(undefined);
	const [filterStatus, setFilterStatus] = useState<
		EmailAccountStatus | undefined
	>(initialFilterStatus);
	const [focusedEmailId, setFocusedEmailId] = useState<number | undefined>(
		initialFocusedEmailId,
	);
	const [importContent, setImportContent] = useState("");
	const [separator, setSeparator] = useState("----");
	const [importGroupId, setImportGroupId] = useState<number | undefined>(
		undefined,
	);
	const [mailList, setMailList] = useState<MailItem[]>([]);
	const [mailLoading, setMailLoading] = useState(false);
	const [currentEmail, setCurrentEmail] = useState<string>("");
	const [currentEmailId, setCurrentEmailId] = useState<number | null>(null);
	const [currentEmailRecord, setCurrentEmailRecord] =
		useState<EmailAccount | null>(null);
	const [currentMailbox, setCurrentMailbox] = useState<MailboxName>("INBOX");
	const [emailDetailVisible, setEmailDetailVisible] = useState(false);
	const [selectedMailDetail, setSelectedMailDetail] = useState<MailItem | null>(
		null,
	);
	const [selectedMailIds, setSelectedMailIds] = useState<string[]>([]);
	const [mailListPage, setMailListPage] = useState(1);
	const [mailListPageSize, setMailListPageSize] = useState(10);
	const [deletingSelectedMails, setDeletingSelectedMails] = useState(false);
	const [composeModalVisible, setComposeModalVisible] = useState(false);
	const [composeSending, setComposeSending] = useState(false);
	const [batchFetchLoading, setBatchFetchLoading] = useState(false);
	const [checkingEmailIds, setCheckingEmailIds] = useState<number[]>([]);
	const [batchClearModalVisible, setBatchClearModalVisible] = useState(false);
	const [batchClearLoading, setBatchClearLoading] = useState(false);
	const [batchClearMailbox, setBatchClearMailbox] = useState<"INBOX" | "Junk">(
		"INBOX",
	);
	const [emailEditLoading, setEmailEditLoading] = useState(false);
	const [revealModalVisible, setRevealModalVisible] = useState(false);
	const [revealLoading, setRevealLoading] = useState(false);
	const [revealOtp, setRevealOtp] = useState("");
	const [revealGrantToken, setRevealGrantToken] = useState<string | null>(null);
	const [revealGrantExpiresAt, setRevealGrantExpiresAt] = useState<number | null>(
		null,
	);
	const [revealTargetEmailId, setRevealTargetEmailId] = useState<number | null>(
		null,
	);
	const [revealTargetSource, setRevealTargetSource] = useState<
		"edit" | "row" | null
	>(null);
	const [revealTargetEmailLabel, setRevealTargetEmailLabel] = useState<string | null>(
		null,
	);
	const [revealTargetField, setRevealTargetField] =
		useState<RevealableEmailSecretField | null>(null);
	const [revealedSecrets, setRevealedSecrets] = useState<
		Partial<Record<RevealableEmailSecretField, string | null>>
	>({});
	const [revealExpiresAt, setRevealExpiresAt] = useState<number | null>(null);
	const [rowRevealVisible, setRowRevealVisible] = useState(false);
	const [rowRevealedAccountLoginPassword, setRowRevealedAccountLoginPassword] = useState<string | null>(
		null,
	);
	const [rowRevealExpiresAt, setRowRevealExpiresAt] = useState<number | null>(null);
	const [oauthProviderStatuses, setOauthProviderStatuses] = useState<
		Record<"GMAIL" | "OUTLOOK", OAuthProviderStatus>
	>({
		GMAIL: { ...EMPTY_OAUTH_PROVIDER_STATUS },
		OUTLOOK: { ...EMPTY_OAUTH_PROVIDER_STATUS },
	});
	const [googleParseLoading, setGoogleParseLoading] = useState(false);
	const [googleSaveLoading, setGoogleSaveLoading] = useState(false);
	const [googleAuthUrlLoading, setGoogleAuthUrlLoading] = useState(false);
	const [generatedGoogleAuthUrl, setGeneratedGoogleAuthUrl] = useState("");
	const [googleOAuthPendingState, setGoogleOAuthPendingState] = useState("");
	const [googleOAuthPollStatus, setGoogleOAuthPollStatus] = useState<
		"idle" | "pending" | "processing"
	>("idle");
	const [googleOAuthStatusExpiresAt, setGoogleOAuthStatusExpiresAt] = useState<
		number | null
	>(null);
	const [outlookSaveLoading, setOutlookSaveLoading] = useState(false);
	const [outlookAuthUrlLoading, setOutlookAuthUrlLoading] = useState(false);
	const [generatedOutlookAuthUrl, setGeneratedOutlookAuthUrl] = useState("");
	const [outlookOAuthPendingState, setOutlookOAuthPendingState] = useState("");
	const [outlookOAuthPollStatus, setOutlookOAuthPollStatus] = useState<
		"idle" | "pending" | "processing"
	>("idle");
	const [outlookOAuthStatusExpiresAt, setOutlookOAuthStatusExpiresAt] =
		useState<number | null>(null);
	const [form] = Form.useForm();
	const [composeForm] = Form.useForm<ComposeMailValues>();
	const mailFetchStrategyOptions = useMemo(
		() =>
			MAIL_FETCH_STRATEGY_OPTIONS.map((option) => ({
				...option,
				label: t(option.label),
			})),
		[t],
	);
	const emailStatusFilterOptions = useMemo(
		() =>
			EMAIL_STATUS_FILTER_OPTIONS.map((option) => ({
				...option,
				label: t(option.label),
			})),
		[t],
	);

	// Group-related state
	const [groups, setGroups] = useState<EmailGroup[]>([]);
	const [groupModalVisible, setGroupModalVisible] = useState(false);
	const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
	const [groupForm] = Form.useForm();
	const [assignGroupModalVisible, setAssignGroupModalVisible] = useState(false);
	const [assignTargetGroupId, setAssignTargetGroupId] = useState<
		number | undefined
	>(undefined);
	const latestListRequestIdRef = useRef(0);
	const selectedProvider =
		(Form.useWatch("provider", form) as EmailProvider | undefined) || "OUTLOOK";
	const selectedAuthType =
		(Form.useWatch("authType", form) as EmailAuthType | undefined) ||
		getDefaultAuthType(selectedProvider);
	const isOutlookProvider = selectedProvider === "OUTLOOK";
	const isGmailProvider = selectedProvider === "GMAIL";
	const isGmailAppPassword =
		isGmailProvider && selectedAuthType === "APP_PASSWORD";
	const isGmailOAuth = isGmailProvider && selectedAuthType === "GOOGLE_OAUTH";
	const isGenericImapSmtpProvider =
		!isOutlookProvider &&
		!isGmailProvider &&
		selectedAuthType === "APP_PASSWORD";
	const isCustomImapSmtpProvider =
		selectedProvider === "CUSTOM_IMAP_SMTP" &&
		selectedAuthType === "APP_PASSWORD";
	const isOutlookOAuthConfigured = oauthProviderStatuses.OUTLOOK.configured;
	const isGmailOAuthConfigured = oauthProviderStatuses.GMAIL.configured;
	const requiresPasswordAuth = selectedAuthType === "APP_PASSWORD";
	const requiresOAuthFields = isOutlookProvider || isGmailOAuth;
	const clearMailboxDisabled = currentEmailRecord
		? !currentEmailRecord.capabilitySummary?.clearMailbox
		: true;
	const sendMailboxDisabled = currentEmailRecord
		? !currentEmailRecord.capabilitySummary?.sendMail
		: true;
	const selectedProviderDefinition = useMemo(
		() => getProviderDefinition(selectedProvider),
		[selectedProvider],
	);
	const selectedProfileDefinition = useMemo(
		() => getProviderProfileDefinition(selectedProvider, selectedAuthType),
		[selectedAuthType, selectedProvider],
	);
	const selectedProfileConfigDefaults =
		selectedProfileDefinition.providerConfigDefaults;
	const selectedProfileCapabilitySummary =
		selectedProfileDefinition.capabilitySummary;
	const selectedRepresentativeProtocol =
		selectedProfileDefinition.representativeProtocol;
	const isTwoFactorEnabled = Boolean(admin?.twoFactorEnabled);
	const hasActiveRevealGrant = Boolean(
		revealGrantToken && revealGrantExpiresAt && revealGrantExpiresAt > Date.now(),
	);
	const revealedSecretValue = revealTargetField
		? revealedSecrets[revealTargetField]
		: undefined;
	const revealTargetLabel =
		revealTargetSource === "row"
			? t(emailsInlineI18n["emails.reveal.loginPasswordLabel"])
			: revealTargetField === "accountLoginPassword"
			? t(emailsInlineI18n["emails.reveal.accountLoginPasswordLabel"])
			: revealTargetField === "refreshToken"
			? t(emailsInlineI18n["emails.reveal.refreshTokenLabel"])
			: t(
				getProviderProfileSecretLabelMessage(selectedProfileDefinition.key) ||
					defineMessage(
						"emails.imap.genericCredentialLabel",
						"{providerLabel} 授权码 / 应用专用密码",
						"{providerLabel} authorization code / app password",
					),
				{ providerLabel: t(getProviderLabelMessage(selectedProvider)) },
			);
	const availableProfileDefinitions = useMemo(
		() =>
			getProviderProfilesByRepresentativeProtocol(
				selectedRepresentativeProtocol,
			),
		[selectedRepresentativeProtocol],
	);
	const filterProviderOptions = useMemo(() => {
		if (!filterRepresentativeProtocol) {
			return EMAIL_PROVIDER_OPTIONS.map((option) => ({
				...option,
				label: t(getProviderLabelMessage(option.value)),
			}));
		}

		const supportedProviders = new Set(
			getProviderProfilesByRepresentativeProtocol(
				filterRepresentativeProtocol,
			).map((profile) => profile.provider),
		);

		return EMAIL_PROVIDER_OPTIONS.filter((option) =>
			supportedProviders.has(option.value),
		).map((option) => ({
			...option,
			label: t(getProviderLabelMessage(option.value)),
		}));
	}, [filterRepresentativeProtocol, t]);
	const importTemplates = useMemo(
		() => getProviderImportTemplates(separator),
		[separator],
	);
	const recommendedImportTemplates = useMemo(
		() => importTemplates.slice(0, 3),
		[importTemplates],
	);
	const legacyImportTemplates = useMemo(
		() => importTemplates.slice(3),
		[importTemplates],
	);

	const resetSecretRevealState = useCallback(() => {
		setRevealModalVisible(false);
		setRevealOtp("");
		setRevealLoading(false);
		setRevealTargetEmailId(null);
		setRevealTargetSource(null);
		setRevealTargetEmailLabel(null);
		setRevealTargetField(null);
		setRevealedSecrets({});
		setRevealExpiresAt(null);
	}, []);

	const resetRowRevealState = useCallback(() => {
		setRowRevealVisible(false);
		setRowRevealedAccountLoginPassword(null);
		setRowRevealExpiresAt(null);
	}, []);

	useEffect(() => {
		if (!revealExpiresAt) {
			return;
		}

		const remainingMs = revealExpiresAt - Date.now();
		if (remainingMs <= 0) {
			setRevealedSecrets({});
			setRevealExpiresAt(null);
			return;
		}

		const timer = window.setTimeout(() => {
			setRevealedSecrets({});
			setRevealExpiresAt(null);
			message.info(t(emailsInlineI18n["emails.reveal.secretAutoHidden"]));
		}, remainingMs);

		return () => window.clearTimeout(timer);
	}, [revealExpiresAt, t]);

	useEffect(() => {
		if (!rowRevealExpiresAt) {
			return;
		}

		const remainingMs = rowRevealExpiresAt - Date.now();
		if (remainingMs <= 0) {
			resetRowRevealState();
			return;
		}

		const timer = window.setTimeout(() => {
			resetRowRevealState();
			message.info(t(emailsInlineI18n["emails.reveal.passwordAutoHidden"]));
		}, remainingMs);

		return () => window.clearTimeout(timer);
	}, [resetRowRevealState, rowRevealExpiresAt, t]);

	useEffect(() => {
		if (!revealGrantExpiresAt) {
			return;
		}

		const remainingMs = revealGrantExpiresAt - Date.now();
		if (remainingMs <= 0) {
			setRevealGrantToken(null);
			setRevealGrantExpiresAt(null);
			return;
		}

		const timer = window.setTimeout(() => {
			setRevealGrantToken(null);
			setRevealGrantExpiresAt(null);
			message.info(t(emailsInlineI18n["emails.reveal.grantExpiredInfo"]));
		}, remainingMs);

		return () => window.clearTimeout(timer);
	}, [revealGrantExpiresAt, t]);

	const buildBatchActionPayload = useCallback(() => {
		if (selectedRowKeys.length > 0) {
			return {
				ids: selectedRowKeys as number[],
				keyword: undefined,
				groupId: undefined,
				provider: undefined,
				representativeProtocol: undefined,
			};
		}

		return {
			ids: undefined,
			keyword: debouncedKeyword || undefined,
			groupId: filterGroupId,
			provider: filterProvider,
			representativeProtocol: filterRepresentativeProtocol,
			status: filterStatus,
		};
	}, [
		debouncedKeyword,
		filterGroupId,
		filterProvider,
		filterRepresentativeProtocol,
		filterStatus,
		selectedRowKeys,
	]);

	const patchMailboxStatusForEmail = useCallback(
		(emailId: number, mailbox: MailboxName, patch: Partial<MailboxState>) => {
			setData((prev) =>
				prev.map((item) => {
					if (item.id !== emailId) {
						return item;
					}

					const mailboxStatus = normalizeMailboxStatus(
						item.mailboxStatus || EMPTY_MAILBOX_STATUS,
					);
					const sanitizedPatch = Object.fromEntries(
						Object.entries(patch).filter(([, value]) => value !== undefined),
					) as Partial<MailboxState>;
					return {
						...item,
						mailboxStatus: {
							...mailboxStatus,
							[mailbox]: {
								...mailboxStatus[mailbox],
								...sanitizedPatch,
							},
						},
					};
				}),
			);
		},
		[],
	);

	const hasNewMailboxMessages = useCallback(
		(record: EmailAccount, mailbox: MailboxName) => {
			const mailboxStatus = normalizeMailboxStatus(
				record.mailboxStatus || EMPTY_MAILBOX_STATUS,
			);
			return mailboxStatus[mailbox].hasNew;
		},
		[],
	);

	const allMailsSelected =
		mailList.length > 0 && selectedMailIds.length === mailList.length;

	const paginatedMailList = useMemo(() => {
		const startIndex = (mailListPage - 1) * mailListPageSize;
		return mailList.slice(startIndex, startIndex + mailListPageSize);
	}, [mailList, mailListPage, mailListPageSize]);

	const mailListViewKey = `${currentEmailId ?? "none"}:${currentMailbox}`;

	useEffect(() => {
		const maxPage = Math.max(1, Math.ceil(mailList.length / mailListPageSize));
		if (mailListPage > maxPage) {
			setMailListPage(maxPage);
		}
	}, [mailList.length, mailListPage, mailListPageSize]);

	useEffect(() => {
		if (mailListViewKey) {
			setMailListPage(1);
		}
	}, [mailListViewKey]);

	const toggleMailSelection = useCallback(
		(mailId: string, checked: boolean) => {
			setSelectedMailIds((prev) => {
				if (checked) {
					return prev.includes(mailId) ? prev : [...prev, mailId];
				}
				return prev.filter((item) => item !== mailId);
			});
		},
		[],
	);

	const toggleSelectAllMails = useCallback(
		(checked: boolean) => {
			if (!checked) {
				setSelectedMailIds([]);
				return;
			}
			setSelectedMailIds(mailList.map((item) => item.id));
		},
		[mailList],
	);

	const resetGoogleOAuthFlow = useCallback(() => {
		setGeneratedGoogleAuthUrl("");
		setGoogleOAuthPendingState("");
		setGoogleOAuthPollStatus("idle");
		setGoogleOAuthStatusExpiresAt(null);
	}, []);

	const resetOutlookOAuthFlow = useCallback(() => {
		setGeneratedOutlookAuthUrl("");
		setOutlookOAuthPendingState("");
		setOutlookOAuthPollStatus("idle");
		setOutlookOAuthStatusExpiresAt(null);
	}, []);

	const resetAllOAuthFlows = useCallback(() => {
		resetGoogleOAuthFlow();
		resetOutlookOAuthFlow();
	}, [resetGoogleOAuthFlow, resetOutlookOAuthFlow]);

	const closeEmailModal = useCallback(() => {
		resetAllOAuthFlows();
		resetSecretRevealState();
		setModalVisible(false);
	}, [resetAllOAuthFlows, resetSecretRevealState]);

	const fetchGroups = useCallback(async () => {
		const result = await requestData<EmailGroup[]>(
			() => emailsContract.getGroups(),
			"获取分组失败",
			{ silent: true },
		);
		if (result) {
			setGroups(result);
		}
	}, []);

	const fetchOAuthProviderStatuses = useCallback(async () => {
		const result = await requestData<
			Record<"GMAIL" | "OUTLOOK", OAuthProviderStatus>
		>(() => emailsContract.getProviderStatuses(), "获取 OAuth 配置状态失败", {
			silent: true,
		});
		if (result) {
			setOauthProviderStatuses(result);
		}
	}, []);

	const fetchData = useCallback(async () => {
		const currentRequestId = ++latestListRequestIdRef.current;
		setLoading(true);
		const params: {
			page: number;
			pageSize: number;
			keyword: string;
			groupId?: number;
			provider?: EmailProvider;
			representativeProtocol?: RepresentativeProtocol;
			status?: EmailAccountStatus;
		} = { page, pageSize, keyword: debouncedKeyword };
		if (filterGroupId !== undefined) params.groupId = filterGroupId;
		if (filterProvider !== undefined) params.provider = filterProvider;
		if (filterRepresentativeProtocol !== undefined)
			params.representativeProtocol = filterRepresentativeProtocol;
		if (filterStatus !== undefined) params.status = filterStatus;

		const result = await requestData<EmailListResult>(
			() => emailsContract.getList(params),
			"获取数据失败",
		);
		if (currentRequestId !== latestListRequestIdRef.current) {
			return;
		}
		if (result) {
			setData(
				result.list.map((item) => ({
					...item,
					mailboxStatus: normalizeMailboxStatus(
						item.mailboxStatus || EMPTY_MAILBOX_STATUS,
					),
				})),
			);
			setTotal(result.total);
		}
		setLoading(false);
	}, [
		debouncedKeyword,
		filterGroupId,
		filterProvider,
		filterRepresentativeProtocol,
		filterStatus,
		page,
		pageSize,
	]);

	useEffect(() => {
		if (!filterRepresentativeProtocol || !filterProvider) {
			return;
		}

		const providerStillVisible = filterProviderOptions.some(
			(option) => option.value === filterProvider,
		);
		if (!providerStillVisible) {
			setFilterProvider(undefined);
		}
	}, [filterProvider, filterProviderOptions, filterRepresentativeProtocol]);

	useEffect(() => {
		const nextKeyword = searchParams.get("keyword")?.trim() || "";
		const nextStatus = parseEmailStatus(searchParams.get("status"));
		const nextFocusedEmailId = parsePositiveInt(searchParams.get("emailId"));
		setKeyword(nextKeyword);
		setDebouncedKeyword(nextKeyword);
		setFilterStatus(nextStatus);
		setFocusedEmailId(nextFocusedEmailId);
		if (nextKeyword || nextStatus || nextFocusedEmailId) {
			setPage(1);
		}
	}, [searchParams]);

	const handleOAuthCompletionFeedback = useCallback(
		(result: OAuthCompletionPayload) => {
			const providerLabel = getOAuthProviderLabel(result.provider);
			const actionLabel = getOAuthActionLabel(result.action);
			const messageKey = `result.${result.code}`;
		const toastMessage = t(messageKey, {
			providerLabel,
			actionLabel,
			defaultValue:
				result.status === "success"
					? t(providerSetupI18n["emails.oauth.resultAuthorizedSuccess"], {
						providerLabel,
						actionLabel,
					})
					: result.status === "warning"
						? t(providerSetupI18n["emails.oauth.resultAuthorizedVerifyFailed"], {
							providerLabel,
						})
						: t(providerSetupI18n["emails.oauth.resultProviderAuthFailed"], {
							providerLabel,
						}),
		});

			if (result.status === "success") {
				message.success(toastMessage);
			} else if (result.status === "warning") {
				message.warning(toastMessage);
			} else {
				message.error(toastMessage);
			}

			if (result.provider === "GMAIL") {
				if (result.status !== "error") {
					closeEmailModal();
				}
				resetGoogleOAuthFlow();
			} else {
				if (result.status !== "error") {
					closeEmailModal();
				}
				resetOutlookOAuthFlow();
			}

			void fetchData();
			void fetchGroups();
		},
		[
			closeEmailModal,
			fetchData,
			fetchGroups,
			getOAuthActionLabel,
			getOAuthProviderLabel,
			resetGoogleOAuthFlow,
			resetOutlookOAuthFlow,
			t,
		],
	);

	useEffect(() => {
		const timer = window.setTimeout(() => {
			void fetchGroups();
		}, 0);
		return () => window.clearTimeout(timer);
	}, [fetchGroups]);

	useEffect(() => {
		const timer = window.setTimeout(() => {
			void fetchOAuthProviderStatuses();
		}, 0);
		return () => window.clearTimeout(timer);
	}, [fetchOAuthProviderStatuses]);

	useEffect(() => {
		const timer = window.setTimeout(() => {
			setDebouncedKeyword(keyword.trim());
		}, 300);
		return () => window.clearTimeout(timer);
	}, [keyword]);

	useEffect(() => {
		const timer = window.setTimeout(() => {
			void fetchData();
		}, 0);
		return () => window.clearTimeout(timer);
	}, [fetchData]);

	useEffect(() => {
		const oauthStatus = searchParams.get("oauth_status");
		const oauthProvider = searchParams.get("oauth_provider");
		const oauthCode = searchParams.get("oauth_code");
		if (!oauthStatus || !oauthProvider || !oauthCode) {
			return;
		}

		handleOAuthCompletionFeedback({
			provider: oauthProvider === "GMAIL" ? "GMAIL" : "OUTLOOK",
			status:
				oauthStatus === "success" || oauthStatus === "warning"
					? oauthStatus
					: "error",
			code: oauthCode,
			email: searchParams.get("oauth_email") || undefined,
			action: searchParams.get("oauth_action") || undefined,
		});
		navigate("/emails", { replace: true });
	}, [handleOAuthCompletionFeedback, navigate, searchParams]);

	useEffect(() => {
		if (!googleOAuthPendingState) {
			return;
		}

		let cancelled = false;

		const pollStatus = async () => {
			const result = await requestData<OAuthAuthorizationStatusResult>(
				() =>
					emailsContract.getAuthorizationStatus(
						"GMAIL",
						googleOAuthPendingState,
					),
				"获取 Google 授权状态失败",
				{ silent: true },
			);
			if (!result || cancelled) {
				return;
			}

			if (result.status === "expired") {
				resetGoogleOAuthFlow();
				message.warning(t(providerSetupI18n["emails.oauth.googleLinkExpired"]));
				return;
			}

			if (result.status === "completed" && result.result) {
				handleOAuthCompletionFeedback(result.result);
				return;
			}

			setGoogleOAuthPollStatus(
				result.status === "processing" ? "processing" : "pending",
			);
			setGoogleOAuthStatusExpiresAt(result.expiresAt ?? null);
		};

		void pollStatus();
		const timer = window.setInterval(() => {
			void pollStatus();
		}, 3000);

		return () => {
			cancelled = true;
			window.clearInterval(timer);
		};
	}, [
		googleOAuthPendingState,
		handleOAuthCompletionFeedback,
		resetGoogleOAuthFlow,
		t,
	]);

	useEffect(() => {
		if (!outlookOAuthPendingState) {
			return;
		}

		let cancelled = false;

		const pollStatus = async () => {
			const result = await requestData<OAuthAuthorizationStatusResult>(
				() =>
					emailsContract.getAuthorizationStatus(
						"OUTLOOK",
						outlookOAuthPendingState,
					),
				"获取 Microsoft 授权状态失败",
				{ silent: true },
			);
			if (!result || cancelled) {
				return;
			}

			if (result.status === "expired") {
				resetOutlookOAuthFlow();
				message.warning(t(providerSetupI18n["emails.oauth.microsoftLinkExpired"]));
				return;
			}

			if (result.status === "completed" && result.result) {
				handleOAuthCompletionFeedback(result.result);
				return;
			}

			setOutlookOAuthPollStatus(
				result.status === "processing" ? "processing" : "pending",
			);
			setOutlookOAuthStatusExpiresAt(result.expiresAt ?? null);
		};

		void pollStatus();
		const timer = window.setInterval(() => {
			void pollStatus();
		}, 3000);

		return () => {
			cancelled = true;
			window.clearInterval(timer);
		};
	}, [
		outlookOAuthPendingState,
		handleOAuthCompletionFeedback,
		resetOutlookOAuthFlow,
		t,
	]);

	const applyProfileSelection = useCallback(
		(
			profileKey: ProviderProfileKey,
			options?: { preserveStatus?: boolean },
		) => {
			const profileDefinition = getProviderProfileDefinitionByKey(profileKey);
			const provider = profileDefinition.provider;
			resetAllOAuthFlows();
			form.setFields([
				{ name: "clientId", errors: [] },
				{ name: "refreshToken", errors: [] },
				{ name: "clientSecret", errors: [] },
				{ name: "password", errors: [] },
				{ name: "accountLoginPassword", errors: [] },
				{ name: "provider", errors: [] },
				{ name: "authType", errors: [] },
				{ name: "outlookOAuthCallbackUri", errors: [] },
				{ name: "outlookOAuthClientId", errors: [] },
				{ name: "outlookOAuthClientSecret", errors: [] },
				{ name: "outlookOAuthTenant", errors: [] },
				{ name: "outlookOAuthScopes", errors: [] },
				{ name: "gmailOAuthCallbackUri", errors: [] },
				{ name: "gmailOAuthClientId", errors: [] },
				{ name: "gmailOAuthClientSecret", errors: [] },
				{ name: "gmailOAuthScopes", errors: [] },
				{ name: "gmailOAuthJsonText", errors: [] },
			]);
			form.setFieldsValue({
				provider,
				authType: profileDefinition.authType,
				clientId: undefined,
				refreshToken: undefined,
				clientSecret: undefined,
				password: undefined,
				accountLoginPassword: undefined,
				...buildProviderConfigFormValues(
					profileDefinition.providerConfigDefaults,
				),
				...(options?.preserveStatus
					? {}
					: { status: form.getFieldValue("status") || "ACTIVE" }),
				...(provider === "OUTLOOK"
					? getOutlookOAuthFormDefaults(oauthProviderStatuses.OUTLOOK)
					: {}),
				...(provider === "GMAIL"
					? getGoogleOAuthFormDefaults(oauthProviderStatuses.GMAIL)
					: {}),
			});
		},
		[
			form,
			oauthProviderStatuses.GMAIL,
			oauthProviderStatuses.OUTLOOK,
			resetAllOAuthFlows,
		],
	);

	const handleRepresentativeProtocolChange = useCallback(
		(protocol: RepresentativeProtocol) => {
			const compatibleProfile =
				getProviderProfilesByRepresentativeProtocol(protocol).find(
					(profile) => profile.provider === selectedProvider,
				) || getDefaultProfileForRepresentativeProtocol(protocol);
			applyProfileSelection(compatibleProfile.key, { preserveStatus: true });
		},
		[applyProfileSelection, selectedProvider],
	);

	const handleProfileSelection = useCallback(
		(profileKey: ProviderProfileKey) => {
			applyProfileSelection(profileKey, { preserveStatus: true });
		},
		[applyProfileSelection],
	);

	const handleCreate = (protocol: RepresentativeProtocol = "oauth_api") => {
		const defaultProfile = getDefaultProfileForRepresentativeProtocol(protocol);
		setEditingId(null);
		setEmailEditLoading(false);
		resetAllOAuthFlows();
		resetSecretRevealState();
		form.resetFields();
		form.setFieldsValue({
			provider: defaultProfile.provider,
			authType: defaultProfile.authType,
			status: "ACTIVE",
			...buildProviderConfigFormValues(defaultProfile.providerConfigDefaults),
			...(defaultProfile.provider === "OUTLOOK"
				? getOutlookOAuthFormDefaults(oauthProviderStatuses.OUTLOOK)
				: {}),
			...(defaultProfile.provider === "GMAIL"
				? getGoogleOAuthFormDefaults(oauthProviderStatuses.GMAIL)
				: {}),
		});
		setModalVisible(true);
	};

	const handleEdit = useCallback(
		async (record: EmailAccount) => {
			setEditingId(record.id);
			setEmailEditLoading(true);
			resetAllOAuthFlows();
			resetSecretRevealState();
			form.resetFields();
			setModalVisible(true);
			try {
				const res = await emailsContract.getById<EmailDetailsResult>(
					record.id,
				);
				if (res.code === 200) {
					const details = res.data;
					setRevealTargetEmailId(record.id);
					setRevealTargetSource("edit");
					setRevealTargetEmailLabel(details.email);
					setRevealTargetField(
						details.capabilitySummary?.usesOAuth ? "refreshToken" : "password",
					);
					form.setFieldsValue({
						email: details.email,
						provider: details.provider,
						authType: details.authType,
						clientId: details.clientId,
						refreshToken: undefined,
						clientSecret: undefined,
						password: undefined,
						accountLoginPassword: undefined,
						status: details.status,
						groupId: details.groupId,
						...buildProviderConfigFormValues(
							details.providerConfig ||
								getProviderProfileDefinition(details.provider, details.authType)
									.providerConfigDefaults,
						),
						...(details.provider === "OUTLOOK" &&
						details.authType === "MICROSOFT_OAUTH"
							? getOutlookOAuthFormDefaults(oauthProviderStatuses.OUTLOOK)
							: {}),
						...(details.provider === "GMAIL" &&
						details.authType === "GOOGLE_OAUTH"
							? getGoogleOAuthFormDefaults(oauthProviderStatuses.GMAIL)
							: {}),
					});
				}
			} catch {
				message.error(t(emailsInlineI18n["emails.details.fetchFailed"]));
			} finally {
				setEmailEditLoading(false);
			}
		},
		[
			form,
			oauthProviderStatuses.GMAIL,
			oauthProviderStatuses.OUTLOOK,
			resetSecretRevealState,
			resetAllOAuthFlows,
			t,
		],
	);

	const getActiveRevealGrantToken = useCallback(() => {
		if (!revealGrantToken || !revealGrantExpiresAt) {
			return null;
		}
		if (revealGrantExpiresAt <= Date.now()) {
			setRevealGrantToken(null);
			setRevealGrantExpiresAt(null);
			return null;
		}
		return revealGrantToken;
	}, [revealGrantExpiresAt, revealGrantToken]);

	const openRevealModalForTarget = useCallback(
		(
			targetEmailId: number,
			targetField: RevealableEmailSecretField,
			source: "edit" | "row",
			targetEmailLabel?: string | null,
		) => {
			if (!isTwoFactorEnabled) {
				message.warning(t(emailsInlineI18n["emails.reveal.enable2faFirst"]));
				return;
			}
			setRevealTargetEmailId(targetEmailId);
			setRevealTargetField(targetField);
			setRevealTargetSource(source);
			setRevealTargetEmailLabel(targetEmailLabel || null);
			setRevealOtp("");
			setRevealModalVisible(true);
		},
		[isTwoFactorEnabled, t],
	);

	const executeRevealWithGrant = useCallback(
		async (
			targetEmailId: number,
			targetField: RevealableEmailSecretField,
			grantToken: string,
			source: "edit" | "row",
			targetEmailLabel?: string | null,
		) => {
			try {
				const response = await emailsContract.revealSecrets(targetEmailId, {
					grantToken,
					fields: [targetField],
				});
				if (response.code !== 200) {
					message.error(t(emailsInlineI18n["emails.reveal.failed"]));
					return;
				}

				const result = response.data as RevealSecretsResult;
				if (source === "row" && targetField === "accountLoginPassword") {
					setRevealTargetEmailLabel(targetEmailLabel || null);
					setRowRevealedAccountLoginPassword(
						result.secrets.accountLoginPassword ?? null,
					);
					setRowRevealVisible(true);
					setRowRevealExpiresAt(Date.now() + 60_000);
					message.success(t(emailsInlineI18n["emails.reveal.loginPasswordShown"]));
					return;
				}

				setRevealedSecrets(result.secrets || {});
				setRevealExpiresAt(Date.now() + 60_000);
				message.success(t(emailsInlineI18n["emails.reveal.secretShown"]));
			} catch (err: unknown) {
				const errCode = String((err as { code?: unknown })?.code || "").toUpperCase();
				if (errCode === "SECRET_REVEAL_NOT_ALLOWED") {
					message.info(
						targetField === "password"
							? "当前邮箱鉴权方式不支持直接查看登录密码"
							: "当前邮箱鉴权方式不支持查看该密钥",
					);
					return;
				}
				if (
					errCode === "PASSWORD_NOT_PRESENT" ||
					errCode === "ACCOUNT_LOGIN_PASSWORD_NOT_PRESENT"
				) {
					if (source === "edit") {
						setRevealedSecrets({ [targetField]: null });
						setRevealExpiresAt(Date.now() + 60_000);
					}
					message.info(
						targetField === "accountLoginPassword"
							? "当前账号未存储账号登录密码"
							: "当前账号未存储连接密码/授权码",
					);
					return;
				}
				if (errCode === "REVEAL_UNLOCK_EXPIRED") {
					setRevealGrantToken(null);
					setRevealGrantExpiresAt(null);
					message.warning(t(emailsInlineI18n["emails.reveal.grantExpired"]));
					openRevealModalForTarget(
						targetEmailId,
						targetField,
						source,
						targetEmailLabel,
					);
					return;
				}
				if (errCode === "TWO_FACTOR_REQUIRED") {
					setRevealModalVisible(false);
					message.warning(t(emailsInlineI18n["emails.reveal.enable2faFirst"]));
					navigate("/settings");
					return;
				}
				message.error(getErrorMessage(err, t(emailsInlineI18n["emails.reveal.failed"])));
			}
		},
		[navigate, openRevealModalForTarget, t],
	);

	const handleOpenRevealModal = useCallback(() => {
		if (!editingId || !revealTargetField) {
			return;
		}
		const activeGrantToken = getActiveRevealGrantToken();
		if (activeGrantToken) {
			void executeRevealWithGrant(
				editingId,
				revealTargetField,
				activeGrantToken,
				"edit",
				revealTargetEmailLabel,
			);
			return;
		}
		openRevealModalForTarget(
			editingId,
			revealTargetField,
			"edit",
			revealTargetEmailLabel,
		);
	}, [
		editingId,
		executeRevealWithGrant,
		getActiveRevealGrantToken,
		openRevealModalForTarget,
		revealTargetEmailLabel,
		revealTargetField,
	]);

	const handleRowPasswordReveal = useCallback(
		async (record: EmailAccount) => {
			if (!record.hasStoredAccountLoginPassword) {
				message.info(t(emailsInlineI18n["emails.reveal.noStoredAccountLoginPassword"]));
				return;
			}

			const activeGrantToken = getActiveRevealGrantToken();
			if (activeGrantToken) {
				await executeRevealWithGrant(
					record.id,
					"accountLoginPassword",
					activeGrantToken,
					"row",
					record.email,
				);
				return;
			}

			openRevealModalForTarget(
				record.id,
				"accountLoginPassword",
				"row",
				record.email,
			);
		},
		[
			executeRevealWithGrant,
			getActiveRevealGrantToken,
			openRevealModalForTarget,
			t,
		],
	);

	const handleCopyRowRevealedPassword = useCallback(async () => {
		if (!rowRevealedAccountLoginPassword) {
			return;
		}
		try {
			await navigator.clipboard.writeText(rowRevealedAccountLoginPassword);
			message.success(t(emailsInlineI18n["emails.reveal.passwordCopied"]));
		} catch {
			message.error(t(emailsInlineI18n["emails.reveal.copyFailed"]));
		}
	}, [rowRevealedAccountLoginPassword, t]);

	const handleConfirmReveal = useCallback(async () => {
		if (!revealTargetEmailId || !revealTargetField || !revealTargetSource) {
			return;
		}

		const otp = revealOtp.trim();
		if (!/^\d{6}$/.test(otp)) {
			message.error(t(emailsInlineI18n["emails.reveal.otpRequired"]));
			return;
		}

		setRevealLoading(true);
		try {
			const response = await emailsContract.revealUnlock({
				otp,
			});
			if (response.code === 200) {
				const result = response.data as RevealUnlockResult;
				const expiresAt = Date.parse(result.expiresAt);
				setRevealGrantToken(result.grantToken);
				setRevealGrantExpiresAt(
					Number.isFinite(expiresAt) ? expiresAt : Date.now() + 10 * 60_000,
				);
				setRevealOtp("");
				setRevealModalVisible(false);
				await executeRevealWithGrant(
					revealTargetEmailId,
					revealTargetField,
					result.grantToken,
					revealTargetSource,
					revealTargetEmailLabel,
				);
			}
		} catch (err: unknown) {
			const errCode = String((err as { code?: unknown })?.code || "").toUpperCase();
			if (errCode === "INVALID_OTP") {
				message.error(t(emailsInlineI18n["emails.reveal.invalidOtp"]));
				return;
			}
			if (errCode === "TWO_FACTOR_REQUIRED") {
				setRevealModalVisible(false);
				message.warning(t(emailsInlineI18n["emails.reveal.enable2faFirst"]));
				navigate("/settings");
				return;
			}
			message.error(getErrorMessage(err, t(emailsInlineI18n["emails.reveal.failed"])));
		} finally {
			setRevealLoading(false);
		}
	}, [
		executeRevealWithGrant,
		navigate,
		revealOtp,
		revealTargetEmailId,
		revealTargetEmailLabel,
		revealTargetField,
		revealTargetSource,
		t,
	]);

	const focusedEmailRecord = useMemo(
		() =>
			focusedEmailId
				? data.find((item) => item.id === focusedEmailId)
				: undefined,
		[data, focusedEmailId],
	);

	const handleDelete = useCallback(
		async (id: number) => {
			try {
				const res = await emailsContract.delete(id);
				if (res.code === 200) {
					message.success(t(adminI18n.common.deleteSuccess));
					fetchData();
					fetchGroups();
				} else {
					message.error(t(adminI18n.common.deleteFailed));
				}
			} catch (err: unknown) {
				message.error(getErrorMessage(err, t(adminI18n.common.deleteFailed)));
			}
		},
		[fetchData, fetchGroups, t],
	);

	const handleBatchDelete = async () => {
		if (selectedRowKeys.length === 0) {
			message.warning(t(emailsInlineI18n["emails.common.selectMailboxToDelete"]));
			return;
		}

		try {
			const res = await emailsContract.batchDelete(selectedRowKeys as number[]);
			if (res.code === 200) {
				message.success(t(emailsInlineI18n["emails.common.deletedMailboxCount"], { count: res.data.deleted }));
				setSelectedRowKeys([]);
				fetchData();
				fetchGroups();
			} else {
				message.error(t(adminI18n.common.deleteFailed));
			}
		} catch (err: unknown) {
			message.error(getErrorMessage(err, t(adminI18n.common.deleteFailed)));
		}
	};

	const handleAuthTypeChange = (authType: EmailAuthType) => {
		resetAllOAuthFlows();
		form.setFields([
			{ name: "clientId", errors: [] },
			{ name: "refreshToken", errors: [] },
			{ name: "clientSecret", errors: [] },
			{ name: "password", errors: [] },
			{ name: "accountLoginPassword", errors: [] },
		]);
		if (authType === "APP_PASSWORD") {
			form.setFieldsValue({
				clientId: undefined,
				refreshToken: undefined,
				clientSecret: undefined,
				accountLoginPassword: undefined,
			});
			return;
		}

		if (selectedProvider !== "QQ") {
			form.setFieldsValue({
				password: undefined,
				accountLoginPassword: undefined,
			});
		}
	};

	const applyGoogleJsonImport = useCallback(
		async (fileContent: string, fileName: string) => {
			resetGoogleOAuthFlow();
			form.setFieldsValue({
				gmailOAuthJsonText: fileContent,
			});

			setGoogleParseLoading(true);
			const result = await requestData<GoogleClientSecretParseResult>(
				() =>
					emailsContract.parseGoogleClientSecret({
						jsonText: fileContent,
					}),
				t(providerSetupI18n["emails.google.parseImportedSecretFailed"]),
			);
			if (result) {
				form.setFieldsValue({
					gmailOAuthCallbackUri: result.redirectUri,
					gmailOAuthClientId: result.clientId,
					gmailOAuthClientSecret: result.clientSecret,
					gmailOAuthScopes:
						form.getFieldValue("gmailOAuthScopes") ||
						DEFAULT_GOOGLE_OAUTH_SCOPES,
				});
				message.success(t(providerSetupI18n["emails.google.importedClientSecret"], { fileName }));
			}
			setGoogleParseLoading(false);
		},
		[form, resetGoogleOAuthFlow, t],
	);

	const handleGoogleJsonUpload = (file: File) => {
		const reader = new FileReader();
		reader.onload = (event) => {
			const fileContent = event.target?.result;
			if (typeof fileContent !== "string" || !fileContent.trim()) {
				message.error(t(providerSetupI18n["emails.google.readClientSecretFailed"]));
				return;
			}
			void applyGoogleJsonImport(fileContent, file.name);
		};
		reader.onerror = () => {
			message.error(t(providerSetupI18n["emails.google.readClientSecretFailed"]));
		};
		reader.readAsText(file);
		return false;
	};

	const handleParseGoogleClientSecret = useCallback(
		async (showSuccessMessage: boolean = true) => {
			const values = form.getFieldsValue([
				"gmailOAuthCallbackUri",
				"gmailOAuthJsonText",
				"gmailOAuthScopes",
			]);
			setGoogleParseLoading(true);
			const result = await requestData<GoogleClientSecretParseResult>(
				() =>
					emailsContract.parseGoogleClientSecret({
						jsonText: values.gmailOAuthJsonText || null,
						callbackUri: values.gmailOAuthCallbackUri || null,
					}),
				t(providerSetupI18n["emails.google.parseClientSecretFailed"]),
			);
			if (result) {
				resetGoogleOAuthFlow();
				form.setFieldsValue({
					gmailOAuthCallbackUri: result.redirectUri,
					gmailOAuthClientId: result.clientId,
					gmailOAuthClientSecret: result.clientSecret,
					gmailOAuthScopes:
						form.getFieldValue("gmailOAuthScopes") ||
						DEFAULT_GOOGLE_OAUTH_SCOPES,
				});
				if (showSuccessMessage) {
					message.success(
						result.projectId
							? t(providerSetupI18n["emails.google.parseClientSecretSuccessWithProject"], { projectId: result.projectId })
							: t(providerSetupI18n["emails.google.parseClientSecretSuccess"]),
					);
				}
			}
			setGoogleParseLoading(false);
			return result;
		},
		[form, resetGoogleOAuthFlow, t],
	);

	const saveGoogleOAuthConfig = useCallback(
		async (showSuccessMessage: boolean = true) => {
			const values = await form.validateFields([
				"gmailOAuthCallbackUri",
				"gmailOAuthClientId",
				"gmailOAuthClientSecret",
				"gmailOAuthScopes",
			]);
			setGoogleSaveLoading(true);
			const result = await requestData<OAuthProviderStatus>(
				() =>
					emailsContract.saveConfig("GMAIL", {
						redirectUri: values.gmailOAuthCallbackUri,
						clientId: values.gmailOAuthClientId,
						clientSecret: values.gmailOAuthClientSecret || undefined,
						scopes: values.gmailOAuthScopes,
					}),
				t(providerSetupI18n["emails.google.saveConfigFailed"]),
			);
			if (result) {
				await fetchOAuthProviderStatuses();
				if (showSuccessMessage) {
					message.success(t(providerSetupI18n["emails.google.configSaved"]));
				}
			}
			setGoogleSaveLoading(false);
			return result;
		},
		[fetchOAuthProviderStatuses, form, t],
	);

	const saveOutlookOAuthConfig = useCallback(
		async (showSuccessMessage: boolean = true) => {
			const values = await form.validateFields([
				"outlookOAuthCallbackUri",
				"outlookOAuthClientId",
				"outlookOAuthClientSecret",
				"outlookOAuthTenant",
				"outlookOAuthScopes",
			]);
			setOutlookSaveLoading(true);
			const result = await requestData<OAuthProviderStatus>(
				() =>
					emailsContract.saveConfig("OUTLOOK", {
						redirectUri: values.outlookOAuthCallbackUri,
						clientId: values.outlookOAuthClientId,
						clientSecret: values.outlookOAuthClientSecret || undefined,
						tenant: values.outlookOAuthTenant,
						scopes: values.outlookOAuthScopes,
					}),
				t(providerSetupI18n["emails.microsoft.saveConfigFailed"]),
			);
			if (result) {
				await fetchOAuthProviderStatuses();
				if (showSuccessMessage) {
					message.success(t(providerSetupI18n["emails.microsoft.configSaved"]));
				}
			}
			setOutlookSaveLoading(false);
			return result;
		},
		[fetchOAuthProviderStatuses, form, t],
	);

	const handleGenerateGoogleAuthUrl = async () => {
		try {
			const values = form.getFieldsValue(["gmailOAuthJsonText"]);
			const hasGoogleJsonSource = Boolean(
				String(values.gmailOAuthJsonText || "").trim(),
			);
			setGoogleAuthUrlLoading(true);

			if (hasGoogleJsonSource) {
				const parsed = await handleParseGoogleClientSecret(false);
				if (!parsed) {
					return;
				}
			}

			const saved = await saveGoogleOAuthConfig(false);
			if (!saved) {
				return;
			}

			const result = await requestData<OAuthAuthorizationStartResult>(
				() =>
					emailsContract.startAuthorization("GMAIL", {
						groupId: toOptionalNumber(form.getFieldValue("groupId")),
						emailId: editingId ?? undefined,
					}),
				t(providerSetupI18n["emails.google.generateAuthUrlFailed"]),
			);
			if (result?.authUrl) {
				setGeneratedGoogleAuthUrl(result.authUrl);
				setGoogleOAuthPendingState(result.state);
				setGoogleOAuthPollStatus("pending");
				setGoogleOAuthStatusExpiresAt(result.expiresAt);
				message.success(t(providerSetupI18n["emails.google.authUrlGenerated"]));
			}
		} catch (err: unknown) {
			message.error(getErrorMessage(err, t(providerSetupI18n["emails.google.generateAuthUrlFailed"])));
		} finally {
			setGoogleAuthUrlLoading(false);
		}
	};

	const handleGenerateOutlookAuthUrl = async () => {
		try {
			setOutlookAuthUrlLoading(true);

			const saved = await saveOutlookOAuthConfig(false);
			if (!saved) {
				return;
			}

			const result = await requestData<OAuthAuthorizationStartResult>(
				() =>
					emailsContract.startAuthorization("OUTLOOK", {
						groupId: toOptionalNumber(form.getFieldValue("groupId")),
						emailId: editingId ?? undefined,
					}),
				t(providerSetupI18n["emails.microsoft.generateAuthUrlFailed"]),
			);
			if (result?.authUrl) {
				setGeneratedOutlookAuthUrl(result.authUrl);
				setOutlookOAuthPendingState(result.state);
				setOutlookOAuthPollStatus("pending");
				setOutlookOAuthStatusExpiresAt(result.expiresAt);
				message.success(t(providerSetupI18n["emails.microsoft.authUrlGenerated"]));
			}
		} catch (err: unknown) {
			message.error(getErrorMessage(err, t(providerSetupI18n["emails.microsoft.generateAuthUrlFailed"])));
		} finally {
			setOutlookAuthUrlLoading(false);
		}
	};

	const handleCopyGeneratedAuthUrl = async (
		url: string,
		providerLabel: string,
	) => {
		if (!url) {
			return;
		}
		try {
			await navigator.clipboard.writeText(url);
			message.success(t(providerSetupI18n["emails.oauth.authUrlCopied"], { providerLabel }));
		} catch {
			message.error(t(providerSetupI18n["emails.oauth.copyAuthUrlFailed"]));
		}
	};

	const handleSubmit = async () => {
		try {
			const values = await form.validateFields();
			const provider = (values.provider || "OUTLOOK") as EmailProvider;
			const authType = (values.authType ||
				getDefaultAuthType(provider)) as EmailAuthType;
			const normalizedEmail = values.email?.trim();
			const normalizeCredentialValue = (
				value: string | undefined,
				enabled: boolean,
			) => {
				if (!enabled) {
					return null;
				}
				const trimmed = value?.trim();
				if (trimmed) {
					return trimmed;
				}
				return editingId ? undefined : null;
			};

			if (
				!editingId &&
				!normalizedEmail &&
				((provider === "GMAIL" && authType === "GOOGLE_OAUTH") ||
					(provider === "OUTLOOK" && authType === "MICROSOFT_OAUTH"))
			) {
				message.warning(
				t(providerSetupI18n["emails.oauth.useAuthorizationFlowHint"], {
				        providerName: provider === "GMAIL" ? "Gmail" : "Outlook",
                         authProviderLabel: provider === "GMAIL" ? "Google" : "Microsoft",
                     }),
                 );
				return;
			}

			const normalizedGroupId =
				values.groupId === null ? null : toOptionalNumber(values.groupId);
			const normalizedProviderConfig = isGenericImapSmtpProvider
				? normalizeProviderConfigInput(values.providerConfig)
				: undefined;
			const normalizedPayload = {
				email: normalizedEmail,
				provider,
				authType,
				clientId: normalizeCredentialValue(
					values.clientId,
					requiresOAuthFields,
				),
				refreshToken: normalizeCredentialValue(
					values.refreshToken,
					requiresOAuthFields,
				),
				clientSecret: normalizeCredentialValue(
					values.clientSecret,
					requiresOAuthFields,
				),
				password: normalizeCredentialValue(
					values.password,
					requiresPasswordAuth,
				),
				accountLoginPassword: trimOptionalString(values.accountLoginPassword),
				accountPasswordGrantToken:
					editingId && trimOptionalString(values.accountLoginPassword)
						? getActiveRevealGrantToken() || undefined
						: undefined,
				status: values.status,
				groupId: normalizedGroupId ?? null,
				providerConfig: normalizedProviderConfig,
			};

			if (editingId) {
				if (
					normalizedPayload.accountLoginPassword &&
					!normalizedPayload.accountPasswordGrantToken
				) {
					message.warning(t(emailsInlineI18n["emails.accountPassword.requireStepUp"]));
					return;
				}
				const res = await emailsContract.update(editingId, normalizedPayload);
				if (res.code === 200) {
					message.success(t(adminI18n.common.updateSuccess));
					closeEmailModal();
					fetchData();
					fetchGroups();
				} else {
					message.error(t(adminI18n.common.saveFailed));
				}
			} else {
				const res = await emailsContract.create({
					email: normalizedPayload.email,
					provider: normalizedPayload.provider,
					authType: normalizedPayload.authType,
					clientId: normalizedPayload.clientId || undefined,
					refreshToken: normalizedPayload.refreshToken || undefined,
					clientSecret: normalizedPayload.clientSecret || undefined,
					password: normalizedPayload.password || undefined,
					accountLoginPassword:
						normalizedPayload.accountLoginPassword || undefined,
					groupId: toOptionalNumber(values.groupId),
					providerConfig: normalizedPayload.providerConfig,
				});
				if (res.code === 200) {
					message.success(t(adminI18n.common.createSuccess));
					closeEmailModal();
					fetchData();
					fetchGroups();
				} else {
					message.error(t(adminI18n.common.createFailed));
				}
			}
		} catch (err: unknown) {
			message.error(getErrorMessage(err, t(adminI18n.common.saveFailed)));
		}
	};

	const renderStoredSecretRevealPanel = () => {
		if (!editingId || !revealTargetField || revealTargetSource === "row") {
			return null;
		}

		return (
			<Alert
				showIcon
				type={isTwoFactorEnabled ? "info" : "warning"}
				style={marginBottom12Style}
				title={`受控查看已存储的 ${revealTargetLabel}`}
				action={
					<Button
						type="primary"
						size="small"
						icon={<SafetyCertificateOutlined />}
						disabled={!isTwoFactorEnabled}
						onClick={() => void handleOpenRevealModal()}
					>
						{revealedSecretValue !== undefined ? "重新验证查看" : "验证后查看"}
					</Button>
				}
					description={
						<Space orientation="vertical" size="small" style={fullWidthStyle}>
							<Text type="secondary">
							编辑表单默认不会回填已存储内容；需要查看或补录账号登录密码时，必须先经过 2FA 验证。
						</Text>
							{!isTwoFactorEnabled ? (
								<Text type="warning">
									当前管理员未启用 2FA，请先到“设置”页开启后再查看。
								</Text>
						) : null}
						{revealedSecretValue !== undefined ? (
							revealedSecretValue ? (
								<TextArea
									rows={revealTargetField === "refreshToken" ? 4 : 2}
									value={revealedSecretValue}
									readOnly
								/>
							) : (
								<Text type="secondary">{t(emailsInlineI18n["emails.reveal.noStoredSecret"])}</Text>
							)
						) : null}
						{revealExpiresAt ? (
							<Text type="secondary">
								{t(emailsInlineI18n["emails.reveal.secretAutoHideAt"], { time: dayjs(revealExpiresAt).format("HH:mm:ss") })}
							</Text>
						) : null}
						{revealGrantExpiresAt ? (
							<Text type="secondary">
								{t(emailsInlineI18n["emails.reveal.grantValidUntil"], { time: dayjs(revealGrantExpiresAt).format("HH:mm:ss") })}
							</Text>
						) : null}
						{revealTargetField === "accountLoginPassword" && hasActiveRevealGrant ? (
							<Text type="success">
								{t(emailsInlineI18n["emails.accountPassword.verifiedCanSave"])}
							</Text>
						) : null}
					</Space>
				}
			/>
		);
	};

	const handleOpenAccountLoginPasswordAccess = useCallback(async () => {
		if (!editingId) {
			return;
		}
		setRevealTargetField("accountLoginPassword");
		setRevealTargetSource("edit");
		const activeGrantToken = getActiveRevealGrantToken();
		if (activeGrantToken) {
			await executeRevealWithGrant(
				editingId,
				"accountLoginPassword",
				activeGrantToken,
				"edit",
				revealTargetEmailLabel,
			);
			return;
		}
		openRevealModalForTarget(
			editingId,
			"accountLoginPassword",
			"edit",
			revealTargetEmailLabel,
		);
	}, [
		editingId,
		executeRevealWithGrant,
		getActiveRevealGrantToken,
		openRevealModalForTarget,
		revealTargetEmailLabel,
	]);

	const renderAccountLoginPasswordField = (
		description: string,
		placeholder: string,
	) => (
		<>
			{editingId ? (
				<Alert
					showIcon
					type={isTwoFactorEnabled ? "info" : "warning"}
					style={marginBottom12Style}
						title={t(emailsInlineI18n["emails.accountPassword.alertTitle"])}
					action={
						<Button
							type="primary"
							size="small"
							icon={<SafetyCertificateOutlined />}
							disabled={!isTwoFactorEnabled}
							onClick={() => void handleOpenAccountLoginPasswordAccess()}
						>
							{hasActiveRevealGrant ? t(emailsInlineI18n["emails.accountPassword.reverifyOrContinue"]) : t(emailsInlineI18n["emails.accountPassword.verifyThenEdit"])}
						</Button>
					}
					description={
						<Space orientation="vertical" size="small" style={fullWidthStyle}>
							<Text type="secondary">{description}</Text>
							{revealedSecrets.accountLoginPassword !== undefined ? (
								revealedSecrets.accountLoginPassword ? (
									<TextArea
										rows={2}
										value={revealedSecrets.accountLoginPassword}
										readOnly
									/>
								) : (
									<Text type="secondary">
										{t(emailsInlineI18n["emails.accountPassword.noneStoredYet"])}
									</Text>
								)
							) : null}
							{hasActiveRevealGrant ? (
								<Text type="success">
									{t(emailsInlineI18n["emails.accountPassword.stepUpActive"])}
								</Text>
							) : null}
						</Space>
					}
				/>
			) : null}
			<Form.Item
				name="accountLoginPassword"
				label={t(emailsInlineI18n["emails.accountPassword.fieldLabel"])}
				extra={
					editingId
						? hasActiveRevealGrant
							? t(emailsInlineI18n["emails.accountPassword.stepUpSaveHint"])
							: t(emailsInlineI18n["emails.accountPassword.stepUpRequiredHint"])
						: description
				}
			>
				<Input.Password
					placeholder={placeholder}
					disabled={Boolean(editingId && !hasActiveRevealGrant)}
				/>
			</Form.Item>
		</>
	);

	const handleImport = async () => {
		if (!importContent.trim()) {
			message.warning(t(emailsInlineI18n["emails.import.empty"]));
			return;
		}

		try {
			const res = await emailsContract.import(
				importContent,
				separator,
				toOptionalNumber(importGroupId),
			);
			if (res.code === 200) {
				const result = res.data as
					| { success?: number; failed?: number; errors?: string[] }
					| undefined;
				const successCount = result?.success ?? 0;
				const failedCount = result?.failed ?? 0;
				const firstErrors = Array.isArray(result?.errors)
					? result.errors.slice(0, 2)
					: [];
				if (failedCount > 0) {
					message.warning(
						`${t(emailsInlineI18n["emails.import.partialPrefix"], { successCount, failedCount })}${firstErrors.length ? `；${firstErrors.join("；")}` : ""}`,
					);
				} else {
					message.success(t(emailsInlineI18n["emails.import.successCount"], { count: successCount }));
				}
				setImportModalVisible(false);
				setImportContent("");
				setImportGroupId(undefined);
				fetchData();
				fetchGroups();
			} else {
				message.error(t(emailsInlineI18n["emails.import.failed"]));
			}
		} catch (err: unknown) {
			message.error(getErrorMessage(err, t(emailsInlineI18n["emails.import.failed"])));
		}
	};

	const handleExport = async () => {
		try {
			const ids =
				selectedRowKeys.length > 0 ? (selectedRowKeys as number[]) : undefined;
			const groupId = ids ? undefined : toOptionalNumber(filterGroupId);
			const res = await emailsContract.export(ids, separator, groupId);
			if (res.code !== 200) {
				message.error(t(emailsInlineI18n["emails.export.failed"]));
				return;
			}
			const content = res.data?.content || "";

			const blob = new Blob([content], { type: "text/plain" });
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = "email_accounts.txt";
			a.click();
			URL.revokeObjectURL(url);

			message.success(t(emailsInlineI18n["emails.export.success"]));
		} catch (err: unknown) {
			message.error(getErrorMessage(err, t(emailsInlineI18n["emails.export.failed"])));
		}
	};

	const loadMails = useCallback(
		async (
			emailId: number,
			mailbox: MailboxName,
			showSuccessToast: boolean = false,
			markAsSeen: boolean = false,
		) => {
			setMailLoading(true);
			const result = await requestData<{ messages: MailItem[] }>(
				() => emailsContract.viewMails(emailId, mailbox, markAsSeen),
				"获取邮件失败",
			);
			if (result) {
				const messages = result.messages || [];
				const latestMessage = messages[0];
				const now = new Date().toISOString();
				setSelectedMailIds([]);
				setMailList(messages);
				patchMailboxStatusForEmail(emailId, mailbox, {
					latestMessageId: latestMessage?.id || null,
					latestMessageDate: latestMessage?.date || null,
					messageCount: messages.length,
					hasNew: markAsSeen ? false : undefined,
					lastSyncedAt: now,
					lastViewedAt: markAsSeen ? now : undefined,
				});
				if (showSuccessToast) {
					message.success(t(emailsInlineI18n["emails.mailbox.refreshSuccess"]));
				}
			}
			setMailLoading(false);
		},
		[patchMailboxStatusForEmail, t],
	);

	const handleViewMails = useCallback(
		async (record: EmailAccount, mailbox: MailboxName) => {
			setCurrentEmail(record.email);
			setCurrentEmailId(record.id);
			setCurrentEmailRecord(record);
			setCurrentMailbox(mailbox);
			setMailModalVisible(true);
			await loadMails(record.id, mailbox, false, true);
		},
		[loadMails],
	);

	const handleMailboxTabChange = async (mailbox: MailboxName) => {
		setCurrentMailbox(mailbox);
		if (!currentEmailId) {
			return;
		}
		await loadMails(currentEmailId, mailbox, false, true);
	};

	const handleRefreshMails = async () => {
		if (!currentEmailId) return;
		await loadMails(currentEmailId, currentMailbox, true, true);
	};

	const handleClearMailbox = async () => {
		if (!currentEmailId) return;
		try {
			const res = await emailsContract.clearMailbox(
				currentEmailId,
				currentMailbox,
			);
			if (res.code === 200) {
				message.success(t(emailsInlineI18n["emails.mailbox.clearedCount"], { count: res.data?.deletedCount || 0 }));
				setSelectedMailIds([]);
				setMailList([]);
				const now = new Date().toISOString();
				patchMailboxStatusForEmail(currentEmailId, currentMailbox, {
					latestMessageId: null,
					latestMessageDate: null,
					messageCount: 0,
					hasNew: false,
					lastSyncedAt: now,
					lastViewedAt: now,
				});
			} else {
				message.error(t(emailsInlineI18n["emails.mailbox.clearFailed"]));
			}
		} catch (err: unknown) {
			message.error(getErrorMessage(err, t(emailsInlineI18n["emails.mailbox.clearFailed"])));
		}
	};

	const handleDeleteSelectedMails = async () => {
		if (!currentEmailId || selectedMailIds.length === 0) {
			message.warning(t(emailsInlineI18n["emails.mailbox.selectMessagesToDelete"]));
			return;
		}

		try {
			setDeletingSelectedMails(true);
			const res = await emailsContract.deleteSelectedMails<MailItem>(
				currentEmailId,
				{
					mailbox: currentMailbox,
					messageIds: selectedMailIds,
				},
			);
			if (res.code === 200) {
				const messages = res.data?.messages || [];
				const latestMessage = messages[0];
				const now = new Date().toISOString();
				message.success(t(emailsInlineI18n["emails.mailbox.deletedMessageCount"], { count: res.data?.deletedCount || 0 }));
				setSelectedMailIds([]);
				setMailList(messages);
				patchMailboxStatusForEmail(currentEmailId, currentMailbox, {
					latestMessageId: latestMessage?.id || null,
					latestMessageDate: latestMessage?.date || null,
					messageCount: messages.length,
					hasNew: false,
					lastSyncedAt: now,
					lastViewedAt: now,
				});
			} else {
				message.error(t(emailsInlineI18n["emails.mailbox.deleteSelectedFailed"]));
			}
		} catch (err: unknown) {
			message.error(getErrorMessage(err, t(emailsInlineI18n["emails.mailbox.deleteSelectedFailed"])));
		} finally {
			setDeletingSelectedMails(false);
		}
	};

	const handleBatchFetchMailboxes = useCallback(async () => {
		const scopeLabel =
			selectedRowKeys.length > 0
				? `选中的 ${selectedRowKeys.length} 个邮箱`
				: "当前筛选结果中的邮箱";
		setBatchFetchLoading(true);
		const result = await requestData<BatchFetchMailboxResult>(
			() =>
				emailsContract.batchFetchMailboxes({
					...buildBatchActionPayload(),
					mailboxes: ["INBOX", "SENT", "Junk"],
				}),
			"一键检查邮箱失败",
		);
		if (result) {
			if (result.targeted === 0) {
				message.warning(t(emailsInlineI18n["emails.batchCheck.noneAvailable"]));
			} else if (result.errorCount > 0 || result.partialCount > 0) {
				message.warning(
					`一键检查完成：${scopeLabel}中成功 ${result.successCount} 个，部分成功 ${result.partialCount} 个，失败 ${result.errorCount} 个，跳过 ${result.skippedCount} 个`,
				);
			} else {
				message.success(
					`一键检查完成：${scopeLabel}已刷新检查结果${result.skippedCount > 0 ? `，跳过 ${result.skippedCount} 个邮箱` : ""}`,
				);
			}
			await fetchData();
		}
		setBatchFetchLoading(false);
	}, [buildBatchActionPayload, fetchData, selectedRowKeys.length, t]);

	const handleCheckSingleMailbox = useCallback(
		async (record: EmailAccount) => {
			setCheckingEmailIds((prev) =>
				prev.includes(record.id) ? prev : [...prev, record.id],
			);
			const result = await requestData<BatchFetchMailboxResult>(
				() =>
					emailsContract.batchFetchMailboxes({
						ids: [record.id],
						mailboxes: ["INBOX", "SENT", "Junk"],
					}),
				`检查邮箱 ${record.email} 失败`,
			);

			if (result) {
				if (result.targeted === 0) {
					message.warning(t(emailsInlineI18n["emails.batchCheck.mailboxUnavailable"], { email: record.email }));
				} else if (result.errorCount > 0 || result.partialCount > 0) {
					message.warning(
						`检查 ${record.email} 完成：成功 ${result.successCount} 个，部分成功 ${result.partialCount} 个，失败 ${result.errorCount} 个，跳过 ${result.skippedCount} 个邮箱夹`,
					);
				} else {
					message.success(t(emailsInlineI18n["emails.batchCheck.mailboxUpdated"], { email: record.email }));
				}
				await fetchData();
			}

			setCheckingEmailIds((prev) => prev.filter((id) => id !== record.id));
		},
		[fetchData, t],
	);

	const handleBatchClearMailbox = useCallback(async () => {
		setBatchClearLoading(true);
		const result = await requestData<{
			targeted: number;
			deletedCount: number;
			successCount: number;
			errorCount: number;
			skippedCount: number;
		}>(
			() =>
				emailsContract.batchClearMailbox({
					...buildBatchActionPayload(),
					mailbox: batchClearMailbox,
				}),
			"批量清空邮箱失败",
		);
		if (result) {
			if (result.targeted === 0) {
				message.warning(t(emailsInlineI18n["emails.batchClear.noneAvailable"]));
			} else if (result.errorCount > 0) {
				message.warning(
					`批量清空完成：共删除 ${result.deletedCount} 封，成功 ${result.successCount} 个，失败 ${result.errorCount} 个，跳过 ${result.skippedCount} 个`,
				);
			} else {
				message.success(
					`批量清空完成：共删除 ${result.deletedCount} 封邮件${result.skippedCount > 0 ? `，跳过 ${result.skippedCount} 个邮箱` : ""}`,
				);
			}
			setBatchClearModalVisible(false);
			await fetchData();
		}
		setBatchClearLoading(false);
	}, [batchClearMailbox, buildBatchActionPayload, fetchData, t]);

	const handleViewEmailDetail = (record: MailItem) => {
		setSelectedMailDetail(record);
		setEmailDetailVisible(true);
	};

	const handleSendMail = async () => {
		if (!currentEmailId) {
			return;
		}
		try {
			const values = await composeForm.validateFields();
			const recipients = values.to
				.split(/[\n,;]+/)
				.map((item) => item.trim())
				.filter(Boolean);

			if (recipients.length === 0) {
				message.error(
					t(emailsInlineI18n["emails.compose.recipientRequired"]),
				);
				return;
			}

			setComposeSending(true);
			const result = await emailsContract.sendMail(currentEmailId, {
				fromName: values.fromName,
				to: recipients,
				subject: values.subject,
				text: values.text,
			});
			setComposeSending(false);

			if (result.code !== 200) {
				message.error(
					t(emailsInlineI18n["emails.compose.sendFailed"]),
				);
				return;
			}

			message.success(
				t(emailsInlineI18n["emails.compose.sendSuccess"]),
			);
			setComposeModalVisible(false);
			composeForm.resetFields();
			await handleMailboxTabChange("SENT");
		} catch (err: unknown) {
			setComposeSending(false);
			message.error(
				getErrorMessage(
					err,
					t(emailsInlineI18n["emails.compose.sendFailed"]),
				),
			);
		}
	};

	// ========================================
	// Group CRUD handlers
	// ========================================
	const handleCreateGroup = () => {
		setEditingGroupId(null);
		groupForm.resetFields();
		groupForm.setFieldsValue({ fetchStrategy: "GRAPH_FIRST" });
		setGroupModalVisible(true);
	};

	const handleEditGroup = useCallback(
		(group: EmailGroup) => {
			setEditingGroupId(group.id);
			groupForm.setFieldsValue({
				name: group.name,
				description: group.description ?? undefined,
				fetchStrategy: group.fetchStrategy,
			});
			setGroupModalVisible(true);
		},
		[groupForm],
	);

	const handleDeleteGroup = useCallback(
		async (id: number) => {
			try {
				const res = await emailsContract.deleteGroup(id);
				if (res.code === 200) {
					message.success(
						t(emailsInlineI18n["emails.group.deleted"]),
					);
					fetchGroups();
					fetchData();
				}
			} catch (err: unknown) {
				message.error(
					getErrorMessage(
						err,
						t(adminI18n.common.deleteFailed),
					),
				);
			}
		},
		[fetchData, fetchGroups, t],
	);

	const handleGroupSubmit = async () => {
		try {
			const values = normalizeGroupPayload(await groupForm.validateFields());
			if (editingGroupId) {
				const res = await emailsContract.updateGroup(editingGroupId, values);
				if (res.code === 200) {
					message.success(
						t(emailsInlineI18n["emails.group.updated"]),
					);
					setGroupModalVisible(false);
					fetchGroups();
				}
			} else {
				const res = await emailsContract.createGroup(values);
				if (res.code === 200) {
					message.success(
						t(emailsInlineI18n["emails.group.created"]),
					);
					setGroupModalVisible(false);
					fetchGroups();
				}
			}
		} catch (err: unknown) {
			message.error(
				getErrorMessage(
					err,
					t(emailsInlineI18n["emails.group.saveFailed"]),
				),
			);
		}
	};

	const handleBatchAssignGroup = async () => {
		if (selectedRowKeys.length === 0) {
			message.warning(
				t(emailsInlineI18n["emails.selection.selectMailboxFirst"]),
			);
			return;
		}
		if (!assignTargetGroupId) {
			message.warning(
				t(emailsInlineI18n["emails.group.selectTargetGroup"]),
			);
			return;
		}
		try {
			const res = await emailsContract.assignEmails(
				assignTargetGroupId,
				selectedRowKeys as number[],
			);
			if (res.code === 200) {
				message.success(
					t(emailsInlineI18n["emails.group.assignedCount"], { count: res.data.count }),
				);
				setAssignGroupModalVisible(false);
				setAssignTargetGroupId(undefined);
				setSelectedRowKeys([]);
				fetchData();
				fetchGroups();
			}
		} catch (err: unknown) {
			message.error(
				getErrorMessage(
					err,
					t(emailsInlineI18n["emails.group.assignFailed"]),
				),
			);
		}
	};

	const handleBatchRemoveGroup = async () => {
		if (selectedRowKeys.length === 0) {
			message.warning(
				t(emailsInlineI18n["emails.selection.selectMailboxFirst"]),
			);
			return;
		}
		// Find the groupIds of selected emails, remove from each group
		const selectedEmails = data.filter((e: EmailAccount) =>
			selectedRowKeys.includes(e.id),
		);
		const groupIds = [
			...new Set(
				selectedEmails.map((e: EmailAccount) => e.groupId).filter(Boolean),
			),
		] as number[];

		try {
			for (const gid of groupIds) {
				const emailIds = selectedEmails
					.filter((e: EmailAccount) => e.groupId === gid)
					.map((e: EmailAccount) => e.id);
				await emailsContract.removeEmails(gid, emailIds);
			}
			message.success(
				t(emailsInlineI18n["emails.group.removedFromGroups"]),
			);
			setSelectedRowKeys([]);
			fetchData();
			fetchGroups();
		} catch (err: unknown) {
			message.error(
				getErrorMessage(
					err,
					t(emailsInlineI18n["emails.group.removeFailed"]),
				),
			);
		}
	};

	// ========================================
	// Email table columns
	// ========================================
	const columns: ColumnsType<EmailAccount> = useMemo(
		() => [
			{
				title: t(adminI18n.emails.mailboxAddress),
				dataIndex: "email",
				key: "email",
				width: 300,
					render: (_: string, record: EmailAccount) => {
						const profileDefinition = record.providerProfile
							? getProviderProfileDefinitionByKey(record.providerProfile as ProviderProfileKey)
							: getProviderProfileDefinition(record.provider, record.authType);
						return (
							<div style={emailStyles.addressCell}>
								<Text style={emailStyles.addressText}>{record.email}</Text>
								<div style={emailStyles.metaText}>{t(getProviderProfileSummaryHintMessage(profileDefinition.key))}</div>
								{record.errorMessage ? <div style={emailStyles.errorText}>{t(emailsInlineI18n["emails.row.errorMessage"], { message: record.errorMessage })}</div> : null}
							</div>
						);
					},
			},
			{
				title: t(adminI18n.emails.connectionContract),
				key: "connection",
					render: (_: unknown, record: EmailAccount) => {
						const profileDefinition = record.providerProfile
							? getProviderProfileDefinitionByKey(record.providerProfile as ProviderProfileKey)
							: getProviderProfileDefinition(record.provider, record.authType);
						const representativeProtocol = record.representativeProtocol || profileDefinition.representativeProtocol;
						return (
							<div style={emailStyles.contractCell}>
								<Space wrap>
									<Tag color={getProviderDefinition(record.provider).tagColor}>{t(getProviderLabelMessage(record.provider))}</Tag>
									<Tag color={getRepresentativeProtocolTagColor(representativeProtocol)}>{t(getRepresentativeProtocolLabelMessage(representativeProtocol))}</Tag>
									<Tag>{t(getAuthTypeLabelMessage(record.authType))}</Tag>
								</Space>
								<div style={emailStyles.metaText}>{t(getProviderProfileSummaryHintMessage(profileDefinition.key))}</div>
							</div>
						);
					},
			},
			{
				title: t(adminI18n.emails.group),
				key: "group",
				render: (_: unknown, record: EmailAccount) => (
					record.group ? <Tag color="blue">{record.group.name}</Tag> : <Tag>{t(adminI18n.emails.ungrouped)}</Tag>
				),
			},
			{
				title: t(adminI18n.common.clientId),
				dataIndex: "clientId",
				key: "clientId",
				width: 180,
				render: (value: string | null) => <div style={emailStyles.clientIdText}>{value || "-"}</div>,
			},
			{
				title: t(adminI18n.common.status),
				dataIndex: "status",
				key: "status",
				width: 100,
					render: (value: EmailAccountStatus) => {
						const statusMeta = getEmailStatusMeta(value, t);
						return <Tag color={statusMeta.color}>{statusMeta.label}</Tag>;
					},
			},
			{
				title: t(adminI18n.common.lastChecked),
				dataIndex: "lastCheckAt",
				key: "lastCheckAt",
				width: 168,
				render: (value: string | null) => value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "-",
			},
			{
				title: t(adminI18n.common.createdAt),
				dataIndex: "createdAt",
				key: "createdAt",
				width: 168,
				render: (value: string) => dayjs(value).format("YYYY-MM-DD HH:mm"),
			},
			{
				title: t(adminI18n.common.actions),
				key: "action",
				width: 220,
				render: (_: unknown, record: EmailAccount) => (
					<div style={emailStyles.actionCell}>
						<Space wrap>
							<Button
								size="small"
								type={hasNewMailboxMessages(record, "INBOX") ? "primary" : "default"}
								onClick={() => handleViewMails(record, "INBOX")}
							>
								{t(adminI18n.emails.inbox)}
							</Button>
							<Button
								size="small"
								onClick={() => handleViewMails(record, "SENT")}
							>
								{t(adminI18n.emails.sent)}
							</Button>
							<Tooltip
								title={
									canRevealStoredAccountLoginPassword(record)
										? t(emailsInlineI18n["emails.row.viewStoredLoginPassword"])
										: record.hasStoredAccountLoginPassword
											? t(emailsInlineI18n["emails.row.loginPasswordStoredWith2fa"])
											: t(emailsInlineI18n["emails.row.noStoredLoginPassword"])
								}
							>
								<Button
									size="small"
									type={
										canRevealStoredAccountLoginPassword(record)
											? "primary"
											: "default"
									}
									aria-label={t(emailsInlineI18n["emails.row.loginPasswordAriaLabel"])}
									onClick={() => void handleRowPasswordReveal(record)}
								>
									{t(emailsInlineI18n["emails.row.loginPasswordButton"])}
								</Button>
							</Tooltip>
							<Button
								size="small"
								onClick={() => void handleCheckSingleMailbox(record)}
							>
								{t(adminI18n.emails.checkConnection)}
							</Button>
							<Button
								size="small"
								onClick={() => handleEdit(record)}
							>
								{t(adminI18n.common.edit)}
							</Button>
							<Popconfirm
								title={t(emailsInlineI18n["emails.row.deleteConfirm"])}
								onConfirm={() => handleDelete(record.id)}
							>
								<Button size="small" danger>
									{t(adminI18n.common.remove)}
								</Button>
							</Popconfirm>
						</Space>
					</div>
				),
			},
		],
		[
			handleCheckSingleMailbox,
			handleDelete,
			handleEdit,
			handleRowPasswordReveal,
			handleViewMails,
			hasNewMailboxMessages,
			t,
		],
	);

	const rowSelection = useMemo(
		() => ({
			selectedRowKeys,
			columnWidth: 40,
			onChange: setSelectedRowKeys,
		}),
		[selectedRowKeys],
	);

	const tablePagination = useMemo(
		() => ({
			current: page,
			pageSize,
			total,
			showSizeChanger: true,
			showTotal: (count: number) => t(adminI18n.common.totalCount, { count }),
			onChange: (currentPage: number, currentPageSize: number) => {
				setPage(currentPage);
				setPageSize(currentPageSize);
			},
		}),
		[page, pageSize, t, total],
	);

	const groupFilterOptions = useMemo(
		() =>
			groups.map((group: EmailGroup) => ({
				value: group.id,
				label: `${group.name} (${group.emailCount})`,
			})),
		[groups],
	);

	const groupOptions = useMemo(
		() =>
			groups.map((group: EmailGroup) => ({
				value: group.id,
				label: group.name,
			})),
		[groups],
	);

	const createActionItems = EXTERNAL_REPRESENTATIVE_PROTOCOLS.map((protocol) => {
		return {
			key: protocol,
			icon: <PlusOutlined />,
			label: t(getRepresentativeProtocolConnectionLabelMessage(protocol)),
			onClick: () => handleCreate(protocol),
		};
	});

	const toolActionItems = [
		{
			key: "import",
			icon: <UploadOutlined />,
			label: t(adminI18n.common.import),
			onClick: () => setImportModalVisible(true),
		},
		{
			key: "export",
			icon: <DownloadOutlined />,
			label: t(adminI18n.common.export),
			onClick: handleExport,
		},
		{
			key: "check",
			icon: <ReloadOutlined />,
			label:
				selectedRowKeys.length > 0
					? t(emailsInlineI18n["emails.tools.batchCheckSelected"], { count: selectedRowKeys.length })
					: t(emailsInlineI18n["emails.tools.batchCheckFiltered"]),
			disabled: batchFetchLoading,
			onClick: () => {
				void handleBatchFetchMailboxes();
			},
		},
		{
			key: "clear",
			icon: <DeleteOutlined />,
			label:
				selectedRowKeys.length > 0
					? t(emailsInlineI18n["emails.tools.batchClearSelected"], { count: selectedRowKeys.length })
					: t(emailsInlineI18n["emails.tools.batchClearFiltered"]),
			danger: true,
			onClick: () => setBatchClearModalVisible(true),
		},
	];

	// ========================================
	// Group table columns
	// ========================================
	const groupColumns: ColumnsType<EmailGroup> = useMemo(
		() => [
			{
				title: t(emailsInlineI18n["emails.group.columnName"]),
				dataIndex: "name",
				key: "name",
				render: (name: string) => <Tag color="blue">{name}</Tag>,
			},
			{
				title: t(emailsInlineI18n["emails.group.columnDescription"]),
				dataIndex: "description",
				key: "description",
				render: (val: string | null) => val || "-",
			},
			{
				title: t(emailsInlineI18n["emails.group.columnFetchStrategy"]),
				dataIndex: "fetchStrategy",
				key: "fetchStrategy",
				width: 190,
					render: (value: MailFetchStrategy) => (
						<Tag color="purple">{t(MAIL_FETCH_STRATEGY_LABELS[value])}</Tag>
					),
			},
			{
				title: t(emailsInlineI18n["emails.group.columnEmailCount"]),
				dataIndex: "emailCount",
				key: "emailCount",
				width: 100,
			},
			{
				title: t(adminI18n.common.createdAt),
				dataIndex: "createdAt",
				key: "createdAt",
				width: 180,
				render: (val: string) => dayjs(val).format("YYYY-MM-DD HH:mm"),
			},
			{
				title: t(adminI18n.common.actions),
				key: "action",
				width: 160,
				render: (_: unknown, record: EmailGroup) => (
					<Space>
						<Button
							type="text"
							icon={<EditOutlined />}
							onClick={() => handleEditGroup(record)}
						/>
						<Popconfirm
								title={t(emailsInlineI18n["emails.group.deleteConfirm"])}
								onConfirm={() => handleDeleteGroup(record.id)}
						>
							<Button type="text" danger icon={<DeleteOutlined />} />
						</Popconfirm>
					</Space>
				),
			},
		],
		[handleDeleteGroup, handleEditGroup, t],
	);

	// ========================================
	// Render
	// ========================================
	return (
		<div>
			<PageHeader
				title={t(adminI18n.emails.title)}
				subtitle={t(adminI18n.emails.subtitle)}
				extra={
					<Space wrap>
						<Dropdown menu={{ items: toolActionItems }}>
							<Button icon={<MoreOutlined />}>{t(adminI18n.emails.tools)}</Button>
						</Dropdown>
						<Dropdown menu={{ items: createActionItems }}>
							<Button type="primary" icon={<PlusOutlined />}>{t(adminI18n.emails.addMailbox)}</Button>
						</Dropdown>
					</Space>
				}
			/>
			<Tabs
				defaultActiveKey="emails"
				animated={false}
				destroyOnHidden
				items={[
					{
						key: "emails",
						label: t(adminI18n.emails.mailboxList),
						children: (
							<>
								<div style={emailStyles.filterToolbar}>
									<Space wrap>
										<Input
										placeholder={t(adminI18n.emails.searchMailboxes)}
											prefix={<SearchOutlined />}
											value={keyword}
											onChange={(e) => setKeyword(e.target.value)}
											style={width200Style}
											allowClear
										/>
										<Select
										placeholder={t(adminI18n.emails.filterByProtocol)}
											allowClear
											style={width170Style}
											value={filterRepresentativeProtocol}
											options={EXTERNAL_REPRESENTATIVE_PROTOCOLS.map(
												(protocol) => ({
													value: protocol,
													label: t(getRepresentativeProtocolLabelMessage(protocol)),
												}),
											)}
											onChange={(value: RepresentativeProtocol | undefined) => {
												setFilterRepresentativeProtocol(value);
												setPage(1);
											}}
										/>
										<Select
										placeholder={t(adminI18n.emails.filterByProvider)}
											allowClear
											style={width150Style}
											value={filterProvider}
											options={filterProviderOptions}
											onChange={(value: EmailProvider | undefined) => {
												setFilterProvider(value);
												setPage(1);
											}}
										/>
										<Select
										placeholder={t(adminI18n.emails.filterByStatus)}
											allowClear
											style={width140Style}
											value={filterStatus}
										options={emailStatusFilterOptions}
											onChange={(value: EmailAccountStatus | undefined) => {
												setFilterStatus(value);
												setPage(1);
											}}
										/>
										<Select
										placeholder={t(adminI18n.emails.filterByGroup)}
											allowClear
											style={width160Style}
											value={filterGroupId}
											options={groupFilterOptions}
											onChange={(val: number | string | undefined) => {
												setFilterGroupId(toOptionalNumber(val));
												setPage(1);
											}}
										/>
									</Space>
								</div>

								{selectedRowKeys.length > 0 ? (
									<SurfaceCard tone="muted" style={emailStyles.selectionBar} bodyStyle={{ padding: '12px 16px' }}>
									<Space wrap style={{ width: '100%', justifyContent: 'space-between', gap: 12 }}>
										<Text type="secondary">{t(emailsInlineI18n["emails.selection.banner"], { count: selectedRowKeys.length })}</Text>
										<Space wrap>
											<Button type="text" icon={<GroupOutlined />} onClick={() => setAssignGroupModalVisible(true)}>
												{t(emailsInlineI18n["emails.selection.assignGroup"])}
											</Button>
											<Button type="text" onClick={handleBatchRemoveGroup}>
												{t(emailsInlineI18n["emails.selection.removeGroup"])}
											</Button>
											<Popconfirm
												title={t(emailsInlineI18n["emails.selection.deleteSelectedConfirm"], { count: selectedRowKeys.length })}
												onConfirm={handleBatchDelete}
											>
												<Button danger>{t(emailsInlineI18n["emails.selection.batchDelete"])}</Button>
											</Popconfirm>
										</Space>
										</Space>
									</SurfaceCard>
								) : null}

								{filterStatus === "ERROR" ? (
									<Alert
										type={focusedEmailRecord ? "error" : "warning"}
										showIcon
										style={marginBottom16Style}
						title={
											focusedEmailRecord
												? t(emailsInlineI18n["emails.errorFilter.focusedTitle"], { email: focusedEmailRecord.email })
												: t(emailsInlineI18n["emails.errorFilter.listTitle"])
									}
									description={
										focusedEmailRecord
											? `${focusedEmailRecord.errorMessage || t(emailsInlineI18n["emails.errorFilter.defaultReason"])}${focusedEmailRecord.lastCheckAt ? ` ${t(emailsInlineI18n["emails.errorFilter.lastChecked"], { time: dayjs(focusedEmailRecord.lastCheckAt).format("YYYY-MM-DD HH:mm:ss") })}` : ""}`
											: t(emailsInlineI18n["emails.errorFilter.listDescription"])
									}
										action={
											<Space wrap>
												{focusedEmailRecord ? (
													<Button
														size="small"
														icon={<ReloadOutlined />}
														loading={checkingEmailIds.includes(
															focusedEmailRecord.id,
														)}
														onClick={() =>
															void handleCheckSingleMailbox(focusedEmailRecord)
														}
													>
												{t(emailsInlineI18n["emails.errorFilter.recheck"])}
													</Button>
												) : null}
												{focusedEmailRecord ? (
													<Button
														size="small"
														onClick={() => void handleEdit(focusedEmailRecord)}
													>
												{t(emailsInlineI18n["emails.errorFilter.viewConfig"])}
													</Button>
												) : null}
												<Button
													size="small"
													onClick={() => {
														setFocusedEmailId(undefined);
														navigate("/emails", { replace: true });
													}}
												>
												{t(emailsInlineI18n["emails.errorFilter.clearFocus"])}
												</Button>
											</Space>
										}
									/>
								) : null}

									<Table
										columns={columns}
										dataSource={data}
										rowKey="id"
										loading={loading}
					rowSelection={rowSelection}
					pagination={tablePagination}
					size="small"
					scroll={{ y: 560 }}
					/>
							</>
						),
					},
					{
						key: "groups",
						label: t(adminI18n.emails.mailboxGroups),
						children: (
							<>
							<div style={emailStyles.listTopActions}>
								<Button
									type="primary"
									icon={<PlusOutlined />}
									onClick={handleCreateGroup}
								>
									{t(emailsInlineI18n["emails.group.createButton"])}
								</Button>
								</div>
								<Table
									columns={groupColumns}
									dataSource={groups}
									rowKey="id"
									pagination={false}
								/>
							</>
						),
					},
				]}
			/>

			{/* 添加/编辑邮箱 Modal */}
			<Modal
				title={
					editingId
						? t(emailsPageI18n.editMailboxTitle)
						: t(
							getRepresentativeProtocolConnectionLabelMessage(
								selectedRepresentativeProtocol,
							),
						)
				}
				open={modalVisible}
				onOk={handleSubmit}
				onCancel={closeEmailModal}
				okText={
					requiresOAuthFields
						? t(emailsPageI18n.manualSaveAdvanced)
						: t(emailsPageI18n.save)
				}
				destroyOnHidden
				width={680}
			>
				<Spin spinning={emailEditLoading}>
					<Form form={form} layout="vertical">
						<Form.Item name="provider" hidden>
							<Input />
						</Form.Item>

						<Tabs
							activeKey={selectedRepresentativeProtocol}
							onChange={(key) =>
								handleRepresentativeProtocolChange(
									key as RepresentativeProtocol,
								)
							}
							items={EXTERNAL_REPRESENTATIVE_PROTOCOLS.map((protocol) => {
								const protocolProfiles =
									getProviderProfilesByRepresentativeProtocol(protocol);
								return {
									key: protocol,
									label: t(getRepresentativeProtocolLabelMessage(protocol)),
									children: (
										<div style={marginBottom12Style}>
											<div style={emailStyles.modalSectionHeading}>
												{t(getRepresentativeProtocolLabelMessage(protocol))}
											</div>
											<Text type="secondary">{t(getRepresentativeProtocolDescriptionMessage(protocol))}</Text>
											<div style={marginTop8Style}>
												<Space wrap>
													{protocolProfiles.map((profile) => (
														<Tag
															key={profile.key}
															color={
																profile.key === selectedProfileDefinition.key
																	? "blue"
																	: "default"
															}
														>
															{t(getProviderProfileLabelMessage(profile.key))}
														</Tag>
													))}
												</Space>
											</div>
										</div>
									),
								};
							})}
						/>

						<div style={marginBottom12Style}>
							<div style={emailStyles.modalSectionHeadingWide}>
								{t(emailsPageI18n.providerProfileHeading)}
							</div>
							<Space wrap>
								{availableProfileDefinitions.map((profile) => (
									<Button
										key={profile.key}
										type={
											profile.key === selectedProfileDefinition.key
												? "primary"
												: "default"
										}
										onClick={() => handleProfileSelection(profile.key)}
									>
										{t(getProviderProfileLabelMessage(profile.key))}
									</Button>
								))}
							</Space>
						</div>

						{!editingId && (
							<Alert
								type="info"
								showIcon
								style={marginBottom12Style}
							title={t(emailsPageI18n.selectedProtocolAlertTitle, {
								protocol: t(
									getRepresentativeProtocolLabelMessage(
										selectedRepresentativeProtocol,
									),
								),
							})}
							description={`${t(getRepresentativeProtocolDescriptionMessage(selectedRepresentativeProtocol))} ${t(emailsPageI18n.currentProfileInline, { profile: t(getProviderProfileLabelMessage(selectedProfileDefinition.key)) })}。${t(getProviderProfileSummaryHintMessage(selectedProfileDefinition.key))}`}
							/>
						)}

						<Space wrap style={marginBottom12Style}>
							<Tag
								color={getRepresentativeProtocolTagColor(
									selectedProfileDefinition.representativeProtocol,
								)}
							>
								{t(emailsPageI18n.representativeProtocolInline, {
									protocol: t(
										getRepresentativeProtocolLabelMessage(
											selectedProfileDefinition.representativeProtocol,
										),
									),
								})}
							</Tag>
							<Tag color={selectedProviderDefinition.tagColor}>
								{t(emailsPageI18n.profileInline, {
									profile: t(
										getProviderProfileLabelMessage(selectedProfileDefinition.key),
									),
								})}
							</Tag>
							{selectedProfileDefinition.secondaryProtocols.map((protocol) => (
								<Tag
									key={`selected-${selectedProfileDefinition.key}-${protocol}`}
								>
									{t(emailsPageI18n.secondaryProtocolInline, {
										protocol: t(getSecondaryProtocolLabelMessage(protocol)),
									})}
								</Tag>
							))}
						</Space>

						<Text type="secondary" style={emailStyles.secondaryBlock}>
							{t(getProviderProfileDescriptionMessage(selectedProfileDefinition.key))}{" "}
							{t(emailsPageI18n.connectionPathHint)}
						</Text>

						<div style={emailStyles.capabilityBox}>
						<Space orientation="vertical" size={12} style={fullWidthStyle}>
								<div>
									<Text strong style={displayBlockMarginBottom4Style}>
										{t(emailsPageI18n.capabilityMatrixHeading)}
									</Text>
									<Text type="secondary">
										{t(emailsPageI18n.capabilityMatrixDescription)}
									</Text>
								</div>
								{renderCapabilityMatrix(selectedProfileCapabilitySummary, t)}
							</Space>
						</div>

						<Form.Item
							name="email"
							label={t(emailsPageI18n.emailAddressLabel)}
							extra={
								(isGmailOAuth || isOutlookProvider) && !editingId
									? `使用上方 ${isGmailOAuth ? "Google" : "Microsoft"} OAuth 授权链接时可先留空，授权完成后系统会自动识别邮箱地址；若点击底部“手动保存（高级）”，这里仍需填写。`
									: undefined
							}
							rules={[
								{
									validator: (_, value) => {
										const normalizedValue =
											typeof value === "string" ? value.trim() : "";
										if (!normalizedValue) {
										if ((isGmailOAuth || isOutlookProvider) && !editingId) {
											return Promise.resolve();
										}
										return Promise.reject(
											new Error(t(emailsPageI18n.emailAddressRequired)),
										);
									}
									const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
									if (!emailPattern.test(normalizedValue)) {
										return Promise.reject(
											new Error(t(emailsPageI18n.validEmailRequired)),
										);
									}
										return Promise.resolve();
									},
								},
							]}
						>
							<Input
								placeholder={t(getProviderEmailPlaceholderMessage(selectedProvider))}
							/>
						</Form.Item>

						{isOutlookProvider && (
							<>
								<Form.Item name="authType" hidden>
									<Input />
								</Form.Item>
							<Form.Item label={t(emailsInlineI18n["emails.form.authTypeLabel"])}>
								<Input value={t(getAuthTypeLabelMessage("MICROSOFT_OAUTH"))} disabled />
							</Form.Item>
								<Text type="secondary" style={emailStyles.secondaryBlock}>
									使用 Microsoft OAuth 接入 Outlook / Microsoft 365。产品层按
									OAuth API 主分类展示，默认用 Graph
									完成读信、清空和发信；若遇到兼容性问题，底层仍可能借助 IMAP
									辅助读取或删除。
								</Text>
								<Space
									orientation="vertical"
									style={emailStyles.secondaryColumnBlock}
									size="small"
								>
									<div>
										<Tag
											color={isOutlookOAuthConfigured ? "success" : "default"}
										>
											{isOutlookOAuthConfigured
												? "Microsoft OAuth 已配置"
												: "Microsoft OAuth 未配置"}
										</Tag>
										<Tag
											color={
												oauthProviderStatuses.OUTLOOK.source === "database"
													? "processing"
													: oauthProviderStatuses.OUTLOOK.source ===
															"environment"
														? "gold"
														: "default"
											}
										>
											来源：{oauthProviderStatuses.OUTLOOK.source}
										</Tag>
										<Tag
											color={
												oauthProviderStatuses.OUTLOOK.hasClientSecret
													? "blue"
													: "default"
											}
										>
											{oauthProviderStatuses.OUTLOOK.hasClientSecret
												? "已存储 client secret"
												: "未存储 client secret"}
										</Tag>
									</div>
									<Text type="secondary">
										Microsoft OAuth 的回调地址、Client ID、Client
										Secret、Tenant、Scopes
										现在也统一放在这里配置。系统会自动保存配置、生成授权链接，并在你完成
										Microsoft 登录与授权后自动回调写回邮箱。
									</Text>
								</Space>
								<Form.Item
									name="outlookOAuthCallbackUri"
								label={t(providerSetupI18n["emails.outlook.callbackLabel"])}
								rules={[
									{ required: true, message: t(providerSetupI18n["emails.outlook.callbackRequired"]) },
								]}
							>
								<Input placeholder={t(providerSetupI18n["emails.outlook.callbackPlaceholder"])} />
							</Form.Item>
								<Form.Item
									name="outlookOAuthClientId"
								label={t(providerSetupI18n["emails.outlook.clientIdLabel"])}
								rules={[
									{
										required: true,
										message: t(providerSetupI18n["emails.outlook.clientIdRequired"]),
									},
								]}
							>
								<Input placeholder={t(providerSetupI18n["emails.outlook.clientIdPlaceholder"])} />
							</Form.Item>
								<Form.Item
									name="outlookOAuthClientSecret"
								label={t(providerSetupI18n["emails.outlook.clientSecretLabel"])}
								extra={t(providerSetupI18n["emails.outlook.clientSecretExtra"])}
							>
								<Input.Password placeholder={t(providerSetupI18n["emails.outlook.clientSecretPlaceholder"])} />
							</Form.Item>
							<Form.Item name="outlookOAuthTenant" label={t(providerSetupI18n["emails.outlook.tenantLabel"])}>
								<Input placeholder={t(providerSetupI18n["emails.outlook.tenantPlaceholder"])} />
							</Form.Item>
								<Form.Item
									name="outlookOAuthScopes"
								label={t(providerSetupI18n["emails.outlook.scopesLabel"])}
								extra={t(providerSetupI18n["emails.outlook.scopesExtra"])}
							>
									<TextArea
										rows={3}
										placeholder={DEFAULT_OUTLOOK_OAUTH_SCOPES}
									/>
								</Form.Item>
								<Space wrap style={marginBottom12Style}>
									<Button
										type="primary"
										loading={outlookAuthUrlLoading}
										onClick={() => void handleGenerateOutlookAuthUrl()}
									>
									{t(providerSetupI18n["emails.outlook.generateLinkButton"])}
									</Button>
									<Button
										onClick={() => void saveOutlookOAuthConfig()}
										loading={outlookSaveLoading}
									>
									{t(providerSetupI18n["emails.outlook.saveConfigButton"])}
									</Button>
									{generatedOutlookAuthUrl ? (
										<Button
											onClick={() =>
												void handleCopyGeneratedAuthUrl(
													generatedOutlookAuthUrl,
													t(getProviderLabelMessage("OUTLOOK")),
												)
											}
										>
											{t(providerSetupI18n["emails.oauth.copyAuthLinkButton"])}
										</Button>
									) : null}
									{generatedOutlookAuthUrl ? (
										<Button
											onClick={() =>
												window.open(
													generatedOutlookAuthUrl,
													"_blank",
													"noopener,noreferrer",
												)
											}
										>
											{t(providerSetupI18n["emails.oauth.openCurrentBrowser"])}
										</Button>
									) : null}
									{generatedOutlookAuthUrl ? (
										<Button
											onClick={() => {
												void fetchData();
												void fetchGroups();
											}}
										>
											{t(providerSetupI18n["emails.oauth.refreshAfterAuth"])}
										</Button>
									) : null}
								</Space>
								{outlookOAuthPendingState ? (
									<Alert
										showIcon
										type="info"
										style={marginBottom12Style}
							title={
											outlookOAuthPollStatus === "processing"
												? t(providerSetupI18n["emails.outlook.pending.processingTitle"])
												: t(providerSetupI18n["emails.outlook.pending.waitingTitle"])
										}
							description={
								outlookOAuthStatusExpiresAt
									? t(providerSetupI18n["emails.oauth.pending.recheckBefore"], { time: dayjs(outlookOAuthStatusExpiresAt).format("HH:mm:ss") })
									: t(providerSetupI18n["emails.oauth.pending.genericDescription"])
								}
							/>
						) : null}
								{generatedOutlookAuthUrl ? (
									<Form.Item label={t(providerSetupI18n["emails.outlook.authUrlLabel"])}>
										<TextArea
											rows={5}
											value={generatedOutlookAuthUrl}
											readOnly
										/>
									</Form.Item>
								) : null}
						<Text type="secondary" style={emailStyles.secondaryBlock}>
							{t(providerSetupI18n["emails.microsoft.authUrlHelp"])}
						</Text>
								{editingId && revealTargetField === "refreshToken"
									? renderStoredSecretRevealPanel()
									: null}
								<Form.Item
									name="clientId"
									label={t(providerSetupI18n["emails.outlook.recordClientIdLabel"])}
									rules={[
										{
											required: !editingId,
										message: t(providerSetupI18n["emails.outlook.recordClientIdRequired"]),
										},
									]}
								>
									<Input placeholder={t(providerSetupI18n["emails.outlook.recordClientIdPlaceholder"])} />
								</Form.Item>
								<Form.Item
									name="refreshToken"
									label={t(providerSetupI18n["emails.outlook.recordRefreshTokenLabel"])}
									rules={[
										{
											required: !editingId,
										message: t(providerSetupI18n["emails.outlook.recordRefreshTokenRequired"]),
										},
									]}
								>
									<TextArea
										rows={4}
										placeholder={t(providerSetupI18n["emails.outlook.recordRefreshTokenPlaceholder"])}
									/>
								</Form.Item>
								<Form.Item
									name="clientSecret"
									label={t(providerSetupI18n["emails.outlook.recordClientSecretLabel"])}
									extra={t(providerSetupI18n["emails.outlook.recordClientSecretExtra"])}
								>
									<Input.Password placeholder={t(providerSetupI18n["emails.outlook.recordClientSecretPlaceholder"])} />
								</Form.Item>
								{renderAccountLoginPasswordField(
									"这是邮箱账号本身的登录密码，不是 OAuth Refresh Token。编辑已有账号时需先完成 2FA 验证后才能补录或更新。",
									"例如邮箱网页登录密码（可选）",
								)}
							</>
						)}

						{isGmailProvider && (
							<>
								<Form.Item
									name="authType"
								label={t(emailsInlineI18n["emails.form.authTypeLabel"])}
								rules={[{ required: true, message: t(providerSetupI18n["emails.gmail.authTypeRequired"]) }]}
							>
								<Select
									options={EMAIL_AUTH_TYPE_OPTIONS.GMAIL.map((option) => ({ ...option, label: t(getAuthTypeLabelMessage(option.value)) }))}
									onChange={handleAuthTypeChange}
								/>
							</Form.Item>
								<Text type="secondary" style={emailStyles.secondaryBlock}>
									Gmail 支持两种 profile：Google OAuth 归入 OAuth API
									主分类，应用专用密码归入 IMAP / SMTP
									主分类；如需更完整能力，优先使用 Google OAuth。
								</Text>
								{isGmailOAuth && (
									<>
									<Space
										orientation="vertical"
										style={emailStyles.secondaryColumnBlock}
										size="small"
										>
											<div>
												<Tag
													color={isGmailOAuthConfigured ? "success" : "default"}
												>
													{isGmailOAuthConfigured
														? "Google OAuth 已配置"
														: "Google OAuth 未配置"}
												</Tag>
												<Tag
													color={
														oauthProviderStatuses.GMAIL.source === "database"
															? "processing"
															: oauthProviderStatuses.GMAIL.source ===
																	"environment"
																? "gold"
																: "default"
													}
												>
													来源：{oauthProviderStatuses.GMAIL.source}
												</Tag>
												<Tag
													color={
														oauthProviderStatuses.GMAIL.hasClientSecret
															? "blue"
															: "default"
													}
												>
													{oauthProviderStatuses.GMAIL.hasClientSecret
														? "已存储 client secret"
														: "未存储 client secret"}
												</Tag>
											</div>
											<Text type="secondary">
												回调地址在这里手工输入，Google client_secret JSON
												也在这里直接导入或粘贴。当前 profile 对用户按 OAuth
												API（Gmail
												API）主分类展示；若个别邮箱夹需要兼容处理，底层仍可能补充
												IMAP 路径。
											</Text>
										</Space>
										<Form.Item
											name="gmailOAuthCallbackUri"
											label={t(providerSetupI18n["emails.google.callbackLabel"])}
											rules={[
												{ required: true, message: t(providerSetupI18n["emails.google.callbackRequired"]) },
											]}
											extra={t(providerSetupI18n["emails.google.callbackExtra"])}
										>
											<Input placeholder={t(providerSetupI18n["emails.google.callbackPlaceholder"])} />
										</Form.Item>
										<Space wrap style={marginBottom8Style}>
											<Upload
												beforeUpload={handleGoogleJsonUpload}
												showUploadList={false}
												maxCount={1}
												accept=".json"
											>
												<Button icon={<UploadOutlined />}>
													{t(providerSetupI18n["emails.google.importJsonButton"])}
												</Button>
											</Upload>
											<Button
												onClick={() => void handleParseGoogleClientSecret()}
												loading={googleParseLoading}
											>
												{t(providerSetupI18n["emails.google.parseJsonButton"])}
											</Button>
										</Space>
										<Form.Item
											name="gmailOAuthJsonText"
											label={t(providerSetupI18n["emails.google.jsonTextLabel"])}
										>
											<TextArea
												rows={4}
												placeholder='{"web":{"client_id":"...","client_secret":"...","redirect_uris":["http://127.0.0.1:3002/admin/oauth/google/callback"]}}'
											/>
										</Form.Item>
										<Form.Item
											name="gmailOAuthClientId"
											label={t(providerSetupI18n["emails.google.clientIdLabel"])}
											rules={[
												{
													required: true,
													message: t(providerSetupI18n["emails.google.clientIdRequired"]),
												},
											]}
										>
											<Input placeholder={t(providerSetupI18n["emails.google.clientIdPlaceholder"])} />
										</Form.Item>
										<Form.Item
											name="gmailOAuthClientSecret"
											label={t(providerSetupI18n["emails.google.clientSecretLabel"])}
											extra={t(providerSetupI18n["emails.google.clientSecretExtra"])}
										>
											<Input.Password placeholder={t(providerSetupI18n["emails.google.clientSecretPlaceholder"])} />
										</Form.Item>
										<Form.Item
											name="gmailOAuthScopes"
											label={t(providerSetupI18n["emails.google.scopesLabel"])}
										>
											<TextArea
												rows={3}
												placeholder={DEFAULT_GOOGLE_OAUTH_SCOPES}
											/>
										</Form.Item>
										<Space wrap style={marginBottom12Style}>
											<Button
												type="primary"
												loading={googleAuthUrlLoading}
												onClick={() => void handleGenerateGoogleAuthUrl()}
											>
												{t(providerSetupI18n["emails.google.generateLinkButton"])}
											</Button>
											<Button
												onClick={() => void saveGoogleOAuthConfig()}
												loading={googleSaveLoading}
											>
												{t(providerSetupI18n["emails.google.saveConfigButton"])}
											</Button>
											{generatedGoogleAuthUrl ? (
												<Button
													onClick={() =>
														void handleCopyGeneratedAuthUrl(
															generatedGoogleAuthUrl,
													t(getProviderLabelMessage("GMAIL")),
												)
													}
												>
													复制授权链接
												</Button>
											) : null}
											{generatedGoogleAuthUrl ? (
												<Button
													onClick={() =>
														window.open(
															generatedGoogleAuthUrl,
															"_blank",
															"noopener,noreferrer",
														)
													}
												>
													当前浏览器打开
												</Button>
											) : null}
											{generatedGoogleAuthUrl ? (
												<Button
													onClick={() => {
														void fetchData();
														void fetchGroups();
													}}
												>
													授权完成后刷新列表
												</Button>
											) : null}
										</Space>
										{googleOAuthPendingState ? (
											<Alert
												showIcon
												type="info"
												style={marginBottom12Style}
							title={
													googleOAuthPollStatus === "processing"
												? t(providerSetupI18n["emails.google.pending.processingTitle"])
												: t(providerSetupI18n["emails.google.pending.waitingTitle"])
										}
										description={
											googleOAuthStatusExpiresAt
												? t(providerSetupI18n["emails.oauth.pending.recheckBefore"], { time: dayjs(googleOAuthStatusExpiresAt).format("HH:mm:ss") })
												: t(providerSetupI18n["emails.oauth.pending.genericDescription"])
										}
									/>
										) : null}
										{generatedGoogleAuthUrl ? (
									<Form.Item label={t(providerSetupI18n["emails.google.authUrlLabel"])}>
												<TextArea
													rows={5}
													value={generatedGoogleAuthUrl}
													readOnly
												/>
											</Form.Item>
										) : null}
					<Text type="secondary" style={emailStyles.secondaryBlock}>
						{t(providerSetupI18n["emails.google.authUrlHelp"])}
					</Text>
									{editingId && revealTargetField === "refreshToken"
										? renderStoredSecretRevealPanel()
										: null}
									<Form.Item
										name="clientId"
										label={t(providerSetupI18n["emails.google.recordClientIdLabel"])}
											rules={[
												{
													required: !editingId,
												message: t(providerSetupI18n["emails.google.recordClientIdRequired"]),
												},
											]}
										>
											<Input placeholder={t(providerSetupI18n["emails.google.recordClientIdPlaceholder"])} />
										</Form.Item>
										<Form.Item
											name="refreshToken"
											label={t(providerSetupI18n["emails.google.recordRefreshTokenLabel"])}
											rules={[
												{
													required: !editingId,
												message: t(providerSetupI18n["emails.google.recordRefreshTokenRequired"]),
												},
											]}
										>
											<TextArea
												rows={4}
												placeholder={t(providerSetupI18n["emails.google.recordRefreshTokenPlaceholder"])}
											/>
										</Form.Item>
									<Form.Item
										name="clientSecret"
										label={t(providerSetupI18n["emails.google.recordClientSecretLabel"])}
										extra={t(providerSetupI18n["emails.google.recordClientSecretExtra"])}
									>
										<Input.Password placeholder={t(providerSetupI18n["emails.google.recordClientSecretPlaceholder"])} />
									</Form.Item>
									{renderAccountLoginPasswordField(
										"这是 Gmail 账号本身的登录密码，不是 Refresh Token。编辑已有账号时需先完成 2FA 验证后才能补录或更新。",
										"例如 Gmail 账号登录密码（可选）",
									)}
								</>
							)}
							{isGmailAppPassword && (
								<>
									<Form.Item
										name="password"
										label={t(providerSetupI18n["emails.gmail.appPasswordLabel"])}
										rules={[
											{
												required: !editingId,
												message: t(providerSetupI18n["emails.gmail.appPasswordRequired"]),
											},
										]}
										extra={t(providerSetupI18n["emails.gmail.appPasswordExtra"])}
									>
										<Input.Password placeholder={t(providerSetupI18n["emails.gmail.appPasswordPlaceholder"])} />
									</Form.Item>
									{editingId && revealTargetField === "password"
										? renderStoredSecretRevealPanel()
										: null}
									{renderAccountLoginPasswordField(
										"如果你还想保存账号本身的网页登录密码，请先完成 2FA 验证后再补录。",
										"例如 Gmail 账号网页登录密码（可选）",
									)}
								</>
							)}
							</>
						)}

						{isGenericImapSmtpProvider && (
							<>
								<Form.Item name="authType" hidden>
									<Input />
								</Form.Item>
							<Form.Item label={t(emailsInlineI18n["emails.form.authTypeLabel"])}>
								<Input value={t(providerSetupI18n["emails.imap.authTypeValue"])} disabled />
							</Form.Item>
							<Text type="secondary" style={emailStyles.secondaryBlock}>
								{t(providerSetupI18n["emails.imap.profileDescription"], { profileDescription: t(getProviderProfileDescriptionMessage(selectedProfileDefinition.key)) })}
							</Text>
								<Form.Item
									name="password"
									label={
										t(
											getProviderProfileSecretLabelMessage(
												selectedProfileDefinition.key,
											) ||
											defineMessage(
												"emails.imap.genericCredentialLabel",
												"{providerLabel} 授权码 / 应用专用密码",
												"{providerLabel} authorization code / app password",
											),
											{ providerLabel: t(getProviderLabelMessage(selectedProvider)) },
										)
									}
									rules={[
										{
											required: !editingId,
											message: t(providerSetupI18n["emails.imap.genericCredentialRequired"], {
													label: t(
														getProviderProfileSecretLabelMessage(
															selectedProfileDefinition.key,
														) || getProviderLabelMessage(selectedProvider),
													),
												}),
										},
									]}
									extra={`${t(getProviderProfileSecretHelpTextMessage(selectedProfileDefinition.key) || defineMessage("emails.imap.genericCredentialHelp", "", ""))}${editingId ? ` ${t(providerSetupI18n["emails.imap.blankKeepsStoredValue"])}` : ""}`.trim()}
									>
										<Input.Password
										placeholder={
											t(
												getProviderProfileSecretPlaceholderMessage(
													selectedProfileDefinition.key,
												) ||
												defineMessage(
													"emails.imap.genericCredentialLabel",
													"{providerLabel} 授权码 / 应用专用密码",
													"{providerLabel} authorization code / app password",
												),
												{ providerLabel: t(getProviderLabelMessage(selectedProvider)) },
											)
										}
										/>
									</Form.Item>
								{editingId && revealTargetField === "password"
									? renderStoredSecretRevealPanel()
									: null}
								{renderAccountLoginPasswordField(
									"如果你还想保存邮箱账号本身的登录密码，请先完成 2FA 验证后再补录。",
									"例如邮箱网页登录密码（可选）",
								)}

								<div style={emailStyles.capabilityBox}>
						<Space orientation="vertical" size={12} style={fullWidthStyle}>
										<div>
										<Text strong style={displayBlockMarginBottom4Style}>
											{t(providerSetupI18n["emails.imap.serverConfigHeading"])}
										</Text>
										<Text type="secondary">
											{t(
												getProviderProfileServerConfigHelpTextMessage(
													selectedProfileDefinition.key,
												) ||
												defineMessage(
													"emails.imap.serverConfigHelp",
													"大多数 IMAP / SMTP provider 已预填服务器设置；如你的服务商要求不同主机、端口或文件夹名称，可以在这里覆盖。",
													"Most IMAP / SMTP providers already have prefilled server settings. Override them here if your provider requires different hosts, ports, or folder names.",
												),
											)}
										</Text>
										</div>
										<Form.Item
											name={["providerConfig", "imapHost"]}
										label={t(providerSetupI18n["emails.imap.imapHostLabel"])}
											rules={
												selectedProfileDefinition.requiresManualServerConfig
											? [{ required: true, message: t(providerSetupI18n["emails.imap.imapHostRequired"]) }]
													: undefined
											}
										>
											<Input
												placeholder={
													selectedProfileConfigDefaults?.imapHost ||
													"imap.example.com"
												}
											/>
										</Form.Item>
										<Form.Item
											name={["providerConfig", "imapPort"]}
										label={t(providerSetupI18n["emails.imap.imapPortLabel"])}
										>
											<Input
												type="number"
												placeholder={String(
													selectedProfileConfigDefaults?.imapPort || 993,
												)}
											/>
										</Form.Item>
										<Form.Item
											name={["providerConfig", "imapTls"]}
											valuePropName="checked"
											label={t(providerSetupI18n["emails.imap.imapTlsLabel"])}
									>
										<Checkbox>{t(providerSetupI18n["emails.imap.useSslTls"])}</Checkbox>
									</Form.Item>
										<Form.Item
											name={["providerConfig", "smtpHost"]}
										label={t(providerSetupI18n["emails.imap.smtpHostLabel"])}
											rules={
												selectedProfileDefinition.requiresManualServerConfig
											? [{ required: true, message: t(providerSetupI18n["emails.imap.smtpHostRequired"]) }]
													: undefined
											}
										>
											<Input
												placeholder={
													selectedProfileConfigDefaults?.smtpHost ||
													"smtp.example.com"
												}
											/>
										</Form.Item>
										<Form.Item
											name={["providerConfig", "smtpPort"]}
										label={t(providerSetupI18n["emails.imap.smtpPortLabel"])}
										>
											<Input
												type="number"
												placeholder={String(
													selectedProfileConfigDefaults?.smtpPort || 465,
												)}
											/>
										</Form.Item>
										<Form.Item
											name={["providerConfig", "smtpSecure"]}
											valuePropName="checked"
											label={t(providerSetupI18n["emails.imap.smtpSecureLabel"])}
										>
											<Checkbox>
												{t(providerSetupI18n["emails.imap.useSslCheckbox"])}
											</Checkbox>
										</Form.Item>
										<Alert
											type={isCustomImapSmtpProvider ? "warning" : "info"}
											showIcon
							title={
												isCustomImapSmtpProvider
												? t(providerSetupI18n["emails.imap.customServerWarningTitle"])
												: t(providerSetupI18n["emails.imap.overrideFolderNamesTitle"])
											}
											description={
												isCustomImapSmtpProvider
												? t(providerSetupI18n["emails.imap.customServerWarningDescription"])
												: t(providerSetupI18n["emails.imap.overrideFolderNamesDescription"])
											}
										/>
										<Form.Item
											name={["providerConfig", "folders", "inbox"]}
										label={t(providerSetupI18n["emails.imap.inboxFolderLabel"])}
										>
											<Input
												placeholder={
													selectedProfileConfigDefaults?.folders?.inbox ||
													"INBOX"
												}
											/>
										</Form.Item>
										<Form.Item
											name={["providerConfig", "folders", "junk"]}
										label={t(providerSetupI18n["emails.imap.junkFolderLabel"])}
										>
											<Input
												placeholder={
													selectedProfileConfigDefaults?.folders?.junk || "Junk"
												}
											/>
										</Form.Item>
										<Form.Item
											name={["providerConfig", "folders", "sent"]}
										label={t(providerSetupI18n["emails.imap.sentFolderLabel"])}
										>
											<Input
												placeholder={
													selectedProfileConfigDefaults?.folders?.sent || "Sent"
												}
											/>
										</Form.Item>
									</Space>
								</div>
							</>
						)}

						<Form.Item name="groupId" label={t(emailsInlineI18n["emails.form.groupLabel"])}>
							<Select
								placeholder={t(emailsInlineI18n["emails.form.groupPlaceholder"])}
								allowClear
								options={groupOptions}
							/>
						</Form.Item>
						<Form.Item name="status" label={t(adminI18n.common.status)} initialValue="ACTIVE">
							<Select>
								<Select.Option value="ACTIVE">{t(adminI18n.common.healthy)}</Select.Option>
								<Select.Option value="DISABLED">{t(adminI18n.common.disabled)}</Select.Option>
							</Select>
						</Form.Item>
					</Form>
				</Spin>
			</Modal>

			<Modal
				title={
					revealTargetSource === "row"
						? t(emailsInlineI18n["emails.reveal.modalTitleWithMailbox"], { email: revealTargetEmailLabel || t(emailsInlineI18n["emails.reveal.thisMailbox"]) })
						: t(emailsInlineI18n["emails.reveal.modalTitle"])
				}
				open={revealModalVisible}
				onOk={() => void handleConfirmReveal()}
				onCancel={() => {
					setRevealModalVisible(false);
					setRevealOtp("");
				}}
				okText={t(emailsInlineI18n["emails.reveal.okText"])}
				cancelText={t(emailsInlineI18n["emails.reveal.cancelText"])}
				confirmLoading={revealLoading}
				destroyOnHidden
			>
				<Space orientation="vertical" style={fullWidthStyle} size="middle">
					<Text type="secondary">
						{t(emailsInlineI18n["emails.reveal.modalDescription"], { targetLabel: revealTargetLabel || t(emailsInlineI18n["emails.reveal.secretLabelFallback"]) })}
					</Text>
					{revealTargetSource === "row" && revealTargetEmailLabel ? (
						<Text type="secondary">{t(emailsInlineI18n["emails.reveal.targetMailbox"], { email: revealTargetEmailLabel })}</Text>
					) : null}
					<Input
						value={revealOtp}
						onChange={(e) =>
							setRevealOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
						}
						prefix={<SafetyCertificateOutlined />}
						maxLength={6}
						placeholder={t(emailsInlineI18n["emails.reveal.otpPlaceholder"])}
					/>
				</Space>
			</Modal>

			<Modal
					title={t(emailsInlineI18n["emails.reveal.rowTitle"], { label: revealTargetEmailLabel || t(emailsInlineI18n["emails.reveal.mailboxFallback"]) })}
				open={rowRevealVisible}
				onCancel={resetRowRevealState}
				footer={[
					<Button key="copy" type="primary" onClick={() => void handleCopyRowRevealedPassword()}>
						{t(emailsInlineI18n["emails.reveal.copyPassword"])}
					</Button>,
					<Button key="close" onClick={resetRowRevealState}>
						{t(emailsInlineI18n["emails.reveal.close"])}
					</Button>,
				]}
				destroyOnHidden
			>
				<Space orientation="vertical" style={fullWidthStyle} size="middle">
					<Text type="secondary">
						{t(emailsInlineI18n["emails.reveal.rowDescription"])}
					</Text>
					<TextArea rows={2} value={rowRevealedAccountLoginPassword || ""} readOnly />
					{rowRevealExpiresAt ? (
						<Text type="secondary">
							{t(emailsInlineI18n["emails.reveal.rowAutoHideAt"], { time: dayjs(rowRevealExpiresAt).format("HH:mm:ss") })}
						</Text>
					) : null}
				</Space>
			</Modal>

			{/* 批量导入 Modal */}
			<Modal
				title={t(emailsInlineI18n["emails.import.modalTitle"])}
				open={importModalVisible}
				onOk={handleImport}
				onCancel={() => setImportModalVisible(false)}
				destroyOnHidden
				width={700}
			>
				<Space orientation="vertical" style={fullWidthStyle} size="middle">
					<div>
						<Text type="secondary">
							{t(emailsInlineI18n["emails.import.instructionsIntro"])}
							<br />
							{recommendedImportTemplates.map((template, index) => (
								<span key={template}>
									{template}
									{index < recommendedImportTemplates.length - 1 ? <br /> : null}
								</span>
							))}
							<br />
							{t(emailsInlineI18n["emails.import.basicFormatExplanation"])}
							<br />
							{t(emailsInlineI18n["emails.import.legacyFormatIntro"])}
							<br />
							{legacyImportTemplates.map((template, index) => (
								<span key={template}>
									{template}
									{index < legacyImportTemplates.length - 1 ? <br /> : null}
								</span>
							))}
							{t(emailsInlineI18n["emails.import.manualProvidersHint"])}
						</Text>
					</div>
					<Input
						addonBefore={t(emailsInlineI18n["emails.import.separatorLabel"])}
						value={separator}
						onChange={(e) => setSeparator(e.target.value)}
						style={width200Style}
					/>
					<Select
						placeholder={t(emailsInlineI18n["emails.import.groupPlaceholder"])}
						allowClear
						value={importGroupId}
						options={groupOptions}
						onChange={(value: number | string | undefined) =>
							setImportGroupId(toOptionalNumber(value))
						}
						style={width260Style}
					/>
					<Dragger
						beforeUpload={(file) => {
							const reader = new FileReader();
							reader.onload = (e) => {
								const fileContent = e.target?.result as string;
								if (fileContent) {
									const normalizedContent = fileContent
										.replace(/\r\n/g, "\n")
										.trim();
									const lines = normalizedContent
										.split("\n")
										.filter((line: string) => line.trim());
									setImportContent(normalizedContent);
									message.success(
										t(emailsInlineI18n["emails.import.fileParsed"], { count: lines.length }),
									);
								}
							};
							reader.readAsText(file);
							return false;
						}}
						showUploadList={false}
						maxCount={1}
						accept=".txt,.csv"
					>
						<p className="ant-upload-drag-icon">
							<InboxOutlined />
						</p>
						<p className="ant-upload-text">{t(emailsInlineI18n["emails.import.draggerText"])}</p>
						<p className="ant-upload-hint">{t(emailsInlineI18n["emails.import.draggerHint"])}</p>
					</Dragger>
					<TextArea
						rows={12}
						value={importContent}
						onChange={(e) => setImportContent(e.target.value)}
						placeholder={importTemplates.join("\n")}
					/>
				</Space>
			</Modal>

			{/* 邮件列表 Modal */}
			{mailModalVisible && (
				<Modal
					title={t(emailsInlineI18n["emails.mailbox.modalTitle"], { email: currentEmail, mailbox: t(MAILBOX_LABELS[currentMailbox]) })}
					open={mailModalVisible}
					onCancel={() => {
						setSelectedMailIds([]);
						setMailModalVisible(false);
					}}
					footer={null}
					destroyOnHidden
					width={1000}
					styles={{ body: { padding: "16px 24px" } }}
				>
					<Space style={marginBottom16Style}>
						<Tabs
							activeKey={currentMailbox}
							onChange={(key) =>
								void handleMailboxTabChange(key as MailboxName)
							}
							items={[
								{ key: "INBOX", label: t(adminI18n.emails.inbox) },
								{ key: "SENT", label: t(adminI18n.emails.sent) },
								{ key: "Junk", label: t(emailsPageI18n.mailboxJunk) },
							]}
						/>
					</Space>
					<Space style={marginBottom16Style} wrap>
						<Button
							type="primary"
							onClick={handleRefreshMails}
							loading={mailLoading}
						>
							{t(emailsInlineI18n["emails.mailbox.refreshMail"])}
						</Button>
						<Button
							icon={<SendOutlined />}
							onClick={() => setComposeModalVisible(true)}
							disabled={sendMailboxDisabled}
						>
							{t(emailsInlineI18n["emails.mailbox.composeButton"])}
						</Button>
						<Checkbox
							checked={allMailsSelected}
							indeterminate={selectedMailIds.length > 0 && !allMailsSelected}
							onChange={(event) => toggleSelectAllMails(event.target.checked)}
						>
							{t(emailsInlineI18n["emails.mailbox.selectAllCurrentList"])}
						</Checkbox>
						<Popconfirm
							title={t(emailsInlineI18n["emails.mailbox.deleteSelectedConfirm"], { count: selectedMailIds.length })}
							onConfirm={() => void handleDeleteSelectedMails()}
							disabled={selectedMailIds.length === 0}
						>
							<Button
								danger
								loading={deletingSelectedMails}
								disabled={selectedMailIds.length === 0}
							>
								{t(emailsInlineI18n["emails.mailbox.deleteSelectedButton"], { count: selectedMailIds.length })}
							</Button>
						</Popconfirm>
						<Popconfirm
							title={t(emailsInlineI18n["emails.mailbox.clearAllConfirm"], { mailbox: t(MAILBOX_LABELS[currentMailbox]) })}
							onConfirm={handleClearMailbox}
							disabled={clearMailboxDisabled || currentMailbox === "SENT"}
						>
							<Button
								danger
								disabled={clearMailboxDisabled || currentMailbox === "SENT"}
							>
								{t(emailsInlineI18n["emails.mailbox.clearButton"])}
							</Button>
						</Popconfirm>
						{(clearMailboxDisabled || currentMailbox === "SENT") && (
							<span style={emailStyles.mailSummaryLink}>
								{t(emailsInlineI18n["emails.mailbox.clearUnsupported"])}
							</span>
						)}
						<span style={emailStyles.mailSummaryCount}>
							{t(emailsInlineI18n["emails.mailbox.messageCount"], { count: mailList.length })}
						</span>
					</Space>
					<Alert
						type="info"
						showIcon
						style={marginBottom12Style}
						title={t(emailsInlineI18n["emails.mailbox.bulkDeleteHintTitle"])}
						description={t(emailsInlineI18n["emails.mailbox.bulkDeleteHintDescription"])}
					/>
					<Space orientation="vertical" size={12} style={emailStyles.selectedMailList}>
						{paginatedMailList.map((item: MailItem) => (
							<div key={item.id} style={{ border: "1px solid #f0f0f0", borderRadius: 8, padding: 12, background: "#fff" }}>
								<Space orientation="vertical" size={10} style={fullWidthStyle}>
									<Space wrap style={flexBetweenFullWidthStyle}>
										<Typography.Text ellipsis style={emailStyles.messagePreviewText}>
											{item.subject || t(emailsInlineI18n["emails.mailbox.noSubject"])}
										</Typography.Text>
										<Space wrap>
											<Checkbox
												checked={selectedMailIds.includes(item.id)}
												onChange={(event) =>
													toggleMailSelection(item.id, event.target.checked)
												}
											>
												{t(emailsInlineI18n["emails.mailbox.selectMessage"])}
											</Checkbox>
											<Button type="primary" size="small" onClick={() => handleViewEmailDetail(item)}>
												{t(emailsInlineI18n["emails.mailbox.viewMessage"])}
											</Button>
										</Space>
									</Space>
									<Space size="large" wrap>
										<span style={emailStyles.primaryMailSummaryLink}>
											{currentMailbox === "SENT"
												? item.to || t(emailsInlineI18n["emails.mailbox.unknownRecipient"])
												: item.from || t(emailsInlineI18n["emails.mailbox.unknownSender"])}
										</span>
										<span style={emailStyles.mailSummaryLink}>
											{item.date ? dayjs(item.date).format("YYYY-MM-DD HH:mm") : "-"}
										</span>
									</Space>
									</Space>
							</div>
						))}
						{mailList.length > 0 ? (
							<Pagination
								current={mailListPage}
								pageSize={mailListPageSize}
								total={mailList.length}
								showSizeChanger
								showQuickJumper
								showTotal={(total: number) =>
									t(adminI18n.common.totalCount, { count: total })
								}
								onChange={(page, pageSize) => {
									setMailListPage(page);
									setMailListPageSize(pageSize);
								}}
								style={{ marginTop: 16 }}
							/>
						) : null}
					</Space>
				</Modal>
			)}

			{/* 邮件详情 Modal */}
			{emailDetailVisible && (
				<Modal
					title={selectedMailDetail?.subject || t(emailsInlineI18n["emails.mailDetail.noSubject"])}
					open={emailDetailVisible}
					onCancel={() => setEmailDetailVisible(false)}
					footer={null}
					destroyOnHidden
					width={900}
					styles={{ body: { padding: "16px 24px" } }}
				>
					<Space orientation="vertical" style={fullWidthStyle} size={12}>
						<Text>
							<strong>
								{t(emailsInlineI18n["emails.mailDetail.sender"])}：
							</strong>
							{selectedMailDetail?.from || "-"}
						</Text>
						<Text>
							<strong>
								{currentMailbox === "SENT" ? t(emailsInlineI18n["emails.mailDetail.recipient"]) : t(emailsInlineI18n["emails.mailDetail.recipientAddress"])}：
							</strong>
							{selectedMailDetail?.to || "-"}
						</Text>
						{selectedMailDetail?.html ? (
							<div style={emailStyles.detailPanel}>
								{renderSanitizedEmailHtml(selectedMailDetail.html)}
							</div>
						) : null}
						{selectedMailDetail?.text ? (
							<div style={preWrapBreakWordStyle}>
								{renderPlainTextWithLinks(selectedMailDetail.text)}
							</div>
						) : null}
					</Space>
				</Modal>
			)}

			<Modal
				title={
					currentEmail
						? t(emailsInlineI18n["emails.compose.modalTitleWithMailbox"], { email: currentEmail })
						: t(emailsInlineI18n["emails.compose.modalTitle"])
				}
				open={composeModalVisible}
				onOk={() => void handleSendMail()}
				confirmLoading={composeSending}
				onCancel={() => setComposeModalVisible(false)}
				okText={t(emailsInlineI18n["emails.compose.okText"])}
				destroyOnHidden
				width={720}
			>
				<Alert
					style={marginBottom16Style}
					type={sendMailboxDisabled ? "warning" : "info"}
					showIcon
					title={
						sendMailboxDisabled
							? t(emailsInlineI18n["emails.compose.disabledTitle"])
							: t(emailsInlineI18n["emails.compose.enabledTitle"])
					}
					description={
						currentEmailRecord?.provider === "OUTLOOK"
							? t(emailsInlineI18n["emails.compose.outlookScopeHint"])
							: currentEmailRecord
								? t(
									getProviderProfileSummaryHintMessage(
										(currentEmailRecord.providerProfile as ProviderProfileKey | undefined) ||
											getProviderProfileDefinition(
												currentEmailRecord.provider,
												currentEmailRecord.authType,
											).key,
									),
								)
								: undefined
					}
				/>
				<Form
					form={composeForm}
					layout="vertical"
					initialValues={{ fromName: "", to: "", subject: "", text: "" }}
				>
					<Form.Item label={t(emailsInlineI18n["emails.compose.fromNameLabel"])} name="fromName">
						<Input placeholder={t(emailsInlineI18n["emails.compose.fromNamePlaceholder"])} />
					</Form.Item>
					<Form.Item
						label={t(emailsInlineI18n["emails.compose.recipientLabel"])}
						name="to"
						rules={[{ required: true, message: t(emailsInlineI18n["emails.compose.recipientRequired"]) }]}
						extra={t(emailsInlineI18n["emails.compose.recipientExtra"])}
					>
						<TextArea
							rows={3}
							placeholder={t(emailsInlineI18n["emails.compose.recipientPlaceholder"])}
						/>
					</Form.Item>
					<Form.Item
						label={t(emailsInlineI18n["emails.compose.subjectLabel"])}
						name="subject"
						rules={[{ required: true, message: t(emailsInlineI18n["emails.compose.subjectRequired"]) }]}
					>
						<Input maxLength={500} placeholder={t(emailsInlineI18n["emails.compose.subjectPlaceholder"])} />
					</Form.Item>
					<Form.Item
						label={t(emailsInlineI18n["emails.compose.bodyLabel"])}
						name="text"
						rules={[{ required: true, message: t(emailsInlineI18n["emails.compose.bodyRequired"]) }]}
					>
						<TextArea
							rows={10}
							placeholder={t(emailsInlineI18n["emails.compose.bodyPlaceholder"])}
						/>
					</Form.Item>
				</Form>
			</Modal>

			<Modal
				title={t(emailsInlineI18n["emails.batchClear.modalTitle"])}
				open={batchClearModalVisible}
				onOk={() => void handleBatchClearMailbox()}
				confirmLoading={batchClearLoading}
				onCancel={() => setBatchClearModalVisible(false)}
				okText={t(emailsInlineI18n["emails.batchClear.okText"])}
				destroyOnHidden
			>
				<Space orientation="vertical" size={16} style={fullWidthStyle}>
					<Alert
						type="warning"
						showIcon
					title={selectedRowKeys.length > 0 ? t(emailsInlineI18n["emails.batchClear.selectionTitle"], { count: selectedRowKeys.length }) : t(emailsInlineI18n["emails.batchClear.filteredTitle"])}
					description={t(emailsInlineI18n["emails.batchClear.description"])}
					/>
					<div>
						<Text strong>{t(emailsInlineI18n["emails.batchClear.targetMailbox"])}</Text>
						<Select
							value={batchClearMailbox}
							style={widthFullMarginTop8Style}
							options={[
								{ value: "INBOX", label: t(adminI18n.emails.inbox) },
								{ value: "Junk", label: t(emailsPageI18n.mailboxJunk) },
							]}
							onChange={(value) =>
								setBatchClearMailbox(value as "INBOX" | "Junk")
							}
						/>
					</div>
				</Space>
			</Modal>

			{/* 创建/编辑分组 Modal */}
			<Modal
				title={editingGroupId ? t(emailsInlineI18n["emails.group.editTitle"]) : t(emailsInlineI18n["emails.group.createTitle"])}
				open={groupModalVisible}
				onOk={handleGroupSubmit}
				onCancel={() => setGroupModalVisible(false)}
				destroyOnHidden
				width={460}
			>
				<Form form={groupForm} layout="vertical">
					<Form.Item
						name="name"
						label={t(emailsInlineI18n["emails.group.nameLabel"])}
						rules={[{ required: true, message: t(emailsInlineI18n["emails.group.nameRequired"]) }]}
					>
						<Input placeholder={t(emailsInlineI18n["emails.group.namePlaceholder"])} />
					</Form.Item>
					<Form.Item name="description" label={t(emailsInlineI18n["emails.group.descriptionLabel"])}>
						<Input placeholder={t(emailsInlineI18n["emails.group.descriptionPlaceholder"])} />
					</Form.Item>
					<Form.Item
						name="fetchStrategy"
						label={t(emailsInlineI18n["emails.group.fetchStrategyLabel"])}
						rules={[{ required: true, message: t(emailsInlineI18n["emails.group.fetchStrategyRequired"]) }]}
					>
						<Select options={mailFetchStrategyOptions} />
					</Form.Item>
				</Form>
			</Modal>

			{/* 批量分配分组 Modal */}
			<Modal
				title={t(emailsInlineI18n["emails.group.assignModalTitle"])}
				open={assignGroupModalVisible}
				onOk={handleBatchAssignGroup}
				onCancel={() => setAssignGroupModalVisible(false)}
				destroyOnHidden
				width={400}
			>
				<p>{t(emailsInlineI18n["emails.group.assignSelectedCount"], { count: selectedRowKeys.length })}</p>
				<Select
					placeholder={t(emailsInlineI18n["emails.group.assignPlaceholder"])}
					style={fullWidthStyle}
					value={assignTargetGroupId}
					options={groupOptions}
					onChange={setAssignTargetGroupId}
				/>
			</Modal>
		</div>
	);
};

export default EmailsPage;
