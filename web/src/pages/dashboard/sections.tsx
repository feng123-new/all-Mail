import {
	ApiOutlined,
	ArrowRightOutlined,
	CheckCircleOutlined,
	ClockCircleOutlined,
	InboxOutlined,
	KeyOutlined,
	MailOutlined,
	SafetyCertificateOutlined,
} from "@ant-design/icons";
import {
	Alert,
	Button,
	Card,
	Col,
	Empty,
	Progress,
	Row,
	Segmented,
	Space,
	Spin,
	Tag,
	Typography,
} from "antd";
import type { ComponentType } from "react";
import { type ReactNode, Suspense } from "react";
import { createSearchParams, Link } from "react-router-dom";
import { PageHeader, StatCard, SurfaceCard } from "../../components";
import type { SimpleLineChartProps } from "../../components/charts";
import {
	getLogActionColor,
	getLogActionLabel,
} from "../../constants/logActions";
import {
	type EmailProvider,
	getProviderDefinition,
} from "../../constants/providers";
import { getProviderLabelMessage } from "../../i18n/catalog/providers";
import type { TranslationInput } from "../../i18n/messages";
import {
	type ApiTrendItem,
	cardBodyStyle,
	cardStyle,
	dashboardPageI18n,
	dashboardStyles,
	type EmailStats,
	type ErrorEmailItem,
	type LogItem,
	type Stats,
	type TrendWindow,
} from "./shared";

const { Title, Text, Paragraph } = Typography;

type TranslateFn = (
	input: TranslationInput,
	params?: Record<string, number | string>,
) => string;

interface DashboardPageHeaderProps {
	t: TranslateFn;
}

export function DashboardPageHeader({ t }: DashboardPageHeaderProps) {
	return (
		<PageHeader
			title={t(dashboardPageI18n.pageTitle)}
			subtitle={t(dashboardPageI18n.pageSubtitle)}
			breadcrumb={[
				{ title: t(dashboardPageI18n.breadcrumbControlPlane) },
				{ title: t(dashboardPageI18n.breadcrumbOverview) },
			]}
			extra={
				<Space wrap>
					<Link to="/emails">
						<Button type="primary" icon={<MailOutlined />}>
							{t(dashboardPageI18n.manageConnections)}
						</Button>
					</Link>
					<Link to="/domain-mailboxes">
						<Button>{t(dashboardPageI18n.domainMailboxes)}</Button>
					</Link>
				</Space>
			}
		/>
	);
}

interface DashboardProofAlertProps {
	visible: boolean;
	t: TranslateFn;
}

export function DashboardProofAlert({ visible, t }: DashboardProofAlertProps) {
	if (!visible) {
		return null;
	}

	return (
		<Alert
			type="warning"
			showIcon
			banner
			title={t(dashboardPageI18n.degradedProofTitle)}
			description={t(dashboardPageI18n.degradedProofDescription)}
			style={{ marginBottom: 16 }}
		/>
	);
}

interface DashboardHeroSectionProps {
	t: TranslateFn;
	heroBadges: Array<{ key: string; label: TranslationInput; value: string }>;
	automationHealthScore: number;
	trendDays: TrendWindow;
	trendTotal: number;
	averageTrend: number;
	trendPeak: number;
}

export function DashboardHeroSection({
	t,
	heroBadges,
	automationHealthScore,
	trendDays,
	trendTotal,
	averageTrend,
	trendPeak,
}: DashboardHeroSectionProps) {
	return (
		<SurfaceCard
			tone="muted"
			style={dashboardStyles.heroCard}
			bodyStyle={{ padding: 24 }}
		>
			<Row gutter={[24, 24]} align="middle">
				<Col xs={24} xl={16}>
					<Space
						orientation="vertical"
						size={18}
						style={dashboardStyles.fullWidth}
					>
						<div>
							<Text style={dashboardStyles.heroKicker}>
								{t(dashboardPageI18n.dailyPosture)}
							</Text>
							<Title level={3} style={dashboardStyles.heroTitle}>
								{t(dashboardPageI18n.heroTitle)}
							</Title>
							<Paragraph style={dashboardStyles.heroParagraph}>
								{t(dashboardPageI18n.heroDescription)}
							</Paragraph>
						</div>
						<Space wrap size={12}>
							{heroBadges.map((badge) => (
								<div key={badge.key} style={dashboardStyles.heroBadgeCard}>
									<Text type="secondary" style={dashboardStyles.heroBadgeLabel}>
										{t(badge.label)}
									</Text>
									<div style={dashboardStyles.heroBadgeValue}>
										{badge.value}
									</div>
								</div>
							))}
						</Space>
					</Space>
				</Col>
				<Col xs={24} xl={8}>
					<div style={dashboardStyles.heroSummaryPanel}>
						<Space
							orientation="vertical"
							size={18}
							style={dashboardStyles.fullWidth}
						>
							<Space align="start" style={dashboardStyles.flexBetweenFullWidth}>
								<div>
									<Text style={dashboardStyles.healthLabel}>
										{t(dashboardPageI18n.healthScore)}
									</Text>
									<div style={dashboardStyles.healthScoreRow}>
										<span style={dashboardStyles.healthScoreValue}>
											{automationHealthScore}
										</span>
										<span style={dashboardStyles.healthScoreMax}>/ 100</span>
									</div>
								</div>
								<div style={dashboardStyles.healthIconBox}>
									<SafetyCertificateOutlined />
								</div>
							</Space>
							<Progress
								percent={automationHealthScore}
								strokeColor="#1d4ed8"
								railColor="rgba(148, 163, 184, 0.18)"
								showInfo={false}
							/>
							<div style={dashboardStyles.healthMetricGrid}>
								<div style={dashboardStyles.healthMetricRow}>
									<Text style={dashboardStyles.healthLabel}>
										{t(dashboardPageI18n.callsInLastDays, { days: trendDays })}
									</Text>
									<Text style={dashboardStyles.darkText}>{trendTotal}</Text>
								</div>
								<div style={dashboardStyles.healthMetricRow}>
									<Text style={dashboardStyles.healthLabel}>
										{t(dashboardPageI18n.dailyAverage)}
									</Text>
									<Text style={dashboardStyles.darkText}>{averageTrend}</Text>
								</div>
								<div style={dashboardStyles.healthMetricRow}>
									<Text style={dashboardStyles.healthLabel}>
										{t(dashboardPageI18n.peak)}
									</Text>
									<Text style={dashboardStyles.darkText}>{trendPeak}</Text>
								</div>
							</div>
						</Space>
					</div>
				</Col>
			</Row>
		</SurfaceCard>
	);
}

interface DashboardStatsRowProps {
	t: TranslateFn;
	statsData: Stats;
	safeEmailStats: EmailStats;
	coreLoading: boolean;
}

export function DashboardStatsRow({
	t,
	statsData,
	safeEmailStats,
	coreLoading,
}: DashboardStatsRowProps) {
	return (
		<Row gutter={[16, 16]}>
			<Col xs={12} md={6} xl={6}>
				<StatCard
					title={t(dashboardPageI18n.healthyConnections)}
					value={safeEmailStats.active}
					suffix={`/ ${safeEmailStats.total}`}
					icon={<CheckCircleOutlined />}
					iconBgColor="#22c55e"
					loading={coreLoading}
				/>
			</Col>
			<Col xs={12} md={6} xl={6}>
				<StatCard
					title={t(dashboardPageI18n.totalRequests)}
					value={statsData.apiKeys.totalUsage}
					icon={<ApiOutlined />}
					iconBgColor="#2563eb"
					loading={coreLoading}
				/>
			</Col>
			<Col xs={12} md={6} xl={6}>
				<StatCard
					title={t(dashboardPageI18n.activeKeys)}
					value={statsData.apiKeys.active}
					suffix={`/ ${statsData.apiKeys.total}`}
					icon={<KeyOutlined />}
					iconBgColor="#f59e0b"
					loading={coreLoading}
				/>
			</Col>
			<Col xs={12} md={6} xl={6}>
				<StatCard
					title={t(dashboardPageI18n.activeDomainMailboxes)}
					value={statsData.domainMail.activeMailboxes}
					suffix={`/ ${statsData.domainMail.mailboxes}`}
					icon={<InboxOutlined />}
					iconBgColor="#3b82f6"
					loading={coreLoading}
				/>
			</Col>
		</Row>
	);
}

interface DashboardTrendCardProps {
	t: TranslateFn;
	trendDays: TrendWindow;
	setTrendDays: (value: TrendWindow) => void;
	chartsReady: boolean;
	chartsInView: boolean;
	trendLoading: boolean;
	apiTrend: ApiTrendItem[];
	chartsSectionRef: React.RefObject<HTMLDivElement | null>;
	LineChart: ComponentType<SimpleLineChartProps>;
}

export function DashboardTrendCard({
	t,
	trendDays,
	setTrendDays,
	chartsReady,
	chartsInView,
	trendLoading,
	apiTrend,
	chartsSectionRef,
	LineChart,
}: DashboardTrendCardProps) {
	return (
		<Card
			variant="borderless"
			style={cardStyle}
			styles={{ body: cardBodyStyle }}
			ref={chartsSectionRef}
		>
			<Space orientation="vertical" size={18} style={dashboardStyles.fullWidth}>
				<Space align="start" style={dashboardStyles.flexBetweenFullWidth} wrap>
					<div>
						<Title level={4} style={dashboardStyles.titleNoMargin}>
							{t(dashboardPageI18n.apiTrendTitle)}
						</Title>
						<Text type="secondary">
							{t(dashboardPageI18n.apiTrendSubtitle)}
						</Text>
					</div>
					<Segmented<TrendWindow>
						value={trendDays}
						onChange={(value) => setTrendDays(value)}
						options={[
							{ label: t(dashboardPageI18n.trend7Days), value: 7 },
							{ label: t(dashboardPageI18n.trend14Days), value: 14 },
							{ label: t(dashboardPageI18n.trend30Days), value: 30 },
						]}
					/>
				</Space>
				{!chartsReady || !chartsInView || trendLoading ? (
					<div style={dashboardStyles.centeredPadding56MinHeight300}>
						<Spin />
					</div>
				) : (
					<Suspense
						fallback={
							<div style={dashboardStyles.centeredPadding56}>
								<Spin />
							</div>
						}
					>
						<LineChart
							data={apiTrend}
							color="#2563eb"
							height={300}
							ariaLabel={t("dashboard.charts.apiTrendAria")}
						/>
					</Suspense>
				)}
			</Space>
		</Card>
	);
}

interface ProviderBreakdownCardProps {
	t: TranslateFn;
	rankedProviders: Array<{
		key: EmailProvider;
		label: TranslationInput;
		count: number;
		hint: TranslationInput;
	}>;
	activeProviderCount: number;
	dominantProvider?: {
		key: EmailProvider;
		label: TranslationInput;
		count: number;
		hint: TranslationInput;
	};
	coreLoading: boolean;
}

export function ProviderBreakdownCard({
	t,
	rankedProviders,
	activeProviderCount,
	dominantProvider,
	coreLoading,
}: ProviderBreakdownCardProps) {
	return (
		<Card
			variant="borderless"
			style={cardStyle}
			styles={{ body: cardBodyStyle }}
			loading={coreLoading}
		>
			<Space orientation="vertical" size={16} style={dashboardStyles.fullWidth}>
				<div>
					<Title level={4} style={dashboardStyles.titleNoMargin}>
						{t(dashboardPageI18n.providerBreakdownTitle)}
					</Title>
					<Text type="secondary">
						{t(dashboardPageI18n.providerBreakdownSubtitle)}
					</Text>
				</div>
				<div style={dashboardStyles.providerSummaryRow}>
					<Text strong style={{ color: "#0f172a" }}>
						{t(dashboardPageI18n.providersCarryingPool, {
							count: activeProviderCount,
						})}
					</Text>
					<Text style={dashboardStyles.providerSummaryMeta}>
						{dominantProvider && dominantProvider.count > 0
							? t(dashboardPageI18n.dominantProvider, {
									provider: t(dominantProvider.label),
								})
							: t(dashboardPageI18n.noActiveProviders)}
					</Text>
				</div>
				<div style={dashboardStyles.providerScrollRow}>
					{rankedProviders.map((item) => (
						<div key={item.key} style={dashboardStyles.providerCard}>
							<div style={dashboardStyles.providerCardHeader}>
								<Text strong style={{ color: "#0f172a" }}>
									{t(item.label)}
								</Text>
								<div style={dashboardStyles.textAlignRight}>
									<div style={dashboardStyles.providerCount}>{item.count}</div>
									<Text type="secondary">
										{item.count > 0
											? t(dashboardPageI18n.activePool)
											: t(dashboardPageI18n.unused)}
									</Text>
								</div>
							</div>
							<Paragraph style={{ margin: 0, color: "#64748b", fontSize: 13 }}>
								{t(item.hint)}
							</Paragraph>
						</div>
					))}
				</div>
			</Space>
		</Card>
	);
}

interface SystemSignalsCardProps {
	t: TranslateFn;
	systemSignals: Array<{
		title: string;
		description: string;
		tone: string;
		icon: ReactNode;
	}>;
	errorEmails: ErrorEmailItem[];
	safeEmailStats: EmailStats;
	coreLoading: boolean;
}

export function SystemSignalsCard({
	t,
	systemSignals,
	errorEmails,
	safeEmailStats,
	coreLoading,
}: SystemSignalsCardProps) {
	return (
		<Card
			variant="borderless"
			style={cardStyle}
			styles={{ body: cardBodyStyle }}
		>
			<Space orientation="vertical" size={16} style={dashboardStyles.fullWidth}>
				<div>
					<Title level={4} style={dashboardStyles.titleNoMargin}>
						{t(dashboardPageI18n.systemSignalsTitle)}
					</Title>
					<Text type="secondary">
						{t(dashboardPageI18n.systemSignalsSubtitle)}
					</Text>
				</div>
				{systemSignals.map((signal) => (
					<div key={signal.title} style={dashboardStyles.signalCard}>
						<Space
							orientation="vertical"
							size={8}
							style={dashboardStyles.fullWidth}
						>
							<Space>
								<span style={dashboardStyles.signalIcon(signal.tone)}>
									{signal.icon}
								</span>
								<Text strong>{signal.title}</Text>
							</Space>
							<Text type="secondary">{signal.description}</Text>
						</Space>
					</div>
				))}
				<div style={dashboardStyles.errorCard(safeEmailStats.error > 0)}>
					<Space
						orientation="vertical"
						size={12}
						style={dashboardStyles.fullWidth}
					>
						<Space align="start" style={dashboardStyles.flexBetweenFullWidth}>
							<div>
								<Title level={5} style={dashboardStyles.titleNoMargin}>
									{t(dashboardPageI18n.errorEmailsTitle)}
								</Title>
								<Text type="secondary">
									{t(dashboardPageI18n.errorEmailsSubtitle)}
								</Text>
							</div>
							<Link to="/emails">
								<Button type="text" icon={<ArrowRightOutlined />}>
									{t(dashboardPageI18n.enterEmailsPage)}
								</Button>
							</Link>
						</Space>
						{coreLoading ? (
							<div style={dashboardStyles.centeredPadding24}>
								<Spin />
							</div>
						) : errorEmails.length === 0 ? (
							<Empty
								description={t(dashboardPageI18n.noErrorEmails)}
								image={Empty.PRESENTED_IMAGE_SIMPLE}
							/>
						) : (
							<Space
								orientation="vertical"
								size={12}
								style={dashboardStyles.fullWidth}
							>
								{errorEmails.map((item) => (
									<div key={item.id} style={dashboardStyles.listItemReset}>
										<Space
											orientation="vertical"
											size={8}
											style={dashboardStyles.fullWidth}
										>
											<Space wrap style={dashboardStyles.flexBetweenFullWidth}>
												<Space wrap>
													<Tag color="red">{t(dashboardPageI18n.errorTag)}</Tag>
													<Tag
														color={
															getProviderDefinition(item.provider).tagColor
														}
													>
														{t(getProviderLabelMessage(item.provider))}
													</Tag>
													<Text strong>{item.email}</Text>
												</Space>
												<Link
													to={{
														pathname: "/emails",
														search: createSearchParams({
															status: "ERROR",
															keyword: item.email,
															emailId: String(item.id),
														}).toString(),
													}}
												>
													<Button type="text">
														{t(dashboardPageI18n.inspectNow)}
													</Button>
												</Link>
											</Space>
											<Text type="secondary">
												{t(
													item.errorMessage ||
														dashboardPageI18n.defaultErrorMessage,
												)}
											</Text>
											<Text type="secondary">
												{t(dashboardPageI18n.lastChecked, {
													time: item.lastCheckAt
														? new Date(item.lastCheckAt).toLocaleString()
														: t(dashboardPageI18n.noRecord),
												})}
											</Text>
										</Space>
									</div>
								))}
							</Space>
						)}
					</Space>
				</div>
			</Space>
		</Card>
	);
}

interface RecentActivitiesCardProps {
	t: TranslateFn;
	recentLogs: LogItem[];
	logsLoading: boolean;
}

export function RecentActivitiesCard({
	t,
	recentLogs,
	logsLoading,
}: RecentActivitiesCardProps) {
	return (
		<Card
			variant="borderless"
			style={cardStyle}
			styles={{ body: cardBodyStyle }}
			loading={logsLoading}
		>
			<Space orientation="vertical" size={16} style={dashboardStyles.fullWidth}>
				<Space align="start" style={dashboardStyles.flexBetweenFullWidth}>
					<div>
						<Title level={4} style={dashboardStyles.titleNoMargin}>
							{t(dashboardPageI18n.recentActivitiesTitle)}
						</Title>
						<Text type="secondary">
							{t(dashboardPageI18n.recentActivitiesSubtitle)}
						</Text>
					</div>
					<Link to="/operation-logs">
						<Button type="text" icon={<ArrowRightOutlined />}>
							{t(dashboardPageI18n.viewAll)}
						</Button>
					</Link>
				</Space>
				{recentLogs.length === 0 ? (
					<Empty description={t(dashboardPageI18n.noRecentActivities)} />
				) : (
					<Space
						orientation="vertical"
						size={12}
						style={dashboardStyles.fullWidth}
					>
						{recentLogs.map((item) => (
							<div key={item.id} style={dashboardStyles.listItemReset}>
								<Space
									orientation="vertical"
									size={6}
									style={dashboardStyles.fullWidth}
								>
									<Space wrap style={dashboardStyles.flexBetweenFullWidth}>
										<Space wrap>
											<Tag color={getLogActionColor(item.action)}>
												{t(getLogActionLabel(item.action))}
											</Tag>
											{item.responseCode ? (
												<Tag
													color={item.responseCode >= 400 ? "error" : "success"}
												>
													{item.responseCode}
												</Tag>
											) : null}
										</Space>
										<Space size={6}>
											<ClockCircleOutlined style={dashboardStyles.clockIcon} />
											<Text type="secondary">
												{new Date(item.createdAt).toLocaleString()}
											</Text>
										</Space>
									</Space>
									<Text type="secondary">
										{item.apiKeyName && item.apiKeyName !== "-"
											? t(dashboardPageI18n.apiKeyNamed, {
													name: item.apiKeyName,
												})
											: t(dashboardPageI18n.anonymousAction)}
										{item.email && item.email !== "-" ? ` · ${item.email}` : ""}
										{item.responseTimeMs ? ` · ${item.responseTimeMs} ms` : ""}
									</Text>
								</Space>
							</div>
						))}
					</Space>
				)}
			</Space>
		</Card>
	);
}
