import {
  ArrowRightOutlined,
  InboxOutlined,
  SendOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import type { ReactNode } from 'react';
import { useI18n } from '../i18n';
import { defineMessage, type TranslationInput } from '../i18n/messages';
import type { MailFlowState, MailFlowSurface } from './mailFlow';
import StatusBadge from './MailFlowStatusBadge';
import './MailFlowContext.css';

const mailFlowI18n = {
  inboundTitle: defineMessage('mailFlowContext.inbound.title', '入站邮件链路', 'Inbound mail flow'),
  inboundDescription: defineMessage(
    'mailFlowContext.inbound.description',
    '从签名接入、路由匹配到消息存储，先确认送达位置，再查看邮件内容和门户可见性。',
    'Follow signed ingress through route matching and storage. Confirm delivery placement before inspecting content and portal visibility.',
  ),
  forwardingTitle: defineMessage('mailFlowContext.forwarding.title', '转发执行链路', 'Forwarding execution'),
  forwardingDescription: defineMessage(
    'mailFlowContext.forwarding.description',
    '任务按待处理、执行、成功或终止状态推进；失败项应结合重试次数、下次尝试时间和最后错误排查。',
    'Jobs progress through pending, execution, success, or terminal states. Investigate failures with attempt count, next retry, and the last error.',
  ),
  outboundTitle: defineMessage('mailFlowContext.outbound.title', '发信准备链路', 'Outbound readiness'),
  outboundDescription: defineMessage(
    'mailFlowContext.outbound.description',
    '先确认发件身份和服务商配置可用，再执行测试发送或正式发送；失败状态必须保留可核对的错误上下文。',
    'Confirm sender identity and provider readiness before test or production sends. Failed sends must retain inspectable error context.',
  ),
  received: defineMessage('mailFlowContext.state.received', '已接收', 'Received'),
  routed: defineMessage('mailFlowContext.state.routed', '已路由', 'Routed'),
  stored: defineMessage('mailFlowContext.state.stored', '已存储', 'Stored'),
  pending: defineMessage('mailFlowContext.state.pending', '待处理', 'Pending'),
  running: defineMessage('mailFlowContext.state.running', '处理中', 'Running'),
  ready: defineMessage('mailFlowContext.state.ready', '已就绪', 'Ready'),
  sent: defineMessage('mailFlowContext.state.sent', '已发送', 'Sent'),
  failed: defineMessage('mailFlowContext.state.failed', '失败', 'Failed'),
  skipped: defineMessage('mailFlowContext.state.skipped', '已跳过', 'Skipped'),
} as const;

const stateLabels: Record<MailFlowState, TranslationInput> = {
  RECEIVED: mailFlowI18n.received,
  ROUTED: mailFlowI18n.routed,
  STORED: mailFlowI18n.stored,
  PENDING: mailFlowI18n.pending,
  RUNNING: mailFlowI18n.running,
  READY: mailFlowI18n.ready,
  SENT: mailFlowI18n.sent,
  FAILED: mailFlowI18n.failed,
  SKIPPED: mailFlowI18n.skipped,
};

const surfaceDefinitions: Record<MailFlowSurface, {
  title: TranslationInput;
  description: TranslationInput;
  icon: ReactNode;
  states: MailFlowState[];
}> = {
  inbound: {
    title: mailFlowI18n.inboundTitle,
    description: mailFlowI18n.inboundDescription,
    icon: <InboxOutlined />,
    states: ['RECEIVED', 'ROUTED', 'STORED'],
  },
  forwarding: {
    title: mailFlowI18n.forwardingTitle,
    description: mailFlowI18n.forwardingDescription,
    icon: <SwapOutlined />,
    states: ['PENDING', 'RUNNING', 'SENT', 'FAILED', 'SKIPPED'],
  },
  outbound: {
    title: mailFlowI18n.outboundTitle,
    description: mailFlowI18n.outboundDescription,
    icon: <SendOutlined />,
    states: ['PENDING', 'READY', 'SENT', 'FAILED'],
  },
};

interface MailFlowContextProps {
  surface: MailFlowSurface;
}

const MailFlowContext = ({ surface }: MailFlowContextProps) => {
  const { t } = useI18n();
  const definition = surfaceDefinitions[surface];

  return (
    <section className="mail-flow-context" aria-label={t(definition.title)}>
      <div className="mail-flow-context__copy">
        <div className="mail-flow-context__title-row">
          <span className="mail-flow-context__icon" aria-hidden="true">{definition.icon}</span>
          <span className="mail-flow-context__title">{t(definition.title)}</span>
        </div>
        <span className="mail-flow-context__description">{t(definition.description)}</span>
      </div>
      <div className="mail-flow-context__states">
        {definition.states.map((state, index) => (
          <span key={state} className="mail-flow-context__state-item">
            {index > 0 ? <ArrowRightOutlined className="mail-flow-context__arrow" aria-hidden="true" /> : null}
            <StatusBadge state={state}>{t(stateLabels[state])}</StatusBadge>
          </span>
        ))}
      </div>
    </section>
  );
};

export default MailFlowContext;
