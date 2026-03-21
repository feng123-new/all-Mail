import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties, type FC } from 'react';
import { Link, createSearchParams } from 'react-router-dom';
import { Row, Col, Card, Tag, Typography, Spin, Space, Button, Segmented, List, Progress, Empty, Tooltip } from 'antd';
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
    RocketOutlined,
    ClockCircleOutlined,
} from '@ant-design/icons';
import type { SimpleDonutChartProps, SimpleLineChartProps } from '../../components/charts';
import { StatCard } from '../../components';
import { dashboardApi, emailApi } from '../../api';
import { PROVIDER_ORDER, getProviderDefinition, type EmailProvider } from '../../constants/providers';
import { getLogActionColor, getLogActionLabel } from '../../constants/logActions';

const { Title, Text, Paragraph } = Typography;

const LineChart = lazy(async () => {
    const mod = await import('../../components/charts');
    return { default: mod.SimpleLineChart as ComponentType<SimpleLineChartProps> };
});

const PieChart = lazy(async () => {
    const mod = await import('../../components/charts');
    return { default: mod.SimpleDonutChart as ComponentType<SimpleDonutChartProps> };
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
    providers: {
        outlook: number;
        gmail: number;
        qq: number;
    };
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

const providerCountKeys: Record<EmailProvider, keyof EmailStats['providers']> = {
    OUTLOOK: 'outlook',
    GMAIL: 'gmail',
    QQ: 'qq',
};

const cardStyle: CSSProperties = {
    borderRadius: 24,
    border: '1px solid rgba(148, 163, 184, 0.18)',
    boxShadow: '0 24px 48px rgba(15, 23, 42, 0.08)',
    overflow: 'hidden',
};

const cardBodyStyle: CSSProperties = {
    padding: 24,
};

const DashboardPage: FC = () => {
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

    useEffect(() => {
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
                    dashboardApi.getStats<Stats>(),
                    emailApi.getStats<EmailStats>(),
                    dashboardApi.getLogs<LogItem>({ page: 1, pageSize: 6 }),
                    emailApi.getList<ErrorEmailItem>({ page: 1, pageSize: 5, status: 'ERROR' }),
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
    }, []);

    useEffect(() => {
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
    }, []);

    useEffect(() => {
        if (!chartsReady || !chartsInView) {
            return;
        }

        let cancelled = false;
        setTrendLoading(true);

        const loadTrend = async () => {
            try {
                const trendRes = await dashboardApi.getApiTrend<ApiTrendItem>(trendDays);
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
    }, [chartsInView, chartsReady, trendDays]);

    const safeEmailStats = useMemo<EmailStats>(() => emailStats || {
        total: 0,
        active: 0,
        error: 0,
        providers: { outlook: 0, gmail: 0, qq: 0 },
    }, [emailStats]);

    const statsData = useMemo<Stats>(() => stats || {
        apiKeys: { total: 0, active: 0, totalUsage: 0, todayActive: 0 },
        domainMail: { domains: 0, activeDomains: 0, mailboxes: 0, activeMailboxes: 0, inboundMessages: 0, outboundMessages: 0 },
    }, [stats]);

    const pieData = useMemo(() => ([
        { type: '正常', value: safeEmailStats.active, color: '#2f9e77' },
        { type: '异常', value: safeEmailStats.error, color: '#dc2626' },
        { type: '禁用', value: Math.max(0, safeEmailStats.total - safeEmailStats.active - safeEmailStats.error), color: '#94a3b8' },
    ].filter((item) => item.value > 0)), [safeEmailStats]);

    const providerSummary = useMemo(() => PROVIDER_ORDER.map((provider) => {
        const definition = getProviderDefinition(provider);
        return {
            key: provider,
            label: definition.label,
            count: safeEmailStats.providers[providerCountKeys[provider]],
            color: definition.tagColor,
            hint: definition.summaryHint,
        };
    }), [safeEmailStats]);

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

    const quickLinks = [
        { to: '/emails', label: '外部邮箱连接', icon: <MailOutlined />, hint: '检查 Outlook / Gmail / QQ 连接质量' },
        { to: '/domain-mailboxes', label: '域名邮箱', icon: <InboxOutlined />, hint: '查看门户邮箱、批次和转发状态' },
        { to: '/api-keys', label: '访问密钥', icon: <KeyOutlined />, hint: '管控自动化访问范围和分配策略' },
        { to: '/api-docs', label: 'API 文档', icon: <ApiOutlined />, hint: '面向外部系统和脚本调用方' },
    ];

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
            tone: statsData.apiKeys.todayActive > 0 ? '#5865f2' : '#64748b',
            icon: <ThunderboltOutlined />,
        },
    ];

    const trendTotal = useMemo(() => apiTrend.reduce((sum, item) => sum + item.count, 0), [apiTrend]);
    const trendPeak = useMemo(() => apiTrend.reduce((max, item) => Math.max(max, item.count), 0), [apiTrend]);
    const averageTrend = apiTrend.length > 0 ? Math.round(trendTotal / apiTrend.length) : 0;

    return (
        <div>
            <Card
                bordered={false}
                style={{
                    ...cardStyle,
                    background: 'radial-gradient(circle at top left, rgba(88, 101, 242, 0.16), transparent 42%), linear-gradient(135deg, #ffffff 0%, #eef4ff 55%, #f8fbff 100%)',
                    marginBottom: 20,
                }}
                styles={{ body: { padding: 28 } }}
            >
                <Row gutter={[24, 24]} align="middle">
                    <Col xs={24} xl={15}>
                        <Space direction="vertical" size={18} style={{ width: '100%' }}>
                            <Space wrap>
                                <Tag color="blue">Control Plane</Tag>
                                <Tag color="cyan">Multi-provider Mail</Tag>
                                <Tag color="purple">Automation Ready</Tag>
                            </Space>
                            <div>
                                <Title level={2} style={{ margin: 0 }}>控制台概览</Title>
                                <Paragraph style={{ margin: '12px 0 0', color: '#475569', fontSize: 15, maxWidth: 720 }}>
                                    把连接质量、域名收件、自动化活跃度和最近操作放到同一屏里看，先判断系统是否稳，再进入对象级页面处理细节。
                                </Paragraph>
                            </div>
                            <Space wrap size={12}>
                                {heroBadges.map((badge) => (
                                    <div
                                        key={badge.label}
                                        style={{
                                            minWidth: 148,
                                            padding: '12px 14px',
                                            borderRadius: 16,
                                            border: '1px solid rgba(148, 163, 184, 0.22)',
                                            background: 'rgba(255, 255, 255, 0.78)',
                                        }}
                                    >
                                        <Text type="secondary" style={{ fontSize: 12 }}>{badge.label}</Text>
                                        <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{badge.value}</div>
                                    </div>
                                ))}
                            </Space>
                            <Space wrap>
                                {quickLinks.map((link) => (
                                    <Link key={link.to} to={link.to}>
                                        <Button type={link.to === '/emails' ? 'primary' : 'default'} icon={link.icon}>
                                            {link.label}
                                        </Button>
                                    </Link>
                                ))}
                            </Space>
                        </Space>
                    </Col>
                    <Col xs={24} xl={9}>
                        <Card
                            bordered={false}
                            style={{ borderRadius: 22, background: 'rgba(15, 23, 42, 0.96)', color: '#fff' }}
                            styles={{ body: { padding: 24 } }}
                        >
                            <Space direction="vertical" size={18} style={{ width: '100%' }}>
                                <Space align="start" style={{ justifyContent: 'space-between', width: '100%' }}>
                                    <div>
                                        <Text style={{ color: 'rgba(255,255,255,0.72)' }}>自动化健康评分</Text>
                                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 6 }}>
                                            <span style={{ fontSize: 40, lineHeight: 1, fontWeight: 800 }}>{automationHealthScore}</span>
                                            <span style={{ color: 'rgba(255,255,255,0.68)' }}>/ 100</span>
                                        </div>
                                    </div>
                                    <div
                                        style={{
                                            width: 52,
                                            height: 52,
                                            borderRadius: 16,
                                            background: 'linear-gradient(135deg, rgba(88, 101, 242, 1), rgba(45, 212, 191, 1))',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontSize: 22,
                                        }}
                                    >
                                        <SafetyCertificateOutlined />
                                    </div>
                                </Space>
                                <Progress percent={automationHealthScore} strokeColor="#2dd4bf" trailColor="rgba(255,255,255,0.12)" showInfo={false} />
                                <div style={{ display: 'grid', gap: 12 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <Text style={{ color: 'rgba(255,255,255,0.72)' }}>近 {trendDays} 天调用</Text>
                                        <Text style={{ color: '#fff' }}>{trendTotal}</Text>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <Text style={{ color: 'rgba(255,255,255,0.72)' }}>日均调用</Text>
                                        <Text style={{ color: '#fff' }}>{averageTrend}</Text>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <Text style={{ color: 'rgba(255,255,255,0.72)' }}>峰值</Text>
                                        <Text style={{ color: '#fff' }}>{trendPeak}</Text>
                                    </div>
                                </div>
                            </Space>
                        </Card>
                    </Col>
                </Row>
            </Card>

            <Row gutter={[16, 16]}>
                <Col xs={12} md={8} xl={4}>
                    <StatCard title="邮箱总数" value={safeEmailStats.total} icon={<MailOutlined />} iconBgColor="#5865f2" loading={coreLoading} />
                </Col>
                <Col xs={12} md={8} xl={4}>
                    <StatCard title="正常连接" value={safeEmailStats.active} suffix={`/ ${safeEmailStats.total}`} icon={<CheckCircleOutlined />} iconBgColor="#2f9e77" loading={coreLoading} />
                </Col>
                <Col xs={12} md={8} xl={4}>
                    <StatCard title="总调用量" value={statsData.apiKeys.totalUsage} icon={<ApiOutlined />} iconBgColor="#0f766e" loading={coreLoading} />
                </Col>
                <Col xs={12} md={8} xl={4}>
                    <StatCard title="活跃密钥" value={statsData.apiKeys.active} suffix={`/ ${statsData.apiKeys.total}`} icon={<KeyOutlined />} iconBgColor="#d97706" loading={coreLoading} />
                </Col>
                <Col xs={12} md={8} xl={4}>
                    <StatCard title="域名总数" value={statsData.domainMail.domains} suffix={`/ ${statsData.domainMail.activeDomains} 活跃`} icon={<CloudServerOutlined />} iconBgColor="#0284c7" loading={coreLoading} />
                </Col>
                <Col xs={12} md={8} xl={4}>
                    <StatCard title="活跃域名邮箱" value={statsData.domainMail.activeMailboxes} suffix={`/ ${statsData.domainMail.mailboxes}`} icon={<InboxOutlined />} iconBgColor="#7c3aed" loading={coreLoading} />
                </Col>
            </Row>

            <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                <Col xs={24} xl={16}>
                    <Card bordered={false} style={cardStyle} styles={{ body: cardBodyStyle }} ref={chartsSectionRef}>
                        <Space direction="vertical" size={18} style={{ width: '100%' }}>
                            <Space align="start" style={{ justifyContent: 'space-between', width: '100%' }} wrap>
                                <div>
                                    <Title level={4} style={{ margin: 0 }}>自动化趋势</Title>
                                    <Text type="secondary">观察访问密钥调用热度，判断是否适合做批量验证、分配或回归测试。</Text>
                                </div>
                                <Space direction="vertical" size={4} align="end">
                                    <Tooltip title="切换统计窗口后，趋势图会重新按 7 / 14 / 30 天聚合调用量。建议先看 14 天，再决定是否放大到 30 天。">
                                        <Segmented<TrendWindow>
                                            value={trendDays}
                                            onChange={(value) => setTrendDays(value)}
                                            options={[
                                                { label: '7 天', value: 7 },
                                                { label: '14 天', value: 14 },
                                                { label: '30 天', value: 30 },
                                            ]}
                                        />
                                    </Tooltip>
                                    <Text type="secondary" style={{ fontSize: 12 }}>14 天适合看近期波动，30 天适合看节奏变化。</Text>
                                </Space>
                            </Space>
                            {!chartsReady || !chartsInView || trendLoading ? (
                                <div style={{ textAlign: 'center', padding: 56, minHeight: 300 }}><Spin /></div>
                            ) : (
                                <Suspense fallback={<div style={{ textAlign: 'center', padding: 56 }}><Spin /></div>}>
                                    <LineChart data={apiTrend} color="#5865f2" height={300} />
                                </Suspense>
                            )}
                        </Space>
                    </Card>
                </Col>
                <Col xs={24} xl={8}>
                    <Card bordered={false} style={cardStyle} styles={{ body: cardBodyStyle }}>
                        <Space direction="vertical" size={16} style={{ width: '100%' }}>
                            <div>
                                <Title level={4} style={{ margin: 0 }}>系统信号</Title>
                                <Text type="secondary">先看风险，再决定进入哪个对象页处理。</Text>
                            </div>
                            {systemSignals.map((signal) => (
                                <div
                                    key={signal.title}
                                    style={{
                                        borderRadius: 18,
                                        padding: 16,
                                        border: '1px solid rgba(148, 163, 184, 0.18)',
                                        background: 'linear-gradient(180deg, rgba(248,250,252,0.88), rgba(241,245,249,0.94))',
                                    }}
                                >
                                    <Space direction="vertical" size={8} style={{ width: '100%' }}>
                                        <Space>
                                            <span style={{ color: signal.tone, fontSize: 18 }}>{signal.icon}</span>
                                            <Text strong>{signal.title}</Text>
                                        </Space>
                                        <Text type="secondary">{signal.description}</Text>
                                    </Space>
                                </div>
                            ))}
                            <div
                                style={{
                                    borderRadius: 18,
                                    padding: 18,
                                    background: 'linear-gradient(135deg, rgba(88, 101, 242, 0.14), rgba(14, 165, 233, 0.08))',
                                }}
                            >
                                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                                    <Space>
                                        <RocketOutlined style={{ color: '#5865f2' }} />
                                        <Text strong>下一步建议</Text>
                                    </Space>
                                    <Text type="secondary">如果你正在排查验证码流程，优先进入“外部邮箱连接”；如果你在看门户收发体验，优先进入“域名邮箱”或“门户用户”。</Text>
                                </Space>
                            </div>
                            <div
                                style={{
                                    borderRadius: 18,
                                    padding: 18,
                                    border: '1px solid rgba(239, 68, 68, 0.16)',
                                    background: safeEmailStats.error > 0
                                        ? 'linear-gradient(180deg, rgba(254, 242, 242, 0.96), rgba(255, 255, 255, 0.92))'
                                        : 'linear-gradient(180deg, rgba(248,250,252,0.88), rgba(241,245,249,0.94))',
                                }}
                            >
                                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                                    <Space align="start" style={{ justifyContent: 'space-between', width: '100%' }}>
                                        <div>
                                            <Title level={5} style={{ margin: 0 }}>异常外部邮箱</Title>
                                            <Text type="secondary">直接列出当前需要优先检查的外部邮箱连接。</Text>
                                        </div>
                                        <Link to="/emails">
                                            <Button type="link" icon={<ArrowRightOutlined />}>进入邮箱页</Button>
                                        </Link>
                                    </Space>

                                    {coreLoading ? (
                                        <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
                                    ) : errorEmails.length === 0 ? (
                                        <Empty description="当前没有异常外部邮箱，连接状态保持正常。" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                                    ) : (
                                        <List
                                            dataSource={errorEmails}
                                            renderItem={(item) => (
                                                <List.Item key={item.id} style={{ paddingInline: 0 }}>
                                                    <Space direction="vertical" size={8} style={{ width: '100%' }}>
                                                        <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
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
                                                                <Button type="link">直接检查</Button>
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

            <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                <Col xs={24} xl={9}>
                    <Card bordered={false} style={cardStyle} styles={{ body: cardBodyStyle }} loading={coreLoading}>
                        <Space direction="vertical" size={16} style={{ width: '100%' }}>
                            <div>
                                <Title level={4} style={{ margin: 0 }}>Provider 分布</Title>
                                <Text type="secondary">确认主要收件来源是否过度集中，以及 Gmail / QQ / Outlook 的覆盖情况。</Text>
                            </div>
                            <Text type="secondary" style={{ fontSize: 12 }}>如果 Outlook 占比长期过高，建议在引流或自动化策略里逐步增加 Gmail / QQ 覆盖，降低单 provider 风险。</Text>
                            {providerSummary.map((item) => (
                                <div
                                    key={item.key}
                                    style={{
                                        border: '1px solid rgba(148, 163, 184, 0.16)',
                                        borderRadius: 18,
                                        padding: 16,
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        gap: 12,
                                        background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
                                    }}
                                >
                                    <div>
                                        <Tag color={item.color}>{item.label}</Tag>
                                        <div style={{ marginTop: 8 }}>
                                            <Text type="secondary">{item.hint}</Text>
                                        </div>
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{ fontSize: 30, fontWeight: 800 }}>{item.count}</div>
                                        <Text type="secondary">当前账号数</Text>
                                    </div>
                                </div>
                            ))}
                        </Space>
                    </Card>
                </Col>
                <Col xs={24} xl={7}>
                    <Card bordered={false} style={cardStyle} styles={{ body: cardBodyStyle }}>
                        <Space direction="vertical" size={18} style={{ width: '100%' }}>
                            <div>
                                <Title level={4} style={{ margin: 0 }}>连接状态分布</Title>
                                <Text type="secondary">快速判断外部连接是健康、异常，还是只是尚未启用。</Text>
                            </div>
                            {coreLoading || !chartsReady || !chartsInView ? (
                                <div style={{ textAlign: 'center', padding: 56, minHeight: 260 }}><Spin /></div>
                            ) : pieData.length > 0 ? (
                                <Suspense fallback={<div style={{ textAlign: 'center', padding: 56 }}><Spin /></div>}>
                                    <PieChart data={pieData} total={safeEmailStats.total} title="连接" height={260} />
                                </Suspense>
                            ) : (
                                <div style={{ minHeight: 260, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <Empty description="暂无连接数据" />
                                </div>
                            )}
                        </Space>
                    </Card>
                </Col>
                <Col xs={24} xl={8}>
                    <Card bordered={false} style={cardStyle} styles={{ body: cardBodyStyle }} loading={logsLoading}>
                        <Space direction="vertical" size={16} style={{ width: '100%' }}>
                            <Space align="start" style={{ justifyContent: 'space-between', width: '100%' }}>
                                <div>
                                    <Title level={4} style={{ margin: 0 }}>最近自动化活动</Title>
                                    <Text type="secondary">从最近的 API 行为快速判断当前系统是在读信、取号还是清理资源。</Text>
                                </div>
                                <Link to="/operation-logs">
                                    <Button type="link" icon={<ArrowRightOutlined />}>查看全部</Button>
                                </Link>
                            </Space>
                            {recentLogs.length === 0 ? (
                                <Empty description="近期没有自动化调用记录，可先用访问密钥跑一次分配 / 读信链路，再回来看这里的活动回放。" />
                            ) : (
                                <List
                                    dataSource={recentLogs}
                                    renderItem={(item) => (
                                        <List.Item key={item.id} style={{ paddingInline: 0 }}>
                                            <Space direction="vertical" size={6} style={{ width: '100%' }}>
                                                <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
                                                    <Space wrap>
                                                        <Tag color={getLogActionColor(item.action)}>{getLogActionLabel(item.action)}</Tag>
                                                        {item.responseCode ? <Tag color={item.responseCode >= 400 ? 'error' : 'success'}>{item.responseCode}</Tag> : null}
                                                    </Space>
                                                    <Space size={6}>
                                                        <ClockCircleOutlined style={{ color: '#94a3b8' }} />
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
