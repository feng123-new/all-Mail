import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties, type FC } from 'react';
import { Link, createSearchParams, useSearchParams } from 'react-router-dom';
import { Alert, Row, Col, Card, Typography, Spin, Space, Button, Segmented, Progress, Empty, Tag } from 'antd';
import {
    MailOutlined,
    KeyOutlined,
    CheckCircleOutlined,
    ApiOutlined,
    CloudServerOutlined,
    InboxOutlined,
    ArrowRightOutlined,
    WarningOutlined,
    ThunderboltOutlined,
    SafetyCertificateOutlined,
    ClockCircleOutlined,
} from '@ant-design/icons';
import type { SimpleLineChartProps } from '../../components/charts';
import { PageHeader, StatCard, SurfaceCard } from '../../components';
import { dashboardContract } from '../../contracts/admin/dashboard';
import { PROVIDER_ORDER, getProviderDefinition, type EmailProvider } from '../../constants/providers';
import {
    getProviderDescriptionMessage,
    getProviderLabelMessage,
} from '../../i18n/catalog/providers';
import { useI18n } from '../../i18n';
import { defineMessage } from '../../i18n/messages';
import {
    centeredPadding24Style,
    centeredPadding56Style,
    centeredPadding56MinHeight300Style,
    flexBetweenFullWidthStyle,
    fullWidthStyle,
    noMarginStyle,
} from '../../styles/common';
import { contentCardStyle, insetCardStyle, shellPalette } from '../../theme';
import { getLogActionColor, getLogActionLabel } from '../../constants/logActions';

const { Title, Text, Paragraph } = Typography;

const LineChart = lazy(async () => {
    const mod = await import('../../components/charts');
    return { default: mod.SimpleLineChart as ComponentType<SimpleLineChartProps> };
});

interface Stats {
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

interface EmailStats {
    total: number;
    active: number;
    error: number;
    providers: Partial<Record<EmailProvider, number>>;
}

interface ApiTrendItem {
    date: string;
    count: number;
}

interface LogItem {
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

interface ErrorEmailItem {
    id: number;
    email: string;
    provider: EmailProvider;
    status: 'ACTIVE' | 'ERROR' | 'DISABLED';
    errorMessage?: string | null;
    lastCheckAt?: string | null;
}

type TrendWindow = 7 | 14 | 30;

const dashboardPageI18n = {
    pageTitle: defineMessage('dashboard.page.title', '控制台概览', 'Overview'),
    pageSubtitle: defineMessage('dashboard.page.subtitle', '把连接质量、域名邮箱、发信能力和自动化热度放在同一个运营视角下观察。', 'Keep connection quality, domain mailboxes, sending readiness, and automation activity in one operational view.'),
    breadcrumbControlPlane: defineMessage('dashboard.page.breadcrumb.controlPlane', '控制台', 'Control plane'),
    breadcrumbOverview: defineMessage('dashboard.page.breadcrumb.overview', '概览', 'Overview'),
    manageConnections: defineMessage('dashboard.page.actions.manageConnections', '管理连接', 'Manage connections'),
    domainMailboxes: defineMessage('dashboard.page.actions.domainMailboxes', '域名邮箱', 'Domain mailboxes'),
    degradedProofTitle: defineMessage('dashboard.proof.title', '本地证据场景 · 降级数据', 'Proof scenario · degraded data'),
    degradedProofDescription: defineMessage('dashboard.proof.description', '此模式仅用于本地证据采集：模拟连接异常、域名未全量 ACTIVE 与自动化热度回落，便于捕获 Dashboard 的降级态与排查态截图。', 'This mode is only for local proof capture: it simulates connection failures, domains that are not fully ACTIVE, and reduced automation activity so degraded dashboard states are easier to capture.'),
    healthyConnections: defineMessage('dashboard.stats.healthyConnections', '正常连接', 'Healthy connections'),
    totalRequests: defineMessage('dashboard.stats.totalRequests', '总调用量', 'Total requests'),
    activeKeys: defineMessage('dashboard.stats.activeKeys', '活跃密钥', 'Active keys'),
    activeDomainMailboxes: defineMessage('dashboard.stats.activeDomainMailboxes', '活跃域名邮箱', 'Active domain mailboxes'),
    dailyPosture: defineMessage('dashboard.hero.kicker', 'Daily posture', 'Daily posture'),
    heroTitle: defineMessage('dashboard.hero.title', '先确认连接、域名邮箱与自动化节奏', 'Confirm connections, domain mailboxes, and the automation cadence first'),
    heroDescription: defineMessage('dashboard.hero.description', '把最重要的运行信号先收紧到一屏：连接是否稳定、域名邮箱是否可用、今天的自动化是否正常推进。确定整体姿态后，再进入对象页处理细节。', 'Pull the most important runtime signals into one screen first: whether connections are stable, domain mailboxes are usable, and today’s automation is moving normally. Once the overall posture is clear, move into detail pages.'),
    badgeExternalConnections: defineMessage('dashboard.hero.badge.externalConnections', '外部连接', 'External connections'),
    badgeDomainMailboxes: defineMessage('dashboard.hero.badge.domainMailboxes', '域名邮箱', 'Domain mailboxes'),
    badgeTodayActiveKeys: defineMessage('dashboard.hero.badge.todayActiveKeys', '今日活跃密钥', 'Today’s active keys'),
    healthScore: defineMessage('dashboard.health.score', '自动化健康评分', 'Automation health score'),
    callsInLastDays: defineMessage('dashboard.health.callsInLastDays', '近 {days} 天调用', 'Calls in last {days} days'),
    dailyAverage: defineMessage('dashboard.health.dailyAverage', '日均调用', 'Daily average'),
    peak: defineMessage('dashboard.health.peak', '峰值', 'Peak'),
    apiTrendTitle: defineMessage('dashboard.trend.title', '自动化趋势', 'Automation trend'),
    apiTrendSubtitle: defineMessage('dashboard.trend.subtitle', '看调用热度变化，判断当前更适合验证、分配还是回归测试。', 'Use the activity curve to decide whether the current moment fits verification, allocation, or regression testing.'),
    trend7Days: defineMessage('dashboard.trend.window7', '7 天', '7 days'),
    trend14Days: defineMessage('dashboard.trend.window14', '14 天', '14 days'),
    trend30Days: defineMessage('dashboard.trend.window30', '30 天', '30 days'),
    providerBreakdownTitle: defineMessage('dashboard.providers.title', '服务商分布', 'Provider breakdown'),
    providerBreakdownSubtitle: defineMessage('dashboard.providers.subtitle', '把全部服务商收进独立面板，向下滚动检查收件来源是否过度集中。', 'Bring every provider into one panel and scroll to check whether inbound traffic is overly concentrated.'),
    providersCarryingPool: defineMessage('dashboard.providers.carryingPool', '{count} 类服务商正在承载当前邮箱池', '{count} provider classes are currently carrying the mailbox pool'),
    dominantProvider: defineMessage('dashboard.providers.dominant', '{provider} 当前占主导；向下滚动可以继续查看全部服务商分布。', '{provider} is currently dominant; scroll down to review the full provider mix.'),
    noActiveProviders: defineMessage('dashboard.providers.none', '当前没有活跃服务商，保留完整分布视图以便初始化配置时快速确认。', 'There are no active providers right now. Keep the full distribution view so initial setup can be confirmed quickly.'),
    activePool: defineMessage('dashboard.providers.activePool', '活跃池', 'Active pool'),
    unused: defineMessage('dashboard.providers.unused', '未使用', 'Unused'),
    systemSignalsTitle: defineMessage('dashboard.signals.title', '系统信号', 'System signals'),
    systemSignalsSubtitle: defineMessage('dashboard.signals.subtitle', '先看风险，再决定进入哪个对象页处理。', 'Review the risk first, then decide which object page to open.'),
    emailHealthTitle: defineMessage('dashboard.signals.emailHealthTitle', '邮箱健康度', 'Mailbox health'),
    emailHealthWarning: defineMessage('dashboard.signals.emailHealthWarning', '有 {count} 个外部邮箱处于异常状态，下面已列出可直接排查的对象。', '{count} external mailboxes are currently in an error state. The affected items are listed below for direct investigation.'),
    emailHealthHealthy: defineMessage('dashboard.signals.emailHealthHealthy', '当前外部邮箱连接没有错误状态，适合继续承载自动化收件。', 'There are no external mailbox errors right now, so the system is ready to keep handling automated inbox work.'),
    domainRuntimeTitle: defineMessage('dashboard.signals.domainRuntimeTitle', '域名运行态', 'Domain runtime'),
    domainRuntimeAllActive: defineMessage('dashboard.signals.domainRuntimeAllActive', '全部 {count} 个域名都处于 ACTIVE。', 'All {count} domains are ACTIVE.'),
    domainRuntimePartial: defineMessage('dashboard.signals.domainRuntimePartial', '{active}/{total} 个域名处于 ACTIVE，请检查未激活域名的 DNS 或收件配置。', '{active}/{total} domains are ACTIVE. Check DNS or inbound configuration for the inactive ones.'),
    automationPulseTitle: defineMessage('dashboard.signals.automationPulseTitle', '自动化热度', 'Automation pulse'),
    automationPulseActive: defineMessage('dashboard.signals.automationPulseActive', '今天已有 {count} 个访问密钥发起自动化动作。', '{count} API keys have already triggered automation today.'),
    automationPulseIdle: defineMessage('dashboard.signals.automationPulseIdle', '今天还没有访问密钥调用记录，适合做发布前联调或回归测试。', 'There are no API-key calls yet today, which makes this a good moment for pre-release integration or regression testing.'),
    errorEmailsTitle: defineMessage('dashboard.errorEmails.title', '异常外部邮箱', 'External mailboxes with errors'),
    errorEmailsSubtitle: defineMessage('dashboard.errorEmails.subtitle', '直接列出当前需要优先检查的外部邮箱连接。', 'List the external mailbox connections that should be checked first.'),
    enterEmailsPage: defineMessage('dashboard.errorEmails.enterPage', '进入邮箱页', 'Open mailboxes page'),
    noErrorEmails: defineMessage('dashboard.errorEmails.none', '当前没有异常外部邮箱，连接状态保持正常。', 'There are no external mailbox errors right now; connection state remains healthy.'),
    errorTag: defineMessage('dashboard.errorEmails.errorTag', '异常', 'Error'),
    inspectNow: defineMessage('dashboard.errorEmails.inspectNow', '直接检查', 'Inspect now'),
    defaultErrorMessage: defineMessage('dashboard.errorEmails.defaultMessage', '当前连接检查失败，建议重新检查或重新走 OAuth 授权。', 'The connection check failed. Re-run the check or complete OAuth authorization again.'),
    lastChecked: defineMessage('dashboard.errorEmails.lastChecked', '最后检查：{time}', 'Last checked: {time}'),
    noRecord: defineMessage('dashboard.common.noRecord', '暂无记录', 'No record yet'),
    recentActivitiesTitle: defineMessage('dashboard.activities.title', '最近自动化活动', 'Recent automation activity'),
    recentActivitiesSubtitle: defineMessage('dashboard.activities.subtitle', '快速判断当前系统是在读信、取号还是清理资源。', 'Quickly tell whether the system is fetching inbox mail, allocating resources, or cleaning up.'),
    viewAll: defineMessage('dashboard.activities.viewAll', '查看全部', 'View all'),
    noRecentActivities: defineMessage('dashboard.activities.none', '近期没有自动化调用记录，可先用访问密钥跑一次分配 / 读信链路，再回来看这里的活动回放。', 'There is no recent automation activity. Trigger one allocation or inbox-read flow with an API key first, then return here to review the playback.'),
    apiKeyNamed: defineMessage('dashboard.activities.apiKeyNamed', '访问密钥 {name}', 'API key {name}'),
    anonymousAction: defineMessage('dashboard.activities.anonymousAction', '匿名动作', 'Anonymous action'),
    apiTrendAria: defineMessage('dashboard.charts.apiTrendAria', 'API 调用趋势图', 'API activity trend chart'),
} as const;

const DASHBOARD_PROOF_MODE = 'degraded-data';

const DASHBOARD_PROOF_FIXTURE = {
    stats: {
        apiKeys: { total: 12, active: 4, totalUsage: 12894, todayActive: 1 },
        domainMail: { domains: 3, activeDomains: 2, mailboxes: 18, activeMailboxes: 9, inboundMessages: 1524, outboundMessages: 286 },
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
        { date: '04-01', count: 182 },
        { date: '04-02', count: 164 },
        { date: '04-03', count: 96 },
        { date: '04-04', count: 58 },
        { date: '04-05', count: 41 },
        { date: '04-06', count: 73 },
        { date: '04-07', count: 52 },
    ] satisfies ApiTrendItem[],
    recentLogs: [
        {
            id: 901,
            action: 'mail.fetch_latest',
            apiKeyName: 'allocator-bot',
            email: 'ops01@example.com',
            responseCode: 502,
            responseTimeMs: 2480,
            createdAt: '2026-04-05T08:10:00.000Z',
        },
        {
            id: 902,
            action: 'mail.allocate',
            apiKeyName: 'campaign-runner',
            email: 'catchall@example.com',
            responseCode: 429,
            responseTimeMs: 1280,
            createdAt: '2026-04-05T08:16:00.000Z',
        },
    ] satisfies LogItem[],
    errorEmails: [
        {
            id: 401,
            email: 'outlook-hot-01@example.com',
            provider: 'OUTLOOK',
            status: 'ERROR',
            errorMessage: '最近 30 分钟握手失败，建议重新检查授权或代理链路。',
            lastCheckAt: '2026-04-05T08:20:00.000Z',
        },
        {
            id: 402,
            email: 'gmail-batch-02@example.com',
            provider: 'GMAIL',
            status: 'ERROR',
            errorMessage: '刷新令牌不可用，当前轮只保留只读状态。',
            lastCheckAt: '2026-04-05T08:18:00.000Z',
        },
        {
            id: 403,
            email: 'qq-fallback-07@example.com',
            provider: 'QQ',
            status: 'ERROR',
            errorMessage: '验证码抓取连续超时，建议降低并发并复核收件策略。',
            lastCheckAt: '2026-04-05T08:12:00.000Z',
        },
    ] satisfies ErrorEmailItem[],
};

function isLocalProofHost() {
    if (typeof window === 'undefined') {
        return false;
    }

    return window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';
}

const cardStyle: CSSProperties = {
    ...contentCardStyle,
    overflow: 'hidden',
    borderRadius: 18,
};

const cardBodyStyle: CSSProperties = {
    padding: 20,
};

const dashboardStyles = {
    heroCard: {
        ...insetCardStyle,
        borderRadius: 20,
        marginBottom: 12,
    } satisfies CSSProperties,
    fullWidth: fullWidthStyle,
    titleNoMargin: noMarginStyle,
    heroKicker: {
        display: 'block',
        color: shellPalette.muted,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 1.5,
        textTransform: 'uppercase',
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
        margin: '8px 0 0',
        color: shellPalette.inkSoft,
        fontSize: 14,
        maxWidth: 700,
        lineHeight: 1.6,
    } satisfies CSSProperties,
    heroBadgeCard: {
        minWidth: 146,
        padding: '12px 14px',
        borderRadius: 16,
        border: `1px solid ${shellPalette.border}`,
        background: shellPalette.sidebarSurface,
    } satisfies CSSProperties,
    heroBadgeLabel: { fontSize: 11, fontWeight: 700, letterSpacing: 1.1, textTransform: 'uppercase', color: shellPalette.muted } satisfies CSSProperties,
    heroBadgeValue: { fontSize: 22, fontWeight: 760, marginTop: 6, color: shellPalette.ink } satisfies CSSProperties,
    heroSummaryPanel: {
        borderRadius: 18,
        padding: 18,
        border: `1px solid ${shellPalette.border}`,
        background: shellPalette.surface,
    } satisfies CSSProperties,
    flexBetweenFullWidth: flexBetweenFullWidthStyle,
    healthLabel: { color: shellPalette.muted } satisfies CSSProperties,
    healthScoreRow: { display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 6 } satisfies CSSProperties,
    healthScoreValue: { fontSize: 38, lineHeight: 1, fontWeight: 800, color: shellPalette.ink } satisfies CSSProperties,
    healthScoreMax: { color: shellPalette.muted } satisfies CSSProperties,
    darkText: { color: shellPalette.ink } satisfies CSSProperties,
    healthMetricGrid: { display: 'grid', gap: 12 } satisfies CSSProperties,
    healthMetricRow: { display: 'flex', justifyContent: 'space-between' } satisfies CSSProperties,
    healthIconBox: {
        width: 52,
        height: 52,
        borderRadius: 16,
        background: shellPalette.primarySoft,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 22,
        color: shellPalette.primary,
    } satisfies CSSProperties,
    rowMarginTop16: { marginTop: 12 } satisfies CSSProperties,
    centeredPadding56MinHeight300: centeredPadding56MinHeight300Style,
    centeredPadding56: centeredPadding56Style,
    signalCard: {
        padding: '0 0 12px',
        borderBottom: `1px solid ${shellPalette.border}`,
        background: 'transparent',
    } satisfies CSSProperties,
    signalIcon: (tone: string) => ({ color: tone, fontSize: 18 } satisfies CSSProperties),
    errorCard: (hasErrors: boolean) => ({
        borderRadius: 18,
        padding: 16,
        border: '1px solid rgba(239, 68, 68, 0.16)',
        background: hasErrors
            ? 'rgba(254, 242, 242, 0.92)'
            : shellPalette.surfaceMuted,
    } satisfies CSSProperties),
    centeredPadding24: centeredPadding24Style,
    listItemReset: { paddingInline: 0 } satisfies CSSProperties,
    providerCard: {
        width: '100%',
        borderRadius: 14,
        padding: 12,
        display: 'grid',
        gap: 8,
        border: `1px solid ${shellPalette.border}`,
        background: shellPalette.surfaceMuted,
    } satisfies CSSProperties,
    providerSummaryRow: {
        display: 'grid',
        gap: 6,
        padding: '0 0 4px',
    } satisfies CSSProperties,
    providerSummaryMeta: {
        fontSize: 12,
        color: shellPalette.muted,
    } satisfies CSSProperties,
    providerScrollRow: {
        display: 'grid',
        gap: 10,
        maxHeight: 360,
        overflowY: 'auto',
        paddingRight: 4,
        scrollbarWidth: 'thin',
    } satisfies CSSProperties,
    providerCardHeader: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 12,
    } satisfies CSSProperties,
    textAlignRight: { textAlign: 'right' } satisfies CSSProperties,
    providerCount: { fontSize: 24, fontWeight: 760, color: shellPalette.ink } satisfies CSSProperties,
    clockIcon: { color: '#94a3b8' } satisfies CSSProperties,
    mutedSectionHint: { fontSize: 13, color: shellPalette.muted } satisfies CSSProperties,
} as const;

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
    const proofScenario = isLocalProofHost() ? searchParams.get('proof')?.trim() || '' : '';
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
            requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
            cancelIdleCallback?: (handle: number) => void;
        };

        const loadCore = async () => {
            try {
                const [statsRes, emailStatsRes, logsRes, errorEmailsRes] = await Promise.all([
                    dashboardContract.getStats<Stats>(),
                    dashboardContract.getEmailStats<EmailStats>(),
                    dashboardContract.getLogs<LogItem>({ page: 1, pageSize: 6 }),
                    dashboardContract.getErrorEmails<ErrorEmailItem>({ page: 1, pageSize: 5, status: 'ERROR' }),
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
                console.error('Failed to fetch dashboard core data:', err);
            } finally {
                if (!disposed) {
                    setCoreLoading(false);
                    setLogsLoading(false);
                }
            }
        };

        void loadCore();

        if (typeof idleWindow.requestIdleCallback === 'function') {
            idleId = idleWindow.requestIdleCallback(() => {
                if (!disposed) {
                    setChartsReady(true);
                }
            }, { timeout: 1200 });
        } else {
            timerId = window.setTimeout(() => {
                if (!disposed) {
                    setChartsReady(true);
                }
            }, 350);
        }

        return () => {
            disposed = true;
            if (idleId !== null && typeof idleWindow.cancelIdleCallback === 'function') {
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
        if (!target || typeof IntersectionObserver === 'undefined') {
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
            { rootMargin: '120px 0px' }
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
                const trendRes = await dashboardContract.getApiTrend<ApiTrendItem>(trendDays);
                if (!cancelled && trendRes.code === 200) {
                    setApiTrend(trendRes.data);
                }
            } catch (err) {
                console.error('Failed to fetch dashboard trend:', err);
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

    const safeEmailStats = useMemo<EmailStats>(() => emailStats || {
        total: 0,
        active: 0,
        error: 0,
        providers: {},
    }, [emailStats]);

    const statsData = useMemo<Stats>(() => stats || {
        apiKeys: { total: 0, active: 0, totalUsage: 0, todayActive: 0 },
        domainMail: { domains: 0, activeDomains: 0, mailboxes: 0, activeMailboxes: 0, inboundMessages: 0, outboundMessages: 0 },
    }, [stats]);

    const providerSummary = useMemo(() => PROVIDER_ORDER.map((provider) => {
        return {
            key: provider,
            label: getProviderLabelMessage(provider),
            count: safeEmailStats.providers[provider] || 0,
            hint: getProviderDescriptionMessage(provider),
        };
    }), [safeEmailStats]);

    const rankedProviders = useMemo(() => [...providerSummary].sort((left, right) => {
        if (right.count !== left.count) {
            return right.count - left.count;
        }
        return t(left.label).localeCompare(t(right.label), 'zh-Hans-CN');
    }), [providerSummary, t]);

    const activeProviderCount = useMemo(() => rankedProviders.filter((item) => item.count > 0).length, [rankedProviders]);
    const dominantProvider = rankedProviders.find((item) => item.count > 0) || rankedProviders[0];

    const automationHealthScore = useMemo(() => {
        const emailHealth = safeEmailStats.total > 0 ? safeEmailStats.active / safeEmailStats.total : 1;
        const domainHealth = statsData.domainMail.mailboxes > 0 ? statsData.domainMail.activeMailboxes / statsData.domainMail.mailboxes : 1;
        const keyHealth = statsData.apiKeys.total > 0 ? statsData.apiKeys.active / statsData.apiKeys.total : 1;
        return Math.round(((emailHealth * 0.45) + (domainHealth * 0.35) + (keyHealth * 0.2)) * 100);
    }, [safeEmailStats, statsData]);

    const heroBadges = useMemo(() => ([
        { key: 'external-connections', label: dashboardPageI18n.badgeExternalConnections, value: `${safeEmailStats.active}/${safeEmailStats.total}` },
        { key: 'domain-mailboxes', label: dashboardPageI18n.badgeDomainMailboxes, value: `${statsData.domainMail.activeMailboxes}/${statsData.domainMail.mailboxes}` },
        { key: 'today-active-keys', label: dashboardPageI18n.badgeTodayActiveKeys, value: String(statsData.apiKeys.todayActive) },
    ]), [safeEmailStats, statsData]);

    const systemSignals = [
        {
            title: t(dashboardPageI18n.emailHealthTitle),
            description: safeEmailStats.error > 0
                ? t(dashboardPageI18n.emailHealthWarning, { count: safeEmailStats.error })
                : t(dashboardPageI18n.emailHealthHealthy),
            tone: safeEmailStats.error > 0 ? '#dc2626' : '#2f9e77',
            icon: safeEmailStats.error > 0 ? <WarningOutlined /> : <CheckCircleOutlined />,
        },
        {
            title: t(dashboardPageI18n.domainRuntimeTitle),
            description: statsData.domainMail.activeDomains === statsData.domainMail.domains
                ? t(dashboardPageI18n.domainRuntimeAllActive, { count: statsData.domainMail.domains })
                : t(dashboardPageI18n.domainRuntimePartial, { active: statsData.domainMail.activeDomains, total: statsData.domainMail.domains }),
            tone: statsData.domainMail.activeDomains === statsData.domainMail.domains ? '#0f766e' : '#d97706',
            icon: <CloudServerOutlined />,
        },
        {
            title: t(dashboardPageI18n.automationPulseTitle),
            description: statsData.apiKeys.todayActive > 0
                ? t(dashboardPageI18n.automationPulseActive, { count: statsData.apiKeys.todayActive })
                : t(dashboardPageI18n.automationPulseIdle),
            tone: statsData.apiKeys.todayActive > 0 ? shellPalette.primary : shellPalette.muted,
            icon: <ThunderboltOutlined />,
        },
    ];

    const trendTotal = useMemo(() => apiTrend.reduce((sum, item) => sum + item.count, 0), [apiTrend]);
    const trendPeak = useMemo(() => apiTrend.reduce((max, item) => Math.max(max, item.count), 0), [apiTrend]);
    const averageTrend = apiTrend.length > 0 ? Math.round(trendTotal / apiTrend.length) : 0;

    return (
        <div>
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
                            <Button type="primary" icon={<MailOutlined />}>{t(dashboardPageI18n.manageConnections)}</Button>
                        </Link>
                        <Link to="/domain-mailboxes">
                            <Button>{t(dashboardPageI18n.domainMailboxes)}</Button>
                        </Link>
                    </Space>
                }
            />
            {isDegradedProof ? (
                <Alert
                    type="warning"
                    showIcon
                    banner
                    title={t(dashboardPageI18n.degradedProofTitle)}
                    description={t(dashboardPageI18n.degradedProofDescription)}
                    style={{ marginBottom: 16 }}
                />
            ) : null}
            <SurfaceCard
                tone="muted"
                style={dashboardStyles.heroCard}
                bodyStyle={{ padding: 24 }}
            >
                <Row gutter={[24, 24]} align="middle">
                    <Col xs={24} xl={16}>
                        <Space orientation="vertical" size={18} style={dashboardStyles.fullWidth}>
                            <div>
                                <Text style={dashboardStyles.heroKicker}>{t(dashboardPageI18n.dailyPosture)}</Text>
                                <Title level={3} style={dashboardStyles.heroTitle}>{t(dashboardPageI18n.heroTitle)}</Title>
                                <Paragraph style={dashboardStyles.heroParagraph}>
                                    {t(dashboardPageI18n.heroDescription)}
                                </Paragraph>
                            </div>
                            <Space wrap size={12}>
                                {heroBadges.map((badge) => (
                                    <div
                                        key={badge.key}
                                        style={dashboardStyles.heroBadgeCard}
                                    >
                                        <Text type="secondary" style={dashboardStyles.heroBadgeLabel}>{t(badge.label)}</Text>
                                        <div style={dashboardStyles.heroBadgeValue}>{badge.value}</div>
                                    </div>
                                ))}
                            </Space>
                        </Space>
                    </Col>
                    <Col xs={24} xl={8}>
                        <div style={dashboardStyles.heroSummaryPanel}>
                            <Space orientation="vertical" size={18} style={dashboardStyles.fullWidth}>
                                <Space align="start" style={dashboardStyles.flexBetweenFullWidth}>
                                    <div>
                                        <Text style={dashboardStyles.healthLabel}>{t(dashboardPageI18n.healthScore)}</Text>
                                        <div style={dashboardStyles.healthScoreRow}>
                                            <span style={dashboardStyles.healthScoreValue}>{automationHealthScore}</span>
                                            <span style={dashboardStyles.healthScoreMax}>/ 100</span>
                                        </div>
                                    </div>
                                    <div style={dashboardStyles.healthIconBox}>
                                        <SafetyCertificateOutlined />
                                    </div>
                                </Space>
                                <Progress percent={automationHealthScore} strokeColor={shellPalette.accent} railColor="rgba(148, 163, 184, 0.18)" showInfo={false} />
                                <div style={dashboardStyles.healthMetricGrid}>
                                    <div style={dashboardStyles.healthMetricRow}>
                                        <Text style={dashboardStyles.healthLabel}>{t(dashboardPageI18n.callsInLastDays, { days: trendDays })}</Text>
                                        <Text style={dashboardStyles.darkText}>{trendTotal}</Text>
                                    </div>
                                    <div style={dashboardStyles.healthMetricRow}>
                                        <Text style={dashboardStyles.healthLabel}>{t(dashboardPageI18n.dailyAverage)}</Text>
                                        <Text style={dashboardStyles.darkText}>{averageTrend}</Text>
                                    </div>
                                    <div style={dashboardStyles.healthMetricRow}>
                                        <Text style={dashboardStyles.healthLabel}>{t(dashboardPageI18n.peak)}</Text>
                                        <Text style={dashboardStyles.darkText}>{trendPeak}</Text>
                                    </div>
                                </div>
                            </Space>
                        </div>
                    </Col>
                </Row>
            </SurfaceCard>

            <Row gutter={[16, 16]}>
                <Col xs={12} md={6} xl={6}>
                    <StatCard title={t(dashboardPageI18n.healthyConnections)} value={safeEmailStats.active} suffix={`/ ${safeEmailStats.total}`} icon={<CheckCircleOutlined />} iconBgColor={shellPalette.success} loading={coreLoading} />
                </Col>
                <Col xs={12} md={6} xl={6}>
                    <StatCard title={t(dashboardPageI18n.totalRequests)} value={statsData.apiKeys.totalUsage} icon={<ApiOutlined />} iconBgColor={shellPalette.accent} loading={coreLoading} />
                </Col>
                <Col xs={12} md={6} xl={6}>
                    <StatCard title={t(dashboardPageI18n.activeKeys)} value={statsData.apiKeys.active} suffix={`/ ${statsData.apiKeys.total}`} icon={<KeyOutlined />} iconBgColor={shellPalette.warning} loading={coreLoading} />
                </Col>
                <Col xs={12} md={6} xl={6}>
                    <StatCard title={t(dashboardPageI18n.activeDomainMailboxes)} value={statsData.domainMail.activeMailboxes} suffix={`/ ${statsData.domainMail.mailboxes}`} icon={<InboxOutlined />} iconBgColor={shellPalette.primary} loading={coreLoading} />
                </Col>
            </Row>

            <Row gutter={[16, 16]} style={dashboardStyles.rowMarginTop16}>
                <Col xs={24} xl={16}>
                    <Space orientation="vertical" size={16} style={dashboardStyles.fullWidth}>
                        <Card variant="borderless" style={cardStyle} styles={{ body: cardBodyStyle }} ref={chartsSectionRef}>
                            <Space orientation="vertical" size={18} style={dashboardStyles.fullWidth}>
                                <Space align="start" style={dashboardStyles.flexBetweenFullWidth} wrap>
                                <div>
                                    <Title level={4} style={dashboardStyles.titleNoMargin}>{t(dashboardPageI18n.apiTrendTitle)}</Title>
                                    <Text type="secondary">{t(dashboardPageI18n.apiTrendSubtitle)}</Text>
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
                                    <div style={dashboardStyles.centeredPadding56MinHeight300}><Spin /></div>
                                ) : (
                                    <Suspense fallback={<div style={dashboardStyles.centeredPadding56}><Spin /></div>}>
                                        <LineChart data={apiTrend} color={shellPalette.primary} height={300} ariaLabel={t('dashboard.charts.apiTrendAria')} />
                                    </Suspense>
                                )}
                            </Space>
                        </Card>

                        <Card variant="borderless" style={cardStyle} styles={{ body: cardBodyStyle }} loading={coreLoading}>
                            <Space orientation="vertical" size={16} style={dashboardStyles.fullWidth}>
                                <div>
                                    <Title level={4} style={dashboardStyles.titleNoMargin}>{t(dashboardPageI18n.providerBreakdownTitle)}</Title>
                                    <Text type="secondary">{t(dashboardPageI18n.providerBreakdownSubtitle)}</Text>
                                </div>
                                <div style={dashboardStyles.providerSummaryRow}>
                                    <Text strong style={{ color: shellPalette.ink }}>{t(dashboardPageI18n.providersCarryingPool, { count: activeProviderCount })}</Text>
                                    <Text style={dashboardStyles.providerSummaryMeta}>
                                        {dominantProvider && dominantProvider.count > 0
                                            ? t(dashboardPageI18n.dominantProvider, { provider: t(dominantProvider.label) })
                                            : t(dashboardPageI18n.noActiveProviders)}
                                    </Text>
                                </div>
                                <div style={dashboardStyles.providerScrollRow}>
                                    {rankedProviders.map((item) => (
                                        <div
                                            key={item.key}
                                            style={dashboardStyles.providerCard}
                                        >
                                            <div style={dashboardStyles.providerCardHeader}>
                                                <Text strong style={{ color: shellPalette.ink }}>{t(item.label)}</Text>
                                                <div style={dashboardStyles.textAlignRight}>
                                                    <div style={dashboardStyles.providerCount}>{item.count}</div>
                                                    <Text type="secondary">{item.count > 0 ? t(dashboardPageI18n.activePool) : t(dashboardPageI18n.unused)}</Text>
                                                </div>
                                            </div>
                                            <Paragraph style={{ margin: 0, color: shellPalette.muted, fontSize: 13 }}>
                                                {t(item.hint)}
                                            </Paragraph>
                                        </div>
                                    ))}
                                </div>
                            </Space>
                        </Card>
                    </Space>
                </Col>
                <Col xs={24} xl={8}>
                    <Card variant="borderless" style={cardStyle} styles={{ body: cardBodyStyle }}>
                        <Space orientation="vertical" size={16} style={dashboardStyles.fullWidth}>
                            <div>
                                <Title level={4} style={dashboardStyles.titleNoMargin}>{t(dashboardPageI18n.systemSignalsTitle)}</Title>
                                <Text type="secondary">{t(dashboardPageI18n.systemSignalsSubtitle)}</Text>
                            </div>
                            {systemSignals.map((signal) => (
                                <div
                                    key={signal.title}
                                    style={dashboardStyles.signalCard}
                                >
                                    <Space orientation="vertical" size={8} style={dashboardStyles.fullWidth}>
                                        <Space>
                                            <span style={dashboardStyles.signalIcon(signal.tone)}>{signal.icon}</span>
                                            <Text strong>{signal.title}</Text>
                                        </Space>
                                        <Text type="secondary">{signal.description}</Text>
                                    </Space>
                                </div>
                            ))}
                            <div
                                style={dashboardStyles.errorCard(safeEmailStats.error > 0)}
                            >
                                <Space orientation="vertical" size={12} style={dashboardStyles.fullWidth}>
                                    <Space align="start" style={dashboardStyles.flexBetweenFullWidth}>
                                        <div>
                                            <Title level={5} style={dashboardStyles.titleNoMargin}>{t(dashboardPageI18n.errorEmailsTitle)}</Title>
                                            <Text type="secondary">{t(dashboardPageI18n.errorEmailsSubtitle)}</Text>
                                        </div>
                                        <Link to="/emails">
                                            <Button type="text" icon={<ArrowRightOutlined />}>{t(dashboardPageI18n.enterEmailsPage)}</Button>
                                        </Link>
                                    </Space>

                                    {coreLoading ? (
                                        <div style={dashboardStyles.centeredPadding24}><Spin /></div>
                                    ) : errorEmails.length === 0 ? (
                                        <Empty description={t(dashboardPageI18n.noErrorEmails)} image={Empty.PRESENTED_IMAGE_SIMPLE} />
                                    ) : (
                                        <Space orientation="vertical" size={12} style={dashboardStyles.fullWidth}>
                                            {errorEmails.map((item) => (
                                                <div key={item.id} style={dashboardStyles.listItemReset}>
                                                    <Space orientation="vertical" size={8} style={dashboardStyles.fullWidth}>
                                                        <Space wrap style={dashboardStyles.flexBetweenFullWidth}>
                                                            <Space wrap>
                                                                <Tag color="red">{t(dashboardPageI18n.errorTag)}</Tag>
                                                                <Tag color={getProviderDefinition(item.provider).tagColor}>{t(getProviderLabelMessage(item.provider))}</Tag>
                                                                <Text strong>{item.email}</Text>
                                                            </Space>
                                                            <Link
                                                                to={{
                                                                    pathname: '/emails',
                                                                    search: createSearchParams({
                                                                        status: 'ERROR',
                                                                        keyword: item.email,
                                                                        emailId: String(item.id),
                                                                    }).toString(),
                                                                }}
                                                            >
                                                                <Button type="text">{t(dashboardPageI18n.inspectNow)}</Button>
                                                            </Link>
                                                        </Space>
                                                        <Text type="secondary">{t(item.errorMessage || dashboardPageI18n.defaultErrorMessage)}</Text>
                                                        <Text type="secondary">{t(dashboardPageI18n.lastChecked, { time: item.lastCheckAt ? new Date(item.lastCheckAt).toLocaleString() : t(dashboardPageI18n.noRecord) })}</Text>
                                                    </Space>
                                                </div>
                                            ))}
                                        </Space>
                                    )}
                                </Space>
                            </div>
                        </Space>
                    </Card>
                </Col>
            </Row>

            <Row gutter={[16, 16]} style={dashboardStyles.rowMarginTop16}>
                <Col xs={24}>
                    <Card variant="borderless" style={cardStyle} styles={{ body: cardBodyStyle }} loading={logsLoading}>
                        <Space orientation="vertical" size={16} style={dashboardStyles.fullWidth}>
                            <Space align="start" style={dashboardStyles.flexBetweenFullWidth}>
                                <div>
                                    <Title level={4} style={dashboardStyles.titleNoMargin}>{t(dashboardPageI18n.recentActivitiesTitle)}</Title>
                                    <Text type="secondary">{t(dashboardPageI18n.recentActivitiesSubtitle)}</Text>
                                </div>
                                <Link to="/operation-logs">
                                    <Button type="text" icon={<ArrowRightOutlined />}>{t(dashboardPageI18n.viewAll)}</Button>
                                </Link>
                            </Space>
                            {recentLogs.length === 0 ? (
                                <Empty description={t(dashboardPageI18n.noRecentActivities)} />
                            ) : (
                                <Space orientation="vertical" size={12} style={dashboardStyles.fullWidth}>
                                    {recentLogs.map((item) => (
                                        <div key={item.id} style={dashboardStyles.listItemReset}>
                                            <Space orientation="vertical" size={6} style={dashboardStyles.fullWidth}>
                                                <Space wrap style={dashboardStyles.flexBetweenFullWidth}>
                                                    <Space wrap>
                                                        <Tag color={getLogActionColor(item.action)}>{t(getLogActionLabel(item.action))}</Tag>
                                                        {item.responseCode ? <Tag color={item.responseCode >= 400 ? 'error' : 'success'}>{item.responseCode}</Tag> : null}
                                                    </Space>
                                                    <Space size={6}>
                                                        <ClockCircleOutlined style={dashboardStyles.clockIcon} />
                                                        <Text type="secondary">{new Date(item.createdAt).toLocaleString()}</Text>
                                                    </Space>
                                                </Space>
                                                <Text type="secondary">
                                                    {item.apiKeyName && item.apiKeyName !== '-' ? t(dashboardPageI18n.apiKeyNamed, { name: item.apiKeyName }) : t(dashboardPageI18n.anonymousAction)}
                                                    {item.email && item.email !== '-' ? ` · ${item.email}` : ''}
                                                    {item.responseTimeMs ? ` · ${item.responseTimeMs} ms` : ''}
                                                </Text>
                                            </Space>
                                        </div>
                                    ))}
                                </Space>
                            )}
                        </Space>
                    </Card>
                </Col>
            </Row>
        </div>
    );
};

export default DashboardPage;
