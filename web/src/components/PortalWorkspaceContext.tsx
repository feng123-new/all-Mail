import {
  AppstoreOutlined,
  InboxOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import type { ReactNode } from 'react';
import { useI18n } from '../i18n';
import { defineMessage, type TranslationInput } from '../i18n/messages';
import { StatusBadge, type StatusTone } from './DataWorkspace';
import './PortalWorkspaceContext.css';

export type PortalWorkspaceSurface = 'inbox' | 'overview' | 'settings';

const portalWorkspaceI18n = {
  inboxTitle: defineMessage(
    'portalWorkspace.inbox.title',
    '收件箱优先工作区',
    'Inbox-first workspace',
  ),
  inboxDescription: defineMessage(
    'portalWorkspace.inbox.description',
    '先选择邮箱并处理未读、验证码与需要回复的邮件；发件入口和历史记录仍保留在同一工作面。',
    'Choose a mailbox and handle unread mail, verification codes, and messages needing a response first. Compose and sent history remain in the same workspace.',
  ),
  overviewTitle: defineMessage(
    'portalWorkspace.overview.title',
    '资源与待办概览',
    'Resources and action summary',
  ),
  overviewDescription: defineMessage(
    'portalWorkspace.overview.description',
    '这里汇总未读、可发件邮箱与转发状态；需要处理具体邮件时直接进入收件箱。',
    'Review unread mail, send-enabled mailboxes, and forwarding state here. Open the inbox when a message needs direct action.',
  ),
  settingsTitle: defineMessage(
    'portalWorkspace.settings.title',
    '账号与邮箱设置',
    'Account and mailbox settings',
  ),
  settingsDescription: defineMessage(
    'portalWorkspace.settings.description',
    '集中维护密码、二次验证、邮箱转发与发件能力；首次密码状态下其它工作区保持受限。',
    'Maintain password, two-factor verification, mailbox forwarding, and sending capability here. Other workspaces stay restricted while the first-password state remains active.',
  ),
  unreadFirst: defineMessage(
    'portalWorkspace.signal.unreadFirst',
    '未读优先',
    'Unread first',
  ),
  mailboxSwitch: defineMessage(
    'portalWorkspace.signal.mailboxSwitch',
    '邮箱切换',
    'Mailbox switching',
  ),
  verificationActions: defineMessage(
    'portalWorkspace.signal.verificationActions',
    '验证码与快捷动作',
    'Codes and quick actions',
  ),
  unreadSummary: defineMessage(
    'portalWorkspace.signal.unreadSummary',
    '未读摘要',
    'Unread summary',
  ),
  sendReadiness: defineMessage(
    'portalWorkspace.signal.sendReadiness',
    '发件就绪度',
    'Sending readiness',
  ),
  forwardingState: defineMessage(
    'portalWorkspace.signal.forwardingState',
    '转发状态',
    'Forwarding state',
  ),
  passwordTwoFactor: defineMessage(
    'portalWorkspace.signal.passwordTwoFactor',
    '密码与 2FA',
    'Password and 2FA',
  ),
  forwardingPolicy: defineMessage(
    'portalWorkspace.signal.forwardingPolicy',
    '转发策略',
    'Forwarding policy',
  ),
  sendingCapability: defineMessage(
    'portalWorkspace.signal.sendingCapability',
    '发件能力',
    'Sending capability',
  ),
} as const;

interface PortalSignal {
  key: string;
  label: TranslationInput;
  tone: StatusTone;
}

interface PortalWorkspaceDefinition {
  title: TranslationInput;
  description: TranslationInput;
  icon: ReactNode;
  signals: PortalSignal[];
}

const portalWorkspaceDefinitions: Record<PortalWorkspaceSurface, PortalWorkspaceDefinition> = {
  inbox: {
    title: portalWorkspaceI18n.inboxTitle,
    description: portalWorkspaceI18n.inboxDescription,
    icon: <InboxOutlined />,
    signals: [
      { key: 'unread', label: portalWorkspaceI18n.unreadFirst, tone: 'info' },
      { key: 'switch', label: portalWorkspaceI18n.mailboxSwitch, tone: 'default' },
      { key: 'actions', label: portalWorkspaceI18n.verificationActions, tone: 'success' },
    ],
  },
  overview: {
    title: portalWorkspaceI18n.overviewTitle,
    description: portalWorkspaceI18n.overviewDescription,
    icon: <AppstoreOutlined />,
    signals: [
      { key: 'unread-summary', label: portalWorkspaceI18n.unreadSummary, tone: 'info' },
      { key: 'send-readiness', label: portalWorkspaceI18n.sendReadiness, tone: 'success' },
      { key: 'forwarding-state', label: portalWorkspaceI18n.forwardingState, tone: 'default' },
    ],
  },
  settings: {
    title: portalWorkspaceI18n.settingsTitle,
    description: portalWorkspaceI18n.settingsDescription,
    icon: <SettingOutlined />,
    signals: [
      { key: 'password', label: portalWorkspaceI18n.passwordTwoFactor, tone: 'success' },
      { key: 'forwarding', label: portalWorkspaceI18n.forwardingPolicy, tone: 'warning' },
      { key: 'sending', label: portalWorkspaceI18n.sendingCapability, tone: 'info' },
    ],
  },
};

interface PortalWorkspaceContextProps {
  surface: PortalWorkspaceSurface;
}

const PortalWorkspaceContext = ({ surface }: PortalWorkspaceContextProps) => {
  const { t } = useI18n();
  const definition = portalWorkspaceDefinitions[surface];

  return (
    <section
      className="portal-workspace-context"
      data-surface={surface}
      aria-label={t(definition.title)}
    >
      <div className="portal-workspace-context__copy">
        <div className="portal-workspace-context__title-row">
          <span className="portal-workspace-context__icon" aria-hidden="true">
            {definition.icon}
          </span>
          <span className="portal-workspace-context__title">{t(definition.title)}</span>
        </div>
        <span className="portal-workspace-context__description">
          {t(definition.description)}
        </span>
      </div>
      <div className="portal-workspace-context__signals">
        {definition.signals.map((signal) => (
          <StatusBadge key={signal.key} tone={signal.tone}>
            {t(signal.label)}
          </StatusBadge>
        ))}
      </div>
    </section>
  );
};

export default PortalWorkspaceContext;
