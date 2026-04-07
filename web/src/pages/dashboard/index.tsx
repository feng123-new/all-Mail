import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties, type FC } from 'react';
import { Link, createSearchParams, useSearchParams } from 'react-router-dom';
import { Alert, Row, Col, Card, Typography, Spin, Space, Button, Segmented, List, Progress, Empty, Tag } from 'antd';
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
        const definition = getProviderDefinition(provider);
        return {
            key: provider,
            label: definition.label,
            count: safeEmailStats.providers[provider] || 0,
            hint: definition.summaryHint,
        };
    }), [safeEmailStats]);

    const rankedProviders = useMemo(() => [...providerSummary].sort((left, right) => {
        if (right.count !== left.count) {
            return right.count - left.count;
        }
        return left.label.localeCompare(right.label, 'zh-Hans-CN');
    }), [providerSummary]);

    const activeProviderCount = useMemo(() => rankedProviders.filter((item) => item.count > 0).length, [rankedProviders]);
    const dominantProvider = rankedProviders.find((item) => item.count > 0) || rankedProviders[0];

    const automationHealthScore = useMemo(() => {
        const emailHealth = safeEmailStats.total > 0 ? safeEmailStats.active / safeEmailStats.total : 1;
        const domainHealth = statsData.domainMail.mailboxes > 0 ? statsData.domainMail.activeMailboxes / statsData.domainMail.mailboxes : 1;
        const keyHealth = statsData.apiKeys.total > 0 ? statsData.apiKeys.active / statsData.apiKeys.total : 1;
        return Math.round(((emailHealth * 0.45) + (domainHealth * 0.35) + (keyHealth * 0.2)) * 100);
    }, [safeEmailStats, statsData]);

    const heroBadges = useMemo(() => ([
        { label: '外部连接', value: `${safeEmailStats.active}/${safeEmailStats.total}` },
        { label: '域名邮箱', value: `${statsData.domainMail.activeMailboxes}/${statsData.domainMail.mailboxes}` },
        { label: '今日活跃密钥', value: String(statsData.apiKeys.todayActive) },
    ]), [safeEmailStats, statsData]);

    const systemSignals = [
        {
            title: '邮箱健康度',
            description: safeEmailStats.error > 0
                ? `有 ${safeEmailStats.error} 个外部邮箱处于异常状态，下面已列出可直接排查的对象。`
                : '当前外部邮箱连接没有错误状态，适合继续承载自动化收件。',
            tone: safeEmailStats.error > 0 ? '#dc2626' : '#2f9e77',
            icon: safeEmailStats.error > 0 ? <WarningOutlined /> : <CheckCircleOutlined />,
        },
        {
            title: '域名运行态',
            description: statsData.domainMail.activeDomains === statsData.domainMail.domains
                ? `全部 ${statsData.domainMail.domains} 个域名都处于 ACTIVE。`
                : `${statsData.domainMail.activeDomains}/${statsData.domainMail.domains} 个域名处于 ACTIVE，请检查未激活域名的 DNS 或收件配置。`,
            tone: statsData.domainMail.activeDomains === statsData.domainMail.domains ? '#0f766e' : '#d97706',
            icon: <CloudServerOutlined />,
        },
        {
            title: '自动化热度',
            description: statsData.apiKeys.todayActive > 0
                ? `今天已有 ${statsData.apiKeys.todayActive} 个访问密钥发起自动化动作。`
                : '今天还没有访问密钥调用记录，适合做发布前联调或回归测试。',
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
                title="控制台概览"
                subtitle="把连接质量、域名邮箱、发信能力和自动化热度放在同一个运营视角下观察。"
                breadcrumb={[{ title: '控制台' }, { title: '概览' }]}
                extra={
                    <Space wrap>
                        <Link to="/emails">
                            <Button type="primary" icon={<MailOutlined />}>管理连接</Button>
                        </Link>
                        <Link to="/domain-mailboxes">
                            <Button>域名邮箱</Button>
                        </Link>
                    </Space>
                }
            />
            {isDegradedProof ? (
                <Alert
                    type="warning"
                    showIcon
                    banner
                    title="Proof scenario · degraded data"
                    description="此模式仅用于本地证据采集：模拟连接异常、域名未全量 ACTIVE 与自动化热度回落，便于捕获 Dashboard 的降级态与排查态截图。"
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
                                <Text style={dashboardStyles.heroKicker}>Daily posture</Text>
                                <Title level={3} style={dashboardStyles.heroTitle}>先确认连接、域名邮箱与自动化节奏</Title>
                                <Paragraph style={dashboardStyles.heroParagraph}>
                                    把最重要的运行信号先收紧到一屏：连接是否稳定、域名邮箱是否可用、今天的自动化是否正常推进。确定整体姿态后，再进入对象页处理细节。
                                </Paragraph>
                            </div>
                            <Space wrap size={12}>
                                {heroBadges.map((badge) => (
                                    <div
                                        key={badge.label}
                                        style={dashboardStyles.heroBadgeCard}
                                    >
                                        <Text type="secondary" style={dashboardStyles.heroBadgeLabel}>{badge.label}</Text>
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
                                        <Text style={dashboardStyles.healthLabel}>自动化健康评分</Text>
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
                                        <Text style={dashboardStyles.healthLabel}>近 {trendDays} 天调用</Text>
                                        <Text style={dashboardStyles.darkText}>{trendTotal}</Text>
                                    </div>
                                    <div style={dashboardStyles.healthMetricRow}>
                                        <Text style={dashboardStyles.healthLabel}>日均调用</Text>
                                        <Text style={dashboardStyles.darkText}>{averageTrend}</Text>
                                    </div>
                                    <div style={dashboardStyles.healthMetricRow}>
                                        <Text style={dashboardStyles.healthLabel}>峰值</Text>
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
                    <StatCard title="正常连接" value={safeEmailStats.active} suffix={`/ ${safeEmailStats.total}`} icon={<CheckCircleOutlined />} iconBgColor={shellPalette.success} loading={coreLoading} />
                </Col>
                <Col xs={12} md={6} xl={6}>
                    <StatCard title="总调用量" value={statsData.apiKeys.totalUsage} icon={<ApiOutlined />} iconBgColor={shellPalette.accent} loading={coreLoading} />
                </Col>
                <Col xs={12} md={6} xl={6}>
                    <StatCard title="活跃密钥" value={statsData.apiKeys.active} suffix={`/ ${statsData.apiKeys.total}`} icon={<KeyOutlined />} iconBgColor={shellPalette.warning} loading={coreLoading} />
                </Col>
                <Col xs={12} md={6} xl={6}>
                    <StatCard title="活跃域名邮箱" value={statsData.domainMail.activeMailboxes} suffix={`/ ${statsData.domainMail.mailboxes}`} icon={<InboxOutlined />} iconBgColor={shellPalette.primary} loading={coreLoading} />
                </Col>
            </Row>

            <Row gutter={[16, 16]} style={dashboardStyles.rowMarginTop16}>
                <Col xs={24} xl={16}>
                    <Space orientation="vertical" size={16} style={dashboardStyles.fullWidth}>
                        <Card variant="borderless" style={cardStyle} styles={{ body: cardBodyStyle }} ref={chartsSectionRef}>
                            <Space orientation="vertical" size={18} style={dashboardStyles.fullWidth}>
                                <Space align="start" style={dashboardStyles.flexBetweenFullWidth} wrap>
                                    <div>
                                        <Title level={4} style={dashboardStyles.titleNoMargin}>自动化趋势</Title>
                                    <Text type="secondary">看调用热度变化，判断当前更适合验证、分配还是回归测试。</Text>
                                    </div>
                                    <Segmented<TrendWindow>
                                        value={trendDays}
                                        onChange={(value) => setTrendDays(value)}
                                        options={[
                                            { label: '7 天', value: 7 },
                                            { label: '14 天', value: 14 },
                                            { label: '30 天', value: 30 },
                                        ]}
                                    />
                                </Space>
                                {!chartsReady || !chartsInView || trendLoading ? (
                                    <div style={dashboardStyles.centeredPadding56MinHeight300}><Spin /></div>
                                ) : (
                                    <Suspense fallback={<div style={dashboardStyles.centeredPadding56}><Spin /></div>}>
                                        <LineChart data={apiTrend} color={shellPalette.primary} height={300} />
                                    </Suspense>
                                )}
                            </Space>
                        </Card>

                        <Card variant="borderless" style={cardStyle} styles={{ body: cardBodyStyle }} loading={coreLoading}>
                            <Space orientation="vertical" size={16} style={dashboardStyles.fullWidth}>
                                <div>
                                    <Title level={4} style={dashboardStyles.titleNoMargin}>Provider 分布</Title>
                                    <Text type="secondary">把全部 provider 收进独立面板，向下滚动检查收件来源是否过度集中。</Text>
                                </div>
                                <div style={dashboardStyles.providerSummaryRow}>
                                    <Text strong style={{ color: shellPalette.ink }}>{activeProviderCount} 类 Provider 正在承载当前邮箱池</Text>
                                    <Text style={dashboardStyles.providerSummaryMeta}>
                                        {dominantProvider && dominantProvider.count > 0
                                            ? `${dominantProvider.label} 当前占主导；向下滚动可以继续查看全部 provider 分布。`
                                            : '当前没有活跃 provider，保留完整分布视图以便初始化配置时快速确认。'}
                                    </Text>
                                </div>
                                <div style={dashboardStyles.providerScrollRow}>
                                    {rankedProviders.map((item) => (
                                        <div
                                            key={item.key}
                                            style={dashboardStyles.providerCard}
                                        >
                                            <div style={dashboardStyles.providerCardHeader}>
                                                <Text strong style={{ color: shellPalette.ink }}>{item.label}</Text>
                                                <div style={dashboardStyles.textAlignRight}>
                                                    <div style={dashboardStyles.providerCount}>{item.count}</div>
                                                    <Text type="secondary">{item.count > 0 ? '活跃池' : '未使用'}</Text>
                                                </div>
                                            </div>
                                            <Paragraph style={{ margin: 0, color: shellPalette.muted, fontSize: 13 }}>
                                                {item.hint}
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
                                <Title level={4} style={dashboardStyles.titleNoMargin}>系统信号</Title>
                                <Text type="secondary">先看风险，再决定进入哪个对象页处理。</Text>
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
                                            <Title level={5} style={dashboardStyles.titleNoMargin}>异常外部邮箱</Title>
                                            <Text type="secondary">直接列出当前需要优先检查的外部邮箱连接。</Text>
                                        </div>
                                        <Link to="/emails">
                                            <Button type="text" icon={<ArrowRightOutlined />}>进入邮箱页</Button>
                                        </Link>
                                    </Space>

                                    {coreLoading ? (
                                        <div style={dashboardStyles.centeredPadding24}><Spin /></div>
                                    ) : errorEmails.length === 0 ? (
                                        <Empty description="当前没有异常外部邮箱，连接状态保持正常。" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                                    ) : (
                                        <List
                                            dataSource={errorEmails}
                                            renderItem={(item) => (
                                                <List.Item key={item.id} style={dashboardStyles.listItemReset}>
                                                    <Space orientation="vertical" size={8} style={dashboardStyles.fullWidth}>
                                                        <Space wrap style={dashboardStyles.flexBetweenFullWidth}>
                                                            <Space wrap>
                                                                <Tag color="red">异常</Tag>
                                                                <Tag color={getProviderDefinition(item.provider).tagColor}>{getProviderDefinition(item.provider).label}</Tag>
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
                                                                <Button type="text">直接检查</Button>
                                                            </Link>
                                                        </Space>
                                                        <Text type="secondary">{item.errorMessage || '当前连接检查失败，建议重新检查或重新走 OAuth 授权。'}</Text>
                                                        <Text type="secondary">最后检查：{item.lastCheckAt ? new Date(item.lastCheckAt).toLocaleString() : '暂无记录'}</Text>
                                                    </Space>
                                                </List.Item>
                                            )}
                                        />
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
                                    <Title level={4} style={dashboardStyles.titleNoMargin}>最近自动化活动</Title>
                                    <Text type="secondary">快速判断当前系统是在读信、取号还是清理资源。</Text>
                                </div>
                                <Link to="/operation-logs">
                                    <Button type="text" icon={<ArrowRightOutlined />}>查看全部</Button>
                                </Link>
                            </Space>
                            {recentLogs.length === 0 ? (
                                <Empty description="近期没有自动化调用记录，可先用访问密钥跑一次分配 / 读信链路，再回来看这里的活动回放。" />
                            ) : (
                                <List
                                    dataSource={recentLogs}
                                    renderItem={(item) => (
                                        <List.Item key={item.id} style={dashboardStyles.listItemReset}>
                                            <Space orientation="vertical" size={6} style={dashboardStyles.fullWidth}>
                                                <Space wrap style={dashboardStyles.flexBetweenFullWidth}>
                                                    <Space wrap>
                                                        <Tag color={getLogActionColor(item.action)}>{getLogActionLabel(item.action)}</Tag>
                                                        {item.responseCode ? <Tag color={item.responseCode >= 400 ? 'error' : 'success'}>{item.responseCode}</Tag> : null}
                                                    </Space>
                                                    <Space size={6}>
                                                        <ClockCircleOutlined style={dashboardStyles.clockIcon} />
                                                        <Text type="secondary">{new Date(item.createdAt).toLocaleString()}</Text>
                                                    </Space>
                                                </Space>
                                                <Text type="secondary">
                                                    {item.apiKeyName && item.apiKeyName !== '-' ? `访问密钥 ${item.apiKeyName}` : '匿名动作'}
                                                    {item.email && item.email !== '-' ? ` · ${item.email}` : ''}
                                                    {item.responseTimeMs ? ` · ${item.responseTimeMs} ms` : ''}
                                                </Text>
                                            </Space>
                                        </List.Item>
                                    )}
                                />
                            )}
                        </Space>
                    </Card>
                </Col>
            </Row>
        </div>
    );
};

export default DashboardPage;
