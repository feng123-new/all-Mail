import { Suspense, lazy, useEffect, useMemo, useRef, useState, type FC } from 'react';
import { Row, Col, Card, Tag, Typography, Spin } from 'antd';
import {
    MailOutlined,
    KeyOutlined,
    CheckCircleOutlined,
    ApiOutlined,
    CloudServerOutlined,
    InboxOutlined,
} from '@ant-design/icons';
import type { SimpleDonutChartProps, SimpleLineChartProps } from '../../components/charts';
import { StatCard, PageHeader } from '../../components';
import { dashboardApi, emailApi } from '../../api';
import { PROVIDER_ORDER, getProviderDefinition, type EmailProvider } from '../../constants/providers';

const { Text } = Typography;

const LineChart = lazy(async () => {
    const mod = await import('../../components/charts');
    return { default: mod.SimpleLineChart as React.ComponentType<SimpleLineChartProps> };
});

const PieChart = lazy(async () => {
    const mod = await import('../../components/charts');
    return { default: mod.SimpleDonutChart as React.ComponentType<SimpleDonutChartProps> };
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

const providerCountKeys: Record<EmailProvider, keyof EmailStats['providers']> = {
    OUTLOOK: 'outlook',
    GMAIL: 'gmail',
    QQ: 'qq',
};

const DashboardPage: FC = () => {
    const [coreLoading, setCoreLoading] = useState(true);
    const [trendLoading, setTrendLoading] = useState(true);
    const [chartsReady, setChartsReady] = useState(false);
    const [chartsInView, setChartsInView] = useState(false);
    const [stats, setStats] = useState<Stats | null>(null);
    const [emailStats, setEmailStats] = useState<EmailStats | null>(null);
    const [apiTrend, setApiTrend] = useState<ApiTrendItem[]>([]);
    const chartsSectionRef = useRef<HTMLDivElement | null>(null);
    const trendRequestedRef = useRef(false);

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
                const [statsRes, emailStatsRes] = await Promise.all([
                    dashboardApi.getStats<Stats>(),
                    emailApi.getStats<EmailStats>(),
                ]);

                if (disposed) return;

                if (statsRes.code === 200) {
                    setStats(statsRes.data);
                }
                if (emailStatsRes.code === 200) {
                    setEmailStats(emailStatsRes.data);
                }
            } catch (err) {
                console.error('Failed to fetch core dashboard data:', err);
            } finally {
                if (!disposed) {
                    setCoreLoading(false);
                }
            }
        };

        void loadCore();

        if (typeof idleWindow.requestIdleCallback === 'function') {
            idleId = idleWindow.requestIdleCallback(() => {
                if (disposed) return;
                setChartsReady(true);
            }, { timeout: 1200 });
        } else {
            timerId = window.setTimeout(() => {
                if (disposed) return;
                setChartsReady(true);
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
        if (!chartsReady || !chartsInView || trendRequestedRef.current) {
            return;
        }
        trendRequestedRef.current = true;
        let cancelled = false;

        const loadTrend = async () => {
            try {
                const trendRes = await dashboardApi.getApiTrend<ApiTrendItem>(7);
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
    }, [chartsInView, chartsReady]);

    const safeEmailStats: EmailStats = useMemo(() => emailStats || {
        total: 0,
        active: 0,
        error: 0,
        providers: { outlook: 0, gmail: 0, qq: 0 },
    }, [emailStats]);

    const pieData = useMemo(() => ([
        { type: '正常', value: safeEmailStats.active, color: '#52c41a' },
        { type: '异常', value: safeEmailStats.error, color: '#ff4d4f' },
        { type: '禁用', value: Math.max(0, safeEmailStats.total - safeEmailStats.active - safeEmailStats.error), color: '#d9d9d9' },
    ].filter((item) => item.value > 0)), [safeEmailStats]);

    const statsData: Stats = stats || {
        apiKeys: { total: 0, active: 0, totalUsage: 0, todayActive: 0 },
        domainMail: { domains: 0, activeDomains: 0, mailboxes: 0, activeMailboxes: 0, inboundMessages: 0, outboundMessages: 0 },
    };

    const providerSummary = PROVIDER_ORDER.map((provider) => {
        const definition = getProviderDefinition(provider);
        return {
            key: provider,
            label: definition.label,
            count: safeEmailStats.providers[providerCountKeys[provider]],
            color: definition.tagColor,
            hint: definition.summaryHint,
        };
    });

    return (
        <div>
            <PageHeader title="数据概览" subtitle="只展示聚合统计与运行趋势，首页不直接暴露邮箱账号或 API Key 明细。" />

            <Row gutter={[16, 16]}>
                <Col xs={12} sm={12} md={6}>
                    <StatCard
                        title="邮箱总数"
                        value={safeEmailStats.total}
                        icon={<MailOutlined />}
                        iconBgColor="#1890ff"
                    />
                </Col>
                <Col xs={12} sm={12} md={6}>
                    <StatCard
                        title="正常邮箱"
                        value={safeEmailStats.active}
                        icon={<CheckCircleOutlined />}
                        iconBgColor="#52c41a"
                        suffix={`/ ${safeEmailStats.total}`}
                    />
                </Col>
                <Col xs={12} sm={12} md={6}>
                    <StatCard
                        title="API 调用总数"
                        value={statsData.apiKeys.totalUsage}
                        icon={<ApiOutlined />}
                        iconBgColor="#722ed1"
                    />
                </Col>
                <Col xs={12} sm={12} md={6}>
                    <StatCard
                        title="活跃 API Key"
                        value={statsData.apiKeys.active}
                        icon={<KeyOutlined />}
                        iconBgColor="#fa8c16"
                        suffix={`/ ${statsData.apiKeys.total}`}
                    />
                </Col>
                <Col xs={12} sm={12} md={6}>
                    <StatCard
                        title="域名总数"
                        value={statsData.domainMail.domains}
                        icon={<CloudServerOutlined />}
                        iconBgColor="#13c2c2"
                        suffix={`/ ${statsData.domainMail.activeDomains} 活跃`}
                    />
                </Col>
                <Col xs={12} sm={12} md={6}>
                    <StatCard
                        title="活跃域名邮箱"
                        value={statsData.domainMail.activeMailboxes}
                        icon={<InboxOutlined />}
                        iconBgColor="#722ed1"
                        suffix={`/ ${statsData.domainMail.mailboxes} 总数`}
                    />
                </Col>
            </Row>

            <Row gutter={[16, 16]} style={{ marginTop: 16 }} ref={chartsSectionRef}>
                <Col xs={24} md={16}>
                    <Card title="API 调用趋势（近7天）" bordered={false}>
                        {!chartsReady || !chartsInView || trendLoading ? (
                            <div style={{ textAlign: 'center', padding: 40, minHeight: 280 }}><Spin /></div>
                        ) : (
                            <Suspense fallback={<div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>}>
                                <LineChart data={apiTrend} color="#1890ff" height={280} />
                            </Suspense>
                        )}
                    </Card>
                </Col>
                <Col xs={24} md={8}>
                    <Card title="邮箱状态分布" bordered={false}>
                        {coreLoading || !chartsReady || !chartsInView ? (
                            <div style={{ textAlign: 'center', padding: 40, minHeight: 280 }}><Spin /></div>
                        ) : pieData.length > 0 ? (
                            <Suspense fallback={<div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>}>
                                <PieChart data={pieData} total={safeEmailStats.total} title="邮箱" height={280} />
                            </Suspense>
                        ) : (
                            <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Text type="secondary">暂无数据</Text>
                            </div>
                        )}
                    </Card>
                </Col>
            </Row>

            <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                <Col xs={24} md={12}>
                    <Card title="Provider 分布" bordered={false} loading={coreLoading}>
                        <div style={{ display: 'grid', gap: 12 }}>
                            {providerSummary.map((item) => (
                                <div
                                    key={item.key}
                                    style={{
                                        border: '1px solid #f0f0f0',
                                        borderRadius: 10,
                                        padding: 14,
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        gap: 12,
                                    }}
                                >
                                    <div>
                                        <Tag color={item.color}>{item.label}</Tag>
                                        <div style={{ marginTop: 8 }}>
                                            <Text type="secondary">{item.hint}</Text>
                                        </div>
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{ fontSize: 28, fontWeight: 700 }}>{item.count}</div>
                                        <Text type="secondary">当前账号数</Text>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </Card>
                </Col>
                <Col xs={24} md={12}>
                    <Card title="概览边界与敏感性" bordered={false} loading={coreLoading}>
                        <div style={{ display: 'grid', gap: 14 }}>
                            <div>
                                <div style={{ fontWeight: 600, marginBottom: 4 }}>首页默认只看聚合，不看对象明细</div>
                                <Text type="secondary">已经移除“最近添加的邮箱”和“API Key 使用排行”的首页直出，避免在概览页直接暴露邮箱地址和 Key 名称。</Text>
                            </div>
                            <div>
                                <div style={{ fontWeight: 600, marginBottom: 4 }}>今日活跃 API Key</div>
                                <Text>{statsData.apiKeys.todayActive} 个 Key 今日有调用记录。</Text>
                            </div>
                            <div>
                                <div style={{ fontWeight: 600, marginBottom: 4 }}>域名邮箱运行概览</div>
                        <Text type="secondary">当前共有 {statsData.domainMail.domains} 个域名、{statsData.domainMail.mailboxes} 个域名邮箱（其中 {statsData.domainMail.activeMailboxes} 个处于可收件状态）、{statsData.domainMail.inboundMessages} 封仍绑定在现存邮箱上的入站邮件、{statsData.domainMail.outboundMessages} 封出站邮件。</Text>
                            </div>
                            <div>
                                <div style={{ fontWeight: 600, marginBottom: 4 }}>查看明细的位置</div>
                                <Text type="secondary">外部邮箱账号请到“邮箱管理”，域名邮箱请到“域名 / 邮箱与用户 / 邮箱门户”。首页仅保留聚合指标。</Text>
                            </div>
                        </div>
                    </Card>
                </Col>
            </Row>
        </div>
    );
};

export default DashboardPage;
