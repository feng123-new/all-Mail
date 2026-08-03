import {
  CloudServerOutlined,
  DashboardOutlined,
  FileTextOutlined,
  HistoryOutlined,
  InboxOutlined,
  KeyOutlined,
  MailOutlined,
  MessageOutlined,
  SendOutlined,
  SettingOutlined,
  SwapOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import type { ReactNode } from 'react';
import type { MailFlowSurface, WorkspaceKind } from '../components';
import { mainLayoutI18n } from '../i18n/catalog/shell';
import type { TranslationInput } from '../i18n/messages';

export interface AdminNavigationItem {
  key: string;
  icon: ReactNode;
  label: TranslationInput;
  title: TranslationInput;
  subtitle: TranslationInput;
  workspace: WorkspaceKind;
  mailFlowSurface?: MailFlowSurface;
  superAdmin?: boolean;
}

export interface AdminNavigationGroup {
  key: string;
  label: TranslationInput;
  workspace: WorkspaceKind;
  items: AdminNavigationItem[];
}

const withWorkspace = (
  workspace: WorkspaceKind,
  items: Array<Omit<AdminNavigationItem, 'workspace'>>,
): AdminNavigationItem[] => items.map((item) => ({ ...item, workspace }));

export const ADMIN_NAVIGATION_GROUPS: AdminNavigationGroup[] = [
  {
    key: 'overview',
    label: mainLayoutI18n.groups.overview,
    workspace: 'overview',
    items: withWorkspace('overview', [
      { key: '/dashboard', icon: <DashboardOutlined />, ...mainLayoutI18n.dashboard },
    ]),
  },
  {
    key: 'mail-resources',
    label: mainLayoutI18n.groups.mailResources,
    workspace: 'resource',
    items: withWorkspace('resource', [
      { key: '/emails', icon: <MailOutlined />, ...mainLayoutI18n.emails },
      { key: '/domains', icon: <CloudServerOutlined />, ...mainLayoutI18n.domains },
      { key: '/domain-mailboxes', icon: <InboxOutlined />, ...mainLayoutI18n.domainMailboxes },
      { key: '/mailbox-users', icon: <TeamOutlined />, ...mainLayoutI18n.mailboxUsers },
    ]),
  },
  {
    key: 'mail-flow',
    label: mainLayoutI18n.groups.mailFlow,
    workspace: 'flow',
    items: withWorkspace('flow', [
      {
        key: '/domain-messages',
        icon: <MessageOutlined />,
        mailFlowSurface: 'inbound',
        ...mainLayoutI18n.domainMessages,
      },
      {
        key: '/forwarding-jobs',
        icon: <SwapOutlined />,
        mailFlowSurface: 'forwarding',
        ...mainLayoutI18n.forwardingJobs,
      },
      {
        key: '/sending-configs',
        icon: <SendOutlined />,
        mailFlowSurface: 'outbound',
        ...mainLayoutI18n.sendingConfigs,
      },
    ]),
  },
  {
    key: 'automation',
    label: mainLayoutI18n.groups.automation,
    workspace: 'automation',
    items: withWorkspace('automation', [
      { key: '/api-keys', icon: <KeyOutlined />, ...mainLayoutI18n.apiKeys },
      { key: '/api-docs', icon: <FileTextOutlined />, ...mainLayoutI18n.apiDocs },
      { key: '/operation-logs', icon: <HistoryOutlined />, ...mainLayoutI18n.operationLogs },
    ]),
  },
  {
    key: 'system',
    label: mainLayoutI18n.groups.system,
    workspace: 'system',
    items: withWorkspace('system', [
      { key: '/admins', icon: <UserOutlined />, ...mainLayoutI18n.admins, superAdmin: true },
      { key: '/settings', icon: <SettingOutlined />, ...mainLayoutI18n.settings },
    ]),
  },
];

export const ADMIN_NAVIGATION_ITEMS = ADMIN_NAVIGATION_GROUPS.flatMap((group) => group.items);

export function getAdminRouteMeta(pathname: string): AdminNavigationItem {
  return [...ADMIN_NAVIGATION_ITEMS]
    .sort((left, right) => right.key.length - left.key.length)
    .find((item) => pathname === item.key || pathname.startsWith(`${item.key}/`))
    ?? ADMIN_NAVIGATION_ITEMS[0];
}
