import {
  ApiOutlined,
  ArrowRightOutlined,
  CheckCircleOutlined,
  CloudServerOutlined,
  InboxOutlined,
  KeyOutlined,
  MailOutlined,
  ThunderboltOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Empty,
  Segmented,
  Spin,
  Tag,
  Typography,
} from 'antd';
import type { ComponentType, ReactNode, RefObject } from 'react';
import { Suspense, useMemo } from 'react';
import { createSearchParams, Link, type To } from 'react-router';
import {
  StatusBadge,
  SurfaceCard,
  type StatusTone,
} from '../../components';
import type { SimpleLineChartProps } from '../../components/charts';
import {
  getLogActionColor,
  getLogActionLabel,
} from '../../constants/logActions';
import {
  getProviderDefinition,
  PROVIDER_ORDER,
  type EmailProvider,
} from '../../constants/providers';
import { useI18n } from '../../i18n';
import { getProviderLabelMessage } from '../../i18n/catalog/providers';
import { defineMessage, type TranslationInput } from '../../i18n/messages';
import {
  type ApiTrendItem,
  dashboardPageI18n,
  type EmailStats,
  type ErrorEmailItem,
  type LogItem,
  type Stats,
  type TrendWindow,
} from './shared';
import './DashboardOverview.css';

const { Paragraph, Text, Title } = Typography;

const dashboardOverviewI18n = {
  kicker: defineMessage(
    'dashboard.overview.kicker',
    '实时运营总览',
    'Live operations overview',
  ),
  title: defineMessage(
    'dashboard.overview.title',
    '运行概况',
    'Operating overview',
  ),
  description: defineMessage(
    'dashboard.overview.description',
    '先确认连接、域名邮箱、收发流量与自动化是否正常，再进入具体对象处理。',
    'Confirm connections, domain mailboxes, mail flow, and automation activity before opening a detail workspace.',
  ),
  statusAttentionLabel: defineMessage(
    'dashboard.overview.status.attentionLabel',
    '待处理项',
    'Items requiring attention',
  ),
  statusClearLabel: defineMessage(
    'dashboard.overview.status.clearLabel',
    '关键路径正常',
    'Critical paths clear',
  ),
  statusAttentionTitle: defineMessage(
    'dashboard.overview.status.attentionTitle',
    '{count} 项需要处理',
    '{count} items require attention',
  ),
  statusClearTitle: defineMessage(
    'dashboard.overview.status.clearTitle',
    '关键邮件链路运行正常',
    'Critical mail paths are operating normally',
  ),
  statusAttentionDescription: defineMessage(
    'dashboard.overview.status.attentionDescription',
    '异常连接、未激活域名或域名邮箱会影响收件与自动化，请从右侧待办队列直接进入对应对象页。',
    'Connection errors or inactive domain resources can interrupt inbound mail and automation. Use the action queue to open the affected workspace directly.',
  ),
  statusClearDescription: defineMessage(
    'dashboard.overview.status.clearDescription',
    '外部连接、域名和域名邮箱当前没有需要立即处理的状态，可以继续执行收件、发信和自动化任务。',
    'External connections, domains, and domain mailboxes have no immediate issues, so inbound, outbound, and automation work can continue.',
  ),
  manageConnections: defineMessage(
    'dashboard.overview.actions.connections',
    '管理邮箱连接',
    'Manage connections',
  ),
  manageDomains: defineMessage(
    'dashboard.overview.actions.domains',
    '检查域名',
    'Review domains',
  ),
  manageDomainMailboxes: defineMessage(
    'dashboard.overview.actions.domainMailboxes',
    '管理域名邮箱',
    'Manage domain mailboxes',
  ),
  externalConnections: defineMessage(
    'dashboard.overview.metrics.connections',
    '外部邮箱连接',
    'External connections',
  ),
  domains: defineMessage(
    'dashboard.overview.metrics.domains',
    '域名',
    'Domains',
  ),
  domainMailboxes: defineMessage(
    'dashboard.overview.metrics.domainMailboxes',
    '域名邮箱',
    'Domain mailboxes',
  ),
  apiKeys: defineMessage(
    'dashboard.overview.metrics.apiKeys',
    '访问密钥',
    'API keys',
  ),
  allAvailable: defineMessage(
    'dashboard.overview.metrics.allAvailable',
    '全部可用',
    'All available',
  ),
  notConfigured: defineMessage(
    'dashboard.overview.metrics.notConfigured',
    '尚未配置',
    'Not configured',
  ),
  errorCount: defineMessage(
    'dashboard.overview.metrics.errorCount',
    '{count} 个异常',
    '{count} errors',
  ),
  inactiveCount: defineMessage(
    'dashboard.overview.metrics.inactiveCount',
    '{count} 个未激活',
    '{count} inactive',
  ),
  todayActiveKeys: defineMessage(
    'dashboard.overview.metrics.todayActiveKeys',
    '今日 {count} 个活跃',
    '{count} active today',
  ),
  inboundMessages: defineMessage(
    'dashboard.overview.flow.inbound',
    '累计收件',
    'Inbound messages',
  ),
  outboundMessages: defineMessage(
    'dashboard.overview.flow.outbound',
    '累计发件',
    'Outbound messages',
  ),
  totalAutomationCalls: defineMessage(
    'dashboard.overview.flow.apiCalls',
    '自动化调用',
    'Automation calls',
  ),
  activeProviders: defineMessage(
    'dashboard.overview.flow.providers',
    '活跃服务商',
    'Active providers',
  ),
  operationsTitle: defineMessage(
    'dashboard.overview.operations.title',
    '自动化活动',
    'Automation activity',
  ),
  operationsDescription: defineMessage(
    'dashboard.overview.operations.description',
    '用调用趋势判断自动化是否持续运行，避免只看累计数字。',
    'Use the activity curve to verify that automation is still moving instead of relying on cumulative totals alone.',
  ),
  selectedWindowTotal: defineMessage(
    'dashboard.overview.operations.windowTotal',
    '区间调用',
    'Window total',
  ),
  dailyAverage: defineMessage(
    'dashboard.overview.operations.dailyAverage',
    '日均调用',
    'Daily average',
  ),
  peak: defineMessage(
    'dashboard.overview.operations.peak',
    '单日峰值',
    'Daily peak',
  ),
  noTrendData: defineMessage(
    'dashboard.overview.operations.noData',
    '当前区间没有自动化调用记录。',
    'There is no automation activity in the selected window.',
  ),
  queueTitle: defineMessage(
    'dashboard.overview.queue.title',
    '待办与健康',
    'Action queue and health',
  ),
  queueDescription: defineMessage(
    'dashboard.overview.queue.description',
    '按影响范围排序，直接进入需要处理的对象页。',
    'Prioritized by impact with direct links to the affected workspace.',
  ),
  connectionIssue: defineMessage(
    'dashboard.overview.queue.connections',
    '异常邮箱连接',
    'Mailbox connection errors',
  ),
  connectionIssueActive: defineMessage(
    'dashboard.overview.queue.connectionsActive',
    '重新检查授权、代理或服务商连接。',
    'Recheck authorization, proxy, or provider connectivity.',
  ),
  connectionIssueClear: defineMessage(
    'dashboard.overview.queue.connectionsClear',
    '当前没有外部邮箱连接错误。',
    'No external mailbox connection errors are present.',
  ),
  domainIssue: defineMessage(
    'dashboard.overview.queue.domains',
    '未激活域名',
    'Inactive domains',
  ),
  domainIssueActive: defineMessage(
    'dashboard.overview.queue.domainsActive',
    '检查 DNS、Email Routing 与收件入口。',
    'Check DNS, Email Routing, and inbound configuration.',
  ),
  domainIssueClear: defineMessage(
    'dashboard.overview.queue.domainsClear',
    '已配置域名均处于 ACTIVE。',
    'All configured domains are ACTIVE.',
  ),
  mailboxIssue: defineMessage(
    'dashboard.overview.queue.domainMailboxes',
    '未激活域名邮箱',
    'Inactive domain mailboxes',
  ),
  mailboxIssueActive: defineMessage(
    'dashboard.overview.queue.domainMailboxesActive',
    '检查启用状态、门户分配与发信准备度。',
    'Check enablement, portal assignment, and sending readiness.',
  ),
  mailboxIssueClear: defineMessage(
    'dashboard.overview.queue.domainMailboxesClear',
    '已配置域名邮箱均处于可用状态。',
    'All configured domain mailboxes are available.',
  ),
  errorSamplesTitle: defineMessage(
    'dashboard.overview.queue.errorSamples',
    '异常连接样本',
    'Connection samples',
  ),
  inspect: defineMessage(
    'dashboard.overview.queue.inspect',
    '查看',
    'Inspect',
  ),
  lastChecked: defineMessage(
    'dashboard.overview.queue.lastChecked',
    '检查于 {time}',
    'Checked {time}',
  ),
  automationSignal: defineMessage(
    'dashboard.overview.queue.automationSignal',
    '今日自动化活跃度',
    'Automation activity today',
  ),
  automationSignalActive: defineMessage(
    'dashboard.overview.queue.automationSignalActive',
    '{count} 个访问密钥今天产生了调用。',
    '{count} API keys have generated activity today.',
  ),
  automationSignalIdle: defineMessage(
    'dashboard.overview.queue.automationSignalIdle',
    '今天还没有访问密钥调用记录。',
    'No API-key activity has been recorded today.',
  ),
  providerDescription: defineMessage(
    'dashboard.overview.providers.description',
    '按当前邮箱连接数显示占比，快速识别服务商集中度。',
    'Share of current mailbox connections, making provider concentration easy to spot.',
  ),
  providerSummary: defineMessage(
    'dashboard.overview.providers.summary',
    '{count} 类服务商正在承载当前邮箱池',
    '{count} provider classes are carrying the mailbox pool',
  ),
  dominantProvider: defineMessage(
    'dashboard.overview.providers.dominant',
    '{provider} 当前占比最高。',
    '{provider} currently has the largest share.',
  ),
  noActiveProviders: defineMessage(
    'dashboard.overview.providers.none',
    '当前尚未配置活跃邮箱连接。',
    'No active mailbox connections are configured yet.',
  ),
  share: defineMessage(
    'dashboard.overview.providers.share',
    '{percent}% 占比',
    '{percent}% share',
  ),
  activitiesDescription: defineMessage(
    'dashboard.overview.activities.description',
    '最近的分配、读信和资源操作，便于快速确认系统是否按预期工作。',
    'Recent allocation, inbox, and resource actions for a quick confirmation that the system is behaving as expected.',
  ),
  responseCode: defineMessage(
    'dashboard.overview.activities.responseCode',
    '响应 {code}',
    'Response {code}',
  ),
  requestDuration: defineMessage(
    'dashboard.overview.activities.duration',
    '{duration} ms',
    '{duration} ms',
  ),
} as const;

interface DashboardOverviewProps {
  proofVisible: boolean;
  statsData: Stats;
  emailStats: EmailStats;
  apiTrend: ApiTrendItem[];
  recentLogs: LogItem[];
  errorEmails: ErrorEmailItem[];
  coreLoading: boolean;
  trendLoading: boolean;
  logsLoading: boolean;
  trendDays: TrendWindow;
  onTrendDaysChange: (value: TrendWindow) => void;
  chartsReady: boolean;
  chartsInView: boolean;
  chartsSectionRef: RefObject<HTMLDivElement | null>;
  LineChart: ComponentType<SimpleLineChartProps>;
}

interface SummaryMetric {
  key: string;
  label: TranslationInput;
  value: string;
  detail: string;
  icon: ReactNode;
  state: 'clear' | 'attention' | 'idle';
}

interface QueueItem {
  key: string;
  label: TranslationInput;
  value: number;
  hint: TranslationInput;
  clearHint: TranslationInput;
  tone: StatusTone;
  icon: ReactNode;
  to: To;
}

function formatCount(value: number): string {
  return value.toLocaleString();
}

const DashboardOverview = ({
  proofVisible,
  statsData,
  emailStats,
  apiTrend,
  recentLogs,
  errorEmails,
  coreLoading,
  trendLoading,
  logsLoading,
  trendDays,
  onTrendDaysChange,
  chartsReady,
  chartsInView,
  chartsSectionRef,
  LineChart,
}: DashboardOverviewProps) => {
  const { t } = useI18n();

  const inactiveDomains = Math.max(
    statsData.domainMail.domains - statsData.domainMail.activeDomains,
    0,
  );
  const inactiveMailboxes = Math.max(
    statsData.domainMail.mailboxes - statsData.domainMail.activeMailboxes,
    0,
  );
  const attentionCount = emailStats.error + inactiveDomains + inactiveMailboxes;
  const hasAttention = attentionCount > 0;

  const providerRows = useMemo(
    () => PROVIDER_ORDER.map((provider) => ({
      provider,
      label: getProviderLabelMessage(provider),
      count: emailStats.providers[provider] || 0,
    })).sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      return t(left.label).localeCompare(t(right.label), 'zh-Hans-CN');
    }),
    [emailStats.providers, t],
  );
  const activeProviderRows = providerRows.filter((item) => item.count > 0);
  const displayedProviders = activeProviderRows.length > 0
    ? activeProviderRows
    : providerRows.slice(0, 3);
  const providerTotal = providerRows.reduce((total, item) => total + item.count, 0);
  const dominantProvider = activeProviderRows[0];

  const trendTotal = apiTrend.reduce((total, item) => total + item.count, 0);
  const trendAverage = apiTrend.length > 0
    ? Math.round(trendTotal / apiTrend.length)
    : 0;
  const trendPeak = apiTrend.reduce(
    (peakValue, item) => Math.max(peakValue, item.count),
    0,
  );

  const availabilityDetail = (
    total: number,
    unavailable: number,
    unavailableMessage: TranslationInput,
  ) => {
    if (total === 0) return t(dashboardOverviewI18n.notConfigured);
    if (unavailable > 0) return t(unavailableMessage, { count: unavailable });
    return t(dashboardOverviewI18n.allAvailable);
  };

  const summaryMetrics: SummaryMetric[] = [
    {
      key: 'connections',
      label: dashboardOverviewI18n.externalConnections,
      value: `${emailStats.active}/${emailStats.total}`,
      detail: availabilityDetail(
        emailStats.total,
        emailStats.error,
        dashboardOverviewI18n.errorCount,
      ),
      icon: <MailOutlined />,
      state: emailStats.total === 0
        ? 'idle'
        : emailStats.error > 0
          ? 'attention'
          : 'clear',
    },
    {
      key: 'domains',
      label: dashboardOverviewI18n.domains,
      value: `${statsData.domainMail.activeDomains}/${statsData.domainMail.domains}`,
      detail: availabilityDetail(
        statsData.domainMail.domains,
        inactiveDomains,
        dashboardOverviewI18n.inactiveCount,
      ),
      icon: <CloudServerOutlined />,
      state: statsData.domainMail.domains === 0
        ? 'idle'
        : inactiveDomains > 0
          ? 'attention'
          : 'clear',
    },
    {
      key: 'domain-mailboxes',
      label: dashboardOverviewI18n.domainMailboxes,
      value: `${statsData.domainMail.activeMailboxes}/${statsData.domainMail.mailboxes}`,
      detail: availabilityDetail(
        statsData.domainMail.mailboxes,
        inactiveMailboxes,
        dashboardOverviewI18n.inactiveCount,
      ),
      icon: <InboxOutlined />,
      state: statsData.domainMail.mailboxes === 0
        ? 'idle'
        : inactiveMailboxes > 0
          ? 'attention'
          : 'clear',
    },
    {
      key: 'api-keys',
      label: dashboardOverviewI18n.apiKeys,
      value: `${statsData.apiKeys.active}/${statsData.apiKeys.total}`,
      detail: statsData.apiKeys.total === 0
        ? t(dashboardOverviewI18n.notConfigured)
        : t(dashboardOverviewI18n.todayActiveKeys, {
            count: statsData.apiKeys.todayActive,
          }),
      icon: <KeyOutlined />,
      state: statsData.apiKeys.total === 0 ? 'idle' : 'clear',
    },
  ];

  const queueItems: QueueItem[] = [
    {
      key: 'connections',
      label: dashboardOverviewI18n.connectionIssue,
      value: emailStats.error,
      hint: dashboardOverviewI18n.connectionIssueActive,
      clearHint: dashboardOverviewI18n.connectionIssueClear,
      tone: emailStats.error > 0 ? 'danger' : 'success',
      icon: <MailOutlined />,
      to: {
        pathname: '/emails',
        search: createSearchParams({ status: 'ERROR' }).toString(),
      },
    },
    {
      key: 'domains',
      label: dashboardOverviewI18n.domainIssue,
      value: inactiveDomains,
      hint: dashboardOverviewI18n.domainIssueActive,
      clearHint: dashboardOverviewI18n.domainIssueClear,
      tone: inactiveDomains > 0 ? 'warning' : 'success',
      icon: <CloudServerOutlined />,
      to: '/domains',
    },
    {
      key: 'domain-mailboxes',
      label: dashboardOverviewI18n.mailboxIssue,
      value: inactiveMailboxes,
      hint: dashboardOverviewI18n.mailboxIssueActive,
      clearHint: dashboardOverviewI18n.mailboxIssueClear,
      tone: inactiveMailboxes > 0 ? 'warning' : 'success',
      icon: <InboxOutlined />,
      to: '/domain-mailboxes',
    },
  ];

  return (
    <div className="dashboard-overview">
      <header className="dashboard-overview__page-head">
        <div className="dashboard-overview__page-copy">
          <Text className="dashboard-overview__kicker">
            {t(dashboardOverviewI18n.kicker)}
          </Text>
          <Title level={2} className="dashboard-overview__page-title">
            {t(dashboardOverviewI18n.title)}
          </Title>
          <Paragraph className="dashboard-overview__page-description">
            {t(dashboardOverviewI18n.description)}
          </Paragraph>
        </div>
        <div className="dashboard-overview__page-actions">
          <Link to="/emails">
            <Button type="primary" icon={<MailOutlined />}>
              {t(dashboardOverviewI18n.manageConnections)}
            </Button>
          </Link>
          <Link to="/domain-mailboxes">
            <Button>{t(dashboardOverviewI18n.manageDomainMailboxes)}</Button>
          </Link>
        </div>
      </header>

      {proofVisible ? (
        <Alert
          type="warning"
          showIcon
          title={t(dashboardPageI18n.degradedProofTitle)}
          description={t(dashboardPageI18n.degradedProofDescription)}
        />
      ) : null}

      <SurfaceCard
        tone="muted"
        className="dashboard-overview__summary"
        bodyStyle={{ padding: 0 }}
        loading={coreLoading}
      >
        <div className="dashboard-overview__summary-grid">
          <div
            className="dashboard-overview__status"
            data-state={hasAttention ? 'attention' : 'clear'}
          >
            <StatusBadge
              tone={hasAttention ? 'warning' : 'success'}
              icon={hasAttention ? <WarningOutlined /> : <CheckCircleOutlined />}
            >
              {t(
                hasAttention
                  ? dashboardOverviewI18n.statusAttentionLabel
                  : dashboardOverviewI18n.statusClearLabel,
              )}
            </StatusBadge>
            <Title level={2} className="dashboard-overview__status-title">
              {t(
                hasAttention
                  ? dashboardOverviewI18n.statusAttentionTitle
                  : dashboardOverviewI18n.statusClearTitle,
                { count: attentionCount },
              )}
            </Title>
            <Paragraph className="dashboard-overview__status-description">
              {t(
                hasAttention
                  ? dashboardOverviewI18n.statusAttentionDescription
                  : dashboardOverviewI18n.statusClearDescription,
              )}
            </Paragraph>
            <div className="dashboard-overview__status-links">
              <Link to="/emails">
                {t(dashboardOverviewI18n.manageConnections)}
                <ArrowRightOutlined />
              </Link>
              <Link to="/domains">
                {t(dashboardOverviewI18n.manageDomains)}
                <ArrowRightOutlined />
              </Link>
              <Link to="/domain-mailboxes">
                {t(dashboardOverviewI18n.manageDomainMailboxes)}
                <ArrowRightOutlined />
              </Link>
            </div>
          </div>

          <div className="dashboard-overview__summary-metrics">
            {summaryMetrics.map((metric) => (
              <div
                key={metric.key}
                className="dashboard-overview__summary-metric"
                data-state={metric.state}
              >
                <span className="dashboard-overview__summary-metric-icon" aria-hidden="true">
                  {metric.icon}
                </span>
                <div>
                  <Text className="dashboard-overview__summary-metric-label">
                    {t(metric.label)}
                  </Text>
                  <div className="dashboard-overview__summary-metric-value">
                    {metric.value}
                  </div>
                  <Text className="dashboard-overview__summary-metric-detail">
                    {metric.detail}
                  </Text>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="dashboard-overview__flow-strip">
          <div>
            <Text>{t(dashboardOverviewI18n.inboundMessages)}</Text>
            <strong>{formatCount(statsData.domainMail.inboundMessages)}</strong>
          </div>
          <div>
            <Text>{t(dashboardOverviewI18n.outboundMessages)}</Text>
            <strong>{formatCount(statsData.domainMail.outboundMessages)}</strong>
          </div>
          <div>
            <Text>{t(dashboardOverviewI18n.totalAutomationCalls)}</Text>
            <strong>{formatCount(statsData.apiKeys.totalUsage)}</strong>
          </div>
          <div>
            <Text>{t(dashboardOverviewI18n.activeProviders)}</Text>
            <strong>{activeProviderRows.length}</strong>
          </div>
        </div>
      </SurfaceCard>

      <div className="dashboard-overview__content-grid">
        <div ref={chartsSectionRef}>
          <SurfaceCard className="dashboard-overview__operations">
            <div className="dashboard-overview__panel-head">
              <div>
                <Title level={4}>{t(dashboardOverviewI18n.operationsTitle)}</Title>
                <Text>{t(dashboardOverviewI18n.operationsDescription)}</Text>
              </div>
              <Segmented<TrendWindow>
                value={trendDays}
                onChange={onTrendDaysChange}
                options={[
                  { label: t(dashboardPageI18n.trend7Days), value: 7 },
                  { label: t(dashboardPageI18n.trend14Days), value: 14 },
                  { label: t(dashboardPageI18n.trend30Days), value: 30 },
                ]}
              />
            </div>

            <div className="dashboard-overview__trend-metrics">
              <div>
                <Text>{t(dashboardOverviewI18n.selectedWindowTotal)}</Text>
                <strong>{formatCount(trendTotal)}</strong>
              </div>
              <div>
                <Text>{t(dashboardOverviewI18n.dailyAverage)}</Text>
                <strong>{formatCount(trendAverage)}</strong>
              </div>
              <div>
                <Text>{t(dashboardOverviewI18n.peak)}</Text>
                <strong>{formatCount(trendPeak)}</strong>
              </div>
            </div>

            <div className="dashboard-overview__chart">
              {!chartsReady || !chartsInView || trendLoading ? (
                <Spin />
              ) : apiTrend.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={t(dashboardOverviewI18n.noTrendData)}
                />
              ) : (
                <Suspense fallback={<Spin />}>
                  <LineChart
                    data={apiTrend}
                    color="#2563eb"
                    height={260}
                    ariaLabel={t(dashboardPageI18n.apiTrendAria)}
                  />
                </Suspense>
              )}
            </div>
          </SurfaceCard>
        </div>

        <SurfaceCard
          className="dashboard-overview__queue"
          loading={coreLoading}
        >
          <div className="dashboard-overview__panel-head">
            <div>
              <Title level={4}>{t(dashboardOverviewI18n.queueTitle)}</Title>
              <Text>{t(dashboardOverviewI18n.queueDescription)}</Text>
            </div>
          </div>

          <div className="dashboard-overview__queue-list">
            {queueItems.map((item) => (
              <Link
                key={item.key}
                to={item.to}
                className="dashboard-overview__queue-row"
              >
                <span className="dashboard-overview__queue-icon" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="dashboard-overview__queue-copy">
                  <span className="dashboard-overview__queue-label">
                    {t(item.label)}
                  </span>
                  <span className="dashboard-overview__queue-hint">
                    {t(item.value > 0 ? item.hint : item.clearHint)}
                  </span>
                </span>
                <StatusBadge tone={item.tone}>{item.value}</StatusBadge>
                <ArrowRightOutlined className="dashboard-overview__queue-arrow" />
              </Link>
            ))}
          </div>

          {errorEmails.length > 0 ? (
            <div className="dashboard-overview__error-samples">
              <div className="dashboard-overview__subheading">
                <Text strong>{t(dashboardOverviewI18n.errorSamplesTitle)}</Text>
                <Link to="/emails">{t(dashboardPageI18n.viewAll)}</Link>
              </div>
              {errorEmails.slice(0, 3).map((item) => (
                <div key={item.id} className="dashboard-overview__error-row">
                  <div className="dashboard-overview__error-main">
                    <div>
                      <Tag color={getProviderDefinition(item.provider).tagColor}>
                        {t(getProviderLabelMessage(item.provider))}
                      </Tag>
                      <Text strong>{item.email}</Text>
                    </div>
                    <Text className="dashboard-overview__error-message">
                      {t(item.errorMessage || dashboardPageI18n.defaultErrorMessage)}
                    </Text>
                    <Text className="dashboard-overview__error-time">
                      {t(dashboardOverviewI18n.lastChecked, {
                        time: item.lastCheckAt
                          ? new Date(item.lastCheckAt).toLocaleString()
                          : t(dashboardPageI18n.noRecord),
                      })}
                    </Text>
                  </div>
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
                    {t(dashboardOverviewI18n.inspect)}
                  </Link>
                </div>
              ))}
            </div>
          ) : null}

          <Link to="/api-keys" className="dashboard-overview__automation-signal">
            <span aria-hidden="true"><ThunderboltOutlined /></span>
            <span>
              <Text strong>{t(dashboardOverviewI18n.automationSignal)}</Text>
              <Text>
                {t(
                  statsData.apiKeys.todayActive > 0
                    ? dashboardOverviewI18n.automationSignalActive
                    : dashboardOverviewI18n.automationSignalIdle,
                  { count: statsData.apiKeys.todayActive },
                )}
              </Text>
            </span>
            <ArrowRightOutlined />
          </Link>
        </SurfaceCard>
      </div>

      <div className="dashboard-overview__secondary-grid">
        <SurfaceCard
          className="dashboard-overview__providers"
          loading={coreLoading}
        >
          <div className="dashboard-overview__panel-head">
            <div>
              <Title level={4}>{t(dashboardPageI18n.providerBreakdownTitle)}</Title>
              <Text>{t(dashboardOverviewI18n.providerDescription)}</Text>
            </div>
          </div>

          <div className="dashboard-overview__provider-summary">
            <Text strong>
              {t(dashboardOverviewI18n.providerSummary, {
                count: activeProviderRows.length,
              })}
            </Text>
            <Text>
              {dominantProvider
                ? t(dashboardOverviewI18n.dominantProvider, {
                    provider: t(dominantProvider.label),
                  })
                : t(dashboardOverviewI18n.noActiveProviders)}
            </Text>
          </div>

          <div className="dashboard-overview__provider-list">
            {displayedProviders.map((item) => {
              const percent = providerTotal > 0
                ? Math.round((item.count / providerTotal) * 100)
                : 0;
              return (
                <div key={item.provider} className="dashboard-overview__provider-row">
                  <div className="dashboard-overview__provider-row-head">
                    <Text strong>{t(item.label)}</Text>
                    <span>
                      <strong>{item.count}</strong>
                      <Text>{t(dashboardOverviewI18n.share, { percent })}</Text>
                    </span>
                  </div>
                  <div className="dashboard-overview__provider-track" aria-hidden="true">
                    <span style={{ width: `${percent}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </SurfaceCard>

        <SurfaceCard
          className="dashboard-overview__activities"
          loading={logsLoading}
        >
          <div className="dashboard-overview__panel-head dashboard-overview__panel-head--actions">
            <div>
              <Title level={4}>{t(dashboardPageI18n.recentActivitiesTitle)}</Title>
              <Text>{t(dashboardOverviewI18n.activitiesDescription)}</Text>
            </div>
            <Link to="/operation-logs">
              <Button type="text" icon={<ArrowRightOutlined />}>
                {t(dashboardPageI18n.viewAll)}
              </Button>
            </Link>
          </div>

          {recentLogs.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t(dashboardPageI18n.noRecentActivities)}
            />
          ) : (
            <div className="dashboard-overview__activity-list">
              {recentLogs.slice(0, 5).map((item) => {
                const context = [
                  item.email,
                  item.requestIp,
                  item.responseTimeMs != null
                    ? t(dashboardOverviewI18n.requestDuration, {
                        duration: item.responseTimeMs,
                      })
                    : null,
                ].filter(Boolean).join(' · ');
                const responseTone: StatusTone = (item.responseCode || 0) >= 400
                  ? 'danger'
                  : 'success';

                return (
                  <div key={item.id} className="dashboard-overview__activity-row">
                    <div className="dashboard-overview__activity-main">
                      <div className="dashboard-overview__activity-title">
                        <Tag color={getLogActionColor(item.action)}>
                          {t(getLogActionLabel(item.action))}
                        </Tag>
                        <Text strong>
                          {item.apiKeyName
                            ? t(dashboardPageI18n.apiKeyNamed, {
                                name: item.apiKeyName,
                              })
                            : t(dashboardPageI18n.anonymousAction)}
                        </Text>
                      </div>
                      {context ? <Text>{context}</Text> : null}
                    </div>
                    <div className="dashboard-overview__activity-meta">
                      {item.responseCode != null ? (
                        <StatusBadge tone={responseTone}>
                          {t(dashboardOverviewI18n.responseCode, {
                            code: item.responseCode,
                          })}
                        </StatusBadge>
                      ) : null}
                      <Text>{new Date(item.createdAt).toLocaleString()}</Text>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SurfaceCard>
      </div>
    </div>
  );
};

export default DashboardOverview;
