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
import { mainLayoutI18n } from '../i18n/catalog/shell';
import type { TranslationInput } from '../i18n/messages';

export interface AdminNavigationItem {
  key: string;
  icon: ReactNode;
  label: TranslationInput;
  title: TranslationInput;
  subtitle: TranslationInput;
  superAdmin?: boolean;
}

export interface AdminNavigationGroup {
  key: string;
  label: TranslationInput;
  items: AdminNavigationItem[];
}

export const ADMIN_NAVIGATION_GROUPS: AdminNavigationGroup[] = [
  {
    key: 'overview',
    label: mainLayoutI18n.groups.overview,
    items: [
      { key: '/dashboard', icon: <DashboardOutlined />, ...mainLayoutI18n.dashboard },
    ],
  },
  {
    key: 'mail-resources',
    label: mainLayoutI18n.groups.mailResources,
    items: [
      { key: '/emails', icon: <MailOutlined />, ...mainLayoutI18n.emails },
      { key: '/domains', icon: <CloudServerOutlined />, ...mainLayoutI18n.domains },
      { key: '/domain-mailboxes', icon: <InboxOutlined />, ...mainLayoutI18n.domainMailboxes },
      { key: '/mailbox-users', icon: <TeamOutlined />, ...mainLayoutI18n.mailboxUsers },
    ],
  },
  {
    key: 'mail-flow',
    label: mainLayoutI18n.groups.mailFlow,
    items: [
      { key: '/domain-messages', icon: <MessageOutlined />, ...mainLayoutI18n.domainMessages },
      { key: '/forwarding-jobs', icon: <SwapOutlined />, ...mainLayoutI18n.forwardingJobs },
      { key: '/sending-configs', icon: <SendOutlined />, ...mainLayoutI18n.sendingConfigs },
    ],
  },
  {
    key: 'automation',
    label: mainLayoutI18n.groups.automation,
    items: [
      { key: '/api-keys', icon: <KeyOutlined />, ...mainLayoutI18n.apiKeys },
      { key: '/api-docs', icon: <FileTextOutlined />, ...mainLayoutI18n.apiDocs },
      { key: '/operation-logs', icon: <HistoryOutlined />, ...mainLayoutI18n.operationLogs },
    ],
  },
  {
    key: 'system',
    label: mainLayoutI18n.groups.system,
    items: [
      { key: '/admins', icon: <UserOutlined />, ...mainLayoutI18n.admins, superAdmin: true },
      { key: '/settings', icon: <SettingOutlined />, ...mainLayoutI18n.settings },
    ],
  },
];

export const ADMIN_NAVIGATION_ITEMS = ADMIN_NAVIGATION_GROUPS.flatMap((group) => group.items);

export function getAdminRouteMeta(pathname: string): AdminNavigationItem {
  return [...ADMIN_NAVIGATION_ITEMS]
    .sort((left, right) => right.key.length - left.key.length)
    .find((item) => pathname === item.key || pathname.startsWith(`${item.key}/`))
    ?? ADMIN_NAVIGATION_ITEMS[0];
}
