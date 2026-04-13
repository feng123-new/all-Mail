import {
	CheckCircleOutlined,
	CloudServerOutlined,
	ThunderboltOutlined,
	WarningOutlined,
} from "@ant-design/icons";
import { Col, Row, Space } from "antd";
import {
	type ComponentType,
	type FC,
	lazy,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useSearchParams } from "react-router-dom";
import type { SimpleLineChartProps } from "../../components/charts";
import { PROVIDER_ORDER } from "../../constants/providers";
import { dashboardContract } from "../../contracts/admin/dashboard";
import { useI18n } from "../../i18n";
import {
	getProviderDescriptionMessage,
	getProviderLabelMessage,
} from "../../i18n/catalog/providers";
import { shellPalette } from "../../theme";
import {
	DashboardHeroSection,
	DashboardPageHeader,
	DashboardProofAlert,
	DashboardStatsRow,
	DashboardTrendCard,
	ProviderBreakdownCard,
	RecentActivitiesCard,
	SystemSignalsCard,
} from "./sections";
import {
	type ApiTrendItem,
	DASHBOARD_PROOF_FIXTURE,
	DASHBOARD_PROOF_MODE,
	dashboardStyles,
	dashboardPageI18n,
	type EmailStats,
	type ErrorEmailItem,
	isLocalProofHost,
	type LogItem,
	type Stats,
	type TrendWindow,
} from "./shared";

const LineChart = lazy(async () => {
	const mod = await import("../../components/charts");
	return {
		default: mod.SimpleLineChart as ComponentType<SimpleLineChartProps>,
	};
});

const DashboardPage: FC = () => {
	const { t } = useI18n();
	const [searchParams] = useSearchParams();
	const [coreLoading, setCoreLoading] = useState(true);
	const [trendLoading, setTrendLoading] = useState(true);
	const [logsLoading, setLogsLoading] = useState(true);
	const [chartsReady, setChartsReady] = useState(false);
	const [chartsInView, setChartsInView] = useState(false);
	const [trendDays, setTrendDays] = useState<TrendWindow>(14);
	const [stats, setStats] = useState<Stats | null>(null);
	const [emailStats, setEmailStats] = useState<EmailStats | null>(null);
	const [apiTrend, setApiTrend] = useState<ApiTrendItem[]>([]);
	const [recentLogs, setRecentLogs] = useState<LogItem[]>([]);
	const [errorEmails, setErrorEmails] = useState<ErrorEmailItem[]>([]);
	const chartsSectionRef = useRef<HTMLDivElement | null>(null);
	const proofScenario = isLocalProofHost()
		? searchParams.get("proof")?.trim() || ""
		: "";
	const isDegradedProof = proofScenario === DASHBOARD_PROOF_MODE;

	useEffect(() => {
		if (isDegradedProof) {
			setStats(DASHBOARD_PROOF_FIXTURE.stats);
			setEmailStats(DASHBOARD_PROOF_FIXTURE.emailStats);
			setRecentLogs(DASHBOARD_PROOF_FIXTURE.recentLogs);
			setErrorEmails(DASHBOARD_PROOF_FIXTURE.errorEmails);
			setApiTrend(DASHBOARD_PROOF_FIXTURE.apiTrend);
			setCoreLoading(false);
			setLogsLoading(false);
			setTrendLoading(false);
			setChartsReady(true);
			setChartsInView(true);
			return;
		}

		let disposed = false;
		let idleId: number | null = null;
		let timerId: number | null = null;
		const idleWindow = window as Window & {
			requestIdleCallback?: (
				callback: IdleRequestCallback,
				options?: IdleRequestOptions,
			) => number;
			cancelIdleCallback?: (handle: number) => void;
		};

		const loadCore = async () => {
			try {
				const [statsRes, emailStatsRes, logsRes, errorEmailsRes] =
					await Promise.all([
						dashboardContract.getStats<Stats>(),
						dashboardContract.getEmailStats<EmailStats>(),
						dashboardContract.getLogs<LogItem>({ page: 1, pageSize: 6 }),
						dashboardContract.getErrorEmails<ErrorEmailItem>({
							page: 1,
							pageSize: 5,
							status: "ERROR",
						}),
					]);

				if (disposed) return;

				if (statsRes.code === 200) {
					setStats(statsRes.data);
				}
				if (emailStatsRes.code === 200) {
					setEmailStats(emailStatsRes.data);
				}
				if (logsRes.code === 200) {
					setRecentLogs(logsRes.data.list || []);
				}
				if (errorEmailsRes.code === 200) {
					setErrorEmails(errorEmailsRes.data.list || []);
				}
			} catch (err) {
				console.error("Failed to fetch dashboard core data:", err);
			} finally {
				if (!disposed) {
					setCoreLoading(false);
					setLogsLoading(false);
				}
			}
		};

		void loadCore();

		if (typeof idleWindow.requestIdleCallback === "function") {
			idleId = idleWindow.requestIdleCallback(
				() => {
					if (!disposed) {
						setChartsReady(true);
					}
				},
				{ timeout: 1200 },
			);
		} else {
			timerId = window.setTimeout(() => {
				if (!disposed) {
					setChartsReady(true);
				}
			}, 350);
		}

		return () => {
			disposed = true;
			if (
				idleId !== null &&
				typeof idleWindow.cancelIdleCallback === "function"
			) {
				idleWindow.cancelIdleCallback(idleId);
			}
			if (timerId !== null) {
				window.clearTimeout(timerId);
			}
		};
	}, [isDegradedProof]);

	useEffect(() => {
		if (isDegradedProof) {
			setChartsInView(true);
			return;
		}

		const target = chartsSectionRef.current;
		if (!target || typeof IntersectionObserver === "undefined") {
			setChartsInView(true);
			return;
		}

		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					setChartsInView(true);
					observer.disconnect();
				}
			},
			{ rootMargin: "120px 0px" },
		);

		observer.observe(target);
		return () => observer.disconnect();
	}, [isDegradedProof]);

	useEffect(() => {
		if (isDegradedProof) {
			setTrendLoading(false);
			return;
		}

		if (!chartsReady || !chartsInView) {
			return;
		}

		let cancelled = false;
		setTrendLoading(true);

		const loadTrend = async () => {
			try {
				const trendRes =
					await dashboardContract.getApiTrend<ApiTrendItem>(trendDays);
				if (!cancelled && trendRes.code === 200) {
					setApiTrend(trendRes.data);
				}
			} catch (err) {
				console.error("Failed to fetch dashboard trend:", err);
			} finally {
				if (!cancelled) {
					setTrendLoading(false);
				}
			}
		};

		void loadTrend();
		return () => {
			cancelled = true;
		};
	}, [chartsInView, chartsReady, isDegradedProof, trendDays]);

	const safeEmailStats = useMemo<EmailStats>(
		() =>
			emailStats || {
				total: 0,
				active: 0,
				error: 0,
				providers: {},
			},
		[emailStats],
	);

	const statsData = useMemo<Stats>(
		() =>
			stats || {
				apiKeys: { total: 0, active: 0, totalUsage: 0, todayActive: 0 },
				domainMail: {
					domains: 0,
					activeDomains: 0,
					mailboxes: 0,
					activeMailboxes: 0,
					inboundMessages: 0,
					outboundMessages: 0,
				},
			},
		[stats],
	);

	const providerSummary = useMemo(
		() =>
			PROVIDER_ORDER.map((provider) => {
				return {
					key: provider,
					label: getProviderLabelMessage(provider),
					count: safeEmailStats.providers[provider] || 0,
					hint: getProviderDescriptionMessage(provider),
				};
			}),
		[safeEmailStats],
	);

	const rankedProviders = useMemo(
		() =>
			[...providerSummary].sort((left, right) => {
				if (right.count !== left.count) {
					return right.count - left.count;
				}
				return t(left.label).localeCompare(t(right.label), "zh-Hans-CN");
			}),
		[providerSummary, t],
	);

	const activeProviderCount = useMemo(
		() => rankedProviders.filter((item) => item.count > 0).length,
		[rankedProviders],
	);
	const dominantProvider =
		rankedProviders.find((item) => item.count > 0) || rankedProviders[0];

	const automationHealthScore = useMemo(() => {
		const emailHealth =
			safeEmailStats.total > 0
				? safeEmailStats.active / safeEmailStats.total
				: 1;
		const domainHealth =
			statsData.domainMail.mailboxes > 0
				? statsData.domainMail.activeMailboxes / statsData.domainMail.mailboxes
				: 1;
		const keyHealth =
			statsData.apiKeys.total > 0
				? statsData.apiKeys.active / statsData.apiKeys.total
				: 1;
		return Math.round(
			(emailHealth * 0.45 + domainHealth * 0.35 + keyHealth * 0.2) * 100,
		);
	}, [safeEmailStats, statsData]);

	const heroBadges = useMemo(
		() => [
			{
				key: "external-connections",
				label: dashboardPageI18n.badgeExternalConnections,
				value: `${safeEmailStats.active}/${safeEmailStats.total}`,
			},
			{
				key: "domain-mailboxes",
				label: dashboardPageI18n.badgeDomainMailboxes,
				value: `${statsData.domainMail.activeMailboxes}/${statsData.domainMail.mailboxes}`,
			},
			{
				key: "today-active-keys",
				label: dashboardPageI18n.badgeTodayActiveKeys,
				value: String(statsData.apiKeys.todayActive),
			},
		],
		[safeEmailStats, statsData],
	);

	const systemSignals = [
		{
			title: t(dashboardPageI18n.emailHealthTitle),
			description:
				safeEmailStats.error > 0
					? t(dashboardPageI18n.emailHealthWarning, {
							count: safeEmailStats.error,
						})
					: t(dashboardPageI18n.emailHealthHealthy),
			tone: safeEmailStats.error > 0 ? "#dc2626" : "#2f9e77",
			icon:
				safeEmailStats.error > 0 ? (
					<WarningOutlined />
				) : (
					<CheckCircleOutlined />
				),
		},
		{
			title: t(dashboardPageI18n.domainRuntimeTitle),
			description:
				statsData.domainMail.activeDomains === statsData.domainMail.domains
					? t(dashboardPageI18n.domainRuntimeAllActive, {
							count: statsData.domainMail.domains,
						})
					: t(dashboardPageI18n.domainRuntimePartial, {
							active: statsData.domainMail.activeDomains,
							total: statsData.domainMail.domains,
						}),
			tone:
				statsData.domainMail.activeDomains === statsData.domainMail.domains
					? "#0f766e"
					: "#d97706",
			icon: <CloudServerOutlined />,
		},
		{
			title: t(dashboardPageI18n.automationPulseTitle),
			description:
				statsData.apiKeys.todayActive > 0
					? t(dashboardPageI18n.automationPulseActive, {
							count: statsData.apiKeys.todayActive,
						})
					: t(dashboardPageI18n.automationPulseIdle),
			tone:
				statsData.apiKeys.todayActive > 0
					? shellPalette.primary
					: shellPalette.muted,
			icon: <ThunderboltOutlined />,
		},
	];

	const trendTotal = useMemo(
		() => apiTrend.reduce((sum, item) => sum + item.count, 0),
		[apiTrend],
	);
	const trendPeak = useMemo(
		() => apiTrend.reduce((max, item) => Math.max(max, item.count), 0),
		[apiTrend],
	);
	const averageTrend =
		apiTrend.length > 0 ? Math.round(trendTotal / apiTrend.length) : 0;

	return (
		<div>
			<DashboardPageHeader t={t} />
			<DashboardProofAlert visible={isDegradedProof} t={t} />
			<DashboardHeroSection
				t={t}
				heroBadges={heroBadges}
				automationHealthScore={automationHealthScore}
				trendDays={trendDays}
				trendTotal={trendTotal}
				averageTrend={averageTrend}
				trendPeak={trendPeak}
			/>
			<DashboardStatsRow
				t={t}
				statsData={statsData}
				safeEmailStats={safeEmailStats}
				coreLoading={coreLoading}
			/>

			<Row gutter={[16, 16]} style={dashboardStyles.rowMarginTop16}>
				<Col xs={24} xl={16}>
					<Space
						orientation="vertical"
						size={16}
						style={dashboardStyles.fullWidth}
					>
						<DashboardTrendCard
							t={t}
							trendDays={trendDays}
							setTrendDays={setTrendDays}
							chartsReady={chartsReady}
							chartsInView={chartsInView}
							trendLoading={trendLoading}
							apiTrend={apiTrend}
							chartsSectionRef={chartsSectionRef}
							LineChart={LineChart}
						/>
						<ProviderBreakdownCard
							t={t}
							rankedProviders={rankedProviders}
							activeProviderCount={activeProviderCount}
							dominantProvider={dominantProvider}
							coreLoading={coreLoading}
						/>
					</Space>
				</Col>
				<Col xs={24} xl={8}>
					<SystemSignalsCard
						t={t}
						systemSignals={systemSignals}
						errorEmails={errorEmails}
						safeEmailStats={safeEmailStats}
						coreLoading={coreLoading}
					/>
				</Col>
			</Row>

			<Row gutter={[16, 16]} style={dashboardStyles.rowMarginTop16}>
				<Col xs={24}>
					<RecentActivitiesCard
						t={t}
						recentLogs={recentLogs}
						logsLoading={logsLoading}
					/>
				</Col>
			</Row>
		</div>
	);
};

export default DashboardPage;
