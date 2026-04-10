import { defineMessage } from '../messages';

export const languageToggleI18n = {
  ariaLabel: defineMessage('languageToggle.ariaLabel', '语言切换', 'Language toggle'),
  chinese: defineMessage('languageToggle.chinese', '中文', 'Chinese'),
  english: defineMessage('languageToggle.english', 'English', 'English'),
} as const;

export const authSplitLayoutI18n = {
  operatorAccess: defineMessage('authSplitLayout.operatorAccess', '操作入口', 'Operator access'),
  accessPoint: defineMessage('authSplitLayout.accessPoint', '访问入口', 'Access point'),
} as const;

export const mailboxLayoutI18n = {
  overview: defineMessage('mailboxLayout.menu.overview', '门户工作台', 'Portal overview'),
  inbox: defineMessage('mailboxLayout.menu.inbox', '收/发件工作区', 'Inbox workspace'),
  settings: defineMessage('mailboxLayout.menu.settings', '设置中心', 'Settings center'),
  mailboxPortal: defineMessage('mailboxLayout.mailboxPortal', '邮箱门户', 'Mailbox portal'),
  signOut: defineMessage('mailboxLayout.signOut', '退出登录', 'Sign out'),
  mailboxWorkspace: defineMessage('mailboxLayout.mailboxWorkspace', '邮箱工作台', 'Mailbox workspace'),
  mailboxAccess: defineMessage('mailboxLayout.mailboxAccess', '邮箱访问', 'Mailbox access'),
  accessibleMailboxCount: defineMessage('mailboxLayout.accessibleMailboxCount', '{count} 个可访问邮箱', '{count} accessible mailboxes'),
  passwordUpdateRequired: defineMessage('mailboxLayout.passwordUpdateRequired', '当前账号需要先更新密码', 'This account needs a password update first'),
  securityHealthy: defineMessage('mailboxLayout.securityHealthy', '当前账号安全状态正常', 'This account security state is healthy'),
  workspace: defineMessage('mailboxLayout.workspace', '工作区', 'Workspace'),
  updatePasswordFirst: defineMessage('mailboxLayout.updatePasswordFirst', '需要先更新密码', 'Password update required'),
  updatePasswordHint: defineMessage('mailboxLayout.updatePasswordHint', '当前账号仍处于首次密码状态，建议先去设置中心更新密码。', 'This account is still using the initial password. Update it in Settings first.'),
  mailboxUser: defineMessage('mailboxLayout.mailboxUser', '邮箱用户', 'Mailbox user'),
} as const;

export const mainLayoutI18n = {
  dashboard: {
    label: defineMessage('mainLayout.menu.dashboard.label', '控制台概览', 'Overview'),
    title: defineMessage('mainLayout.menu.dashboard.title', '控制台概览', 'Overview'),
    subtitle: defineMessage('mainLayout.menu.dashboard.subtitle', '总览连接健康度、域名邮箱运行态和自动化热度。', 'Review connection health, domain mailbox runtime state, and automation activity at a glance.'),
  },
  emails: {
    label: defineMessage('mainLayout.menu.emails.label', '外部邮箱连接', 'External mailboxes'),
    title: defineMessage('mainLayout.menu.emails.title', '外部邮箱连接', 'External mailboxes'),
    subtitle: defineMessage('mainLayout.menu.emails.subtitle', '管理 OAuth、IMAP / SMTP 与外部邮箱接入能力。', 'Manage OAuth, IMAP / SMTP, and external mailbox connectivity.'),
  },
  domains: {
    label: defineMessage('mainLayout.menu.domains.label', '域名', 'Domains'),
    title: defineMessage('mainLayout.menu.domains.title', '域名', 'Domains'),
    subtitle: defineMessage('mainLayout.menu.domains.subtitle', '查看域名收发状态、验证进度与基础配置。', 'Review domain status, verification progress, and base configuration.'),
  },
  domainMailboxes: {
    label: defineMessage('mainLayout.menu.domainMailboxes.label', '域名邮箱', 'Domain mailboxes'),
    title: defineMessage('mainLayout.menu.domainMailboxes.title', '域名邮箱', 'Domain mailboxes'),
    subtitle: defineMessage('mainLayout.menu.domainMailboxes.subtitle', '集中管理门户邮箱、批次与分配状态。', 'Manage portal mailboxes, batches, and allocation state in one place.'),
  },
  mailboxUsers: {
    label: defineMessage('mainLayout.menu.mailboxUsers.label', '门户用户', 'Portal users'),
    title: defineMessage('mainLayout.menu.mailboxUsers.title', '门户用户', 'Portal users'),
    subtitle: defineMessage('mainLayout.menu.mailboxUsers.subtitle', '管理门户访问人、邮箱归属和登录状态。', 'Manage portal access, mailbox ownership, and sign-in state.'),
  },
  domainMessages: {
    label: defineMessage('mainLayout.menu.domainMessages.label', '域名消息', 'Domain messages'),
    title: defineMessage('mainLayout.menu.domainMessages.title', '域名消息', 'Domain messages'),
    subtitle: defineMessage('mainLayout.menu.domainMessages.subtitle', '追踪入站消息、路由结果与可见性。', 'Track inbound messages, routing results, and visibility.'),
  },
  forwardingJobs: {
    label: defineMessage('mainLayout.menu.forwardingJobs.label', '转发任务', 'Forwarding jobs'),
    title: defineMessage('mainLayout.menu.forwardingJobs.title', '转发任务', 'Forwarding jobs'),
    subtitle: defineMessage('mainLayout.menu.forwardingJobs.subtitle', '查看 forwarding job 状态、失败原因和下一次重试时间。', 'Inspect forwarding-job status, failure reasons, and the next retry time.'),
  },
  sendingConfigs: {
    label: defineMessage('mainLayout.menu.sendingConfigs.label', '发信配置', 'Sending configs'),
    title: defineMessage('mainLayout.menu.sendingConfigs.title', '发信配置', 'Sending configs'),
    subtitle: defineMessage('mainLayout.menu.sendingConfigs.subtitle', '配置域名发信能力、默认 From 和发送路径。', 'Configure domain sending capability, default From values, and sending paths.'),
  },
  apiKeys: {
    label: defineMessage('mainLayout.menu.apiKeys.label', '访问密钥', 'API keys'),
    title: defineMessage('mainLayout.menu.apiKeys.title', '访问密钥与资源范围', 'API keys and resource scope'),
    subtitle: defineMessage('mainLayout.menu.apiKeys.subtitle', '约束自动化调用范围、速率和资源边界。', 'Control automation scope, rate limits, and resource boundaries.'),
  },
  apiDocs: {
    label: defineMessage('mainLayout.menu.apiDocs.label', 'API 文档', 'API docs'),
    title: defineMessage('mainLayout.menu.apiDocs.title', 'API 文档', 'API docs'),
    subtitle: defineMessage('mainLayout.menu.apiDocs.subtitle', '面向脚本、服务和集成方的调用入口。', 'The calling surface for scripts, services, and integrations.'),
  },
  operationLogs: {
    label: defineMessage('mainLayout.menu.operationLogs.label', '操作日志', 'Operation logs'),
    title: defineMessage('mainLayout.menu.operationLogs.title', '操作日志', 'Operation logs'),
    subtitle: defineMessage('mainLayout.menu.operationLogs.subtitle', '审计关键动作、调用轨迹与异常处理。', 'Audit key actions, request traces, and exception handling.'),
  },
  admins: {
    label: defineMessage('mainLayout.menu.admins.label', '管理员', 'Admins'),
    title: defineMessage('mainLayout.menu.admins.title', '管理员管理', 'Admin management'),
    subtitle: defineMessage('mainLayout.menu.admins.subtitle', '管理后台管理员权限与安全策略。', 'Manage admin permissions and security policy.'),
  },
  settings: {
    label: defineMessage('mainLayout.menu.settings.label', '系统设置', 'System settings'),
    title: defineMessage('mainLayout.menu.settings.title', '系统设置', 'System settings'),
    subtitle: defineMessage('mainLayout.menu.settings.subtitle', '维护全局配置、安全与平台默认行为。', 'Maintain global configuration, security, and platform defaults.'),
  },
  profile: defineMessage('mainLayout.profile', '个人设置', 'Personal settings'),
  logout: defineMessage('mainLayout.logout', '退出登录', 'Sign out'),
  expandSidebar: defineMessage('mainLayout.expandSidebar', '展开侧边栏', 'Expand sidebar'),
  collapseSidebar: defineMessage('mainLayout.collapseSidebar', '收起侧边栏', 'Collapse sidebar'),
  controlPlane: defineMessage('mainLayout.controlPlane', '控制台', 'Control plane'),
  navigation: defineMessage('mainLayout.navigation', '导航', 'Navigation'),
  adminWorkspace: defineMessage('mainLayout.adminWorkspace', '管理员工作区', 'Admin workspace'),
  superAdmin: defineMessage('mainLayout.superAdmin', '超级管理员', 'Super admin'),
  admin: defineMessage('mainLayout.admin', '管理员', 'Admin'),
  passwordResetRequired: defineMessage('mainLayout.passwordResetRequired', '需先改密', 'Password reset required'),
} as const;
