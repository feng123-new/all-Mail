import {
  CheckCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { Col, Row, Typography } from 'antd';
import { StatusBadge, SurfaceCard } from '../../components';
import { useI18n } from '../../i18n';
import { defineMessage, type TranslationInput } from '../../i18n/messages';
import './DashboardPriorityHero.css';

const { Paragraph, Text, Title } = Typography;

const dashboardPriorityI18n = {
  kicker: defineMessage('dashboard.priority.kicker', '运行优先级', 'Operational priorities'),
  title: defineMessage('dashboard.priority.title', '先处理风险，再进入对象页', 'Resolve risks before opening the detail workspaces'),
  description: defineMessage(
    'dashboard.priority.description',
    '这里不再生成加权健康分。每一项都直接来自可核对的连接、域名和邮箱状态，先处理异常，再继续配置与自动化。',
    'This surface no longer invents a weighted health score. Every item comes directly from inspectable connection, domain, and mailbox state so operators can resolve concrete issues first.',
  ),
  attentionLabel: defineMessage('dashboard.priority.attentionLabel', '待处理项', 'Items requiring attention'),
  clearLabel: defineMessage('dashboard.priority.clearLabel', '当前风险', 'Current risks'),
  attentionHint: defineMessage(
    'dashboard.priority.attentionHint',
    '这些数量可直接回到对象页核对，不包含隐藏权重或推测性评分。',
    'These counts map directly to object pages and contain no hidden weighting or speculative scoring.',
  ),
  clearHint: defineMessage(
    'dashboard.priority.clearHint',
    '当前连接、域名和域名邮箱没有检测到需要立即处理的状态。',
    'No connection, domain, or domain-mailbox state currently requires immediate intervention.',
  ),
  abnormalConnections: defineMessage('dashboard.priority.abnormalConnections', '异常邮箱连接', 'Mailbox connection errors'),
  inactiveDomains: defineMessage('dashboard.priority.inactiveDomains', '未激活域名', 'Inactive domains'),
  inactiveMailboxes: defineMessage('dashboard.priority.inactiveMailboxes', '未激活域名邮箱', 'Inactive domain mailboxes'),
} as const;

interface DashboardPriorityHeroProps {
  heroBadges: Array<{ key: string; label: TranslationInput; value: string }>;
  attentionCount: number;
  abnormalConnections: number;
  inactiveDomains: number;
  inactiveMailboxes: number;
}

const DashboardPriorityHero = ({
  heroBadges,
  attentionCount,
  abnormalConnections,
  inactiveDomains,
  inactiveMailboxes,
}: DashboardPriorityHeroProps) => {
  const { t } = useI18n();
  const hasAttention = attentionCount > 0;
  const breakdown: Array<{ label: TranslationInput; value: number }> = [
    { label: dashboardPriorityI18n.abnormalConnections, value: abnormalConnections },
    { label: dashboardPriorityI18n.inactiveDomains, value: inactiveDomains },
    { label: dashboardPriorityI18n.inactiveMailboxes, value: inactiveMailboxes },
  ];

  return (
    <SurfaceCard tone="muted" className="dashboard-priority" bodyStyle={{ padding: 24 }}>
      <Row gutter={[24, 24]} align="stretch">
        <Col xs={24} xl={16}>
          <div className="dashboard-priority__copy">
            <div>
              <Text className="dashboard-priority__kicker">{t(dashboardPriorityI18n.kicker)}</Text>
              <Title level={3} className="dashboard-priority__title">{t(dashboardPriorityI18n.title)}</Title>
            </div>
            <Paragraph className="dashboard-priority__description">
              {t(dashboardPriorityI18n.description)}
            </Paragraph>
            <div className="dashboard-priority__badges">
              {heroBadges.map((badge) => (
                <div key={badge.key} className="dashboard-priority__badge">
                  <Text className="dashboard-priority__badge-label">{t(badge.label)}</Text>
                  <span className="dashboard-priority__badge-value">{badge.value}</span>
                </div>
              ))}
            </div>
          </div>
        </Col>
        <Col xs={24} xl={8}>
          <div
            className="dashboard-priority__summary"
            data-state={hasAttention ? 'attention' : 'clear'}
          >
            <div className="dashboard-priority__summary-head">
              <div>
                <StatusBadge tone={hasAttention ? 'warning' : 'success'}>
                  {t(hasAttention ? dashboardPriorityI18n.attentionLabel : dashboardPriorityI18n.clearLabel)}
                </StatusBadge>
                <div className="dashboard-priority__summary-value">{attentionCount}</div>
              </div>
              <span className="dashboard-priority__summary-icon" aria-hidden="true">
                {hasAttention ? <WarningOutlined /> : <CheckCircleOutlined />}
              </span>
            </div>
            <Text className="dashboard-priority__summary-hint">
              {t(hasAttention ? dashboardPriorityI18n.attentionHint : dashboardPriorityI18n.clearHint)}
            </Text>
            <div className="dashboard-priority__breakdown">
              {breakdown.map(({ label, value }) => (
                <div
                  key={typeof label === 'string' ? label : label.key}
                  className="dashboard-priority__breakdown-row"
                >
                  <Text className="dashboard-priority__breakdown-label">{t(label)}</Text>
                  <span className="dashboard-priority__breakdown-value">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </Col>
      </Row>
    </SurfaceCard>
  );
};

export default DashboardPriorityHero;
