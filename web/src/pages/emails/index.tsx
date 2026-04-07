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
	List,
	Modal,
	message,
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
	AUTH_TYPE_LABELS,
	EMAIL_AUTH_TYPE_OPTIONS,
	EMAIL_PROVIDER_LABELS,
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
	getRepresentativeProtocolDefinition,
	getRepresentativeProtocolLabel,
	getRepresentativeProtocolTagColor,
	getSecondaryProtocolLabel,
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
import { requestData } from "../../utils/request";

const { Text } = Typography;
const { TextArea } = Input;
const { Dragger } = Upload;
const MAIL_FETCH_STRATEGY_OPTIONS = [
	{ value: "GRAPH_FIRST", label: "Graph 优先（失败回退 IMAP）" },
	{ value: "IMAP_FIRST", label: "IMAP 优先（失败回退 Graph）" },
	{ value: "GRAPH_ONLY", label: "仅 Graph" },
	{ value: "IMAP_ONLY", label: "仅 IMAP" },
] as const;

type MailFetchStrategy = (typeof MAIL_FETCH_STRATEGY_OPTIONS)[number]["value"];

const MAIL_FETCH_STRATEGY_LABELS: Record<MailFetchStrategy, string> = {
	GRAPH_FIRST: "Graph 优先",
	IMAP_FIRST: "IMAP 优先",
	GRAPH_ONLY: "仅 Graph",
	IMAP_ONLY: "仅 IMAP",
};

type EmailAccountStatus = EmailAccount["status"];

const EMAIL_STATUS_FILTER_OPTIONS: Array<{
	value: EmailAccountStatus;
	label: string;
}> = [
	{ value: "ACTIVE", label: "正常" },
	{ value: "ERROR", label: "异常" },
	{ value: "DISABLED", label: "禁用" },
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

function getEmailStatusMeta(status: EmailAccountStatus) {
	const colors: Record<EmailAccountStatus, string> = {
		ACTIVE: "green",
		ERROR: "red",
		DISABLED: "default",
	};
	const labels: Record<EmailAccountStatus, string> = {
		ACTIVE: "正常",
		ERROR: "异常",
		DISABLED: "禁用",
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

const canRevealStoredPassword = (
	record: Pick<EmailAccount, "hasStoredPassword" | "capabilitySummary">,
) => Boolean(record.hasStoredPassword && !record.capabilitySummary?.usesOAuth);

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

const MAILBOX_LABELS: Record<MailboxName, string> = {
	INBOX: "收件箱",
	SENT: "已发送",
	Junk: "垃圾箱",
};

const CAPABILITY_GROUPS: Array<{
	title: string;
	keys: Array<keyof ProviderProfileCapabilities>;
}> = [
	{
		title: "收取能力",
		keys: ["readInbox", "readJunk", "readSent", "receiveMail"],
	},
	{
		title: "操作能力",
		keys: ["clearMailbox", "sendMail", "search", "aliasSupport"],
	},
	{
		title: "连接能力",
		keys: ["usesOAuth", "refreshToken", "webhook", "apiAccess", "forwarding"],
	},
];

const CAPABILITY_LABELS: Record<keyof ProviderProfileCapabilities, string> = {
	readInbox: "收件箱",
	readJunk: "垃圾箱",
	readSent: "已发送",
	clearMailbox: "批量清空",
	sendMail: "发信",
	usesOAuth: "OAuth",
	receiveMail: "可收件",
	apiAccess: "API Access",
	forwarding: "Forwarding",
	search: "搜索",
	refreshToken: "Refresh Token",
	webhook: "Webhook",
	aliasSupport: "Alias",
	modes: "Modes",
};

const renderCapabilityMatrix = (
	capabilitySummary: ProviderProfileCapabilities,
	compact = false,
) => (
	<Space orientation="vertical" size={compact ? 8 : 12} style={fullWidthStyle}>
		{CAPABILITY_GROUPS.map((group) => (
			<div key={group.title}>
				<Text strong style={displayBlockMarginBottom6Style}>
					{group.title}
				</Text>
				<Space wrap>
					{group.keys.map((key) => (
						<Tag
							key={key}
							color={capabilitySummary[key] ? "success" : "default"}
						>
							{CAPABILITY_LABELS[key]}：{capabilitySummary[key] ? "支持" : "否"}
						</Tag>
					))}
				</Space>
			</div>
		))}
		<div>
			<Text strong style={displayBlockMarginBottom6Style}>
				底层模式
			</Text>
			<Space wrap>
				{capabilitySummary.modes.length > 0 ? (
					capabilitySummary.modes.map((mode) => (
						<Tag key={mode} color="processing">
							{mode}
						</Tag>
					))
				) : (
					<Tag>无</Tag>
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
}

type RevealableEmailSecretField = "password" | "refreshToken";

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
	email?: string;
	action?: string;
	message: string;
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
	const [rowRevealedPassword, setRowRevealedPassword] = useState<string | null>(
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
	const selectedRepresentativeProtocolDefinition = useMemo(
		() => getRepresentativeProtocolDefinition(selectedRepresentativeProtocol),
		[selectedRepresentativeProtocol],
	);
	const isTwoFactorEnabled = Boolean(admin?.twoFactorEnabled);
	const canRevealStoredSecret = Boolean(
		editingId && revealTargetField && revealTargetSource !== "row",
	);
	const revealedSecretValue = revealTargetField
		? revealedSecrets[revealTargetField]
		: undefined;
	const revealTargetLabel =
		revealTargetSource === "row"
			? "登录密码"
			: revealTargetField === "refreshToken"
			? "Refresh Token"
			: selectedProfileDefinition.secretLabel ||
				`${selectedProviderDefinition.label} 授权码 / 应用专用密码`;
	const availableProfileDefinitions = useMemo(
		() =>
			getProviderProfilesByRepresentativeProtocol(
				selectedRepresentativeProtocol,
			),
		[selectedRepresentativeProtocol],
	);
	const filterProviderOptions = useMemo(() => {
		if (!filterRepresentativeProtocol) {
			return EMAIL_PROVIDER_OPTIONS;
		}

		const supportedProviders = new Set(
			getProviderProfilesByRepresentativeProtocol(
				filterRepresentativeProtocol,
			).map((profile) => profile.provider),
		);

		return EMAIL_PROVIDER_OPTIONS.filter((option) =>
			supportedProviders.has(option.value),
		);
	}, [filterRepresentativeProtocol]);
	const importTemplates = useMemo(
		() => getProviderImportTemplates(separator),
		[separator],
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
		setRowRevealedPassword(null);
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
			message.info("已自动隐藏临时显示的密钥");
		}, remainingMs);

		return () => window.clearTimeout(timer);
	}, [revealExpiresAt]);

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
			message.info("已自动隐藏临时显示的密码");
		}, remainingMs);

		return () => window.clearTimeout(timer);
	}, [resetRowRevealState, rowRevealExpiresAt]);

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
			message.info("密码查看授权已过期，请重新验证");
		}, remainingMs);

		return () => window.clearTimeout(timer);
	}, [revealGrantExpiresAt]);

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
			const label = result.provider === "GMAIL" ? "Gmail" : "Outlook";
			const suffix = [
				result.email ? `邮箱：${result.email}` : "",
				result.action ? `动作：${result.action}` : "",
			]
				.filter(Boolean)
				.join("，");
			const toastMessage = suffix
				? `${result.message}（${suffix}）`
				: result.message;

			if (result.status === "success") {
				message.success(toastMessage || `${label} 授权成功`);
			} else if (result.status === "warning") {
				message.warning(toastMessage || `${label} 已授权，但验证存在告警`);
			} else {
				message.error(toastMessage || `${label} 授权失败`);
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
			resetGoogleOAuthFlow,
			resetOutlookOAuthFlow,
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
		const oauthMessage = searchParams.get("oauth_message");
		if (!oauthStatus || !oauthProvider || !oauthMessage) {
			return;
		}

		handleOAuthCompletionFeedback({
			provider: oauthProvider === "GMAIL" ? "GMAIL" : "OUTLOOK",
			status:
				oauthStatus === "success" || oauthStatus === "warning"
					? oauthStatus
					: "error",
			message: oauthMessage,
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
				message.warning("Google 授权链接已过期，请重新生成。");
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
				message.warning("Microsoft 授权链接已过期，请重新生成。");
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
				message.error("获取详情失败");
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
				message.warning("请先在设置页启用 2FA，再查看已存储的密钥");
				return;
			}
			setRevealTargetEmailId(targetEmailId);
			setRevealTargetField(targetField);
			setRevealTargetSource(source);
			setRevealTargetEmailLabel(targetEmailLabel || null);
			setRevealOtp("");
			setRevealModalVisible(true);
		},
		[isTwoFactorEnabled],
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
					message.error(response.message || "查看密钥失败");
					return;
				}

				const result = response.data as RevealSecretsResult;
				if (source === "row" && targetField === "password") {
					setRevealTargetEmailLabel(targetEmailLabel || null);
					setRowRevealedPassword(result.secrets.password ?? null);
					setRowRevealVisible(true);
					setRowRevealExpiresAt(Date.now() + 60_000);
					message.success("已受控显示密码，60 秒后自动隐藏");
					return;
				}

				setRevealedSecrets(result.secrets || {});
				setRevealExpiresAt(Date.now() + 60_000);
				message.success("已受控显示密钥，60 秒后自动隐藏");
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
				if (errCode === "PASSWORD_NOT_PRESENT") {
					if (source === "edit" && targetField === "password") {
						setRevealedSecrets({ password: null });
						setRevealExpiresAt(Date.now() + 60_000);
					}
					message.info("当前账号未存储登录密码");
					return;
				}
				if (errCode === "REVEAL_UNLOCK_EXPIRED") {
					setRevealGrantToken(null);
					setRevealGrantExpiresAt(null);
					message.warning("查看授权已过期，请重新验证");
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
					message.warning("请先在设置页启用 2FA，再查看已存储的密钥");
					navigate("/settings");
					return;
				}
				message.error(getErrorMessage(err, "查看密钥失败"));
			}
		},
		[navigate, openRevealModalForTarget],
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
			if (!record.hasStoredPassword) {
				message.info("该账号暂无已存储的登录密码");
				return;
			}

			if (!canRevealStoredPassword(record)) {
				message.info("当前邮箱鉴权方式不支持直接查看登录密码");
				return;
			}

			const activeGrantToken = getActiveRevealGrantToken();
			if (activeGrantToken) {
				await executeRevealWithGrant(
					record.id,
					"password",
					activeGrantToken,
					"row",
					record.email,
				);
				return;
			}

			openRevealModalForTarget(record.id, "password", "row", record.email);
		},
		[
			executeRevealWithGrant,
			getActiveRevealGrantToken,
			openRevealModalForTarget,
		],
	);

	const handleCopyRowRevealedPassword = useCallback(async () => {
		if (!rowRevealedPassword) {
			return;
		}
		try {
			await navigator.clipboard.writeText(rowRevealedPassword);
			message.success("已复制密码");
		} catch {
			message.error("复制失败，请手动复制");
		}
	}, [rowRevealedPassword]);

	const handleConfirmReveal = useCallback(async () => {
		if (!revealTargetEmailId || !revealTargetField || !revealTargetSource) {
			return;
		}

		const otp = revealOtp.trim();
		if (!/^\d{6}$/.test(otp)) {
			message.error("请输入 6 位验证码");
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
				message.error("验证码错误，请重试");
				return;
			}
			if (errCode === "TWO_FACTOR_REQUIRED") {
				setRevealModalVisible(false);
				message.warning("请先在设置页启用 2FA，再查看已存储的密钥");
				navigate("/settings");
				return;
			}
			message.error(getErrorMessage(err, "查看密钥失败"));
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
					message.success("删除成功");
					fetchData();
					fetchGroups();
				} else {
					message.error(res.message);
				}
			} catch (err: unknown) {
				message.error(getErrorMessage(err, "删除失败"));
			}
		},
		[fetchData, fetchGroups],
	);

	const handleBatchDelete = async () => {
		if (selectedRowKeys.length === 0) {
			message.warning("请选择要删除的邮箱");
			return;
		}

		try {
			const res = await emailsContract.batchDelete(selectedRowKeys as number[]);
			if (res.code === 200) {
				message.success(`成功删除 ${res.data.deleted} 个邮箱`);
				setSelectedRowKeys([]);
				fetchData();
				fetchGroups();
			} else {
				message.error(res.message);
			}
		} catch (err: unknown) {
			message.error(getErrorMessage(err, "删除失败"));
		}
	};

	const handleAuthTypeChange = (authType: EmailAuthType) => {
		resetAllOAuthFlows();
		form.setFields([
			{ name: "clientId", errors: [] },
			{ name: "refreshToken", errors: [] },
			{ name: "clientSecret", errors: [] },
			{ name: "password", errors: [] },
		]);
		if (authType === "APP_PASSWORD") {
			form.setFieldsValue({
				clientId: undefined,
				refreshToken: undefined,
				clientSecret: undefined,
			});
			return;
		}

		if (selectedProvider !== "QQ") {
			form.setFieldsValue({
				password: undefined,
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
				"导入 Google client secret 文件后自动解析失败",
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
				message.success(`已导入 ${fileName}，并自动填充 Google OAuth 字段`);
			}
			setGoogleParseLoading(false);
		},
		[form, resetGoogleOAuthFlow],
	);

	const handleGoogleJsonUpload = (file: File) => {
		const reader = new FileReader();
		reader.onload = (event) => {
			const fileContent = event.target?.result;
			if (typeof fileContent !== "string" || !fileContent.trim()) {
				message.error("读取 Google client_secret 文件失败");
				return;
			}
			void applyGoogleJsonImport(fileContent, file.name);
		};
		reader.onerror = () => {
			message.error("读取 Google client_secret 文件失败");
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
				"解析 Google client secret 失败",
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
						`Google client secret 解析成功${result.projectId ? `（project: ${result.projectId}）` : ""}`,
					);
				}
			}
			setGoogleParseLoading(false);
			return result;
		},
		[form, resetGoogleOAuthFlow],
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
				"保存 Google OAuth 配置失败",
			);
			if (result) {
				await fetchOAuthProviderStatuses();
				if (showSuccessMessage) {
					message.success("Google OAuth 配置已保存");
				}
			}
			setGoogleSaveLoading(false);
			return result;
		},
		[fetchOAuthProviderStatuses, form],
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
				"保存 Microsoft OAuth 配置失败",
			);
			if (result) {
				await fetchOAuthProviderStatuses();
				if (showSuccessMessage) {
					message.success("Microsoft OAuth 配置已保存");
				}
			}
			setOutlookSaveLoading(false);
			return result;
		},
		[fetchOAuthProviderStatuses, form],
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
				"生成 Google 授权链接失败",
			);
			if (result?.authUrl) {
				setGeneratedGoogleAuthUrl(result.authUrl);
				setGoogleOAuthPendingState(result.state);
				setGoogleOAuthPollStatus("pending");
				setGoogleOAuthStatusExpiresAt(result.expiresAt);
				message.success(
					"Google 授权链接已生成，请复制到已登录 Google 的浏览器中打开；授权完成后会自动回调 all-Mail。",
				);
			}
		} catch (err: unknown) {
			message.error(getErrorMessage(err, "生成 Google 授权链接失败"));
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
				"生成 Microsoft 授权链接失败",
			);
			if (result?.authUrl) {
				setGeneratedOutlookAuthUrl(result.authUrl);
				setOutlookOAuthPendingState(result.state);
				setOutlookOAuthPollStatus("pending");
				setOutlookOAuthStatusExpiresAt(result.expiresAt);
				message.success(
					"Microsoft 授权链接已生成，请复制到已登录 Microsoft 的浏览器中打开；授权完成后会自动回调 all-Mail。",
				);
			}
		} catch (err: unknown) {
			message.error(getErrorMessage(err, "生成 Microsoft 授权链接失败"));
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
			message.success(`${providerLabel} 授权链接已复制`);
		} catch {
			message.error("复制失败，请手动复制下方链接");
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
					`如果你想自动接入 ${provider === "GMAIL" ? "Gmail" : "Outlook"}，请使用上方的 ${provider === "GMAIL" ? "Google" : "Microsoft"} 授权链接流程；只有“手动保存（高级）”时才需要填写邮箱地址。`,
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
				status: values.status,
				groupId: normalizedGroupId ?? null,
				providerConfig: normalizedProviderConfig,
			};

			if (editingId) {
				const res = await emailsContract.update(editingId, normalizedPayload);
				if (res.code === 200) {
					message.success("更新成功");
					closeEmailModal();
					fetchData();
					fetchGroups();
				} else {
					message.error(res.message);
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
					groupId: toOptionalNumber(values.groupId),
					providerConfig: normalizedPayload.providerConfig,
				});
				if (res.code === 200) {
					message.success("创建成功");
					closeEmailModal();
					fetchData();
					fetchGroups();
				} else {
					message.error(res.message);
				}
			}
		} catch (err: unknown) {
			message.error(getErrorMessage(err, "保存失败"));
		}
	};

	const renderStoredSecretRevealPanel = () => {
		if (!canRevealStoredSecret || !revealTargetField) {
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
								编辑表单默认不会回填已存储密钥；需要查看时，必须经过 2FA 验证，验证通过后可在短时间内连续查看。
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
								<Text type="secondary">当前未存储该密钥。</Text>
							)
						) : null}
						{revealExpiresAt ? (
							<Text type="secondary">
								将于 {dayjs(revealExpiresAt).format("HH:mm:ss")} 自动隐藏。
							</Text>
						) : null}
						{revealGrantExpiresAt ? (
							<Text type="secondary">
								当前查看授权有效至 {dayjs(revealGrantExpiresAt).format("HH:mm:ss")}。
							</Text>
						) : null}
						</Space>
					}
				/>
			);
		};

	const handleImport = async () => {
		if (!importContent.trim()) {
			message.warning("请输入或粘贴邮箱数据");
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
						`导入完成：成功 ${successCount} 条，失败 ${failedCount} 条${firstErrors.length ? `；${firstErrors.join("；")}` : ""}`,
					);
				} else {
					message.success(`导入完成：成功 ${successCount} 条`);
				}
				setImportModalVisible(false);
				setImportContent("");
				setImportGroupId(undefined);
				fetchData();
				fetchGroups();
			} else {
				message.error(res.message);
			}
		} catch (err: unknown) {
			message.error(getErrorMessage(err, "导入失败"));
		}
	};

	const handleExport = async () => {
		try {
			const ids =
				selectedRowKeys.length > 0 ? (selectedRowKeys as number[]) : undefined;
			const groupId = ids ? undefined : toOptionalNumber(filterGroupId);
			const res = await emailsContract.export(ids, separator, groupId);
			if (res.code !== 200) {
				message.error(res.message || "导出失败");
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

			message.success("导出成功");
		} catch (err: unknown) {
			message.error(getErrorMessage(err, "导出失败"));
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
					message.success("刷新成功");
				}
			}
			setMailLoading(false);
		},
		[patchMailboxStatusForEmail],
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
				message.success(`已清空 ${res.data?.deletedCount || 0} 封邮件`);
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
				message.error(res.message || "清空失败");
			}
		} catch (err: unknown) {
			message.error(getErrorMessage(err, "清空失败"));
		}
	};

	const handleDeleteSelectedMails = async () => {
		if (!currentEmailId || selectedMailIds.length === 0) {
			message.warning("请先选择要删除的邮件");
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
				message.success(`已删除 ${res.data?.deletedCount || 0} 封邮件`);
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
				message.error(res.message || "删除选中邮件失败");
			}
		} catch (err: unknown) {
			message.error(getErrorMessage(err, "删除选中邮件失败"));
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
				message.warning("没有可检查的邮箱");
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
	}, [buildBatchActionPayload, fetchData, selectedRowKeys.length]);

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
					message.warning(`邮箱 ${record.email} 当前不可检查`);
				} else if (result.errorCount > 0 || result.partialCount > 0) {
					message.warning(
						`检查 ${record.email} 完成：成功 ${result.successCount} 个，部分成功 ${result.partialCount} 个，失败 ${result.errorCount} 个，跳过 ${result.skippedCount} 个邮箱夹`,
					);
				} else {
					message.success(`已检查 ${record.email}，最后检查时间已更新`);
				}
				await fetchData();
			}

			setCheckingEmailIds((prev) => prev.filter((id) => id !== record.id));
		},
		[fetchData],
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
				message.warning("没有可清空的邮箱");
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
	}, [batchClearMailbox, buildBatchActionPayload, fetchData]);

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
				message.error("请至少填写一个收件人");
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
				message.error(result.message || "发送失败");
				return;
			}

			message.success("发送成功");
			setComposeModalVisible(false);
			composeForm.resetFields();
			await handleMailboxTabChange("SENT");
		} catch (err: unknown) {
			setComposeSending(false);
			message.error(getErrorMessage(err, "发送失败"));
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
					message.success("分组已删除");
					fetchGroups();
					fetchData();
				}
			} catch (err: unknown) {
				message.error(getErrorMessage(err, "删除失败"));
			}
		},
		[fetchData, fetchGroups],
	);

	const handleGroupSubmit = async () => {
		try {
			const values = normalizeGroupPayload(await groupForm.validateFields());
			if (editingGroupId) {
				const res = await emailsContract.updateGroup(editingGroupId, values);
				if (res.code === 200) {
					message.success("分组已更新");
					setGroupModalVisible(false);
					fetchGroups();
				}
			} else {
				const res = await emailsContract.createGroup(values);
				if (res.code === 200) {
					message.success("分组已创建");
					setGroupModalVisible(false);
					fetchGroups();
				}
			}
		} catch (err: unknown) {
			message.error(getErrorMessage(err, "分组保存失败"));
		}
	};

	const handleBatchAssignGroup = async () => {
		if (selectedRowKeys.length === 0) {
			message.warning("请先选择邮箱");
			return;
		}
		if (!assignTargetGroupId) {
			message.warning("请选择目标分组");
			return;
		}
		try {
			const res = await emailsContract.assignEmails(
				assignTargetGroupId,
				selectedRowKeys as number[],
			);
			if (res.code === 200) {
				message.success(`已将 ${res.data.count} 个邮箱分配到分组`);
				setAssignGroupModalVisible(false);
				setAssignTargetGroupId(undefined);
				setSelectedRowKeys([]);
				fetchData();
				fetchGroups();
			}
		} catch (err: unknown) {
			message.error(getErrorMessage(err, "分配失败"));
		}
	};

	const handleBatchRemoveGroup = async () => {
		if (selectedRowKeys.length === 0) {
			message.warning("请先选择邮箱");
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
			message.success("已将选中邮箱移出分组");
			setSelectedRowKeys([]);
			fetchData();
			fetchGroups();
		} catch (err: unknown) {
			message.error(getErrorMessage(err, "移出失败"));
		}
	};

	// ========================================
	// Email table columns
	// ========================================
	const columns: ColumnsType<EmailAccount> = useMemo(
		() => [
			{
				title: "邮箱地址",
				dataIndex: "email",
				key: "email",
				width: 300,
				render: (_: string, record: EmailAccount) => (
					<div style={emailStyles.addressCell}>
						<Text style={emailStyles.addressText}>{record.email}</Text>
						{record.profileSummaryHint ? <div style={emailStyles.metaText}>{record.profileSummaryHint}</div> : null}
						{record.errorMessage ? <div style={emailStyles.errorText}>错误：{record.errorMessage}</div> : null}
					</div>
				),
			},
			{
				title: "连接合同",
				key: "connection",
				render: (_: unknown, record: EmailAccount) => {
					const profileDefinition = record.providerProfile
						? getProviderProfileDefinitionByKey(record.providerProfile as ProviderProfileKey)
						: getProviderProfileDefinition(record.provider, record.authType);
					const representativeProtocol = record.representativeProtocol || profileDefinition.representativeProtocol;
					return (
						<div style={emailStyles.contractCell}>
							<Space wrap>
								<Tag color={getProviderDefinition(record.provider).tagColor}>{EMAIL_PROVIDER_LABELS[record.provider]}</Tag>
								<Tag color={getRepresentativeProtocolTagColor(representativeProtocol)}>{getRepresentativeProtocolLabel(representativeProtocol)}</Tag>
								<Tag>{AUTH_TYPE_LABELS[record.authType]}</Tag>
							</Space>
							<div style={emailStyles.metaText}>{profileDefinition.summaryHint}</div>
						</div>
					);
				},
			},
			{
				title: "分组",
				key: "group",
				render: (_: unknown, record: EmailAccount) => (
					record.group ? <Tag color="blue">{record.group.name}</Tag> : <Tag>未分组</Tag>
				),
			},
			{
				title: "Client ID",
				dataIndex: "clientId",
				key: "clientId",
				width: 180,
				render: (value: string | null) => <div style={emailStyles.clientIdText}>{value || "-"}</div>,
			},
			{
				title: "状态",
				dataIndex: "status",
				key: "status",
				width: 100,
				render: (value: EmailAccountStatus) => {
					const statusMeta = getEmailStatusMeta(value);
					return <Tag color={statusMeta.color}>{statusMeta.label}</Tag>;
				},
			},
			{
				title: "最后检查",
				dataIndex: "lastCheckAt",
				key: "lastCheckAt",
				width: 168,
				render: (value: string | null) => value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "-",
			},
			{
				title: "创建时间",
				dataIndex: "createdAt",
				key: "createdAt",
				width: 168,
				render: (value: string) => dayjs(value).format("YYYY-MM-DD HH:mm"),
			},
			{
				title: "动作",
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
								收件箱
							</Button>
							<Button
								size="small"
								onClick={() => handleViewMails(record, "SENT")}
							>
								已发送
							</Button>
							<Tooltip
								title={
									canRevealStoredPassword(record)
										? "查看已存储的登录密码"
										: record.hasStoredPassword
											? "当前邮箱鉴权方式不支持直接查看登录密码"
											: "该账号暂无已存储的登录密码"
								}
							>
								<Button
									size="small"
									type={canRevealStoredPassword(record) ? "primary" : "default"}
									aria-label="密码"
									onClick={() => void handleRowPasswordReveal(record)}
								>
									密码
								</Button>
							</Tooltip>
							<Button
								size="small"
								onClick={() => void handleCheckSingleMailbox(record)}
							>
								检查连接
							</Button>
							<Button
								size="small"
								onClick={() => handleEdit(record)}
							>
								编辑
							</Button>
							<Popconfirm
								title="确定要删除此邮箱吗？"
								onConfirm={() => handleDelete(record.id)}
							>
								<Button size="small" danger>
									删除
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
			showTotal: (count: number) => `共 ${count} 条`,
			onChange: (currentPage: number, currentPageSize: number) => {
				setPage(currentPage);
				setPageSize(currentPageSize);
			},
		}),
		[page, pageSize, total],
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
		const definition = getRepresentativeProtocolDefinition(protocol);
		return {
			key: protocol,
			icon: <PlusOutlined />,
			label: definition.connectionLabel,
			onClick: () => handleCreate(protocol),
		};
	});

	const toolActionItems = [
		{
			key: "import",
			icon: <UploadOutlined />,
			label: "导入",
			onClick: () => setImportModalVisible(true),
		},
		{
			key: "export",
			icon: <DownloadOutlined />,
			label: "导出",
			onClick: handleExport,
		},
		{
			key: "check",
			icon: <ReloadOutlined />,
			label:
				selectedRowKeys.length > 0
					? `一键检查 (${selectedRowKeys.length})`
					: "一键检查筛选结果",
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
					? `批量清空邮件 (${selectedRowKeys.length})`
					: "批量清空邮箱邮件",
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
				title: "分组名称",
				dataIndex: "name",
				key: "name",
				render: (name: string) => <Tag color="blue">{name}</Tag>,
			},
			{
				title: "描述",
				dataIndex: "description",
				key: "description",
				render: (val: string | null) => val || "-",
			},
			{
				title: "拉取策略",
				dataIndex: "fetchStrategy",
				key: "fetchStrategy",
				width: 190,
				render: (value: MailFetchStrategy) => (
					<Tag color="purple">{MAIL_FETCH_STRATEGY_LABELS[value]}</Tag>
				),
			},
			{
				title: "邮箱数",
				dataIndex: "emailCount",
				key: "emailCount",
				width: 100,
			},
			{
				title: "创建时间",
				dataIndex: "createdAt",
				key: "createdAt",
				width: 180,
				render: (val: string) => dayjs(val).format("YYYY-MM-DD HH:mm"),
			},
			{
				title: "操作",
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
							title="删除分组后，组内邮箱将变为「未分组」。确认？"
							onConfirm={() => handleDeleteGroup(record.id)}
						>
							<Button type="text" danger icon={<DeleteOutlined />} />
						</Popconfirm>
					</Space>
				),
			},
		],
		[handleDeleteGroup, handleEditGroup],
	);

	// ========================================
	// Render
	// ========================================
	return (
		<div>
			<PageHeader
				title="外部邮箱连接"
				subtitle="统一管理 OAuth API 与 IMAP / SMTP 外部连接。"
				extra={
					<Space wrap>
						<Dropdown menu={{ items: toolActionItems }}>
							<Button icon={<MoreOutlined />}>工具</Button>
						</Dropdown>
						<Dropdown menu={{ items: createActionItems }}>
							<Button type="primary" icon={<PlusOutlined />}>添加邮箱</Button>
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
						label: "邮箱列表",
						children: (
							<>
								<div style={emailStyles.filterToolbar}>
									<Space wrap>
										<Input
											placeholder="搜索邮箱"
											prefix={<SearchOutlined />}
											value={keyword}
											onChange={(e) => setKeyword(e.target.value)}
											style={width200Style}
											allowClear
										/>
										<Select
											placeholder="按协议家族筛选"
											allowClear
											style={width170Style}
											value={filterRepresentativeProtocol}
											options={EXTERNAL_REPRESENTATIVE_PROTOCOLS.map(
												(protocol) => ({
													value: protocol,
													label: getRepresentativeProtocolLabel(protocol),
												}),
											)}
											onChange={(value: RepresentativeProtocol | undefined) => {
												setFilterRepresentativeProtocol(value);
												setPage(1);
											}}
										/>
										<Select
											placeholder="按 Provider 筛选"
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
											placeholder="按状态筛选"
											allowClear
											style={width140Style}
											value={filterStatus}
											options={EMAIL_STATUS_FILTER_OPTIONS}
											onChange={(value: EmailAccountStatus | undefined) => {
												setFilterStatus(value);
												setPage(1);
											}}
										/>
										<Select
											placeholder="按分组筛选"
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
											<Text type="secondary">已选择 {selectedRowKeys.length} 个邮箱，可以继续做分组或删除。</Text>
											<Space wrap>
												<Button type="text" icon={<GroupOutlined />} onClick={() => setAssignGroupModalVisible(true)}>
													分配分组
												</Button>
												<Button type="text" onClick={handleBatchRemoveGroup}>
													移出分组
												</Button>
												<Popconfirm
													title={`确定要删除选中的 ${selectedRowKeys.length} 个邮箱吗？`}
													onConfirm={handleBatchDelete}
												>
													<Button danger>批量删除</Button>
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
												? `已定位异常邮箱：${focusedEmailRecord.email}`
												: "当前正在查看异常邮箱列表"
										}
										description={
											focusedEmailRecord
												? `${focusedEmailRecord.errorMessage || "当前连接检查失败，建议重新检查或重新走 OAuth 授权。"}${focusedEmailRecord.lastCheckAt ? ` 最后检查：${dayjs(focusedEmailRecord.lastCheckAt).format("YYYY-MM-DD HH:mm:ss")}` : ""}`
												: "这里会只显示 status=ERROR 的外部邮箱，适合集中排查 OAuth 续期、网络超时和 Provider 配置问题。"
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
														重新检查
													</Button>
												) : null}
												{focusedEmailRecord ? (
													<Button
														size="small"
														onClick={() => void handleEdit(focusedEmailRecord)}
													>
														查看配置
													</Button>
												) : null}
												<Button
													size="small"
													onClick={() => {
														setFocusedEmailId(undefined);
														navigate("/emails", { replace: true });
													}}
												>
													清除定位
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
						label: "邮箱分组",
						children: (
							<>
								<div style={emailStyles.listTopActions}>
									<Button
										type="primary"
										icon={<PlusOutlined />}
										onClick={handleCreateGroup}
									>
										创建分组
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
						? "编辑邮箱"
						: selectedRepresentativeProtocolDefinition.connectionLabel
				}
				open={modalVisible}
				onOk={handleSubmit}
				onCancel={closeEmailModal}
				okText={requiresOAuthFields ? "手动保存（高级）" : "保存"}
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
								const definition =
									getRepresentativeProtocolDefinition(protocol);
								const protocolProfiles =
									getProviderProfilesByRepresentativeProtocol(protocol);
								return {
									key: protocol,
									label: definition.label,
									children: (
										<div style={marginBottom12Style}>
											<div style={emailStyles.modalSectionHeading}>
												{definition.label}
											</div>
											<Text type="secondary">{definition.description}</Text>
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
															{profile.label}
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
								Provider Profile
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
										{profile.label}
									</Button>
								))}
							</Space>
						</div>

						{!editingId && (
							<Alert
								type="info"
								showIcon
								style={marginBottom12Style}
							title={`当前选择会按 ${getRepresentativeProtocolLabel(selectedRepresentativeProtocol)} 主分类展示`}
								description={`${selectedRepresentativeProtocolDefinition.description} 当前 profile：${selectedProfileDefinition.label}。${selectedProfileDefinition.summaryHint}`}
							/>
						)}

						<Space wrap style={marginBottom12Style}>
							<Tag
								color={getRepresentativeProtocolTagColor(
									selectedProfileDefinition.representativeProtocol,
								)}
							>
								代表协议：
								{getRepresentativeProtocolLabel(
									selectedProfileDefinition.representativeProtocol,
								)}
							</Tag>
							<Tag color={selectedProviderDefinition.tagColor}>
								Profile：{selectedProfileDefinition.label}
							</Tag>
							{selectedProfileDefinition.secondaryProtocols.map((protocol) => (
								<Tag
									key={`selected-${selectedProfileDefinition.key}-${protocol}`}
								>
									辅助协议：{getSecondaryProtocolLabel(protocol)}
								</Tag>
							))}
						</Space>

						<Text type="secondary" style={emailStyles.secondaryBlock}>
							{selectedProviderDefinition.authTypeNotes[selectedAuthType] ||
								selectedProviderDefinition.classificationNote}{" "}
							当前连接路径遵循“协议家族 → provider profile →
							capability”顺序：先确定是 OAuth API 还是 IMAP / SMTP，再落到具体
							provider profile。
						</Text>

						<div style={emailStyles.capabilityBox}>
						<Space orientation="vertical" size={12} style={fullWidthStyle}>
								<div>
									<Text strong style={displayBlockMarginBottom4Style}>
										Capability Matrix
									</Text>
									<Text type="secondary">
										当前 profile
										的能力矩阵会直接决定列表页的可检查、可发信、可清空和后续扩展边界。
									</Text>
								</div>
								{renderCapabilityMatrix(selectedProfileCapabilitySummary)}
							</Space>
						</div>

						<Form.Item
							name="email"
							label="邮箱地址"
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
											return Promise.reject(new Error("请输入邮箱地址"));
										}
										const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
										if (!emailPattern.test(normalizedValue)) {
											return Promise.reject(new Error("请输入有效的邮箱地址"));
										}
										return Promise.resolve();
									},
								},
							]}
						>
							<Input
								placeholder={selectedProviderDefinition.emailPlaceholder}
							/>
						</Form.Item>

						{isOutlookProvider && (
							<>
								<Form.Item name="authType" hidden>
									<Input />
								</Form.Item>
								<Form.Item label="鉴权方式">
									<Input value="Microsoft OAuth" disabled />
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
									label="Microsoft 回调地址（手工输入）"
									rules={[
										{ required: true, message: "请输入 Microsoft 回调地址" },
									]}
								>
									<Input placeholder="http://localhost:3002/oauth" />
								</Form.Item>
								<Form.Item
									name="outlookOAuthClientId"
									label="Microsoft OAuth Client ID"
									rules={[
										{
											required: true,
											message: "请输入 Microsoft OAuth Client ID",
										},
									]}
								>
									<Input placeholder="Azure / Entra Client ID" />
								</Form.Item>
								<Form.Item
									name="outlookOAuthClientSecret"
									label="Microsoft OAuth Client Secret"
									extra="留空不会覆盖当前已存储的 client secret；如果你正在录入新的 Web 应用，这里需要填写。"
								>
									<Input.Password placeholder="Microsoft OAuth Client Secret" />
								</Form.Item>
								<Form.Item name="outlookOAuthTenant" label="Microsoft Tenant">
									<Input placeholder="consumers / common / tenant-id" />
								</Form.Item>
								<Form.Item
									name="outlookOAuthScopes"
									label="Microsoft OAuth Scopes"
									extra="默认值只包含 Microsoft Graph scopes。`https://outlook.office.com/IMAP.AccessAsUser.All` 属于另一个资源，不能和 Graph scopes 混在同一次授权请求里；如需 IMAP OAuth，请单独申请。"
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
										保存配置并生成 Microsoft 授权链接
									</Button>
									<Button
										onClick={() => void saveOutlookOAuthConfig()}
										loading={outlookSaveLoading}
									>
										仅保存 Microsoft OAuth 配置
									</Button>
									{generatedOutlookAuthUrl ? (
										<Button
											onClick={() =>
												void handleCopyGeneratedAuthUrl(
													generatedOutlookAuthUrl,
													"Microsoft",
												)
											}
										>
											复制授权链接
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
											当前浏览器打开
										</Button>
									) : null}
									{generatedOutlookAuthUrl ? (
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
								{outlookOAuthPendingState ? (
									<Alert
										showIcon
										type="info"
										style={marginBottom12Style}
							title={
											outlookOAuthPollStatus === "processing"
												? "Microsoft 已回调，正在完成令牌交换与邮箱验证…"
												: "正在等待另一个浏览器完成 Microsoft 授权…"
										}
										description={
											outlookOAuthStatusExpiresAt
												? `完成后当前页面会自动刷新结果。若一直未完成，请在 ${dayjs(outlookOAuthStatusExpiresAt).format("HH:mm:ss")} 前重新检查授权页。`
												: "完成后当前页面会自动刷新结果。"
										}
									/>
								) : null}
								{generatedOutlookAuthUrl ? (
									<Form.Item label="Microsoft 授权链接（复制到已登录 Microsoft 的浏览器中打开）">
										<TextArea
											rows={5}
											value={generatedOutlookAuthUrl}
											readOnly
										/>
									</Form.Item>
								) : null}
								<Text type="secondary" style={emailStyles.secondaryBlock}>
									这个链接可以手动粘贴到另一个已登录 Microsoft
									的浏览器里打开。Microsoft
									完成登录、二次验证、授权同意后，会自动回调 all-Mail
									并写回邮箱记录。
								</Text>
								{editingId && revealTargetField === "refreshToken"
									? renderStoredSecretRevealPanel()
									: null}
								<Form.Item
									name="clientId"
									label="邮箱记录 Client ID（高级手动保存）"
									rules={[
										{
											required: !editingId,
											message: "请输入 Microsoft 刷新令牌对应的 Client ID",
										},
									]}
								>
									<Input placeholder="仅在不走上方授权链接、而是手工维护 Outlook 邮箱记录时使用" />
								</Form.Item>
								<Form.Item
									name="refreshToken"
									label="邮箱记录 Refresh Token（高级手动保存）"
									rules={[
										{
											required: !editingId,
											message: "请输入 Microsoft 刷新令牌",
										},
									]}
								>
									<TextArea
										rows={4}
										placeholder="仅在手动保存 Outlook OAuth 邮箱记录时填写"
									/>
								</Form.Item>
								<Form.Item
									name="clientSecret"
									label="邮箱记录 Client Secret（高级手动保存）"
									extra="只有你跳过上方自动授权流程、改为手工保存 Outlook OAuth 邮箱记录时才需要填写。"
								>
									<Input.Password placeholder="可选：手工保存邮箱记录时的 Microsoft client secret" />
								</Form.Item>
							</>
						)}

						{isGmailProvider && (
							<>
								<Form.Item
									name="authType"
									label="鉴权方式"
									rules={[{ required: true, message: "请选择 Gmail 鉴权方式" }]}
								>
									<Select
										options={EMAIL_AUTH_TYPE_OPTIONS.GMAIL}
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
											label="Google 回调地址（手工输入）"
											rules={[
												{ required: true, message: "请输入 Google 回调地址" },
											]}
											extra="这里填写你准备在 Google Console 注册的 callback URI；如果你同时导入或粘贴了 client_secret JSON，系统会校验它是否存在于 redirect_uris 中。"
										>
											<Input placeholder="http://127.0.0.1:3002/admin/oauth/google/callback" />
										</Form.Item>
										<Space wrap style={marginBottom8Style}>
											<Upload
												beforeUpload={handleGoogleJsonUpload}
												showUploadList={false}
												maxCount={1}
												accept=".json"
											>
												<Button icon={<UploadOutlined />}>
													导入 client_secret JSON 文件
												</Button>
											</Upload>
											<Button
												onClick={() => void handleParseGoogleClientSecret()}
												loading={googleParseLoading}
											>
												仅解析 Google JSON
											</Button>
										</Space>
										<Form.Item
											name="gmailOAuthJsonText"
											label="Google client_secret JSON 内容（可选，支持直接粘贴）"
										>
											<TextArea
												rows={4}
												placeholder='{"web":{"client_id":"...","client_secret":"...","redirect_uris":["http://127.0.0.1:3002/admin/oauth/google/callback"]}}'
											/>
										</Form.Item>
										<Form.Item
											name="gmailOAuthClientId"
											label="Google OAuth Client ID"
											rules={[
												{
													required: true,
													message: "请输入 Google OAuth Client ID",
												},
											]}
										>
											<Input placeholder="Google OAuth Client ID" />
										</Form.Item>
										<Form.Item
											name="gmailOAuthClientSecret"
											label="Google OAuth Client Secret"
											extra="留空不会覆盖当前已存储的 client secret；如果你刚导入 JSON，系统会自动填好。"
										>
											<Input.Password placeholder="Google OAuth Client Secret" />
										</Form.Item>
										<Form.Item
											name="gmailOAuthScopes"
											label="Google OAuth Scopes"
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
												保存配置并生成 Google 授权链接
											</Button>
											<Button
												onClick={() => void saveGoogleOAuthConfig()}
												loading={googleSaveLoading}
											>
												仅保存 Google OAuth 配置
											</Button>
											{generatedGoogleAuthUrl ? (
												<Button
													onClick={() =>
														void handleCopyGeneratedAuthUrl(
															generatedGoogleAuthUrl,
															"Google",
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
														? "Google 已回调，正在完成令牌交换与邮箱验证…"
														: "正在等待另一个浏览器完成 Google 授权…"
												}
												description={
													googleOAuthStatusExpiresAt
														? `完成后当前页面会自动刷新结果。若一直未完成，请在 ${dayjs(googleOAuthStatusExpiresAt).format("HH:mm:ss")} 前重新检查授权页。`
														: "完成后当前页面会自动刷新结果。"
												}
											/>
										) : null}
										{generatedGoogleAuthUrl ? (
											<Form.Item label="Google 授权链接（复制到已登录 Google 的浏览器中打开）">
												<TextArea
													rows={5}
													value={generatedGoogleAuthUrl}
													readOnly
												/>
											</Form.Item>
										) : null}
									<Text type="secondary" style={emailStyles.secondaryBlock}>
										这个链接可以手动粘贴到另一个已登录 Google
										的浏览器里打开。Google
										完成登录、二次验证、授权同意后，会自动回调 all-Mail
										并写回邮箱记录。
									</Text>
									{editingId && revealTargetField === "refreshToken"
										? renderStoredSecretRevealPanel()
										: null}
									<Form.Item
										name="clientId"
										label="邮箱记录 Client ID（高级手动保存）"
											rules={[
												{
													required: !editingId,
													message: "请输入 Google 刷新令牌对应的 Client ID",
												},
											]}
										>
											<Input placeholder="仅在不走上方授权链接、而是手工维护邮箱记录时使用" />
										</Form.Item>
										<Form.Item
											name="refreshToken"
											label="邮箱记录 Refresh Token（高级手动保存）"
											rules={[
												{
													required: !editingId,
													message: "请输入 Google 刷新令牌",
												},
											]}
										>
											<TextArea
												rows={4}
												placeholder="仅在手动保存 Gmail OAuth 邮箱记录时填写"
											/>
										</Form.Item>
										<Form.Item
											name="clientSecret"
											label="邮箱记录 Client Secret（高级手动保存）"
											extra="只有你跳过上方自动授权流程、改为手工保存 Gmail OAuth 邮箱记录时才需要填写。"
										>
											<Input.Password placeholder="可选：手工保存邮箱记录时的 Google client secret" />
										</Form.Item>
									</>
								)}
							{isGmailAppPassword && (
								<>
									{editingId && revealTargetField === "password"
										? renderStoredSecretRevealPanel()
										: null}
									<Form.Item
										name="password"
										label="Gmail 应用专用密码"
										rules={[
											{
												required: !editingId,
												message: "请输入 Gmail 应用专用密码",
											},
										]}
										extra="适用于已开启两步验证后的 Gmail 应用专用密码模式。当前 profile 按 IMAP / SMTP 主分类展示，不再视为 OAuth API 邮箱。留空不会覆盖当前已存储值。"
									>
										<Input.Password placeholder="Gmail App Password" />
									</Form.Item>
								</>
							)}
							</>
						)}

						{isGenericImapSmtpProvider && (
							<>
								<Form.Item name="authType" hidden>
									<Input />
								</Form.Item>
								<Form.Item label="鉴权方式">
									<Input value="授权码 / 应用专用密码" disabled />
								</Form.Item>
								<Text type="secondary" style={emailStyles.secondaryBlock}>
									{selectedProfileDefinition.description} 当前 profile 统一归入
									IMAP / SMTP 协议家族，适合走标准收信/发信协议而不是 OAuth
									API。
								</Text>
								{editingId && revealTargetField === "password"
									? renderStoredSecretRevealPanel()
									: null}
								<Form.Item
									name="password"
									label={
										selectedProfileDefinition.secretLabel ||
										`${selectedProviderDefinition.label} 授权码 / 应用专用密码`
									}
									rules={[
										{
											required: !editingId,
											message: `请输入${selectedProfileDefinition.secretLabel || selectedProviderDefinition.label}`,
										},
									]}
									extra={`${selectedProfileDefinition.secretHelpText || ""}${editingId ? " 留空不会覆盖当前已存储值。" : ""}`.trim()}
								>
									<Input.Password
										placeholder={
											selectedProfileDefinition.secretPlaceholder ||
											`${selectedProviderDefinition.label} 授权码 / 应用专用密码`
										}
									/>
								</Form.Item>

								<div style={emailStyles.capabilityBox}>
						<Space orientation="vertical" size={12} style={fullWidthStyle}>
										<div>
											<Text strong style={displayBlockMarginBottom4Style}>
												服务器配置
											</Text>
											<Text type="secondary">
												{selectedProfileDefinition.serverConfigHelpText ||
													"大多数 IMAP / SMTP provider 已预填服务器设置；如你的服务商要求不同主机、端口或文件夹名称，可以在这里覆盖。"}
											</Text>
										</div>
										<Form.Item
											name={["providerConfig", "imapHost"]}
											label="IMAP Host"
											rules={
												selectedProfileDefinition.requiresManualServerConfig
													? [{ required: true, message: "请输入 IMAP Host" }]
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
											label="IMAP Port"
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
											label="IMAP TLS"
										>
											<Checkbox>使用 SSL / TLS</Checkbox>
										</Form.Item>
										<Form.Item
											name={["providerConfig", "smtpHost"]}
											label="SMTP Host"
											rules={
												selectedProfileDefinition.requiresManualServerConfig
													? [{ required: true, message: "请输入 SMTP Host" }]
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
											label="SMTP Port"
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
											label="SMTP Secure"
										>
											<Checkbox>
												使用 SSL（取消后按 STARTTLS / 明文端口处理）
											</Checkbox>
										</Form.Item>
										<Alert
											type={isCustomImapSmtpProvider ? "warning" : "info"}
											showIcon
							title={
												isCustomImapSmtpProvider
													? "Custom IMAP / SMTP 需要手工确认服务器信息"
													: "可选：覆盖预设的邮箱夹名称"
											}
											description={
												isCustomImapSmtpProvider
													? "如果你接入的是企业自建邮箱、域名邮箱或 Amazon WorkMail，请确认 IMAP/SMTP 主机、端口和 TLS 设置与服务商要求一致。"
													: "如果服务商的垃圾箱、已发送文件夹名称与默认值不同，可在下方手工指定。"
											}
										/>
										<Form.Item
											name={["providerConfig", "folders", "inbox"]}
											label="Inbox 文件夹"
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
											label="Junk 文件夹"
										>
											<Input
												placeholder={
													selectedProfileConfigDefaults?.folders?.junk || "Junk"
												}
											/>
										</Form.Item>
										<Form.Item
											name={["providerConfig", "folders", "sent"]}
											label="Sent 文件夹"
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

						<Form.Item name="groupId" label="所属分组">
							<Select
								placeholder="可选：选择分组"
								allowClear
								options={groupOptions}
							/>
						</Form.Item>
						<Form.Item name="status" label="状态" initialValue="ACTIVE">
							<Select>
								<Select.Option value="ACTIVE">正常</Select.Option>
								<Select.Option value="DISABLED">禁用</Select.Option>
							</Select>
						</Form.Item>
					</Form>
				</Spin>
			</Modal>

			<Modal
				title={
					revealTargetSource === "row"
						? `二次验证后查看 ${revealTargetEmailLabel || "该邮箱"} 的登录密码`
						: "二次验证后查看密钥"
				}
				open={revealModalVisible}
				onOk={() => void handleConfirmReveal()}
				onCancel={() => {
					setRevealModalVisible(false);
					setRevealOtp("");
				}}
				okText="验证并查看"
				cancelText="取消"
				confirmLoading={revealLoading}
				destroyOnHidden
			>
				<Space orientation="vertical" style={fullWidthStyle} size="middle">
					<Text type="secondary">
						请输入验证器中的 6 位动态码，验证成功后会开启一个短时查看授权，并临时显示已存储的 {revealTargetLabel}。
					</Text>
					{revealTargetSource === "row" && revealTargetEmailLabel ? (
						<Text type="secondary">目标邮箱：{revealTargetEmailLabel}</Text>
					) : null}
					<Input
						value={revealOtp}
						onChange={(e) =>
							setRevealOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
						}
						prefix={<SafetyCertificateOutlined />}
						maxLength={6}
						placeholder="6 位验证码"
					/>
				</Space>
			</Modal>

			<Modal
				title={`已受控显示 ${revealTargetEmailLabel || "邮箱"} 的登录密码`}
				open={rowRevealVisible}
				onCancel={resetRowRevealState}
				footer={[
					<Button key="copy" type="primary" onClick={() => void handleCopyRowRevealedPassword()}>
						复制密码
					</Button>,
					<Button key="close" onClick={resetRowRevealState}>
						关闭
					</Button>,
				]}
				destroyOnHidden
			>
				<Space orientation="vertical" style={fullWidthStyle} size="middle">
					<Text type="secondary">
						该密码仅临时显示，请避免在公共环境中查看。
					</Text>
					<TextArea rows={2} value={rowRevealedPassword || ""} readOnly />
					{rowRevealExpiresAt ? (
						<Text type="secondary">
							将于 {dayjs(rowRevealExpiresAt).format("HH:mm:ss")} 自动隐藏。
						</Text>
					) : null}
				</Space>
			</Modal>

			{/* 批量导入 Modal */}
			<Modal
				title="批量导入邮箱"
				open={importModalVisible}
				onOk={handleImport}
				onCancel={() => setImportModalVisible(false)}
				destroyOnHidden
				width={700}
			>
				<Space orientation="vertical" style={fullWidthStyle} size="middle">
					<div>
						<Text type="secondary">
							上传文件或粘贴内容。外部邮箱建议先按协议家族理解：OAuth API
							下通常导入 `OUTLOOK_OAUTH`、`GMAIL_OAUTH`，IMAP / SMTP 下可导入各
							provider 的授权码 / 应用专用密码模板。旧的 `GMAIL / OUTLOOK / QQ`
							头部仍兼容。Amazon WorkMail 与 Custom IMAP / SMTP
							因为主机信息通常需要手工确认，当前更适合通过表单创建而不是批量导入。
							<br />
							{importTemplates.map((template, index) => (
								<span key={template}>
									{template}
									{index < importTemplates.length - 1 ? <br /> : null}
								</span>
							))}
						</Text>
					</div>
					<Input
						addonBefore="分隔符"
						value={separator}
						onChange={(e) => setSeparator(e.target.value)}
						style={width200Style}
					/>
					<Select
						placeholder="导入到分组（可选）"
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
										`文件读取成功，已解析 ${lines.length} 行数据`,
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
						<p className="ant-upload-text">点击或拖拽文件到此区域</p>
						<p className="ant-upload-hint">支持 .txt 或 .csv 文件</p>
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
					title={`${currentEmail} 的${MAILBOX_LABELS[currentMailbox]}`}
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
								{ key: "INBOX", label: "收件箱" },
								{ key: "SENT", label: "已发送" },
								{ key: "Junk", label: "垃圾箱" },
							]}
						/>
					</Space>
					<Space style={marginBottom16Style} wrap>
						<Button
							type="primary"
							onClick={handleRefreshMails}
							loading={mailLoading}
						>
							收取新邮件
						</Button>
						<Button
							icon={<SendOutlined />}
							onClick={() => setComposeModalVisible(true)}
							disabled={sendMailboxDisabled}
						>
							写邮件
						</Button>
						<Checkbox
							checked={allMailsSelected}
							indeterminate={selectedMailIds.length > 0 && !allMailsSelected}
							onChange={(event) => toggleSelectAllMails(event.target.checked)}
						>
							全选当前列表
						</Checkbox>
						<Popconfirm
							title={`确定要删除选中的 ${selectedMailIds.length} 封邮件吗？`}
							onConfirm={() => void handleDeleteSelectedMails()}
							disabled={selectedMailIds.length === 0}
						>
							<Button
								danger
								loading={deletingSelectedMails}
								disabled={selectedMailIds.length === 0}
							>
								批量删除选中 ({selectedMailIds.length})
							</Button>
						</Popconfirm>
						<Popconfirm
							title={`确定要清空${MAILBOX_LABELS[currentMailbox]}的所有邮件吗？`}
							onConfirm={handleClearMailbox}
							disabled={clearMailboxDisabled || currentMailbox === "SENT"}
						>
							<Button
								danger
								disabled={clearMailboxDisabled || currentMailbox === "SENT"}
							>
								清空
							</Button>
						</Popconfirm>
						{(clearMailboxDisabled || currentMailbox === "SENT") && (
							<span style={emailStyles.mailSummaryLink}>
								当前 Provider/鉴权模式不支持清空邮箱
							</span>
						)}
						<span style={emailStyles.mailSummaryCount}>
							共 {mailList.length} 封邮件
						</span>
					</Space>
					<Alert
						type="info"
						showIcon
						style={marginBottom12Style}
						title="支持在当前邮箱夹内勾选多封邮件后批量删除"
						description="API 模式会删除/移入垃圾箱；IMAP 模式会按 UID 标记删除并 expunge 当前邮箱夹中的选中邮件。"
					/>
					<List
						loading={mailLoading}
						dataSource={mailList}
						itemLayout="horizontal"
						pagination={{
							pageSize: 10,
							showSizeChanger: true,
							showQuickJumper: true,
							showTotal: (total: number) => `共 ${total} 条`,
							style: { marginTop: 16 },
						}}
						style={emailStyles.selectedMailList}
						renderItem={(item: MailItem) => (
							<List.Item
								key={item.id}
								actions={[
									<Checkbox
										key="select"
										checked={selectedMailIds.includes(item.id)}
										onChange={(event) =>
											toggleMailSelection(item.id, event.target.checked)
										}
									>
										选择
									</Checkbox>,
									<Button
										key="view"
										type="primary"
										size="small"
										onClick={() => handleViewEmailDetail(item)}
									>
										查看
									</Button>,
								]}
							>
								<List.Item.Meta
									title={
										<Typography.Text
											ellipsis
											style={emailStyles.messagePreviewText}
										>
											{item.subject || "(无主题)"}
										</Typography.Text>
									}
									description={
										<Space size="large">
											<span style={emailStyles.primaryMailSummaryLink}>
												{currentMailbox === "SENT"
													? item.to || "未知收件人"
													: item.from || "未知发件人"}
											</span>
											<span style={emailStyles.mailSummaryLink}>
												{item.date
													? dayjs(item.date).format("YYYY-MM-DD HH:mm")
													: "-"}
											</span>
										</Space>
									}
								/>
							</List.Item>
						)}
					/>
				</Modal>
			)}

			{/* 邮件详情 Modal */}
			{emailDetailVisible && (
				<Modal
					title={selectedMailDetail?.subject || "无主题"}
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
								{currentMailbox === "SENT" ? "发件人" : "发件人"}：
							</strong>
							{selectedMailDetail?.from || "-"}
						</Text>
						<Text>
							<strong>
								{currentMailbox === "SENT" ? "收件人" : "收件地址"}：
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
				title={currentEmail ? `通过 ${currentEmail} 发送邮件` : "发送邮件"}
				open={composeModalVisible}
				onOk={() => void handleSendMail()}
				confirmLoading={composeSending}
				onCancel={() => setComposeModalVisible(false)}
				okText="发送"
				destroyOnHidden
				width={720}
			>
				<Alert
					style={marginBottom16Style}
					type={sendMailboxDisabled ? "warning" : "info"}
					showIcon
					title={
						sendMailboxDisabled
							? "当前账号配置不支持直接发信。"
							: "发送成功后，可切到“已发送”查看结果。"
					}
					description={
						currentEmailRecord?.provider === "OUTLOOK"
							? "如果 Outlook 老账号提示缺少 Mail.Send scope，需要在后台重新走一次 Outlook OAuth 授权。"
							: currentEmailRecord?.profileSummaryHint
					}
				/>
				<Form
					form={composeForm}
					layout="vertical"
					initialValues={{ fromName: "", to: "", subject: "", text: "" }}
				>
					<Form.Item label="发件显示名" name="fromName">
						<Input placeholder="例如：all-Mail" />
					</Form.Item>
					<Form.Item
						label="收件人"
						name="to"
						rules={[{ required: true, message: "请输入收件人" }]}
						extra="支持多个地址，使用逗号、分号或换行分隔。"
					>
						<TextArea
							rows={3}
							placeholder="alice@example.com, bob@example.com"
						/>
					</Form.Item>
					<Form.Item
						label="主题"
						name="subject"
						rules={[{ required: true, message: "请输入主题" }]}
					>
						<Input maxLength={500} placeholder="请输入邮件主题" />
					</Form.Item>
					<Form.Item
						label="正文"
						name="text"
						rules={[{ required: true, message: "请输入正文" }]}
					>
						<TextArea
							rows={10}
							placeholder="请输入正文，正文中的链接会作为普通邮件内容发送。"
						/>
					</Form.Item>
				</Form>
			</Modal>

			<Modal
				title="批量清空邮箱邮件"
				open={batchClearModalVisible}
				onOk={() => void handleBatchClearMailbox()}
				confirmLoading={batchClearLoading}
				onCancel={() => setBatchClearModalVisible(false)}
				okText="开始清空"
				destroyOnHidden
			>
				<Space orientation="vertical" size={16} style={fullWidthStyle}>
					<Alert
						type="warning"
						showIcon
					title={`即将对${selectedRowKeys.length > 0 ? `选中的 ${selectedRowKeys.length} 个邮箱` : '当前筛选结果中的全部邮箱'}执行批量清空`}
						description="该操作会清空所选邮箱夹中的全部邮件；凡是 capability 标记为不支持清空的 profile（例如 Gmail 应用专用密码、QQ IMAP / SMTP）都会被后端自动跳过。"
					/>
					<div>
						<Text strong>目标邮箱夹</Text>
						<Select
							value={batchClearMailbox}
							style={widthFullMarginTop8Style}
							options={[
								{ value: "INBOX", label: "收件箱" },
								{ value: "Junk", label: "垃圾箱" },
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
				title={editingGroupId ? "编辑分组" : "创建分组"}
				open={groupModalVisible}
				onOk={handleGroupSubmit}
				onCancel={() => setGroupModalVisible(false)}
				destroyOnHidden
				width={460}
			>
				<Form form={groupForm} layout="vertical">
					<Form.Item
						name="name"
						label="分组名称"
						rules={[{ required: true, message: "请输入分组名称" }]}
					>
						<Input placeholder="例如：aws、discord" />
					</Form.Item>
					<Form.Item name="description" label="描述">
						<Input placeholder="可选描述" />
					</Form.Item>
					<Form.Item
						name="fetchStrategy"
						label="邮件拉取策略"
						rules={[{ required: true, message: "请选择拉取策略" }]}
					>
						<Select
							options={MAIL_FETCH_STRATEGY_OPTIONS.map((option) => ({
								value: option.value,
								label: option.label,
							}))}
						/>
					</Form.Item>
				</Form>
			</Modal>

			{/* 批量分配分组 Modal */}
			<Modal
				title="分配邮箱到分组"
				open={assignGroupModalVisible}
				onOk={handleBatchAssignGroup}
				onCancel={() => setAssignGroupModalVisible(false)}
				destroyOnHidden
				width={400}
			>
				<p>已选择 {selectedRowKeys.length} 个邮箱</p>
				<Select
					placeholder="选择目标分组"
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
