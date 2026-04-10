import {
	ApiOutlined,
	CheckCircleOutlined,
	CodeOutlined,
	KeyOutlined,
	MailOutlined,
	SafetyCertificateOutlined,
	ThunderboltOutlined,
	WarningOutlined,
} from "@ant-design/icons";
import {
	Alert,
	Anchor,
	Button,
	Card,
	Col,
	Collapse,
	Divider,
	Row,
	Space,
	Steps,
	Table,
	Tag,
	Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { PageHeader, SurfaceCard } from "../../components";
import { LOG_ACTION_OPTIONS } from "../../constants/logActions";
import { useI18n } from "../../i18n";
import { defineMessage, type TranslationInput } from "../../i18n/messages";
import {
	cardBgErrorStyle,
	cardBgMutedStyle,
	cardBgSuccessStyle,
	codeBlockCompactStyle,
	codeBlockStyle,
	errorTextStyle,
	fullWidthStyle,
	listItemMarginBottom8Style,
	marginBottom8Style,
	marginBottom16Style,
	marginBottom24Style,
	noMarginBottomStyle,
	noMarginStyle,
	orderedListStyle,
	stickyTop24Style,
	successTextStyle,
} from "../../styles/common";

const { Title, Text, Paragraph } = Typography;

const m = (key: string, zh: string, en = zh) =>
	defineMessage(`apiDocs.${key}`, zh, en);

type ApiGroup = "外部连接器接口" | "域名邮箱接口";

interface ParamRow {
	name: string;
	type: string;
	required: boolean;
	desc: TranslationInput;
}

interface ApiSection {
	key: string;
	name: TranslationInput;
	group: ApiGroup;
	method: string;
	path: string;
	legacyPaths?: string[];
	audience: TranslationInput;
	description: TranslationInput;
	usageHint: TranslationInput;
	params: ParamRow[];
	example: TranslationInput;
	successResponse: TranslationInput;
	errorResponse: TranslationInput;
}

interface SurfaceDocCard {
	key: string;
	title: TranslationInput;
	auth: TranslationInput;
	prefixes: string[];
	audience: TranslationInput;
	description: TranslationInput;
	status: TranslationInput;
}

interface RouteOperation {
	method: string;
	path: string;
	purpose: TranslationInput;
}

interface RouteFamilyDoc {
	key: string;
	sectionId: string;
	surface: "admin" | "portal" | "ingress";
	title: TranslationInput;
	auth: TranslationInput;
	audience: TranslationInput;
	description: TranslationInput;
	operations: RouteOperation[];
	requestExample?: TranslationInput;
	successResponse?: TranslationInput;
}

interface CallPlaybook {
	key: string;
	title: TranslationInput;
	audience: TranslationInput;
	summary: TranslationInput;
	steps: TranslationInput[];
	curl: TranslationInput;
	response: TranslationInput;
}

interface AuthMethodDoc {
	method: TranslationInput;
	example: string;
	description: TranslationInput;
}

interface GettingStartedStep {
	title: TranslationInput;
	description: TranslationInput;
}

interface FaqItem {
	question: TranslationInput;
	answer: TranslationInput;
}

interface CommonErrorDoc {
	code: string;
	reason: TranslationInput;
	suggestion: TranslationInput;
}

interface IntegrationScenario {
	title: TranslationInput;
	steps: TranslationInput[];
}

const apiDocsPageI18n = {
	pageTitle: m("pageTitle", "API 文档", "API docs"),
	pageSubtitle: m(
		"pageSubtitle",
		"把 all-Mail 当成统一的邮件自动化控制面来使用：这页现在同时覆盖公开自动化 API、管理员控制面、门户用户 API 和 ingress 投递面，并按真实路由分组展示。",
		"Use all-Mail as one unified mail-automation control plane: this page now covers the public automation APIs, the admin control plane, the portal-user APIs, and the ingress delivery surface, grouped by the real route families.",
	),
	startHere: m("startHere", "从这里开始", "Start here"),
	newNaming: m("newNaming", "新命名", "New naming"),
	compatibilityAlias: m(
		"compatibilityAlias",
		"兼容别名",
		"Compatibility alias",
	),
	realRoute: m("realRoute", "真实接口", "Real route"),
	fullSurface: m("fullSurface", "完整功能面", "Full surface"),
	oneSentenceTitle: m(
		"oneSentenceTitle",
		"先用一句话理解 all-Mail API",
		"Understand the all-Mail API in one sentence",
	),
	oneSentenceLead: m(
		"oneSentenceLead",
		"如果你把 all-Mail 当成一个“分配邮箱资源、读取消息、提取验证码、管理分配状态”的服务，这一页就是它的操作说明书。新的公开主路径采用资源化命名；旧脚本路径仍可迁移，但不再作为主文档入口。除了公开接口，这里也把后台控制面、门户会话和 ingress 投递面一起梳理成可调用手册。",
		"If you think of all-Mail as a service for allocating mailbox resources, reading messages, extracting verification codes, and managing allocation state, this page is the operating manual. The public routes now use resource-style naming; legacy script paths still exist for migration, but they are no longer the main documentation entry. Alongside the public APIs, this page also maps the admin control plane, portal sessions, and ingress delivery surface into one callable guide.",
	),
	criticalDifferenceTitle: m(
		"criticalDifferenceTitle",
		"最重要的区别：先认清你在调哪一个功能面",
		"Most important distinction: know which surface you are calling first",
	),
	externalConnectorLead: m(
		"externalConnectorLead",
		"外部连接器接口：",
		"External-connector APIs:",
	),
	externalConnectorDescription: m(
		"externalConnectorDescription",
		"对应 Outlook / Gmail / QQ 等外部连接器，推荐路径族是 /api/mailboxes/* 与 /api/messages/*。",
		"These map to external connectors such as Outlook, Gmail, and QQ. The recommended route families are /api/mailboxes/* and /api/messages/*.",
	),
	domainSurfaceLead: m(
		"domainSurfaceLead",
		"域名邮箱接口：",
		"Domain-mail APIs:",
	),
	domainSurfaceDescription: m(
		"domainSurfaceDescription",
		"对应 all-Mail 自己管理的域名邮箱与入站消息，推荐路径族是 /api/domain-mail/mailboxes/* 与 /api/domain-mail/messages/*。",
		"These map to all-Mail-managed domain mailboxes and inbound messages. The recommended route families are /api/domain-mail/mailboxes/* and /api/domain-mail/messages/*.",
	),
	adminSurfaceLead: m(
		"adminSurfaceLead",
		"管理员控制面：",
		"Admin control plane:",
	),
	adminSurfaceDescription: m(
		"adminSurfaceDescription",
		"后台真实使用的是 /admin/*，包括 OAuth、邮箱、域名、域名邮箱、门户用户、发信与日志。",
		"The real backend control plane is /admin/*, including OAuth, mailboxes, domains, domain mailboxes, portal users, sending, and logs.",
	),
	portalIngressLead: m(
		"portalIngressLead",
		"门户与 ingress：",
		"Portal and ingress:",
	),
	portalIngressDescription: m(
		"portalIngressDescription",
		"门户用户调用 /mail/api/*，内部投递接入面是 /ingress/domain-mail/receive。",
		"Portal users call /mail/api/*, while the internal delivery ingress is /ingress/domain-mail/receive.",
	),
	platformSurfaceTitle: m(
		"platformSurfaceTitle",
		"平台功能面一览",
		"Platform surface overview",
	),
	authLabel: m("authLabel", "认证：", "Auth:"),
	audienceLabel: m("audienceLabel", "适合谁：", "Audience:"),
	quickStartTitle: m(
		"quickStartTitle",
		"5 分钟上手",
		"Get started in 5 minutes",
	),
	scenarioTitle: m(
		"scenarioTitle",
		"先把最常见的两个场景跑通",
		"Start with the two most common scenarios",
	),
	playbookTitle: m(
		"playbookTitle",
		"高频功能调用剧本",
		"Common call playbooks",
	),
	requestExampleTitle: m("requestExampleTitle", "请求示例", "Request example"),
	callExampleTitle: m("callExampleTitle", "调用示例", "Call example"),
	responseExampleTitle: m(
		"responseExampleTitle",
		"响应示例",
		"Response example",
	),
	authSectionTitle: m("authSectionTitle", "认证方式", "Authentication methods"),
	allExternalApisNeedKey: m(
		"allExternalApisNeedKey",
		"所有外部 API 都需要访问密钥",
		"All external APIs require an access key",
	),
	accessKeyReminder: m(
		"accessKeyReminder",
		"请先到后台的「访问密钥」页面创建密钥。这个密钥只在创建时显示一次，请立即保存到密码管理器或你的部署环境变量里。",
		"Create an access key from the admin “API Keys” page first. The key is shown only once when it is created, so save it immediately in your password manager or deployment environment variables.",
	),
	methodColumn: m("methodColumn", "方式", "Method"),
	exampleColumn: m("exampleColumn", "示例", "Example"),
	whenToUseColumn: m("whenToUseColumn", "什么时候用", "When to use it"),
	publicApiTitle: m(
		"publicApiTitle",
		"公开自动化 API 详解",
		"Public automation API reference",
	),
	bestFitTitle: m(
		"bestFitTitle",
		"什么时候最适合调这个接口？",
		"When is this endpoint the best fit?",
	),
	legacyAliasStillAvailable: m(
		"legacyAliasStillAvailable",
		"兼容别名仍可使用",
		"Legacy aliases are still available",
	),
	requestUrlTitle: m("requestUrlTitle", "请求地址", "Request URL"),
	requestParamsTitle: m("requestParamsTitle", "请求参数", "Request parameters"),
	curlExampleTitle: m("curlExampleTitle", "curl 调用示例", "curl example"),
	successResponseTitle: m(
		"successResponseTitle",
		"成功响应示例",
		"Successful response example",
	),
	errorResponseTitle: m(
		"errorResponseTitle",
		"失败响应示例",
		"Error response example",
	),
	controlPlaneTitle: m(
		"controlPlaneTitle",
		"控制面与内部功能面详解",
		"Control-plane and internal-surface reference",
	),
	operationMatrixTitle: m(
		"operationMatrixTitle",
		"功能调用矩阵",
		"Operation matrix",
	),
	troubleshootingTitle: m(
		"troubleshootingTitle",
		"排错说明",
		"Troubleshooting guide",
	),
	troubleshootingPrefix: m(
		"troubleshootingPrefix",
		"建议排查：",
		"Suggested checks:",
	),
	logActionsTitle: m(
		"logActionsTitle",
		"日志 action 与内部约定",
		"Log actions and internal conventions",
	),
	internalSurfacesAudienceWarningTitle: m(
		"internalSurfacesAudienceWarningTitle",
		"后台、门户和 ingress 都是真实接口，但它们的目标受众不同",
		"Admin, portal, and ingress are all real APIs, but they serve different audiences",
	),
	internalSurfacesAudienceWarningBody: m(
		"internalSurfacesAudienceWarningBody",
		"公开自动化 API 优先给脚本和第三方系统；/admin/* 更适合后台控制面；/mail/api/* 只适合门户会话；/ingress/* 只适合内部签名投递。",
		"The public automation APIs are primarily for scripts and third-party systems; /admin/* is better suited to the admin control plane; /mail/api/* is for portal sessions only; /ingress/* is only for internally signed delivery.",
	),
	adminMayAlsoTouch: m(
		"adminMayAlsoTouch",
		"如果你是管理员，可能还会接触到：",
		"If you are an administrator, you may also touch:",
	),
	internalCapabilityNote: m(
		"internalCapabilityNote",
		"。这些接口都是真实存在的，但它们属于后台或门户内部能力，不适合作为“新手 API 起点”。",
		". These endpoints are all real, but they belong to internal admin or portal capabilities and are not a good starting point for new API consumers.",
	),
	logActionColumn: m(
		"logActionColumn",
		"操作日志 action",
		"Operation-log action",
	),
	logMeaningColumn: m("logMeaningColumn", "中文含义", "Meaning"),
	quickNavigationTitle: m(
		"quickNavigationTitle",
		"快速导航",
		"Quick navigation",
	),
	readThisPageFirst: m(
		"readThisPageFirst",
		"先读这一页",
		"Read this page first",
	),
	fastestTestOrderTitle: m(
		"fastestTestOrderTitle",
		"最快的测试顺序",
		"Fastest test order",
	),
	domainAutomationTitle: m(
		"domainAutomationTitle",
		"如果你在用域名邮箱自动化",
		"If you are automating domain mailboxes",
	),
	domainAutomationBody: m(
		"domainAutomationBody",
		"把上面三步换成 /api/domain-mail/mailboxes/allocation-stats → /api/domain-mail/mailboxes/allocate → /api/domain-mail/messages/text。",
		"Replace the three steps above with /api/domain-mail/mailboxes/allocation-stats → /api/domain-mail/mailboxes/allocate → /api/domain-mail/messages/text.",
	),
	productionReminderTitle: m(
		"productionReminderTitle",
		"生产环境提醒",
		"Production reminder",
	),
	productionReminderBody: m(
		"productionReminderBody",
		"JWT_SECRET、ENCRYPTION_KEY、ADMIN_PASSWORD 必须通过外部环境变量注入，不要写死进仓库。",
		"JWT_SECRET, ENCRYPTION_KEY, and ADMIN_PASSWORD must be injected through external environment variables. Do not hardcode them into the repository.",
	),
	healthCheckTitle: m("healthCheckTitle", "健康检查", "Health check"),
	beginnerFaqTitle: m("beginnerFaqTitle", "新手常见问题", "Beginner FAQ"),
	paramNameColumn: m("paramNameColumn", "参数名", "Parameter"),
	paramTypeColumn: m("paramTypeColumn", "类型", "Type"),
	requiredColumn: m("requiredColumn", "必填", "Required"),
	descriptionColumn: m("descriptionColumn", "说明", "Description"),
	operationPathColumn: m("operationPathColumn", "路径", "Path"),
	operationPurposeColumn: m("operationPurposeColumn", "功能说明", "Purpose"),
	yes: m("yes", "是", "Yes"),
	no: m("no", "否", "No"),
	pathLegendNewNaming: m("pathLegendNewNaming", "新命名", "New naming"),
	pathLegendCompatibility: m(
		"pathLegendCompatibility",
		"兼容别名",
		"Compatibility alias",
	),
	pathLegendRealRoute: m("pathLegendRealRoute", "真实接口", "Real route"),
	pathLegendFullSurface: m(
		"pathLegendFullSurface",
		"完整功能面",
		"Full surface",
	),
} as const;

const ApiDocsPage = () => {
	const { t } = useI18n();
	const docsStyles = {
		fullWidth: fullWidthStyle,
		marginBottom24: marginBottom24Style,
		titleNoMargin: noMarginStyle,
		orderedList: orderedListStyle,
		listItemGap: listItemMarginBottom8Style,
		codeCardMuted: cardBgMutedStyle,
		codeCardSuccess: cardBgSuccessStyle,
		codeCardError: cardBgErrorStyle,
		stickyTop24: stickyTop24Style,
		successText: successTextStyle,
		errorText: errorTextStyle,
	} as const;
	const baseUrl = window.location.origin;

	const paramColumns: ColumnsType<ParamRow> = [
		{
			title: t(apiDocsPageI18n.paramNameColumn),
			dataIndex: "name",
			key: "name",
			render: (text) => <Text code>{text}</Text>,
		},
		{
			title: t(apiDocsPageI18n.paramTypeColumn),
			dataIndex: "type",
			key: "type",
		},
		{
			title: t(apiDocsPageI18n.requiredColumn),
			dataIndex: "required",
			key: "required",
			render: (required) =>
				required ? (
					<Tag color="red">{t(apiDocsPageI18n.yes)}</Tag>
				) : (
					<Tag>{t(apiDocsPageI18n.no)}</Tag>
				),
		},
		{
			title: t(apiDocsPageI18n.descriptionColumn),
			dataIndex: "desc",
			key: "desc",
			render: (value: TranslationInput) => t(value),
		},
	];

	const operationColumns: ColumnsType<RouteOperation> = [
		{
			title: t(apiDocsPageI18n.methodColumn),
			dataIndex: "method",
			key: "method",
			width: 120,
			render: (text) => <Tag color="blue">{text}</Tag>,
		},
		{
			title: t(apiDocsPageI18n.operationPathColumn),
			dataIndex: "path",
			key: "path",
			render: (text) => <Text code>{text}</Text>,
		},
		{
			title: t(apiDocsPageI18n.operationPurposeColumn),
			dataIndex: "purpose",
			key: "purpose",
			render: (value: TranslationInput) => t(value),
		},
	];

	const authMethods: AuthMethodDoc[] = [
		{
			method: m(
				"auth.headerRecommended",
				"Header（推荐）",
				"Header (recommended)",
			),
			example: "X-API-Key: sk_your_api_key",
			description: m(
				"auth.headerDescription",
				"适合脚本、后端任务、Postman 和 webhook worker。",
				"Best for scripts, backend jobs, Postman, and webhook workers.",
			),
		},
		{
			method: m("auth.bearerToken", "Bearer Token", "Bearer token"),
			example: "Authorization: Bearer sk_your_api_key",
			description: m(
				"auth.bearerDescription",
				"当你的请求库天然偏好 Bearer Token 时使用。",
				"Use this when your request client naturally prefers bearer tokens.",
			),
		},
	];

	const gettingStartedSteps: GettingStartedStep[] = [
		{
			title: m(
				"gettingStarted.createKey.title",
				"先创建访问密钥",
				"Create an access key first",
			),
			description: m(
				"gettingStarted.createKey.description",
				"在后台「访问密钥」页面创建一个密钥。它只会在创建时显示一次，请立即保存。",
				"Create a key from the admin “API Keys” page. It is shown only once when created, so save it immediately.",
			),
		},
		{
			title: m(
				"gettingStarted.distinguishSurfaces.title",
				"先区分两条自动化路径",
				"Separate the two automation surfaces first",
			),
			description: m(
				"gettingStarted.distinguishSurfaces.description",
				"外部 Outlook / Gmail / QQ 连接走 /api/*；all-Mail 自己托管的域名邮箱走 /api/domain-mail/*。",
				"External Outlook / Gmail / QQ connectors use /api/*, while all-Mail-hosted domain mailboxes use /api/domain-mail/*.",
			),
		},
		{
			title: m(
				"gettingStarted.statsAllocateRead.title",
				"先跑统计，再分配，再读文本",
				"Run stats, then allocate, then read text",
			),
			description: m(
				"gettingStarted.statsAllocateRead.description",
				"建议先调 allocation-stats，确认认证和作用域没问题；再分配邮箱资源；最后用 messages/text 提取验证码。",
				"Start with allocation-stats to verify authentication and scope, then allocate a mailbox resource, and finally use messages/text to extract the verification code.",
			),
		},
		{
			title: m(
				"gettingStarted.legacyMigration.title",
				"旧脚本可迁移，不必一步到位",
				"Legacy scripts can migrate gradually",
			),
			description: m(
				"gettingStarted.legacyMigration.description",
				"旧的 get-email / mail_text / pool-stats 仍保留为兼容别名，但新的集成请直接使用资源化路径。",
				"The old get-email / mail_text / pool-stats routes still exist as compatibility aliases, but new integrations should go straight to the resource-style paths.",
			),
		},
	];

	const beginnerFaq: FaqItem[] = [
		{
			question: m(
				"faq.firstEndpoint.question",
				"我应该先调哪一个接口？",
				"Which endpoint should I call first?",
			),
			answer: m(
				"faq.firstEndpoint.answer",
				"先调统计接口。外部连接建议从 /api/mailboxes/allocation-stats 开始，域名邮箱建议从 /api/domain-mail/mailboxes/allocation-stats 开始。确认认证和作用域正常后，再调 allocate 与 messages/text。",
				"Start with the stats endpoint. For external connectors, begin with /api/mailboxes/allocation-stats; for domain mailboxes, begin with /api/domain-mail/mailboxes/allocation-stats. Once auth and scope look correct, move on to allocate and messages/text.",
			),
		},
		{
			question: m(
				"faq.surfaceDifference.question",
				"外部连接器接口和域名邮箱接口有什么区别？",
				"What is the difference between external-connector APIs and domain-mail APIs?",
			),
			answer: m(
				"faq.surfaceDifference.answer",
				"外部连接器接口面向 Outlook / Gmail / QQ 等外部账号；域名邮箱接口面向 all-Mail 自己维护的域名邮箱、批次和入站消息。两者认证方式一致，但资源模型和字段不同。",
				"External-connector APIs target external accounts such as Outlook, Gmail, and QQ; domain-mail APIs target the domain mailboxes, batches, and inbound messages managed directly by all-Mail. They share the same auth style, but the resource model and fields differ.",
			),
		},
		{
			question: m(
				"faq.verificationCode.question",
				"我只是想拿验证码，怎么最省事？",
				"I only want the verification code. What is the simplest path?",
			),
			answer: m(
				"faq.verificationCode.answer",
				"直接使用 messages/text。它支持返回纯文本，也可以通过 match 参数直接提取验证码。",
				"Use messages/text directly. It can return the plain text, and it can also extract the verification code directly through the match parameter.",
			),
		},
		{
			question: m(
				"faq.legacyScripts.question",
				"旧脚本还能继续跑吗？",
				"Can legacy scripts keep running?",
			),
			answer: m(
				"faq.legacyScripts.answer",
				"可以。旧的 get-email / mail_new / mail_text / pool-stats 等路径仍作为兼容别名存在，但公开文档已经切换到新的资源化命名。",
				"Yes. The old get-email / mail_new / mail_text / pool-stats routes still exist as compatibility aliases, but the public documentation has switched to the new resource-style naming.",
			),
		},
	];

	const commonErrors: CommonErrorDoc[] = [
		{
			code: "AUTH_REQUIRED",
			reason: m(
				"commonErrors.authRequired.reason",
				"请求没有带访问密钥，或者带法不对。",
				"The request is missing an access key, or it was sent in the wrong place.",
			),
			suggestion: m(
				"commonErrors.authRequired.suggestion",
				"优先使用 Header 的 X-API-Key 方式，并确认密钥仍处于 ACTIVE 状态。",
				"Prefer the X-API-Key header style and confirm that the key is still ACTIVE.",
			),
		},
		{
			code: "EMAIL_NOT_FOUND / DOMAIN_MAILBOX_NOT_FOUND",
			reason: m(
				"commonErrors.mailboxNotFound.reason",
				"目标邮箱不存在，或者当前访问密钥无权访问这个资源。",
				"The target mailbox does not exist, or the current access key cannot reach that resource.",
			),
			suggestion: m(
				"commonErrors.mailboxNotFound.suggestion",
				"先调 mailboxes 接口确认资源存在，再检查访问范围与分组/域名限制。",
				"Call the mailboxes endpoint first to confirm the resource exists, then review scope, group, or domain restrictions.",
			),
		},
		{
			code: "NO_UNUSED_EMAIL / NO_UNUSED_DOMAIN_MAILBOX",
			reason: m(
				"commonErrors.noUnused.reason",
				"当前可分配资源已耗尽。",
				"The currently allocatable resources are exhausted.",
			),
			suggestion: m(
				"commonErrors.noUnused.suggestion",
				"先查看 allocation-stats，再决定是补资源还是重置当前访问密钥的分配记录。",
				"Check allocation-stats first, then decide whether you need to add resources or reset the current key’s allocation history.",
			),
		},
		{
			code: "DOMAIN_FORBIDDEN",
			reason: m(
				"commonErrors.domainForbidden.reason",
				"当前访问密钥被限制了域名访问范围。",
				"The current access key is restricted from the selected domain scope.",
			),
			suggestion: m(
				"commonErrors.domainForbidden.suggestion",
				"换一个有权限的访问密钥，或者在后台放开允许的域名范围。",
				"Use another access key that has permission, or broaden the allowed domain scope in the admin console.",
			),
		},
		{
			code: "Error: No match found",
			reason: m(
				"commonErrors.noMatch.reason",
				"messages/text 提供的正则没有在邮件文本中匹配到内容。",
				"The regex provided to messages/text did not match anything in the mail text.",
			),
			suggestion: m(
				"commonErrors.noMatch.suggestion",
				"先不传 match 获取原始文本，再根据真实邮件内容调整正则表达式。",
				"Fetch the raw text first without match, then refine the regex against the real mail content.",
			),
		},
	];

	const surfaceCards: SurfaceDocCard[] = [
		{
			key: "public-automation",
			title: m(
				"surface.publicAutomation.title",
				"公开自动化 API",
				"Public automation APIs",
			),
			auth: m(
				"surface.publicAutomation.auth",
				"X-API-Key / Bearer",
				"X-API-Key / Bearer",
			),
			prefixes: ["/api/*", "/api/domain-mail/*"],
			audience: m(
				"surface.publicAutomation.audience",
				"脚本、机器人、验证码轮询、自动化服务",
				"Scripts, bots, verification polling, and automation services",
			),
			description: m(
				"surface.publicAutomation.description",
				"这是对外的资源分配 / 读信 / 文本提取接口，也是第三方系统最该优先接的调用面。",
				"This is the public resource-allocation, message-reading, and text-extraction surface, and it is usually the first surface third-party systems should integrate.",
			),
			status: m(
				"surface.publicAutomation.status",
				"推荐起点",
				"Recommended starting point",
			),
		},
		{
			key: "admin-control-plane",
			title: m(
				"surface.adminControlPlane.title",
				"管理员控制面 API",
				"Admin control-plane APIs",
			),
			auth: m(
				"surface.adminControlPlane.auth",
				"管理员 session cookie",
				"Admin session cookie",
			),
			prefixes: ["/admin/*"],
			audience: m(
				"surface.adminControlPlane.audience",
				"后台页面、内部运维脚本、管理员工具",
				"Admin pages, internal ops scripts, and administrator tools",
			),
			description: m(
				"surface.adminControlPlane.description",
				"覆盖 API Key、外部邮箱、域名、域名邮箱、门户用户、发信配置、转发任务、统计与日志。",
				"Covers API keys, external mailboxes, domains, domain mailboxes, portal users, sending configuration, forwarding jobs, stats, and logs.",
			),
			status: m(
				"surface.adminControlPlane.status",
				"完整控制面",
				"Full control plane",
			),
		},
		{
			key: "mailbox-portal",
			title: m(
				"surface.mailboxPortal.title",
				"门户用户 API",
				"Portal-user APIs",
			),
			auth: m(
				"surface.mailboxPortal.auth",
				"mailbox_token Cookie",
				"mailbox_token cookie",
			),
			prefixes: ["/mail/api/*"],
			audience: m(
				"surface.mailboxPortal.audience",
				"门户前端、站内邮箱用户、自助收件与发信",
				"Portal frontend, mailbox users, and self-service receive/send flows",
			),
			description: m(
				"surface.mailboxPortal.description",
				"面向 mailbox user 的登录、会话、收件列表、已发送、站内发信与转发设置。",
				"Handles mailbox-user login, session management, inbox lists, sent mail, hosted sending, and forwarding settings.",
			),
			status: m("surface.mailboxPortal.status", "门户专用", "Portal only"),
		},
		{
			key: "ingress",
			title: m("surface.ingress.title", "Ingress 接入面", "Ingress surface"),
			auth: m("surface.ingress.auth", "签名校验", "Signature validation"),
			prefixes: ["/ingress/domain-mail/*"],
			audience: m(
				"surface.ingress.audience",
				"邮件网关、Worker、转发入口、站内入站链路",
				"Mail gateways, workers, forwarding ingress, and hosted inbound pipelines",
			),
			description: m(
				"surface.ingress.description",
				"只暴露内部投递入口，用来把入站邮件写入 all-Mail 的域名消息存储。",
				"Only exposes the internal delivery entry used to persist inbound mail into all-Mail’s domain-message storage.",
			),
			status: m("surface.ingress.status", "内部集成", "Internal integration"),
		},
	];

	const integrationScenarios: IntegrationScenario[] = [
		{
			title: m(
				"scenarios.external.title",
				"场景 1：外部连接器验证码流程",
				"Scenario 1: external-connector verification flow",
			),
			steps: [
				m(
					"scenarios.external.step1",
					"调用 /api/mailboxes/allocate 分配一个外部邮箱资源。",
					"Call /api/mailboxes/allocate to reserve one external mailbox resource.",
				),
				m(
					"scenarios.external.step2",
					"把返回的 email 用到你的注册、验证或自动化流程里。",
					"Feed the returned email into your registration, verification, or automation flow.",
				),
				m(
					"scenarios.external.step3",
					"等待目标站点发信后，调用 /api/messages/text，并传入 match=\\d{6} 之类的正则。",
					"After the target site sends the message, call /api/messages/text and pass a regex such as match=\\d{6}.",
				),
				m(
					"scenarios.external.step4",
					"如需重新释放当前访问密钥的分配记录，可调用 /api/mailboxes/allocation-reset。",
					"If you need to release the current key’s allocation history again, call /api/mailboxes/allocation-reset.",
				),
			],
		},
		{
			title: m(
				"scenarios.domain.title",
				"场景 2：域名邮箱验证码流程",
				"Scenario 2: domain-mailbox verification flow",
			),
			steps: [
				m(
					"scenarios.domain.step1",
					"先调用 /api/domain-mail/mailboxes/allocate 分配一个域名邮箱。",
					"Start with /api/domain-mail/mailboxes/allocate to reserve a domain mailbox.",
				),
				m(
					"scenarios.domain.step2",
					"把这个邮箱投给你的业务系统。",
					"Give that mailbox address to your business system.",
				),
				m(
					"scenarios.domain.step3",
					"邮件进入 all-Mail 后，用 /api/domain-mail/messages/latest 或 /api/domain-mail/messages/text 读取最新邮件。",
					"After mail lands in all-Mail, use /api/domain-mail/messages/latest or /api/domain-mail/messages/text to read the latest message.",
				),
				m(
					"scenarios.domain.step4",
					"如果你想看某个批次是否快分配完了，优先调用 /api/domain-mail/mailboxes/allocation-stats。",
					"If you need to check whether a batch is running low, start with /api/domain-mail/mailboxes/allocation-stats.",
				),
			],
		},
	];

	const routeFamilies: RouteFamilyDoc[] = [
		{
			key: "admin-auth",
			sectionId: "admin-api",
			surface: "admin",
			title: m(
				"routeFamilies.adminAuth.title",
				"管理员认证与 2FA",
				"Admin authentication and 2FA",
			),
			auth: m(
				"routeFamilies.adminAuth.auth",
				"登录前公开；其他接口需要管理员 session cookie",
				"Public before login; all other endpoints require an admin session cookie",
			),
			audience: m(
				"routeFamilies.adminAuth.audience",
				"后台登录页、管理员个人设置、安全运维",
				"Admin login, personal security settings, and security operations",
			),
			description: m(
				"routeFamilies.adminAuth.description",
				"对应 `server/src/modules/auth/auth.routes.ts`，覆盖登录、登出、当前用户、改密、2FA 状态、启用与禁用。",
				"Backed by `server/src/modules/auth/auth.routes.ts`, covering login, logout, current-user reads, password changes, 2FA status, setup, enable, and disable flows.",
			),
			operations: [
				{
					method: "POST",
					path: "/admin/auth/login",
					purpose: m(
						"routeFamilies.adminAuth.login",
						"管理员登录并写入 httpOnly cookie，同时返回当前管理员资料。",
						"Logs an administrator in, writes the httpOnly cookie, and returns the current admin profile.",
					),
				},
				{
					method: "POST",
					path: "/admin/auth/logout",
					purpose: m(
						"routeFamilies.adminAuth.logout",
						"清理 token cookie。",
						"Clears the token cookie.",
					),
				},
				{
					method: "GET",
					path: "/admin/auth/me",
					purpose: m(
						"routeFamilies.adminAuth.me",
						"读取当前管理员资料与 mustChangePassword 等状态。",
						"Reads the current admin profile and related flags such as mustChangePassword.",
					),
				},
				{
					method: "POST",
					path: "/admin/auth/change-password",
					purpose: m(
						"routeFamilies.adminAuth.changePassword",
						"管理员主动改密。",
						"Lets an administrator rotate their password.",
					),
				},
				{
					method: "GET",
					path: "/admin/auth/2fa/status",
					purpose: m(
						"routeFamilies.adminAuth.twoFaStatus",
						"查看当前 2FA 开启状态。",
						"Reads the current 2FA status.",
					),
				},
				{
					method: "POST",
					path: "/admin/auth/2fa/setup",
					purpose: m(
						"routeFamilies.adminAuth.twoFaSetup",
						"生成 2FA 绑定二维码与 secret。",
						"Generates the QR code and secret used to bind 2FA.",
					),
				},
				{
					method: "POST",
					path: "/admin/auth/2fa/enable",
					purpose: m(
						"routeFamilies.adminAuth.twoFaEnable",
						"校验验证码并启用 2FA。",
						"Verifies the code and enables 2FA.",
					),
				},
				{
					method: "POST",
					path: "/admin/auth/2fa/disable",
					purpose: m(
						"routeFamilies.adminAuth.twoFaDisable",
						"校验密码/验证码后禁用 2FA。",
						"Disables 2FA after password/code verification.",
					),
				},
			],
			requestExample: `curl -X POST "${baseUrl}/admin/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<admin-password>"}'`,
			successResponse: `{
  "success": true,
  "data": {
    "admin": { "id": 1, "username": "admin", "role": "SUPER_ADMIN" }
  }
}`,
		},
		{
			key: "admin-api-keys",
			sectionId: "admin-api",
			surface: "admin",
			title: m(
				"routeFamilies.adminApiKeys.title",
				"访问密钥与分配范围",
				"Access keys and allocation scope",
			),
			auth: m("routeFamilies.adminApiKeys.auth", "管理员 JWT", "Admin JWT"),
			audience: m(
				"routeFamilies.adminApiKeys.audience",
				"API Key 管理页、内部运维脚本、分配范围治理",
				"API-key management, internal operations scripts, and allocation-scope governance",
			),
			description: m(
				"routeFamilies.adminApiKeys.description",
				"对应 `server/src/modules/api-key/apiKey.routes.ts`，覆盖 API Key CRUD、邮箱池 usage/reset、已分配邮箱列表与手工分配。",
				"Backed by `server/src/modules/api-key/apiKey.routes.ts`, covering API-key CRUD, mailbox-pool usage/reset flows, assigned-mailbox lists, and manual assignment.",
			),
			operations: [
				{
					method: "GET",
					path: "/admin/api-keys",
					purpose: m(
						"routeFamilies.adminApiKeys.list",
						"分页查询访问密钥。",
						"Lists access keys with pagination.",
					),
				},
				{
					method: "POST",
					path: "/admin/api-keys",
					purpose: m(
						"routeFamilies.adminApiKeys.create",
						"创建访问密钥并返回仅展示一次的明文 key。",
						"Creates an access key and returns the plain key only once.",
					),
				},
				{
					method: "GET",
					path: "/admin/api-keys/:id",
					purpose: m(
						"routeFamilies.adminApiKeys.detail",
						"查看单个访问密钥详情。",
						"Reads the details of a single access key.",
					),
				},
				{
					method: "PUT",
					path: "/admin/api-keys/:id",
					purpose: m(
						"routeFamilies.adminApiKeys.update",
						"更新状态、权限、作用域、过期时间等。",
						"Updates status, permissions, scope, expiration time, and related settings.",
					),
				},
				{
					method: "DELETE",
					path: "/admin/api-keys/:id",
					purpose: m(
						"routeFamilies.adminApiKeys.delete",
						"删除访问密钥。",
						"Deletes an access key.",
					),
				},
				{
					method: "GET",
					path: "/admin/api-keys/:id/allocation-stats",
					purpose: m(
						"routeFamilies.adminApiKeys.stats",
						"查看某个 key 的外部邮箱分配统计。",
						"Reads the external-mailbox allocation stats for a specific key.",
					),
				},
				{
					method: "POST",
					path: "/admin/api-keys/:id/allocation-reset",
					purpose: m(
						"routeFamilies.adminApiKeys.reset",
						"重置某个 key 的外部邮箱分配记录。",
						"Resets the external-mailbox allocation history for a specific key.",
					),
				},
				{
					method: "GET",
					path: "/admin/api-keys/:id/assigned-mailboxes",
					purpose: m(
						"routeFamilies.adminApiKeys.assignedList",
						"查看这个 key 能访问/已占用的邮箱。",
						"Lists the mailboxes this key can access or has already occupied.",
					),
				},
				{
					method: "PUT",
					path: "/admin/api-keys/:id/assigned-mailboxes",
					purpose: m(
						"routeFamilies.adminApiKeys.assignedUpdate",
						"手工调整该 key 绑定的邮箱集合。",
						"Manually updates the mailbox set bound to this key.",
					),
				},
			],
			requestExample: `curl -X POST "${baseUrl}/admin/api-keys" \
  -b "token=<admin-session-cookie>" \
  -H "Content-Type: application/json" \
  -d '{"name":"ops-bot","status":"ACTIVE","permissions":{"mail_text":true},"allowedGroupIds":[1]}'`,
			successResponse: `{
  "success": true,
  "data": {
    "id": 8,
    "name": "ops-bot",
    "plainKey": "sk_xxxxx",
    "status": "ACTIVE"
  }
}`,
		},
		{
			key: "admin-emails-oauth",
			sectionId: "admin-api",
			surface: "admin",
			title: m(
				"routeFamilies.adminEmails.title",
				"外部邮箱、OAuth 与邮箱分组",
				"External mailboxes, OAuth, and mailbox groups",
			),
			auth: m("routeFamilies.adminEmails.auth", "管理员 JWT", "Admin JWT"),
			audience: m(
				"routeFamilies.adminEmails.audience",
				"外部邮箱连接页、OAuth 配置页、分组管理页",
				"External mailbox setup, OAuth configuration, and mailbox-group management",
			),
			description: m(
				"routeFamilies.adminEmails.description",
				"对应 `email.routes.ts`、`email.oauth.routes.ts`、`group.routes.ts`，覆盖外部邮箱 CRUD、批量检查、批量清空、导入导出、OAuth 配置与邮箱分组。",
				"Backed by `email.routes.ts`, `email.oauth.routes.ts`, and `group.routes.ts`, covering external-mailbox CRUD, batch checks, batch clearing, import/export, OAuth configuration, and mailbox groups.",
			),
			operations: [
				{
					method: "GET",
					path: "/admin/emails",
					purpose: m(
						"routeFamilies.adminEmails.list",
						"分页查询外部邮箱，支持 provider / representativeProtocol / status / groupId。",
						"Lists external mailboxes with pagination and supports provider / representativeProtocol / status / groupId filters.",
					),
				},
				{
					method: "POST",
					path: "/admin/emails",
					purpose: m(
						"routeFamilies.adminEmails.create",
						"创建外部邮箱记录。",
						"Creates an external mailbox record.",
					),
				},
				{
					method: "PUT",
					path: "/admin/emails/:id",
					purpose: m(
						"routeFamilies.adminEmails.update",
						"更新邮箱鉴权信息、分组、状态等。",
						"Updates mailbox credentials, group assignment, status, and related properties.",
					),
				},
				{
					method: "POST",
					path: "/admin/emails/import",
					purpose: m(
						"routeFamilies.adminEmails.import",
						"按 registry token 批量导入邮箱。",
						"Imports mailboxes in bulk through a registry token.",
					),
				},
				{
					method: "GET",
					path: "/admin/emails/export",
					purpose: m(
						"routeFamilies.adminEmails.export",
						"导出邮箱凭据。",
						"Exports mailbox credentials.",
					),
				},
				{
					method: "POST",
					path: "/admin/emails/reveal-unlock",
					purpose: m(
						"routeFamilies.adminEmails.revealUnlock",
						"验证管理员 OTP 并签发短时密码查看授权。",
						"Verifies the admin OTP and issues temporary permission to reveal secrets.",
					),
				},
				{
					method: "POST",
					path: "/admin/emails/:id/reveal-secrets",
					purpose: m(
						"routeFamilies.adminEmails.revealSecrets",
						"在 OTP 或短时授权通过后，受控查看指定邮箱密钥。",
						"Reveals the selected mailbox secret under control after OTP or short-lived authorization succeeds.",
					),
				},
				{
					method: "POST",
					path: "/admin/emails/batch-fetch-mails",
					purpose: m(
						"routeFamilies.adminEmails.batchFetch",
						"批量拉取收件箱 / 已发送 / 垃圾箱。",
						"Fetches inbox / sent / junk folders in bulk.",
					),
				},
				{
					method: "POST",
					path: "/admin/emails/batch-clear-mailbox",
					purpose: m(
						"routeFamilies.adminEmails.batchClear",
						"按 capability 判断后批量清空邮箱。",
						"Clears mailboxes in bulk after checking capabilities.",
					),
				},
				{
					method: "GET",
					path: "/admin/oauth/providers",
					purpose: m(
						"routeFamilies.adminEmails.oauthProviders",
						"查看 Google / Microsoft OAuth 当前配置状态。",
						"Reads the current Google / Microsoft OAuth configuration state.",
					),
				},
				{
					method: "PUT",
					path: "/admin/oauth/configs/:provider",
					purpose: m(
						"routeFamilies.adminEmails.oauthConfig",
						"保存 provider 级 OAuth client 配置。",
						"Saves provider-level OAuth client configuration.",
					),
				},
				{
					method: "POST",
					path: "/admin/oauth/:provider/start",
					purpose: m(
						"routeFamilies.adminEmails.oauthStart",
						"生成授权链接并启动 OAuth 流。",
						"Creates the authorization URL and starts the OAuth flow.",
					),
				},
				{
					method: "GET",
					path: "/admin/oauth/:provider/status",
					purpose: m(
						"routeFamilies.adminEmails.oauthStatus",
						"轮询授权状态。",
						"Polls the OAuth authorization status.",
					),
				},
				{
					method: "GET",
					path: "/admin/email-groups",
					purpose: m(
						"routeFamilies.adminEmails.groupList",
						"读取外部邮箱分组。",
						"Lists external-mailbox groups.",
					),
				},
				{
					method: "POST",
					path: "/admin/email-groups/:id/assign",
					purpose: m(
						"routeFamilies.adminEmails.groupAssign",
						"把邮箱分配到某个分组。",
						"Assigns mailboxes into a specific group.",
					),
				},
			],
			requestExample: `curl -X POST "${baseUrl}/admin/emails/batch-fetch-mails" \
  -b "token=<admin-session-cookie>" \
  -H "Content-Type: application/json" \
  -d '{"representativeProtocol":"imap_smtp","status":"ACTIVE","mailboxes":["INBOX","SENT","Junk"]}'`,
			successResponse: `{
  "success": true,
  "data": {
    "targeted": 6,
    "successCount": 5,
    "partialCount": 1,
    "errorCount": 0,
    "results": [{ "id": 2, "email": "example@gmail.com", "status": "success" }]
  }
}`,
		},
		{
			key: "admin-domain-surface",
			sectionId: "admin-api",
			surface: "admin",
			title: m(
				"routeFamilies.adminDomain.title",
				"域名、域名邮箱、门户用户、消息与发信",
				"Domains, domain mailboxes, portal users, messages, and sending",
			),
			auth: m(
				"routeFamilies.adminDomain.auth",
				"管理员 JWT（管理员管理额外要求 SUPER_ADMIN）",
				"Admin JWT (SUPER_ADMIN is additionally required for admin-account management)",
			),
			audience: m(
				"routeFamilies.adminDomain.audience",
				"域名控制台、域名邮箱管理、门户用户管理、域名消息与发信页面",
				"Domain console, domain-mailbox management, portal-user management, domain-message pages, and sending pages",
			),
			description: m(
				"routeFamilies.adminDomain.description",
				"对应 `domain.routes.ts`、`domainMailbox.routes.ts`、`mailboxUser.routes.ts`、`message.routes.ts`、`send.routes.ts`、`dashboard.routes.ts`、`admin.routes.ts`。",
				"Backed by `domain.routes.ts`, `domainMailbox.routes.ts`, `mailboxUser.routes.ts`, `message.routes.ts`, `send.routes.ts`, `dashboard.routes.ts`, and `admin.routes.ts`.",
			),
			operations: [
				{
					method: "GET/POST/PATCH/DELETE",
					path: "/admin/domains*",
					purpose: m(
						"routeFamilies.adminDomain.domains",
						"域名 CRUD、DNS verify、catch-all、sending config、aliases 管理。",
						"Domain CRUD, DNS verification, catch-all, sending-config, and alias management.",
					),
				},
				{
					method: "GET/POST/PATCH/DELETE",
					path: "/admin/domain-mailboxes*",
					purpose: m(
						"routeFamilies.adminDomain.mailboxes",
						"域名邮箱 CRUD、批量创建与批量删除。",
						"Domain-mailbox CRUD, bulk creation, and bulk deletion.",
					),
				},
				{
					method: "GET/POST/PATCH/DELETE",
					path: "/admin/mailbox-users*",
					purpose: m(
						"routeFamilies.adminDomain.mailboxUsers",
						"门户用户 CRUD 与批量绑定邮箱成员关系。",
						"Portal-user CRUD and bulk mailbox-membership binding.",
					),
				},
				{
					method: "GET/DELETE",
					path: "/admin/domain-messages*",
					purpose: m(
						"routeFamilies.adminDomain.messages",
						"查看和删除落库的域名入站消息。",
						"Reads and deletes persisted inbound domain messages.",
					),
				},
				{
					method: "GET/POST/DELETE",
					path: "/admin/send/*",
					purpose: m(
						"routeFamilies.adminDomain.send",
						"查看发送配置、发送消息、删除发送记录。",
						"Reads sending configuration, sends messages, and deletes sending history.",
					),
				},
				{
					method: "GET",
					path: "/admin/forwarding-jobs*",
					purpose: m(
						"routeFamilies.adminDomain.forwardingJobs",
						"查看 forwarding job 列表、状态和详情诊断。",
						"Reads forwarding-job lists, status, and detailed diagnostics.",
					),
				},
				{
					method: "GET/DELETE",
					path: "/admin/dashboard/*",
					purpose: m(
						"routeFamilies.adminDomain.dashboard",
						"统计、趋势、后台日志。",
						"Reads stats, trends, and admin logs.",
					),
				},
				{
					method: "GET/POST/PUT/DELETE",
					path: "/admin/admins*",
					purpose: m(
						"routeFamilies.adminDomain.admins",
						"超级管理员管理管理员账号。",
						"Lets super administrators manage administrator accounts.",
					),
				},
			],
			requestExample: `curl -X POST "${baseUrl}/admin/domains" \
  -b "token=<admin-session-cookie>" \
  -H "Content-Type: application/json" \
  -d '{"name":"example.com","displayName":"Ops Domain","canReceive":true,"canSend":true}'`,
			successResponse: `{
  "success": true,
  "data": {
    "id": 6,
    "name": "example.com",
    "status": "PENDING",
    "verificationToken": "..."
  }
}`,
		},
		{
			key: "mailbox-portal-api",
			sectionId: "portal-api",
			surface: "portal",
			title: m(
				"routeFamilies.portal.title",
				"门户用户会话、收件、已发送与转发",
				"Portal-user sessions, inbox, sent mail, and forwarding",
			),
			auth: m(
				"routeFamilies.portal.auth",
				"mailbox_token Cookie",
				"mailbox_token cookie",
			),
			audience: m(
				"routeFamilies.portal.audience",
				"mail portal 前端、站内邮箱使用者、自助收发信",
				"Mail portal frontend, hosted-mailbox users, and self-service receive/send flows",
			),
			description: m(
				"routeFamilies.portal.description",
				"对应 `mailboxPortal.routes.ts`，是 `/mail/*` 页面真正消费的后端接口。",
				"Backed by `mailboxPortal.routes.ts`, this is the real backend surface consumed by the `/mail/*` pages.",
			),
			operations: [
				{
					method: "POST",
					path: "/mail/api/login",
					purpose: m(
						"routeFamilies.portal.login",
						"门户用户登录并写入 mailbox_token cookie。",
						"Logs a portal user in and writes the mailbox_token cookie.",
					),
				},
				{
					method: "POST",
					path: "/mail/api/logout",
					purpose: m(
						"routeFamilies.portal.logout",
						"门户登出。",
						"Logs the portal user out.",
					),
				},
				{
					method: "GET",
					path: "/mail/api/session",
					purpose: m(
						"routeFamilies.portal.session",
						"读取当前门户用户与可见邮箱。",
						"Reads the current portal user and the visible mailboxes.",
					),
				},
				{
					method: "GET",
					path: "/mail/api/mailboxes",
					purpose: m(
						"routeFamilies.portal.mailboxes",
						"列出门户用户可访问的域名邮箱。",
						"Lists the domain mailboxes that the portal user can access.",
					),
				},
				{
					method: "GET",
					path: "/mail/api/messages",
					purpose: m(
						"routeFamilies.portal.messages",
						"查看入站消息列表，支持 mailboxId / unreadOnly / 分页。",
						"Lists inbound messages and supports mailboxId / unreadOnly / pagination filters.",
					),
				},
				{
					method: "GET",
					path: "/mail/api/messages/:id",
					purpose: m(
						"routeFamilies.portal.messageDetail",
						"查看单封入站消息详情。",
						"Reads the details of one inbound message.",
					),
				},
				{
					method: "GET",
					path: "/mail/api/sent-messages",
					purpose: m(
						"routeFamilies.portal.sentList",
						"查看已发送消息列表。",
						"Lists sent messages.",
					),
				},
				{
					method: "GET",
					path: "/mail/api/sent-messages/:id",
					purpose: m(
						"routeFamilies.portal.sentDetail",
						"查看单封已发送消息详情。",
						"Reads the details of one sent message.",
					),
				},
				{
					method: "POST",
					path: "/mail/api/send",
					purpose: m(
						"routeFamilies.portal.send",
						"以门户用户可访问邮箱发信。",
						"Sends mail through a mailbox the portal user can access.",
					),
				},
				{
					method: "POST",
					path: "/mail/api/change-password",
					purpose: m(
						"routeFamilies.portal.changePassword",
						"门户用户修改密码。",
						"Lets the portal user change their password.",
					),
				},
				{
					method: "POST",
					path: "/mail/api/forwarding",
					purpose: m(
						"routeFamilies.portal.forwarding",
						"更新门户用户的转发设置。",
						"Updates the portal user’s forwarding settings.",
					),
				},
			],
			requestExample: `curl -X POST "${baseUrl}/mail/api/send" \
  -H "Cookie: mailbox_token=<mailbox-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"mailboxId":12,"to":["target@example.com"],"subject":"Portal send","text":"hello from mailbox portal"}'`,
			successResponse: `{
  "success": true,
  "data": {
    "status": "SENT",
    "id": "188",
    "providerMessageId": "re_xxx"
  }
}`,
		},
		{
			key: "ingress-api",
			sectionId: "ingress-api",
			surface: "ingress",
			title: m(
				"routeFamilies.ingress.title",
				"Ingress 入站投递",
				"Ingress inbound delivery",
			),
			auth: m(
				"routeFamilies.ingress.auth",
				"ingress signature",
				"Ingress signature",
			),
			audience: m(
				"routeFamilies.ingress.audience",
				"Cloudflare Worker、邮件网关、内部投递器",
				"Cloudflare workers, mail gateways, and internal deliverers",
			),
			description: m(
				"routeFamilies.ingress.description",
				"对应 `ingress.routes.ts`，只有一个签名保护的 POST 接口，用来把入站邮件写入域名消息系统。",
				"Backed by `ingress.routes.ts`, this surface exposes a single signature-protected POST endpoint that persists inbound mail into the domain-message system.",
			),
			operations: [
				{
					method: "POST",
					path: "/ingress/domain-mail/receive",
					purpose: m(
						"routeFamilies.ingress.receive",
						"接收入站 payload，校验签名后写入 inbound messages。",
						"Accepts the inbound payload, verifies the signature, and writes it into inbound messages.",
					),
				},
			],
			requestExample: `curl -X POST "${baseUrl}/ingress/domain-mail/receive" \
  -H "Content-Type: application/json" \
  -H "x-ingress-key-id: ingress-demo" \
  -H "x-ingress-timestamp: 1774540000" \
  -H "x-ingress-signature: sha256=..." \
  -d '{"domain":"example.com","matchedAddress":"code@example.com","finalAddress":"code@example.com","fromAddress":"noreply@example.com","toAddress":"code@example.com","subject":"Your code","textPreview":"123456"}'`,
			successResponse: `{
  "success": true,
  "data": {
    "accepted": true,
    "messageId": "1024",
    "stored": true
  }
}`,
		},
	];

	const callPlaybooks: CallPlaybook[] = [
		{
			key: "playbook-admin-oauth-email",
			title: m(
				"playbooks.adminOauth.title",
				"管理员配置 OAuth 并创建外部邮箱",
				"Admin configures OAuth and creates an external mailbox",
			),
			audience: m(
				"playbooks.adminOauth.audience",
				"后台管理员 / 运维",
				"Admin / operations",
			),
			summary: m(
				"playbooks.adminOauth.summary",
				"这是外部 Outlook/Gmail OAuth 接入的完整控制面调用链：先存 provider config，再启动授权，再查状态，最后在邮箱列表里看到回写结果。",
				"This is the full control-plane call chain for Outlook/Gmail OAuth onboarding: save the provider config, start the authorization flow, poll status, and finally inspect the mailbox record that gets written back.",
			),
			steps: [
				m(
					"playbooks.adminOauth.step1",
					"调用 /admin/oauth/configs/:provider 保存 clientId / redirectUri / scopes / tenant。",
					"Call /admin/oauth/configs/:provider to save clientId / redirectUri / scopes / tenant.",
				),
				m(
					"playbooks.adminOauth.step2",
					"调用 /admin/oauth/:provider/start 获取授权链接。",
					"Call /admin/oauth/:provider/start to get the authorization URL.",
				),
				m(
					"playbooks.adminOauth.step3",
					"浏览器完成 OAuth 回调后，用 /admin/oauth/:provider/status 轮询结果。",
					"After the browser finishes the OAuth callback, poll /admin/oauth/:provider/status for the result.",
				),
				m(
					"playbooks.adminOauth.step4",
					"最后调用 /admin/emails 或 /admin/emails/:id 查看落库的邮箱记录与 capability。",
					"Finally, call /admin/emails or /admin/emails/:id to inspect the persisted mailbox record and capabilities.",
				),
			],
			curl: `curl -X POST "${baseUrl}/admin/oauth/google/start" \
  -b "token=<admin-session-cookie>" \
  -H "Content-Type: application/json" \
  -d '{"groupId":1}'`,
			response: `{
  "success": true,
  "data": {
    "state": "oauth-state-xxx",
    "authorizationUrl": "https://accounts.google.com/o/oauth2/v2/auth?..."
  }
}`,
		},
		{
			key: "playbook-admin-domain-bootstrap",
			title: m(
				"playbooks.adminDomain.title",
				"管理员创建域名、验证 DNS、批量创建域名邮箱",
				"Admin creates a domain, verifies DNS, and batch-creates domain mailboxes",
			),
			audience: m(
				"playbooks.adminDomain.audience",
				"后台管理员 / 域名运维",
				"Admin / domain operations",
			),
			summary: m(
				"playbooks.adminDomain.summary",
				"这是 hosted_internal 体系的控制面标准流程：域名 → verify → catch-all / sending config → mailbox batch create → mailbox user。",
				"This is the standard hosted_internal control-plane flow: domain → verify → catch-all / sending config → mailbox batch create → mailbox user.",
			),
			steps: [
				m(
					"playbooks.adminDomain.step1",
					"POST /admin/domains 创建域名。",
					"POST /admin/domains creates the domain.",
				),
				m(
					"playbooks.adminDomain.step2",
					"POST /admin/domains/:id/verify 生成和刷新 DNS 验证信息。",
					"POST /admin/domains/:id/verify generates and refreshes the DNS verification details.",
				),
				m(
					"playbooks.adminDomain.step3",
					"POST /admin/domains/:id/sending-config 保存发信配置。",
					"POST /admin/domains/:id/sending-config saves the sending configuration.",
				),
				m(
					"playbooks.adminDomain.step4",
					"POST /admin/domain-mailboxes/batch-create 批量创建 mailbox。",
					"POST /admin/domain-mailboxes/batch-create creates mailboxes in bulk.",
				),
				m(
					"playbooks.adminDomain.step5",
					"POST /admin/mailbox-users/:id/mailboxes/batch-add 绑定门户用户可见邮箱。",
					"POST /admin/mailbox-users/:id/mailboxes/batch-add binds the mailboxes visible to a portal user.",
				),
			],
			curl: `curl -X POST "${baseUrl}/admin/domain-mailboxes/batch-create" \
  -b "token=<admin-session-cookie>" \
  -H "Content-Type: application/json" \
  -d '{"domainId":6,"count":20,"batchTag":"ops-batch-20260327","provisioningMode":"API_POOL"}'`,
			response: `{
  "success": true,
  "data": {
    "created": 20,
    "batchTag": "ops-batch-20260327"
  }
}`,
		},
		{
			key: "playbook-portal-user",
			title: m(
				"playbooks.portal.title",
				"门户用户登录后收件与发信",
				"Portal user logs in, receives mail, and sends mail",
			),
			audience: m(
				"playbooks.portal.audience",
				"mail portal 前端 / 门户用户",
				"Mail portal frontend / portal user",
			),
			summary: m(
				"playbooks.portal.summary",
				"门户用户的典型流是：登录 → session → mailboxes → messages / sent-messages → send / forwarding。",
				"The typical portal-user flow is login → session → mailboxes → messages / sent-messages → send / forwarding.",
			),
			steps: [
				m(
					"playbooks.portal.step1",
					"POST /mail/api/login 写入 mailbox_token cookie。",
					"POST /mail/api/login writes the mailbox_token cookie.",
				),
				m(
					"playbooks.portal.step2",
					"GET /mail/api/session 确认当前门户用户身份。",
					"GET /mail/api/session confirms the current portal-user identity.",
				),
				m(
					"playbooks.portal.step3",
					"GET /mail/api/mailboxes 获取可用 mailbox。",
					"GET /mail/api/mailboxes fetches the available mailboxes.",
				),
				m(
					"playbooks.portal.step4",
					"GET /mail/api/messages?mailboxId=... 查看收件。",
					"GET /mail/api/messages?mailboxId=... reads the inbox.",
				),
				m(
					"playbooks.portal.step5",
					"POST /mail/api/send 发信，或 POST /mail/api/forwarding 更新转发策略。",
					"POST /mail/api/send sends mail, or POST /mail/api/forwarding updates the forwarding policy.",
				),
			],
			curl: `curl -X POST "${baseUrl}/mail/api/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"portal-demo-user","password":"<portal-password>"}'`,
			response: `{
			  "success": true,
			  "data": {
			    "mailboxUser": { "id": 3, "username": "portal-demo-user" }
			  }
			}`,
		},
		{
			key: "playbook-ingress",
			title: m(
				"playbooks.ingress.title",
				"Ingress Worker 推送入站邮件",
				"Ingress worker pushes inbound mail",
			),
			audience: m(
				"playbooks.ingress.audience",
				"Worker / 邮件网关 / 内部接收器",
				"Worker / mail gateway / internal receiver",
			),
			summary: m(
				"playbooks.ingress.summary",
				"这是站内入站链路的调用方式：签名投递到 ingress，再由 ingress service 写入 inbound message。",
				"This is the hosted inbound-delivery path: send the signed request to ingress, and then let the ingress service persist the inbound message.",
			),
			steps: [
				m(
					"playbooks.ingress.step1",
					"构造 request body，并按共享 signing secret 生成 canonical signature。",
					"Build the request body and generate the canonical signature with the shared signing secret.",
				),
				m(
					"playbooks.ingress.step2",
					"POST /ingress/domain-mail/receive，带上 key id / timestamp / signature 头。",
					"POST /ingress/domain-mail/receive with the key id / timestamp / signature headers.",
				),
				m(
					"playbooks.ingress.step3",
					"服务端校验成功后把消息路由到 domain mailbox 与 message store。",
					"After validation succeeds, the server routes the message into the target domain mailbox and message store.",
				),
			],
			curl: `curl -X POST "${baseUrl}/ingress/domain-mail/receive" \
  -H "x-ingress-key-id: ingress-demo" \
  -H "x-ingress-timestamp: 1774540000" \
  -H "x-ingress-signature: sha256=..." \
  -H "Content-Type: application/json" \
  -d '{"domain":"example.com","matchedAddress":"ops@example.com","finalAddress":"ops@example.com","fromAddress":"noreply@example.com","toAddress":"ops@example.com","subject":"Code","textPreview":"123456"}'`,
			response: `{
  "success": true,
  "data": {
    "accepted": true,
    "stored": true
  }
}`,
		},
	];

	const apiEndpoints: ApiSection[] = [
		{
			key: "allocate-external-mailbox",
			name: m(
				"api.allocateExternal.name",
				"分配一个外部邮箱资源",
				"Allocate one external mailbox resource",
			),
			group: "外部连接器接口",
			method: "GET / POST",
			path: "/api/mailboxes/allocate",
			legacyPaths: ["/api/get-email"],
			audience: m(
				"api.allocateExternal.audience",
				"适合先拿一个可用外部邮箱地址的自动化脚本或服务。",
				"Best when your script or service needs a usable external mailbox address first.",
			),
			description: m(
				"api.allocateExternal.description",
				"从 Outlook / Gmail / QQ 外部连接器里分配一个当前访问密钥尚未占用的邮箱资源，可按分组限制来源。",
				"Allocates one external mailbox from Outlook / Gmail / QQ connectors that the current access key has not already used, optionally restricted by group.",
			),
			usageHint: m(
				"api.allocateExternal.usageHint",
				"这是大多数“先拿邮箱、再等邮件”的入口接口。",
				"This is the main entrypoint for flows that first need a mailbox and then wait for mail.",
			),
			params: [
				{
					name: "group",
					type: "string",
					required: false,
					desc: m(
						"api.allocateExternal.params.group",
						"邮箱分组名称。传了以后，只会从这个分组里挑邮箱。",
						"Mailbox group name. When provided, allocation is limited to that group.",
					),
				},
			],
			example: `curl -X POST "${baseUrl}/api/mailboxes/allocate" \
  -H "X-API-Key: sk_your_api_key"`,
			successResponse: `{
  "success": true,
  "data": {
    "email": "example@outlook.com",
    "id": 1
  }
}`,
			errorResponse: `{
  "success": false,
  "error": {
    "code": "NO_UNUSED_EMAIL",
    "message": "No unused emails available. Used: 10/10"
  }
}`,
		},
		{
			key: "external-latest-message",
			name: m(
				"api.externalLatest.name",
				"读取外部邮箱最新邮件",
				"Read the latest external message",
			),
			group: "外部连接器接口",
			method: "GET / POST",
			path: "/api/messages/latest",
			legacyPaths: ["/api/mail_new"],
			audience: m(
				"api.externalLatest.audience",
				"适合已经知道邮箱地址，只想拿最新一封邮件时使用。",
				"Best when you already know the mailbox address and only need the latest message.",
			),
			description: m(
				"api.externalLatest.description",
				"根据指定邮箱地址读取最新一封邮件，返回结构化 JSON。",
				"Reads the latest message for the specified mailbox address and returns structured JSON.",
			),
			usageHint: m(
				"api.externalLatest.usageHint",
				"如果你只想看验证码，而不是整封邮件，优先看 messages/text。",
				"If you only want the verification code instead of the full message, start with messages/text.",
			),
			params: [
				{
					name: "email",
					type: "string",
					required: true,
					desc: m(
						"api.externalLatest.params.email",
						"目标邮箱地址。必须是系统里已经存在的邮箱。",
						"Target mailbox address. It must already exist in the system.",
					),
				},
				{
					name: "mailbox",
					type: "string",
					required: false,
					desc: m(
						"api.externalLatest.params.mailbox",
						"邮箱文件夹，默认 inbox。也可传 sent / junk。",
						"Mailbox folder. Defaults to inbox and also supports sent / junk.",
					),
				},
				{
					name: "socks5",
					type: "string",
					required: false,
					desc: m(
						"api.externalLatest.params.socks5",
						"SOCKS5 代理地址，可选。",
						"Optional SOCKS5 proxy address.",
					),
				},
				{
					name: "http",
					type: "string",
					required: false,
					desc: m(
						"api.externalLatest.params.http",
						"HTTP 代理地址，可选。",
						"Optional HTTP proxy address.",
					),
				},
			],
			example: `curl -X POST "${baseUrl}/api/messages/latest" \
  -H "X-API-Key: sk_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"email":"example@outlook.com"}'`,
			successResponse: `{
  "success": true,
  "data": {
    "email": "example@outlook.com",
    "mailbox": "inbox",
    "count": 1,
    "messages": [
      {
        "id": "AAMk...",
        "subject": "验证码邮件",
        "from": "noreply@example.com",
        "text": "您的验证码是 123456"
      }
    ],
    "method": "graph_api"
  },
  "email": "example@outlook.com"
}`,
			errorResponse: `{
  "success": false,
  "error": {
    "code": "EMAIL_NOT_FOUND",
    "message": "Email account not found"
  }
}`,
		},
		{
			key: "external-message-text",
			name: m(
				"api.externalText.name",
				"提取外部邮箱文本 / 验证码",
				"Extract external-mail text / verification code",
			),
			group: "外部连接器接口",
			method: "GET / POST",
			path: "/api/messages/text",
			legacyPaths: ["/api/mail_text"],
			audience: m(
				"api.externalText.audience",
				"适合自动化脚本、验证码轮询、机器人流程。",
				"Best for automation scripts, verification polling, and bot workflows.",
			),
			description: m(
				"api.externalText.description",
				"返回最新一封邮件的纯文本内容；如果传 match，会尝试直接从文本里提取匹配结果。",
				"Returns the plain text of the latest message. If match is provided, it tries to extract the first matching result directly from that text.",
			),
			usageHint: m(
				"api.externalText.usageHint",
				"想省事拿 6 位验证码，就传 match=\\d{6}。",
				"If you only want a 6-digit code, pass match=\\d{6}.",
			),
			params: [
				{
					name: "email",
					type: "string",
					required: true,
					desc: m(
						"api.externalText.params.email",
						"目标邮箱地址。",
						"Target mailbox address.",
					),
				},
				{
					name: "match",
					type: "string",
					required: false,
					desc: m(
						"api.externalText.params.match",
						"可选正则表达式，例如 \\d{6}。",
						"Optional regex, for example \\d{6}.",
					),
				},
			],
			example: `curl "${baseUrl}/api/messages/text?email=example@outlook.com&match=\\d{6}" \
  -H "X-API-Key: sk_your_api_key"`,
			successResponse: `123456`,
			errorResponse: `Error: No match found`,
		},
		{
			key: "external-messages",
			name: m(
				"api.externalMessages.name",
				"读取外部邮箱邮件列表",
				"List external-mail messages",
			),
			group: "外部连接器接口",
			method: "GET / POST",
			path: "/api/messages",
			legacyPaths: ["/api/mail_all"],
			audience: m(
				"api.externalMessages.audience",
				"适合排查整封历史邮件，而不是只看最新一封时使用。",
				"Best when you need the historical message list instead of only the latest item.",
			),
			description: m(
				"api.externalMessages.description",
				"读取指定邮箱当前文件夹中的邮件列表，返回结构化 JSON。",
				"Reads the message list for the current folder of the specified mailbox and returns structured JSON.",
			),
			usageHint: m(
				"api.externalMessages.usageHint",
				"通常用于排查“为什么最新邮件没命中”这类问题。",
				"Usually used to debug cases where the latest message was not the one you expected.",
			),
			params: [
				{
					name: "email",
					type: "string",
					required: true,
					desc: m(
						"api.externalMessages.params.email",
						"目标邮箱地址。",
						"Target mailbox address.",
					),
				},
				{
					name: "mailbox",
					type: "string",
					required: false,
					desc: m(
						"api.externalMessages.params.mailbox",
						"默认 inbox。",
						"Defaults to inbox.",
					),
				},
				{
					name: "socks5",
					type: "string",
					required: false,
					desc: m(
						"api.externalMessages.params.socks5",
						"SOCKS5 代理地址。",
						"SOCKS5 proxy address.",
					),
				},
				{
					name: "http",
					type: "string",
					required: false,
					desc: m(
						"api.externalMessages.params.http",
						"HTTP 代理地址。",
						"HTTP proxy address.",
					),
				},
			],
			example: `curl "${baseUrl}/api/messages?email=example@outlook.com" \
  -H "X-API-Key: sk_your_api_key"`,
			successResponse: `{
  "success": true,
  "data": {
    "email": "example@outlook.com",
    "mailbox": "inbox",
    "count": 2,
    "messages": [
      { "id": "1", "subject": "邮件1" },
      { "id": "2", "subject": "邮件2" }
    ],
    "method": "imap"
  },
  "email": "example@outlook.com"
}`,
			errorResponse: `{
  "success": false,
  "error": {
    "code": "EMAIL_NOT_FOUND",
    "message": "Email account not found"
  }
}`,
		},
		{
			key: "external-clear-mailbox",
			name: m(
				"api.externalClear.name",
				"清理外部邮箱当前文件夹",
				"Clear the current folder of an external mailbox",
			),
			group: "外部连接器接口",
			method: "GET / POST",
			path: "/api/mailboxes/clear",
			legacyPaths: ["/api/process-mailbox"],
			audience: m(
				"api.externalClear.audience",
				"适合你需要清理邮箱历史、避免旧邮件干扰脚本时使用。",
				"Best when you need to clear mailbox history so old mail does not interfere with your automation.",
			),
			description: m(
				"api.externalClear.description",
				"删除指定邮箱当前文件夹中的邮件，返回删除结果。",
				"Deletes messages in the current folder of the specified mailbox and returns the deletion result.",
			),
			usageHint: m(
				"api.externalClear.usageHint",
				"生产环境谨慎使用，尤其不要直接对 sent 文件夹做清理。",
				"Use carefully in production, especially avoid clearing the sent folder directly.",
			),
			params: [
				{
					name: "email",
					type: "string",
					required: true,
					desc: m(
						"api.externalClear.params.email",
						"目标邮箱地址。",
						"Target mailbox address.",
					),
				},
				{
					name: "mailbox",
					type: "string",
					required: false,
					desc: m(
						"api.externalClear.params.mailbox",
						"默认 inbox。",
						"Defaults to inbox.",
					),
				},
				{
					name: "socks5",
					type: "string",
					required: false,
					desc: m(
						"api.externalClear.params.socks5",
						"SOCKS5 代理地址。",
						"SOCKS5 proxy address.",
					),
				},
				{
					name: "http",
					type: "string",
					required: false,
					desc: m(
						"api.externalClear.params.http",
						"HTTP 代理地址。",
						"HTTP proxy address.",
					),
				},
			],
			example: `curl -X POST "${baseUrl}/api/mailboxes/clear" \
  -H "X-API-Key: sk_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"email":"example@outlook.com"}'`,
			successResponse: `{
  "success": true,
  "data": {
    "email": "example@outlook.com",
    "mailbox": "inbox",
    "status": "success",
    "deletedCount": 5,
    "message": "Successfully deleted 5 messages"
  },
  "email": "example@outlook.com"
}`,
			errorResponse: `{
  "success": false,
  "error": {
    "code": "EMAIL_NOT_FOUND",
    "message": "Email account not found"
  }
}`,
		},
		{
			key: "external-mailboxes",
			name: m(
				"api.externalMailboxes.name",
				"查看当前可访问的外部邮箱列表",
				"List the external mailboxes accessible to the current key",
			),
			group: "外部连接器接口",
			method: "GET / POST",
			path: "/api/mailboxes",
			legacyPaths: ["/api/list-emails"],
			audience: m(
				"api.externalMailboxes.audience",
				"适合运维脚本或调试人员确认访问范围内到底有哪些外部邮箱资源。",
				"Best for ops scripts and debugging sessions that need to confirm which external mailbox resources are actually reachable.",
			),
			description: m(
				"api.externalMailboxes.description",
				"列出当前访问密钥有权限访问的 ACTIVE 外部邮箱。",
				"Lists ACTIVE external mailboxes that the current access key can reach.",
			),
			usageHint: m(
				"api.externalMailboxes.usageHint",
				"如果你不知道邮箱是否存在，先调这个接口。",
				"If you are not sure a mailbox exists, call this endpoint first.",
			),
			params: [
				{
					name: "group",
					type: "string",
					required: false,
					desc: m(
						"api.externalMailboxes.params.group",
						"邮箱分组名称。",
						"Mailbox group name.",
					),
				},
			],
			example: `curl "${baseUrl}/api/mailboxes" \
  -H "X-API-Key: sk_your_api_key"`,
			successResponse: `{
  "success": true,
  "data": {
    "total": 2,
    "emails": [
      { "email": "user1@outlook.com", "provider": "OUTLOOK", "status": "ACTIVE", "group": "default" },
      { "email": "user2@gmail.com", "provider": "GMAIL", "status": "ACTIVE", "group": null }
    ]
  }
}`,
			errorResponse: `{
  "success": false,
  "error": {
    "code": "AUTH_REQUIRED",
    "message": "API Key required"
  }
}`,
		},
		{
			key: "external-allocation-stats",
			name: m(
				"api.externalStats.name",
				"查看外部分配统计",
				"Read external allocation stats",
			),
			group: "外部连接器接口",
			method: "GET / POST",
			path: "/api/mailboxes/allocation-stats",
			legacyPaths: ["/api/pool-stats"],
			audience: m(
				"api.externalStats.audience",
				"适合先判断资源是否够用，再决定是否继续分配。",
				"Best when you need to know whether enough resources remain before allocating anything else.",
			),
			description: m(
				"api.externalStats.description",
				"返回当前访问密钥在外部邮箱资源中的 total / used / remaining。",
				"Returns total / used / remaining counts for the current key within the external-mailbox resource pool.",
			),
			usageHint: m(
				"api.externalStats.usageHint",
				"这是最适合作为健康探测或预检查的业务接口之一。",
				"This is one of the best business endpoints to use as a health probe or precheck.",
			),
			params: [
				{
					name: "group",
					type: "string",
					required: false,
					desc: m(
						"api.externalStats.params.group",
						"按分组统计。",
						"Return stats filtered by group.",
					),
				},
			],
			example: `curl "${baseUrl}/api/mailboxes/allocation-stats" \
  -H "X-API-Key: sk_your_api_key"`,
			successResponse: `{
  "success": true,
  "data": {
    "total": 100,
    "used": 3,
    "remaining": 97
  }
}`,
			errorResponse: `{
  "success": false,
  "error": {
    "code": "AUTH_REQUIRED",
    "message": "API Key required"
  }
}`,
		},
		{
			key: "external-allocation-reset",
			name: m(
				"api.externalReset.name",
				"重置外部分配记录",
				"Reset external allocation history",
			),
			group: "外部连接器接口",
			method: "GET / POST",
			path: "/api/mailboxes/allocation-reset",
			legacyPaths: ["/api/reset-pool"],
			audience: m(
				"api.externalReset.audience",
				"适合测试环境反复复用资源，或脚本演练完之后手动归零。",
				"Best for test environments that repeatedly reuse resources, or for manually resetting a script run after rehearsal.",
			),
			description: m(
				"api.externalReset.description",
				"清空当前访问密钥的邮箱分配历史。不会删除邮箱账号本身。",
				"Clears the mailbox-allocation history for the current access key without deleting the mailbox accounts themselves.",
			),
			usageHint: m(
				"api.externalReset.usageHint",
				"这个动作只重置分配记录，不会删资源对象。",
				"This action only resets allocation history. It does not delete the resource objects.",
			),
			params: [
				{
					name: "group",
					type: "string",
					required: false,
					desc: m(
						"api.externalReset.params.group",
						"只重置指定分组。",
						"Only reset the selected group.",
					),
				},
			],
			example: `curl -X POST "${baseUrl}/api/mailboxes/allocation-reset" \
  -H "X-API-Key: sk_your_api_key"`,
			successResponse: `{
  "success": true,
  "data": {
    "message": "Pool reset successfully"
  }
}`,
			errorResponse: `{
  "success": false,
  "error": {
    "code": "AUTH_REQUIRED",
    "message": "API Key required"
  }
}`,
		},
		{
			key: "allocate-domain-mailbox",
			name: m(
				"api.allocateDomain.name",
				"分配一个域名邮箱资源",
				"Allocate one domain-mailbox resource",
			),
			group: "域名邮箱接口",
			method: "GET / POST",
			path: "/api/domain-mail/mailboxes/allocate",
			legacyPaths: ["/api/domain-mail/get-mailbox"],
			audience: m(
				"api.allocateDomain.audience",
				"适合你已经在 all-Mail 里维护了域名邮箱资源，并且要从 API_POOL 场景里取号。",
				"Best when you already manage domain-mailbox resources in all-Mail and need to pick one from an API_POOL workflow.",
			),
			description: m(
				"api.allocateDomain.description",
				"从域名邮箱资源中分配一个当前访问密钥尚未使用的 API_POOL 邮箱，可按 domainId / domain / batchTag 缩小范围。",
				"Allocates one API_POOL mailbox that the current access key has not used yet, with optional domainId / domain / batchTag narrowing.",
			),
			usageHint: m(
				"api.allocateDomain.usageHint",
				"这是域名邮箱场景里的“先拿邮箱地址”入口。",
				"This is the mailbox-address entrypoint for the domain-mailbox flow.",
			),
			params: [
				{
					name: "domainId",
					type: "number",
					required: false,
					desc: m(
						"api.allocateDomain.params.domainId",
						"按域名 ID 限定范围。",
						"Limit the scope by domain ID.",
					),
				},
				{
					name: "domain",
					type: "string",
					required: false,
					desc: m(
						"api.allocateDomain.params.domain",
						"按域名名称限定范围。",
						"Limit the scope by domain name.",
					),
				},
				{
					name: "batchTag",
					type: "string",
					required: false,
					desc: m(
						"api.allocateDomain.params.batchTag",
						"按批次标签限定范围。",
						"Limit the scope by batch tag.",
					),
				},
			],
			example: `curl -X POST "${baseUrl}/api/domain-mail/mailboxes/allocate" \
  -H "X-API-Key: sk_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"domain":"example.com","batchTag":"ops-batch-20260318"}'`,
			successResponse: `{
  "success": true,
  "data": {
    "id": 12,
    "email": "demo12@example.com",
    "localPart": "demo12",
    "batchTag": "ops-batch-20260318",
    "domainId": 6,
    "domainName": "example.com"
  }
}`,
			errorResponse: `{
  "success": false,
  "error": {
    "code": "NO_UNUSED_DOMAIN_MAILBOX",
    "message": "No unused domain mailboxes available. Used: 10/10"
  }
}`,
		},
		{
			key: "domain-latest-message",
			name: m(
				"api.domainLatest.name",
				"读取域名邮箱最新邮件",
				"Read the latest domain-mailbox message",
			),
			group: "域名邮箱接口",
			method: "GET / POST",
			path: "/api/domain-mail/messages/latest",
			legacyPaths: ["/api/domain-mail/mail_new"],
			audience: m(
				"api.domainLatest.audience",
				"适合已经知道域名邮箱地址，只想拿最新一封入站邮件。",
				"Best when you already know the domain-mailbox address and only need the latest inbound message.",
			),
			description: m(
				"api.domainLatest.description",
				"读取 all-Mail 已落库的 inbound messages 中最新一封邮件。",
				"Reads the latest mail stored in all-Mail’s inbound-message store for the selected domain mailbox.",
			),
			usageHint: m(
				"api.domainLatest.usageHint",
				"如果你只在乎验证码，还是建议优先看 messages/text。",
				"If you only care about the verification code, messages/text is still the better first call.",
			),
			params: [
				{
					name: "email",
					type: "string",
					required: true,
					desc: m(
						"api.domainLatest.params.email",
						"域名邮箱地址，例如 demo12@example.com。",
						"Domain-mailbox address, for example demo12@example.com.",
					),
				},
				{
					name: "limit",
					type: "number",
					required: false,
					desc: m(
						"api.domainLatest.params.limit",
						"当前实现里最新邮件接口实际只取 1 封，一般不用传。",
						"The current latest-message implementation effectively reads one item, so this usually does not need to be passed.",
					),
				},
			],
			example: `curl -X POST "${baseUrl}/api/domain-mail/messages/latest" \
  -H "X-API-Key: sk_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"email":"demo12@example.com"}'`,
			successResponse: `{
  "success": true,
  "data": {
    "email": "demo12@example.com",
    "mailboxId": 12,
    "domainId": 6,
    "domainName": "example.com",
    "count": 1,
    "messages": [
      {
        "id": "101",
        "from": "noreply@example.com",
        "to": "demo12@example.com",
        "subject": "验证码邮件",
        "text": "Your code is 123456",
        "html": "",
        "verificationCode": "123456",
        "routeKind": "DIRECT",
        "date": "2026-03-19T12:00:00.000Z"
      }
    ]
  },
  "email": "demo12@example.com"
}`,
			errorResponse: `{
  "success": false,
  "error": {
    "code": "DOMAIN_MAILBOX_NOT_FOUND",
    "message": "Domain API mailbox not found"
  }
}`,
		},
		{
			key: "domain-messages",
			name: m(
				"api.domainMessages.name",
				"读取域名邮箱邮件列表",
				"List domain-mailbox messages",
			),
			group: "域名邮箱接口",
			method: "GET / POST",
			path: "/api/domain-mail/messages",
			legacyPaths: ["/api/domain-mail/mail_all"],
			audience: m(
				"api.domainMessages.audience",
				"适合排查整批域名邮件历史，而不是只看最新一封。",
				"Best when you need the domain-mailbox history instead of only the latest message.",
			),
			description: m(
				"api.domainMessages.description",
				"读取某个域名邮箱已落库的入站邮件列表，支持 limit。",
				"Reads the persisted inbound-message list for one domain mailbox and supports limit.",
			),
			usageHint: m(
				"api.domainMessages.usageHint",
				"这是域名邮箱版的消息列表接口。",
				"This is the message-list endpoint for the domain-mailbox surface.",
			),
			params: [
				{
					name: "email",
					type: "string",
					required: true,
					desc: m(
						"api.domainMessages.params.email",
						"域名邮箱地址。",
						"Domain-mailbox address.",
					),
				},
				{
					name: "limit",
					type: "number",
					required: false,
					desc: m(
						"api.domainMessages.params.limit",
						"最多返回 100 条，默认 20 条。",
						"Returns up to 100 items, with 20 items by default.",
					),
				},
			],
			example: `curl -X POST "${baseUrl}/api/domain-mail/messages" \
  -H "X-API-Key: sk_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"email":"demo12@example.com","limit":5}'`,
			successResponse: `{
  "success": true,
  "data": {
    "email": "demo12@example.com",
    "mailboxId": 12,
    "domainId": 6,
    "domainName": "example.com",
    "count": 2,
    "messages": [
      { "id": "101", "subject": "验证码邮件", "text": "Your code is 123456" },
      { "id": "100", "subject": "欢迎邮件", "text": "Welcome" }
    ]
  },
  "email": "demo12@example.com"
}`,
			errorResponse: `{
  "success": false,
  "error": {
    "code": "DOMAIN_MAILBOX_NOT_FOUND",
    "message": "Domain API mailbox not found"
  }
}`,
		},
		{
			key: "domain-message-text",
			name: m(
				"api.domainText.name",
				"提取域名邮箱文本 / 验证码",
				"Extract domain-mailbox text / verification code",
			),
			group: "域名邮箱接口",
			method: "GET / POST",
			path: "/api/domain-mail/messages/text",
			legacyPaths: ["/api/domain-mail/mail_text"],
			audience: m(
				"api.domainText.audience",
				"适合域名邮箱验证码读取和自动化脚本。",
				"Best for domain-mailbox verification-code reads and automation scripts.",
			),
			description: m(
				"api.domainText.description",
				"从最新一封域名邮箱邮件里提取纯文本；支持用 match 正则直接抽取验证码。",
				"Extracts the plain text from the latest domain-mailbox message and supports match regex extraction for verification codes.",
			),
			usageHint: m(
				"api.domainText.usageHint",
				"如果你只要验证码，这是域名邮箱场景里最推荐的接口。",
				"If you only want the verification code, this is the most recommended domain-mailbox endpoint.",
			),
			params: [
				{
					name: "email",
					type: "string",
					required: true,
					desc: m(
						"api.domainText.params.email",
						"域名邮箱地址。",
						"Domain-mailbox address.",
					),
				},
				{
					name: "match",
					type: "string",
					required: false,
					desc: m(
						"api.domainText.params.match",
						"可选正则表达式。",
						"Optional regex.",
					),
				},
			],
			example: `curl "${baseUrl}/api/domain-mail/messages/text?email=demo12@example.com&match=\\d{6}" \
  -H "X-API-Key: sk_your_api_key"`,
			successResponse: `123456`,
			errorResponse: `Error: No match found`,
		},
		{
			key: "domain-mailboxes",
			name: m(
				"api.domainMailboxes.name",
				"查看当前可访问的域名邮箱列表",
				"List the domain mailboxes accessible to the current key",
			),
			group: "域名邮箱接口",
			method: "GET / POST",
			path: "/api/domain-mail/mailboxes",
			legacyPaths: ["/api/domain-mail/list-mailboxes"],
			audience: m(
				"api.domainMailboxes.audience",
				"适合调试域名邮箱资源、看某个批次还有哪些邮箱能分。",
				"Best for debugging domain-mailbox resources and checking which batch resources remain allocatable.",
			),
			description: m(
				"api.domainMailboxes.description",
				"列出当前访问密钥可访问的 API_POOL 域名邮箱，并返回是否已被当前访问密钥使用。",
				"Lists API_POOL domain mailboxes accessible to the current access key and indicates whether the key has already used them.",
			),
			usageHint: m(
				"api.domainMailboxes.usageHint",
				"如果你不确定资源里有哪些邮箱，这个接口最好先跑一遍。",
				"If you are not sure which mailboxes exist in the resource pool, start with this endpoint.",
			),
			params: [
				{
					name: "domainId",
					type: "number",
					required: false,
					desc: m(
						"api.domainMailboxes.params.domainId",
						"按域名 ID 筛选。",
						"Filter by domain ID.",
					),
				},
				{
					name: "domain",
					type: "string",
					required: false,
					desc: m(
						"api.domainMailboxes.params.domain",
						"按域名名称筛选。",
						"Filter by domain name.",
					),
				},
				{
					name: "batchTag",
					type: "string",
					required: false,
					desc: m(
						"api.domainMailboxes.params.batchTag",
						"按批次标签筛选。",
						"Filter by batch tag.",
					),
				},
			],
			example: `curl "${baseUrl}/api/domain-mail/mailboxes?domain=example.com" \
  -H "X-API-Key: sk_your_api_key"`,
			successResponse: `{
  "success": true,
  "data": {
    "total": 2,
    "mailboxes": [
      {
        "id": 12,
        "email": "demo12@example.com",
        "localPart": "demo12",
        "batchTag": "ops-batch-20260318",
        "used": true,
        "domainId": 6,
        "domainName": "example.com"
      }
    ]
  }
}`,
			errorResponse: `{
  "success": false,
  "error": {
    "code": "DOMAIN_FORBIDDEN",
    "message": "This API Key cannot access the selected domain"
  }
}`,
		},
		{
			key: "domain-allocation-stats",
			name: m(
				"api.domainStats.name",
				"查看域名邮箱分配统计",
				"Read domain-mailbox allocation stats",
			),
			group: "域名邮箱接口",
			method: "GET / POST",
			path: "/api/domain-mail/mailboxes/allocation-stats",
			legacyPaths: ["/api/domain-mail/pool-stats"],
			audience: m(
				"api.domainStats.audience",
				"适合先判断域名邮箱剩余量，再决定要不要继续分配。",
				"Best when you need to see remaining domain-mailbox capacity before deciding whether to allocate more.",
			),
			description: m(
				"api.domainStats.description",
				"返回当前访问密钥在域名邮箱资源中的 total / used / remaining。",
				"Returns total / used / remaining counts for the current key inside the domain-mailbox resource pool.",
			),
			usageHint: m(
				"api.domainStats.usageHint",
				"域名邮箱版的健康探测接口。",
				"The health-check style endpoint for domain-mailbox allocation.",
			),
			params: [
				{
					name: "domainId",
					type: "number",
					required: false,
					desc: m(
						"api.domainStats.params.domainId",
						"按域名 ID 统计。",
						"Return stats filtered by domain ID.",
					),
				},
				{
					name: "domain",
					type: "string",
					required: false,
					desc: m(
						"api.domainStats.params.domain",
						"按域名名统计。",
						"Return stats filtered by domain name.",
					),
				},
				{
					name: "batchTag",
					type: "string",
					required: false,
					desc: m(
						"api.domainStats.params.batchTag",
						"按批次统计。",
						"Return stats filtered by batch tag.",
					),
				},
			],
			example: `curl "${baseUrl}/api/domain-mail/mailboxes/allocation-stats?domain=example.com" \
  -H "X-API-Key: sk_your_api_key"`,
			successResponse: `{
  "success": true,
  "data": {
    "total": 50,
    "used": 12,
    "remaining": 38
  }
}`,
			errorResponse: `{
  "success": false,
  "error": {
    "code": "AUTH_REQUIRED",
    "message": "API Key required"
  }
}`,
		},
		{
			key: "domain-allocation-reset",
			name: m(
				"api.domainReset.name",
				"重置域名邮箱分配记录",
				"Reset domain-mailbox allocation history",
			),
			group: "域名邮箱接口",
			method: "GET / POST",
			path: "/api/domain-mail/mailboxes/allocation-reset",
			legacyPaths: ["/api/domain-mail/reset-pool"],
			audience: m(
				"api.domainReset.audience",
				"适合测试或重复演练场景，需要重新把当前访问密钥的域名邮箱占用归零。",
				"Best for test or repeated rehearsal flows that need to zero out domain-mailbox usage for the current access key.",
			),
			description: m(
				"api.domainReset.description",
				"删除当前访问密钥对这些域名邮箱的使用记录，不会删除邮箱本身。",
				"Deletes the current access key’s usage history for these domain mailboxes without deleting the mailbox resources themselves.",
			),
			usageHint: m(
				"api.domainReset.usageHint",
				"和外部连接的 allocation-reset 语义一致，只是对象换成域名邮箱资源。",
				"This matches the semantics of the external allocation-reset endpoint, but the target resource is the domain-mailbox pool.",
			),
			params: [
				{
					name: "domainId",
					type: "number",
					required: false,
					desc: m(
						"api.domainReset.params.domainId",
						"按域名 ID 重置。",
						"Reset by domain ID.",
					),
				},
				{
					name: "domain",
					type: "string",
					required: false,
					desc: m(
						"api.domainReset.params.domain",
						"按域名名重置。",
						"Reset by domain name.",
					),
				},
				{
					name: "batchTag",
					type: "string",
					required: false,
					desc: m(
						"api.domainReset.params.batchTag",
						"按批次标签重置。",
						"Reset by batch tag.",
					),
				},
			],
			example: `curl -X POST "${baseUrl}/api/domain-mail/mailboxes/allocation-reset" \
  -H "X-API-Key: sk_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"domain":"example.com","batchTag":"ops-batch-20260318"}'`,
			successResponse: `{
  "success": true,
  "data": {
    "success": true,
    "deletedCount": 12
  }
}`,
			errorResponse: `{
  "success": false,
  "error": {
    "code": "DOMAIN_FORBIDDEN",
    "message": "This API Key cannot access the selected domain"
  }
}`,
		},
	];

	const groupedApis = [
		{
			key: "external",
			title: m(
				"groups.external.title",
				"外部连接器接口（OAuth API / IMAP / SMTP）",
				"External-connector APIs (OAuth API / IMAP / SMTP)",
			),
			description: m(
				"groups.external.description",
				"面向外部邮箱连接器与自动化调用，覆盖 Outlook、Gmail 以及当前 registry 中的 QQ / 163 / 126 / iCloud / Yahoo / Zoho / 阿里邮箱等 IMAP / SMTP profile。",
				"Covers external-mailbox connectors and automation calls, including Outlook, Gmail, and the IMAP / SMTP-style profiles currently modeled in the registry such as QQ / 163 / 126 / iCloud / Yahoo / Zoho / Aliyun Mail.",
			),
			items: apiEndpoints.filter((item) => item.group === "外部连接器接口"),
		},
		{
			key: "domain",
			title: m(
				"groups.domain.title",
				"域名邮箱接口（all-Mail 自管域名邮箱）",
				"Domain-mail APIs (all-Mail-managed domain mailboxes)",
			),
			description: m(
				"groups.domain.description",
				"面向 all-Mail 自己管理的域名邮箱、批次与入站消息，适合统一管理自有域名和消息落库。",
				"Covers all-Mail-managed domain mailboxes, batches, and inbound messages, which is ideal for managing your own domains and persisted mail flows in one place.",
			),
			items: apiEndpoints.filter((item) => item.group === "域名邮箱接口"),
		},
	];

	const logActionRows = LOG_ACTION_OPTIONS.map((item) => ({
		action: item.value,
		label: t(item.label),
	}));

	const routeFamilyGroups = [
		{
			key: "admin",
			sectionId: "admin-api",
			title: m(
				"routeGroup.admin.title",
				"管理员控制面 API",
				"Admin control-plane APIs",
			),
			description: m(
				"routeGroup.admin.description",
				"后台页面自己调用的 JWT 保护接口，覆盖认证、邮箱、域名、门户用户、发信、日志与统计。",
				"JWT-protected endpoints consumed by the admin frontend itself, covering auth, mailboxes, domains, portal users, sending, logs, and stats.",
			),
			items: routeFamilies.filter((item) => item.surface === "admin"),
		},
		{
			key: "portal",
			sectionId: "portal-api",
			title: m("routeGroup.portal.title", "门户用户 API", "Portal-user APIs"),
			description: m(
				"routeGroup.portal.description",
				"mail portal 使用的 mailbox session 接口，适合收件、已发送和站内发信场景。",
				"Mailbox-session endpoints used by the mail portal, covering inbox, sent-mail, and hosted-send flows.",
			),
			items: routeFamilies.filter((item) => item.surface === "portal"),
		},
		{
			key: "ingress",
			sectionId: "ingress-api",
			title: m(
				"routeGroup.ingress.title",
				"Ingress / 内部投递 API",
				"Ingress / internal-delivery API",
			),
			description: m(
				"routeGroup.ingress.description",
				"站内邮件入站接收面，供 Worker / 网关把原始投递写入 all-Mail。",
				"The hosted inbound-receive surface used by workers and gateways to write raw deliveries into all-Mail.",
			),
			items: routeFamilies.filter((item) => item.surface === "ingress"),
		},
	];

	return (
		<div>
			<PageHeader
				title={t(apiDocsPageI18n.pageTitle)}
				subtitle={t(apiDocsPageI18n.pageSubtitle)}
				extra={
					<Button type="primary" icon={<ApiOutlined />} href="#quick-start">
						{t(apiDocsPageI18n.startHere)}
					</Button>
				}
			/>

			<Row gutter={24} align="top">
				<Col xs={24} xl={18}>
					<div id="quick-start">
						<SurfaceCard style={docsStyles.marginBottom24}>
							<Space
								orientation="vertical"
								size={16}
								style={docsStyles.fullWidth}
							>
								<Space>
									<Tag color="blue">{t(apiDocsPageI18n.newNaming)}</Tag>
									<Tag color="purple">
										{t(apiDocsPageI18n.compatibilityAlias)}
									</Tag>
									<Tag color="green">{t(apiDocsPageI18n.realRoute)}</Tag>
									<Tag color="gold">{t(apiDocsPageI18n.fullSurface)}</Tag>
								</Space>
								<Title level={4} style={docsStyles.titleNoMargin}>
									{t(apiDocsPageI18n.oneSentenceTitle)}
								</Title>
								<Paragraph style={noMarginBottomStyle}>
									{t(apiDocsPageI18n.oneSentenceLead)}
								</Paragraph>
								<Alert
									type="info"
									showIcon
									title={t(apiDocsPageI18n.criticalDifferenceTitle)}
									description={
										<div>
											<p style={marginBottom8Style}>
												<Text strong>
													{t(apiDocsPageI18n.externalConnectorLead)}
												</Text>
												{t(apiDocsPageI18n.externalConnectorDescription)}
											</p>
											<p style={marginBottom8Style}>
												<Text strong>
													{t(apiDocsPageI18n.domainSurfaceLead)}
												</Text>
												{t(apiDocsPageI18n.domainSurfaceDescription)}
											</p>
											<p style={marginBottom8Style}>
												<Text strong>
													{t(apiDocsPageI18n.adminSurfaceLead)}
												</Text>
												{t(apiDocsPageI18n.adminSurfaceDescription)}
											</p>
											<p style={noMarginBottomStyle}>
												<Text strong>
													{t(apiDocsPageI18n.portalIngressLead)}
												</Text>
												{t(apiDocsPageI18n.portalIngressDescription)}
											</p>
										</div>
									}
								/>
							</Space>
						</SurfaceCard>
					</div>

					<div id="surface-map">
						<SurfaceCard
							title={t(apiDocsPageI18n.platformSurfaceTitle)}
							style={docsStyles.marginBottom24}
						>
							<Row gutter={[16, 16]}>
								{surfaceCards.map((surface) => (
									<Col xs={24} md={12} key={surface.key}>
										<Card
											size="small"
											title={t(surface.title)}
											extra={<Tag color="processing">{t(surface.status)}</Tag>}
										>
											<Space
												orientation="vertical"
												size={8}
												style={docsStyles.fullWidth}
											>
												<Text type="secondary">{t(surface.description)}</Text>
												<div>
													<Text strong>{t(apiDocsPageI18n.authLabel)}</Text>{" "}
													{t(surface.auth)}
												</div>
												<div>
													<Text strong>{t(apiDocsPageI18n.audienceLabel)}</Text>{" "}
													{t(surface.audience)}
												</div>
												<Space wrap>
													{surface.prefixes.map((prefix) => (
														<Text key={prefix} code>
															{prefix}
														</Text>
													))}
												</Space>
											</Space>
										</Card>
									</Col>
								))}
							</Row>
						</SurfaceCard>
					</div>

					<SurfaceCard
						title={t(apiDocsPageI18n.quickStartTitle)}
						style={docsStyles.marginBottom24}
					>
						<Steps
							direction="vertical"
							current={-1}
							items={gettingStartedSteps.map((step) => ({
								title: t(step.title),
								description: t(step.description),
							}))}
						/>
					</SurfaceCard>

					<SurfaceCard
						title={t(apiDocsPageI18n.scenarioTitle)}
						style={docsStyles.marginBottom24}
					>
						<Row gutter={[16, 16]}>
							{integrationScenarios.map((scenario) => (
								<Col xs={24} lg={12} key={t(scenario.title)}>
									<Card size="small" title={t(scenario.title)}>
										<ol style={docsStyles.orderedList}>
											{scenario.steps.map((step) => (
												<li key={t(step)} style={docsStyles.listItemGap}>
													{t(step)}
												</li>
											))}
										</ol>
									</Card>
								</Col>
							))}
						</Row>
					</SurfaceCard>

					<SurfaceCard
						title={t(apiDocsPageI18n.playbookTitle)}
						style={docsStyles.marginBottom24}
					>
						<Row gutter={[16, 16]}>
							{callPlaybooks.map((playbook) => (
								<Col xs={24} key={playbook.key}>
									<Card size="small" title={t(playbook.title)}>
										<Space
											orientation="vertical"
											size={12}
											style={docsStyles.fullWidth}
										>
											<Alert
												type="info"
												showIcon
												title={t(playbook.audience)}
												description={t(playbook.summary)}
											/>
											<ol style={docsStyles.orderedList}>
												{playbook.steps.map((step) => (
													<li key={t(step)} style={docsStyles.listItemGap}>
														{t(step)}
													</li>
												))}
											</ol>
											<Row gutter={16}>
												<Col xs={24} lg={12}>
													<Title level={5}>
														{t(apiDocsPageI18n.callExampleTitle)}
													</Title>
													<SurfaceCard
														size="small"
														style={docsStyles.codeCardMuted}
													>
														<Text code style={codeBlockStyle}>
															{t(playbook.curl)}
														</Text>
													</SurfaceCard>
												</Col>
												<Col xs={24} lg={12}>
													<Title level={5}>
														{t(apiDocsPageI18n.responseExampleTitle)}
													</Title>
													<SurfaceCard
														size="small"
														style={docsStyles.codeCardSuccess}
													>
														<Text code style={codeBlockStyle}>
															{t(playbook.response)}
														</Text>
													</SurfaceCard>
												</Col>
											</Row>
										</Space>
									</Card>
								</Col>
							))}
						</Row>
					</SurfaceCard>

					<SurfaceCard
						title={t(apiDocsPageI18n.authSectionTitle)}
						style={docsStyles.marginBottom24}
					>
						<Alert
							type="warning"
							showIcon
							icon={<KeyOutlined />}
							title={t(apiDocsPageI18n.allExternalApisNeedKey)}
							description={t(apiDocsPageI18n.accessKeyReminder)}
							style={marginBottom16Style}
						/>
						<Table
							rowKey="method"
							pagination={false}
							size="small"
							dataSource={authMethods}
							columns={[
								{
									title: t(apiDocsPageI18n.methodColumn),
									dataIndex: "method",
									key: "method",
									render: (value: TranslationInput) => t(value),
								},
								{
									title: t(apiDocsPageI18n.exampleColumn),
									dataIndex: "example",
									key: "example",
									render: (text) => (
										<Text code copyable>
											{text}
										</Text>
									),
								},
								{
									title: t(apiDocsPageI18n.whenToUseColumn),
									dataIndex: "description",
									key: "description",
									render: (value: TranslationInput) => t(value),
								},
							]}
						/>
					</SurfaceCard>

					<SurfaceCard
						title={t(apiDocsPageI18n.publicApiTitle)}
						style={docsStyles.marginBottom24}
					>
						<Space
							orientation="vertical"
							size={24}
							style={docsStyles.fullWidth}
						>
							{groupedApis.map((group) => (
								<div
									key={group.key}
									id={group.key === "external" ? "external-api" : "domain-api"}
								>
									<Title level={4}>{t(group.title)}</Title>
									<Paragraph type="secondary">{t(group.description)}</Paragraph>
									<Collapse
										items={group.items.map((api) => ({
											key: api.key,
											label: (
												<Space wrap>
													<Tag color="blue">{api.method}</Tag>
													<span>{t(api.name)}</span>
													<Text code>{api.path}</Text>
												</Space>
											),
											children: (
												<Space
													orientation="vertical"
													size={16}
													style={docsStyles.fullWidth}
												>
													<Alert
														type="info"
														showIcon
														title={t(api.audience)}
														description={t(api.description)}
													/>
													<Alert
														type="success"
														showIcon
														icon={<CheckCircleOutlined />}
														title={t(apiDocsPageI18n.bestFitTitle)}
														description={t(api.usageHint)}
													/>
													{api.legacyPaths && api.legacyPaths.length > 0 ? (
														<Alert
															type="warning"
															showIcon
															icon={<WarningOutlined />}
															title={t(
																apiDocsPageI18n.legacyAliasStillAvailable,
															)}
															description={
																<Space wrap>
																	{api.legacyPaths.map((legacyPath) => (
																		<Text key={legacyPath} code>
																			{legacyPath}
																		</Text>
																	))}
																</Space>
															}
														/>
													) : null}

													<div>
														<Title level={5}>
															{t(apiDocsPageI18n.requestUrlTitle)}
														</Title>
														<Paragraph>
															<Text code copyable>
																{baseUrl}
																{api.path}
															</Text>
														</Paragraph>
													</div>

													<div>
														<Title level={5}>
															{t(apiDocsPageI18n.requestParamsTitle)}
														</Title>
														<Table
															rowKey="name"
															pagination={false}
															size="small"
															columns={paramColumns}
															dataSource={api.params}
														/>
													</div>

													<div>
														<Title level={5}>
															{t(apiDocsPageI18n.curlExampleTitle)}
														</Title>
														<SurfaceCard
															size="small"
															style={docsStyles.codeCardMuted}
														>
															<Text code style={codeBlockStyle}>
																{t(api.example)}
															</Text>
														</SurfaceCard>
													</div>

													<Row gutter={16}>
														<Col xs={24} lg={12}>
															<Title level={5} style={docsStyles.successText}>
																{t(apiDocsPageI18n.successResponseTitle)}
															</Title>
															<SurfaceCard
																size="small"
																style={docsStyles.codeCardSuccess}
															>
																<Text code style={codeBlockCompactStyle}>
																	{t(api.successResponse)}
																</Text>
															</SurfaceCard>
														</Col>
														<Col xs={24} lg={12}>
															<Title level={5} style={docsStyles.errorText}>
																{t(apiDocsPageI18n.errorResponseTitle)}
															</Title>
															<SurfaceCard
																size="small"
																style={docsStyles.codeCardError}
															>
																<Text code style={codeBlockCompactStyle}>
																	{t(api.errorResponse)}
																</Text>
															</SurfaceCard>
														</Col>
													</Row>
												</Space>
											),
										}))}
									/>
								</div>
							))}
						</Space>
					</SurfaceCard>

					<SurfaceCard
						title={t(apiDocsPageI18n.controlPlaneTitle)}
						style={docsStyles.marginBottom24}
					>
						<Space
							orientation="vertical"
							size={24}
							style={docsStyles.fullWidth}
						>
							{routeFamilyGroups.map((group) => (
								<div key={group.key} id={group.sectionId}>
									<Title level={4}>{t(group.title)}</Title>
									<Paragraph type="secondary">{t(group.description)}</Paragraph>
									<Collapse
										items={group.items.map((item) => ({
											key: item.key,
											label: (
												<Space wrap>
													<Tag
														color={
															item.surface === "admin"
																? "blue"
																: item.surface === "portal"
																	? "purple"
																	: "gold"
														}
													>
														{t(item.auth)}
													</Tag>
													<span>{t(item.title)}</span>
												</Space>
											),
											children: (
												<Space
													orientation="vertical"
													size={16}
													style={docsStyles.fullWidth}
												>
													<Alert
														type="info"
														showIcon
														title={t(item.audience)}
														description={t(item.description)}
													/>
													<div>
														<Title level={5}>
															{t(apiDocsPageI18n.operationMatrixTitle)}
														</Title>
														<Table
															rowKey="path"
															pagination={false}
															size="small"
															columns={operationColumns}
															dataSource={item.operations}
														/>
													</div>
													{item.requestExample ? (
														<div>
															<Title level={5}>
																{t(apiDocsPageI18n.requestExampleTitle)}
															</Title>
															<SurfaceCard
																size="small"
																style={docsStyles.codeCardMuted}
															>
																<Text code style={codeBlockStyle}>
																	{t(item.requestExample)}
																</Text>
															</SurfaceCard>
														</div>
													) : null}
													{item.successResponse ? (
														<div>
															<Title level={5}>
																{t(apiDocsPageI18n.successResponseTitle)}
															</Title>
															<SurfaceCard
																size="small"
																style={docsStyles.codeCardSuccess}
															>
																<Text code style={codeBlockStyle}>
																	{t(item.successResponse)}
																</Text>
															</SurfaceCard>
														</div>
													) : null}
												</Space>
											),
										}))}
									/>
								</div>
							))}
						</Space>
					</SurfaceCard>

					<SurfaceCard
						title={t(apiDocsPageI18n.troubleshootingTitle)}
						style={docsStyles.marginBottom24}
					>
					<Space orientation="vertical" size={12} style={docsStyles.fullWidth}>
						{commonErrors.map((item) => (
							<div key={item.code}>
								<Space
									orientation="vertical"
									size={4}
									style={docsStyles.fullWidth}
								>
									<Space wrap>
										<Tag color="red">{item.code}</Tag>
										<Text strong>{t(item.reason)}</Text>
									</Space>
									<Text type="secondary">
										{t(apiDocsPageI18n.troubleshootingPrefix)}
										{t(item.suggestion)}
									</Text>
								</Space>
							</div>
						))}
					</Space>
					</SurfaceCard>

					<SurfaceCard
						title={t(apiDocsPageI18n.logActionsTitle)}
						style={docsStyles.marginBottom24}
					>
						<Space
							orientation="vertical"
							size={16}
							style={docsStyles.fullWidth}
						>
							<Alert
								type="warning"
								showIcon
								icon={<WarningOutlined />}
								title={t(apiDocsPageI18n.internalSurfacesAudienceWarningTitle)}
								description={t(
									apiDocsPageI18n.internalSurfacesAudienceWarningBody,
								)}
							/>
							<Paragraph style={noMarginBottomStyle}>
								{t(apiDocsPageI18n.adminMayAlsoTouch)}
								<Text code> /admin/api-keys </Text>
								<Text code> /admin/emails </Text>
								<Text code> /admin/domains </Text>
								<Text code> /admin/domain-mailboxes </Text>
								<Text code> /admin/send </Text>{" "}
								{t(
									m(
										"portalOwnLead",
										"以及门户自己的",
										"as well as the portal-specific",
									),
								)}
								<Text code> /mail/api/* </Text>
								{t(apiDocsPageI18n.internalCapabilityNote)}
							</Paragraph>
							<Table
								rowKey="action"
								size="small"
								pagination={false}
								dataSource={logActionRows}
								columns={[
									{
										title: t(apiDocsPageI18n.logActionColumn),
										dataIndex: "action",
										key: "action",
										render: (text) => <Text code>{text}</Text>,
									},
									{
										title: t(apiDocsPageI18n.logMeaningColumn),
										dataIndex: "label",
										key: "label",
									},
								]}
							/>
						</Space>
					</SurfaceCard>
				</Col>

				<Col xs={24} xl={6}>
					<SurfaceCard
						title={t(apiDocsPageI18n.quickNavigationTitle)}
						style={docsStyles.stickyTop24}
					>
						<Anchor
							items={[
								{
									key: "quick-start",
									href: "#quick-start",
									title: t(apiDocsPageI18n.readThisPageFirst),
								},
								{
									key: "surface-map",
									href: "#surface-map",
									title: t(apiDocsPageI18n.platformSurfaceTitle),
								},
								{
									key: "external-api",
									href: "#external-api",
									title: t(
										m(
											"anchor.external",
											"外部连接器接口",
											"External-connector APIs",
										),
									),
								},
								{
									key: "domain-api",
									href: "#domain-api",
									title: t(
										m("anchor.domain", "域名邮箱接口", "Domain-mail APIs"),
									),
								},
								{
									key: "admin-api",
									href: "#admin-api",
									title: t(
										m(
											"anchor.admin",
											"管理员控制面 API",
											"Admin control-plane APIs",
										),
									),
								},
								{
									key: "portal-api",
									href: "#portal-api",
									title: t(
										m("anchor.portal", "门户用户 API", "Portal-user APIs"),
									),
								},
								{
									key: "ingress-api",
									href: "#ingress-api",
									title: t(
										m(
											"anchor.ingress",
											"Ingress 内部投递",
											"Ingress internal delivery",
										),
									),
								},
							]}
						/>
						<Divider />
						<Space
							orientation="vertical"
							size={12}
							style={docsStyles.fullWidth}
						>
							<Alert
								type="success"
								showIcon
								icon={<ThunderboltOutlined />}
								title={t(apiDocsPageI18n.fastestTestOrderTitle)}
								description={
									<div>
										<div>
											{t(
												m(
													"fastestOrder.step1",
													"1. 先调 /api/mailboxes/allocation-stats",
													"1. Start with /api/mailboxes/allocation-stats",
												),
											)}
										</div>
										<div>
											{t(
												m(
													"fastestOrder.step2",
													"2. 再调 /api/mailboxes/allocate",
													"2. Then call /api/mailboxes/allocate",
												),
											)}
										</div>
										<div>
											{t(
												m(
													"fastestOrder.step3",
													"3. 最后调 /api/messages/text",
													"3. Finish with /api/messages/text",
												),
											)}
										</div>
									</div>
								}
							/>
							<Alert
								type="info"
								showIcon
								icon={<MailOutlined />}
								title={t(apiDocsPageI18n.domainAutomationTitle)}
								description={t(apiDocsPageI18n.domainAutomationBody)}
							/>
							<Alert
								type="warning"
								showIcon
								icon={<SafetyCertificateOutlined />}
								title={t(apiDocsPageI18n.productionReminderTitle)}
								description={t(apiDocsPageI18n.productionReminderBody)}
							/>
							<Alert
								type="info"
								showIcon
								icon={<CodeOutlined />}
								title={t(apiDocsPageI18n.healthCheckTitle)}
								description={<Text code copyable>{`${baseUrl}/health`}</Text>}
							/>
						</Space>
					</SurfaceCard>
				</Col>
			</Row>

			<Divider />

			<SurfaceCard
				title={t(apiDocsPageI18n.beginnerFaqTitle)}
				style={docsStyles.marginBottom24}
			>
				<Collapse
					items={beginnerFaq.map((item) => ({
						key: t(item.question),
						label: t(item.question),
						children: (
							<Paragraph style={noMarginBottomStyle}>
								{t(item.answer)}
							</Paragraph>
						),
					}))}
				/>
			</SurfaceCard>
		</div>
	);
};

export default ApiDocsPage;
