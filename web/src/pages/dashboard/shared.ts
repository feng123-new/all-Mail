import type { CSSProperties } from "react";
import type { EmailProvider } from "../../constants/providers";
import { defineMessage } from "../../i18n/messages";
import {
	centeredPadding24Style,
	centeredPadding56MinHeight300Style,
	centeredPadding56Style,
	flexBetweenFullWidthStyle,
	fullWidthStyle,
	noMarginStyle,
} from "../../styles/common";
import { contentCardStyle, insetCardStyle, shellPalette } from "../../theme";

export interface Stats {
	apiKeys: {
		total: number;
		active: number;
		totalUsage: number;
		todayActive: number;
	};
	domainMail: {
		domains: number;
		activeDomains: number;
		mailboxes: number;
		activeMailboxes: number;
		inboundMessages: number;
		outboundMessages: number;
	};
}

export interface EmailStats {
	total: number;
	active: number;
	error: number;
	providers: Partial<Record<EmailProvider, number>>;
}

export interface ApiTrendItem {
	date: string;
	count: number;
}

export interface LogItem {
	id: number;
	action: string;
	apiKeyName?: string | null;
	email?: string | null;
	requestIp?: string | null;
	responseCode?: number | null;
	responseTimeMs?: number | null;
	requestId?: string | null;
	createdAt: string;
}

export interface ErrorEmailItem {
	id: number;
	email: string;
	provider: EmailProvider;
	status: "ACTIVE" | "ERROR" | "DISABLED";
	errorMessage?: string | null;
	lastCheckAt?: string | null;
}

export type TrendWindow = 7 | 14 | 30;

export const dashboardPageI18n = {
	pageTitle: defineMessage("dashboard.page.title", "控制台概览", "Overview"),
	pageSubtitle: defineMessage(
		"dashboard.page.subtitle",
		"把连接质量、域名邮箱、发信能力和自动化热度放在同一个运营视角下观察。",
		"Keep connection quality, domain mailboxes, sending readiness, and automation activity in one operational view.",
	),
	breadcrumbControlPlane: defineMessage(
		"dashboard.page.breadcrumb.controlPlane",
		"控制台",
		"Control plane",
	),
	breadcrumbOverview: defineMessage(
		"dashboard.page.breadcrumb.overview",
		"概览",
		"Overview",
	),
	manageConnections: defineMessage(
		"dashboard.page.actions.manageConnections",
		"管理连接",
		"Manage connections",
	),
	domainMailboxes: defineMessage(
		"dashboard.page.actions.domainMailboxes",
		"域名邮箱",
		"Domain mailboxes",
	),
	degradedProofTitle: defineMessage(
		"dashboard.proof.title",
		"本地证据场景 · 降级数据",
		"Proof scenario · degraded data",
	),
	degradedProofDescription: defineMessage(
		"dashboard.proof.description",
		"此模式仅用于本地证据采集：模拟连接异常、域名未全量 ACTIVE 与自动化热度回落，便于捕获 Dashboard 的降级态与排查态截图。",
		"This mode is only for local proof capture: it simulates connection failures, domains that are not fully ACTIVE, and reduced automation activity so degraded dashboard states are easier to capture.",
	),
	healthyConnections: defineMessage(
		"dashboard.stats.healthyConnections",
		"正常连接",
		"Healthy connections",
	),
	totalRequests: defineMessage(
		"dashboard.stats.totalRequests",
		"总调用量",
		"Total requests",
	),
	activeKeys: defineMessage(
		"dashboard.stats.activeKeys",
		"活跃密钥",
		"Active keys",
	),
	activeDomainMailboxes: defineMessage(
		"dashboard.stats.activeDomainMailboxes",
		"活跃域名邮箱",
		"Active domain mailboxes",
	),
	dailyPosture: defineMessage(
		"dashboard.hero.kicker",
		"Daily posture",
		"Daily posture",
	),
	heroTitle: defineMessage(
		"dashboard.hero.title",
		"先确认连接、域名邮箱与自动化节奏",
		"Confirm connections, domain mailboxes, and the automation cadence first",
	),
	heroDescription: defineMessage(
		"dashboard.hero.description",
		"把最重要的运行信号先收紧到一屏：连接是否稳定、域名邮箱是否可用、今天的自动化是否正常推进。确定整体姿态后，再进入对象页处理细节。",
		"Pull the most important runtime signals into one screen first: whether connections are stable, domain mailboxes are usable, and today’s automation is moving normally. Once the overall posture is clear, move into detail pages.",
	),
	badgeExternalConnections: defineMessage(
		"dashboard.hero.badge.externalConnections",
		"外部连接",
		"External connections",
	),
	badgeDomainMailboxes: defineMessage(
		"dashboard.hero.badge.domainMailboxes",
		"域名邮箱",
		"Domain mailboxes",
	),
	badgeTodayActiveKeys: defineMessage(
		"dashboard.hero.badge.todayActiveKeys",
		"今日活跃密钥",
		"Today’s active keys",
	),
	healthScore: defineMessage(
		"dashboard.health.score",
		"自动化健康评分",
		"Automation health score",
	),
	callsInLastDays: defineMessage(
		"dashboard.health.callsInLastDays",
		"近 {days} 天调用",
		"Calls in last {days} days",
	),
	dailyAverage: defineMessage(
		"dashboard.health.dailyAverage",
		"日均调用",
		"Daily average",
	),
	peak: defineMessage("dashboard.health.peak", "峰值", "Peak"),
	apiTrendTitle: defineMessage(
		"dashboard.trend.title",
		"自动化趋势",
		"Automation trend",
	),
	apiTrendSubtitle: defineMessage(
		"dashboard.trend.subtitle",
		"看调用热度变化，判断当前更适合验证、分配还是回归测试。",
		"Use the activity curve to decide whether the current moment fits verification, allocation, or regression testing.",
	),
	trend7Days: defineMessage("dashboard.trend.window7", "7 天", "7 days"),
	trend14Days: defineMessage("dashboard.trend.window14", "14 天", "14 days"),
	trend30Days: defineMessage("dashboard.trend.window30", "30 天", "30 days"),
	providerBreakdownTitle: defineMessage(
		"dashboard.providers.title",
		"服务商分布",
		"Provider breakdown",
	),
	providerBreakdownSubtitle: defineMessage(
		"dashboard.providers.subtitle",
		"把全部服务商收进独立面板，向下滚动检查收件来源是否过度集中。",
		"Bring every provider into one panel and scroll to check whether inbound traffic is overly concentrated.",
	),
	providersCarryingPool: defineMessage(
		"dashboard.providers.carryingPool",
		"{count} 类服务商正在承载当前邮箱池",
		"{count} provider classes are currently carrying the mailbox pool",
	),
	dominantProvider: defineMessage(
		"dashboard.providers.dominant",
		"{provider} 当前占主导；向下滚动可以继续查看全部服务商分布。",
		"{provider} is currently dominant; scroll down to review the full provider mix.",
	),
	noActiveProviders: defineMessage(
		"dashboard.providers.none",
		"当前没有活跃服务商，保留完整分布视图以便初始化配置时快速确认。",
		"There are no active providers right now. Keep the full distribution view so initial setup can be confirmed quickly.",
	),
	activePool: defineMessage(
		"dashboard.providers.activePool",
		"活跃池",
		"Active pool",
	),
	unused: defineMessage("dashboard.providers.unused", "未使用", "Unused"),
	systemSignalsTitle: defineMessage(
		"dashboard.signals.title",
		"系统信号",
		"System signals",
	),
	systemSignalsSubtitle: defineMessage(
		"dashboard.signals.subtitle",
		"先看风险，再决定进入哪个对象页处理。",
		"Review the risk first, then decide which object page to open.",
	),
	emailHealthTitle: defineMessage(
		"dashboard.signals.emailHealthTitle",
		"邮箱健康度",
		"Mailbox health",
	),
	emailHealthWarning: defineMessage(
		"dashboard.signals.emailHealthWarning",
		"有 {count} 个外部邮箱处于异常状态，下面已列出可直接排查的对象。",
		"{count} external mailboxes are currently in an error state. The affected items are listed below for direct investigation.",
	),
	emailHealthHealthy: defineMessage(
		"dashboard.signals.emailHealthHealthy",
		"当前外部邮箱连接没有错误状态，适合继续承载自动化收件。",
		"There are no external mailbox errors right now, so the system is ready to keep handling automated inbox work.",
	),
	domainRuntimeTitle: defineMessage(
		"dashboard.signals.domainRuntimeTitle",
		"域名运行态",
		"Domain runtime",
	),
	domainRuntimeAllActive: defineMessage(
		"dashboard.signals.domainRuntimeAllActive",
		"全部 {count} 个域名都处于 ACTIVE。",
		"All {count} domains are ACTIVE.",
	),
	domainRuntimePartial: defineMessage(
		"dashboard.signals.domainRuntimePartial",
		"{active}/{total} 个域名处于 ACTIVE，请检查未激活域名的 DNS 或收件配置。",
		"{active}/{total} domains are ACTIVE. Check DNS or inbound configuration for the inactive ones.",
	),
	automationPulseTitle: defineMessage(
		"dashboard.signals.automationPulseTitle",
		"自动化热度",
		"Automation pulse",
	),
	automationPulseActive: defineMessage(
		"dashboard.signals.automationPulseActive",
		"今天已有 {count} 个访问密钥发起自动化动作。",
		"{count} API keys have already triggered automation today.",
	),
	automationPulseIdle: defineMessage(
		"dashboard.signals.automationPulseIdle",
		"今天还没有访问密钥调用记录，适合做发布前联调或回归测试。",
		"There are no API-key calls yet today, which makes this a good moment for pre-release integration or regression testing.",
	),
	errorEmailsTitle: defineMessage(
		"dashboard.errorEmails.title",
		"异常外部邮箱",
		"External mailboxes with errors",
	),
	errorEmailsSubtitle: defineMessage(
		"dashboard.errorEmails.subtitle",
		"直接列出当前需要优先检查的外部邮箱连接。",
		"List the external mailbox connections that should be checked first.",
	),
	enterEmailsPage: defineMessage(
		"dashboard.errorEmails.enterPage",
		"进入邮箱页",
		"Open mailboxes page",
	),
	noErrorEmails: defineMessage(
		"dashboard.errorEmails.none",
		"当前没有异常外部邮箱，连接状态保持正常。",
		"There are no external mailbox errors right now; connection state remains healthy.",
	),
	errorTag: defineMessage("dashboard.errorEmails.errorTag", "异常", "Error"),
	inspectNow: defineMessage(
		"dashboard.errorEmails.inspectNow",
		"直接检查",
		"Inspect now",
	),
	defaultErrorMessage: defineMessage(
		"dashboard.errorEmails.defaultMessage",
		"当前连接检查失败，建议重新检查或重新走 OAuth 授权。",
		"The connection check failed. Re-run the check or complete OAuth authorization again.",
	),
	lastChecked: defineMessage(
		"dashboard.errorEmails.lastChecked",
		"最后检查：{time}",
		"Last checked: {time}",
	),
	noRecord: defineMessage(
		"dashboard.common.noRecord",
		"暂无记录",
		"No record yet",
	),
	recentActivitiesTitle: defineMessage(
		"dashboard.activities.title",
		"最近自动化活动",
		"Recent automation activity",
	),
	recentActivitiesSubtitle: defineMessage(
		"dashboard.activities.subtitle",
		"快速判断当前系统是在读信、取号还是清理资源。",
		"Quickly tell whether the system is fetching inbox mail, allocating resources, or cleaning up.",
	),
	viewAll: defineMessage(
		"dashboard.activities.viewAll",
		"查看全部",
		"View all",
	),
	noRecentActivities: defineMessage(
		"dashboard.activities.none",
		"近期没有自动化调用记录，可先用访问密钥跑一次分配 / 读信链路，再回来看这里的活动回放。",
		"There is no recent automation activity. Trigger one allocation or inbox-read flow with an API key first, then return here to review the playback.",
	),
	apiKeyNamed: defineMessage(
		"dashboard.activities.apiKeyNamed",
		"访问密钥 {name}",
		"API key {name}",
	),
	anonymousAction: defineMessage(
		"dashboard.activities.anonymousAction",
		"匿名动作",
		"Anonymous action",
	),
	apiTrendAria: defineMessage(
		"dashboard.charts.apiTrendAria",
		"API 调用趋势图",
		"API activity trend chart",
	),
} as const;

export const DASHBOARD_PROOF_MODE = "degraded-data";

export const DASHBOARD_PROOF_FIXTURE = {
	stats: {
		apiKeys: { total: 12, active: 4, totalUsage: 12894, todayActive: 1 },
		domainMail: {
			domains: 3,
			activeDomains: 2,
			mailboxes: 18,
			activeMailboxes: 9,
			inboundMessages: 1524,
			outboundMessages: 286,
		},
	} satisfies Stats,
	emailStats: {
		total: 42,
		active: 27,
		error: 5,
		providers: {
			OUTLOOK: 21,
			GMAIL: 12,
			QQ: 9,
		},
	} satisfies EmailStats,
	apiTrend: [
		{ date: "04-01", count: 182 },
		{ date: "04-02", count: 164 },
		{ date: "04-03", count: 96 },
		{ date: "04-04", count: 58 },
		{ date: "04-05", count: 41 },
		{ date: "04-06", count: 73 },
		{ date: "04-07", count: 52 },
	] satisfies ApiTrendItem[],
	recentLogs: [
		{
			id: 901,
			action: "mail.fetch_latest",
			apiKeyName: "allocator-bot",
			email: "ops01@example.com",
			responseCode: 502,
			responseTimeMs: 2480,
			createdAt: "2026-04-05T08:10:00.000Z",
		},
		{
			id: 902,
			action: "mail.allocate",
			apiKeyName: "campaign-runner",
			email: "catchall@example.com",
			responseCode: 429,
			responseTimeMs: 1280,
			createdAt: "2026-04-05T08:16:00.000Z",
		},
	] satisfies LogItem[],
	errorEmails: [
		{
			id: 401,
			email: "outlook-hot-01@example.com",
			provider: "OUTLOOK",
			status: "ERROR",
			errorMessage: "最近 30 分钟握手失败，建议重新检查授权或代理链路。",
			lastCheckAt: "2026-04-05T08:20:00.000Z",
		},
		{
			id: 402,
			email: "gmail-batch-02@example.com",
			provider: "GMAIL",
			status: "ERROR",
			errorMessage: "刷新令牌不可用，当前轮只保留只读状态。",
			lastCheckAt: "2026-04-05T08:18:00.000Z",
		},
		{
			id: 403,
			email: "qq-fallback-07@example.com",
			provider: "QQ",
			status: "ERROR",
			errorMessage: "验证码抓取连续超时，建议降低并发并复核收件策略。",
			lastCheckAt: "2026-04-05T08:12:00.000Z",
		},
	] satisfies ErrorEmailItem[],
};

export function isLocalProofHost() {
	if (typeof window === "undefined") {
		return false;
	}

	return (
		window.location.hostname === "127.0.0.1" ||
		window.location.hostname === "localhost"
	);
}

export const cardStyle: CSSProperties = {
	...contentCardStyle,
	overflow: "hidden",
	borderRadius: 18,
};

export const cardBodyStyle: CSSProperties = {
	padding: 20,
};

export const dashboardStyles = {
	heroCard: {
		...insetCardStyle,
		borderRadius: 20,
		marginBottom: 12,
	} satisfies CSSProperties,
	fullWidth: fullWidthStyle,
	titleNoMargin: noMarginStyle,
	heroKicker: {
		display: "block",
		color: shellPalette.muted,
		fontSize: 11,
		fontWeight: 700,
		letterSpacing: 1.5,
		textTransform: "uppercase",
		marginBottom: 10,
	} satisfies CSSProperties,
	heroTitle: {
		margin: 0,
		color: shellPalette.ink,
		fontSize: 28,
		lineHeight: 1.08,
		letterSpacing: -0.4,
		fontWeight: 700,
	} satisfies CSSProperties,
	heroParagraph: {
		margin: "8px 0 0",
		color: shellPalette.inkSoft,
		fontSize: 14,
		maxWidth: 700,
		lineHeight: 1.6,
	} satisfies CSSProperties,
	heroBadgeCard: {
		minWidth: 146,
		padding: "12px 14px",
		borderRadius: 16,
		border: `1px solid ${shellPalette.border}`,
		background: shellPalette.sidebarSurface,
	} satisfies CSSProperties,
	heroBadgeLabel: {
		fontSize: 11,
		fontWeight: 700,
		letterSpacing: 1.1,
		textTransform: "uppercase",
		color: shellPalette.muted,
	} satisfies CSSProperties,
	heroBadgeValue: {
		fontSize: 22,
		fontWeight: 760,
		marginTop: 6,
		color: shellPalette.ink,
	} satisfies CSSProperties,
	heroSummaryPanel: {
		borderRadius: 18,
		padding: 18,
		border: `1px solid ${shellPalette.border}`,
		background: shellPalette.surface,
	} satisfies CSSProperties,
	flexBetweenFullWidth: flexBetweenFullWidthStyle,
	healthLabel: { color: shellPalette.muted } satisfies CSSProperties,
	healthScoreRow: {
		display: "flex",
		alignItems: "baseline",
		gap: 8,
		marginTop: 6,
	} satisfies CSSProperties,
	healthScoreValue: {
		fontSize: 38,
		lineHeight: 1,
		fontWeight: 800,
		color: shellPalette.ink,
	} satisfies CSSProperties,
	healthScoreMax: { color: shellPalette.muted } satisfies CSSProperties,
	darkText: { color: shellPalette.ink } satisfies CSSProperties,
	healthMetricGrid: { display: "grid", gap: 12 } satisfies CSSProperties,
	healthMetricRow: {
		display: "flex",
		justifyContent: "space-between",
	} satisfies CSSProperties,
	healthIconBox: {
		width: 52,
		height: 52,
		borderRadius: 16,
		background: shellPalette.primarySoft,
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		fontSize: 22,
		color: shellPalette.primary,
	} satisfies CSSProperties,
	rowMarginTop16: { marginTop: 12 } satisfies CSSProperties,
	centeredPadding56MinHeight300: centeredPadding56MinHeight300Style,
	centeredPadding56: centeredPadding56Style,
	signalCard: {
		padding: "0 0 12px",
		borderBottom: `1px solid ${shellPalette.border}`,
		background: "transparent",
	} satisfies CSSProperties,
	signalIcon: (tone: string) =>
		({ color: tone, fontSize: 18 }) satisfies CSSProperties,
	errorCard: (hasErrors: boolean) =>
		({
			borderRadius: 18,
			padding: 16,
			border: "1px solid rgba(239, 68, 68, 0.16)",
			background: hasErrors
				? "rgba(254, 242, 242, 0.92)"
				: shellPalette.surfaceMuted,
		}) satisfies CSSProperties,
	centeredPadding24: centeredPadding24Style,
	listItemReset: { paddingInline: 0 } satisfies CSSProperties,
	providerCard: {
		width: "100%",
		borderRadius: 14,
		padding: 12,
		display: "grid",
		gap: 8,
		border: `1px solid ${shellPalette.border}`,
		background: shellPalette.surfaceMuted,
	} satisfies CSSProperties,
	providerSummaryRow: {
		display: "grid",
		gap: 6,
		padding: "0 0 4px",
	} satisfies CSSProperties,
	providerSummaryMeta: {
		fontSize: 12,
		color: shellPalette.muted,
	} satisfies CSSProperties,
	providerScrollRow: {
		display: "grid",
		gap: 10,
		maxHeight: 360,
		overflowY: "auto",
		paddingRight: 4,
		scrollbarWidth: "thin",
	} satisfies CSSProperties,
	providerCardHeader: {
		display: "flex",
		justifyContent: "space-between",
		alignItems: "flex-start",
		gap: 12,
	} satisfies CSSProperties,
	textAlignRight: { textAlign: "right" } satisfies CSSProperties,
	providerCount: {
		fontSize: 24,
		fontWeight: 760,
		color: shellPalette.ink,
	} satisfies CSSProperties,
	clockIcon: { color: "#94a3b8" } satisfies CSSProperties,
	mutedSectionHint: {
		fontSize: 13,
		color: shellPalette.muted,
	} satisfies CSSProperties,
} as const;
