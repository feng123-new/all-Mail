export type AppLanguage = 'zh-CN' | 'en-US';

type TranslationParams = Record<string, number | string>;
type PatternTranslation = {
  pattern: RegExp;
  replace: (match: RegExpMatchArray) => string;
};

export function normalizeLanguage(candidate?: string | null): AppLanguage {
  if (!candidate) {
    return 'zh-CN';
  }

  const normalized = candidate.trim().toLowerCase();
  if (normalized.startsWith('en')) {
    return 'en-US';
  }

  return 'zh-CN';
}

const exactTranslations: Record<AppLanguage, Record<string, string>> = {
  'zh-CN': {
    'Admin Console': '管理控制台',
    'Admin workspace': '管理工作台',
    'Access point': '访问入口',
    'Mailbox access': '邮箱访问',
    'Mailbox portal': '邮箱门户',
    'Mailbox Portal': '邮箱门户',
    'Mailbox User': '邮箱用户',
    'Navigation': '导航',
    'Operator access': '运维入口',
    'Proof scenario · degraded data': '示例场景 · 降级数据',
    'Proof scenario · unread demo': '示例场景 · 未读演示',
    'Secure Access': '安全访问',
    'Super admin': '超级管理员',
    'User Workspace': '用户工作区',
    'Workspace': '工作区',
    'mailbox workspace': '邮箱工作台',
    'control plane': '控制台',
  },
  'en-US': {
    'all-Mail 管理控制台': 'all-Mail Admin Console',
    '统一管理外部邮箱连接、域名邮箱、门户用户与邮件自动化': 'Centrally manage external mailbox connections, domain mailboxes, portal users, and mail automation.',
    '控制台概览': 'Overview',
    '总览连接健康度、域名邮箱运行态和自动化热度。': 'Review connection health, domain mailbox runtime state, and automation activity at a glance.',
    '外部邮箱连接': 'External mailboxes',
    '管理 OAuth、IMAP / SMTP 与外部邮箱接入能力。': 'Manage OAuth, IMAP / SMTP, and external mailbox connectivity.',
    '域名': 'Domains',
    '查看域名收发状态、验证进度与基础配置。': 'Inspect domain mail flow, verification progress, and baseline configuration.',
    '域名邮箱': 'Domain mailboxes',
    '集中管理门户邮箱、批次与分配状态。': 'Manage portal mailboxes, batches, and assignment state in one place.',
    '门户用户': 'Portal users',
    '管理门户访问人、邮箱归属和登录状态。': 'Manage portal access, mailbox ownership, and login state.',
    '域名消息': 'Domain messages',
    '追踪入站消息、路由结果与可见性。': 'Trace inbound messages, routing outcomes, and visibility.',
    '转发任务': 'Forwarding jobs',
    '查看 forwarding job 状态、失败原因和下一次重试时间。': 'Inspect forwarding job state, failure causes, and the next retry time.',
    '发信配置': 'Sending configs',
    '配置域名发信能力、默认 From 和发送路径。': 'Configure sending for domains, default From addresses, and delivery paths.',
    '访问密钥': 'API keys',
    '访问密钥与资源范围': 'API keys and resource scope',
    '约束自动化调用范围、速率和资源边界。': 'Control automation scope, rate limits, and resource boundaries.',
    'API 文档': 'API docs',
    '面向脚本、服务和集成方的调用入口。': 'The calling surface for scripts, services, and integrations.',
    '操作日志': 'Operation logs',
    '审计关键动作、调用轨迹与异常处理。': 'Audit key actions, request traces, and exception handling.',
    '管理员': 'Admins',
    '管理员管理': 'Admin management',
    '管理后台管理员权限与安全策略。': 'Manage admin permissions and security policy for the control plane.',
    '系统设置': 'System settings',
    '维护全局配置、安全与平台默认行为。': 'Maintain global configuration, security, and platform defaults.',
    '个人设置': 'Profile settings',
    '退出登录': 'Sign out',
    '展开侧边栏': 'Expand sidebar',
    '收起侧边栏': 'Collapse sidebar',
    '需先改密': 'Change password first',
    '收/发件工作区': 'Inbox / Sent workspace',
    '设置中心': 'Settings center',
    '门户工作台': 'Portal overview',
    '收 / 发件工作区': 'Inbox / Sent workspace',
    '当前账号需要先更新密码': 'This account needs a password change before continuing.',
    '当前账号安全状态正常': 'This account is in a healthy security state.',
    '需要先更新密码': 'Password change required',
    '当前账号仍处于首次密码状态，建议先去设置中心更新密码。': 'This account is still using its initial password. Update it in Settings before continuing.',
    '登录管理控制台': 'Sign in to the admin console',
    '优先走管理员认证；如果当前账号属于门户用户，系统会自动切换到门户工作台。': 'Try admin authentication first. If the account is a portal user, the app will switch to the portal workspace automatically.',
    '同一入口会自动兼容邮箱门户用户；如果管理员认证失败，系统会自动尝试门户登录。': 'This shared entry also supports mailbox portal users. If admin authentication fails, the app automatically tries portal login.',
    '用户名或邮箱': 'Username or email',
    '请输入用户名或邮箱': 'Enter a username or email address',
    '密码': 'Password',
    '请输入密码': 'Enter a password',
    '如果账号启用了 2FA，下一步会要求输入 6 位验证码': 'If the account uses 2FA, the next step will ask for a 6-digit verification code.',
    '当前无法完成登录': 'Unable to complete sign-in',
    '进入管理控制台': 'Open admin console',
    '二次验证': 'Two-factor verification',
    '验证并登录': 'Verify and sign in',
    '取消': 'Cancel',
    '请输入验证器中的 6 位动态码': 'Enter the 6-digit code from your authenticator app.',
    '6 位验证码': '6-digit verification code',
    '邮箱门户': 'Mailbox portal',
    '给邮箱用户一个稳定、清晰的入口：先确认未读与可访问邮箱，再进入收 / 发件工作区处理具体任务。': 'Give mailbox users a stable, clear entrypoint: review unread activity and available mailboxes first, then move into the workspaces.',
    '邮箱资源集中查看': 'Centralized mailbox visibility',
    '把可访问邮箱、未读状态和主要工作入口收进同一屏。': 'Keep accessible mailboxes, unread state, and core actions on one screen.',
    '收发件共用一个工作面': 'One workspace for inbox and sent mail',
    '查看收件、历史发件，并在允许发件时直接开始写信。': 'Review inbox, sent history, and start composing whenever sending is enabled.',
    '安全状态集中处理': 'Security state in one place',
    '首次密码提醒、转发策略和门户会话都在设置中心统一维护。': 'Initial password reminders, forwarding rules, and portal session state are all handled in Settings.',
    '门户用户名支持预填。如果你从管理员后台或用户通知里带了用户名参数进来，登录页会自动帮你填好用户名。': 'Portal usernames can be prefilled. If you arrive from the admin console or a user notice with a username parameter, the login page fills it in automatically.',
    '登录邮箱门户': 'Sign in to the mailbox portal',
    '默认使用门户用户名 + 密码登录；登录后会直接进入工作台。': 'Use portal username and password by default, then go straight into the workspace after sign-in.',
    '如果门户账号仍处于首次密码状态，登录后会在工作台和设置中心看到明确提醒。': 'If the portal account is still using its initial password, the workspace and settings center will show a clear reminder after sign-in.',
    '门户用户名': 'Portal username',
    '请输入门户用户名': 'Enter the portal username',
    '当前无法进入邮箱门户': 'Unable to enter the mailbox portal',
    '进入门户工作台': 'Open portal workspace',
    '设置': 'Settings',
    '统一管理管理员密码、2FA 与平台接入提示，先把账号安全稳住，再继续其他控制面操作。': 'Manage admin password, 2FA, and platform onboarding hints in one place before handling the rest of the control plane.',
    '个人信息': 'Profile',
    '角色': 'Role',
    '当前管理员仍在使用首次初始化的临时密码': 'This admin is still using the initial bootstrap password.',
    '在设置新密码之前，系统会阻止访问控制台其他页面以及受保护的管理接口。先完成这一步，再继续配置邮箱、域名和 API 密钥。': 'Until a new password is set, the system blocks the rest of the console and protected admin APIs. Finish this first, then continue with mailbox, domain, and API-key setup.',
    '设置新的管理员密码': 'Set a new admin password',
    '修改密码': 'Change password',
    '当前密码': 'Current password',
    '新密码': 'New password',
    '确认新密码': 'Confirm new password',
    '请确认新密码': 'Confirm the new password',
    '密码至少 8 个字符': 'Password must contain at least 8 characters',
    '设置新密码并解锁系统': 'Set password and unlock the system',
    '二次验证（2FA）': 'Two-factor authentication (2FA)',
    '加载中...': 'Loading…',
    '当前状态：': 'Current status:',
    '已启用': 'Enabled',
    '未启用': 'Disabled',
    '待验证': 'Pending verification',
    '当前账号使用环境变量 2FA（ADMIN_2FA_SECRET），暂不支持在界面中直接管理。': 'This account uses environment-variable 2FA (ADMIN_2FA_SECRET) and cannot be managed directly from the UI yet.',
    '生成绑定密钥': 'Generate setup secret',
    '绑定信息': 'Setup details',
    '输入验证器中的 6 位验证码': 'Enter the 6-digit code from your authenticator app',
    '禁用二次验证': 'Disable 2FA',
    '验证码': 'Verification code',
    'Provider OAuth 配置': 'Provider OAuth configuration',
    'Provider OAuth 配置已迁移到外部邮箱连接的各 Provider 添加入口': 'Provider OAuth configuration has moved to the external mailbox connection flows for each provider.',
    'API 使用说明': 'API usage notes',
    'Mailbox portal': 'Mailbox portal',
    '欢迎回来，邮箱用户': 'Welcome back, mailbox user',
    '先看未读和邮箱资源，再决定进入工作区还是设置中心。': 'Check unread messages and mailbox resources first, then decide whether to open the workspace or settings.',
    '进入工作区': 'Open workspace',
    '写邮件': 'Compose',
    '检测到当前门户账号仍处于首次密码状态': 'This portal account is still using its initial password.',
    '建议先进入设置中心更新密码，再继续收发和配置转发。': 'Update the password in Settings before continuing with mail flow and forwarding.',
    '此模式仅用于本地证据采集：注入带验证码动作的未读邮件样例，并压测压缩后的门户工作区节奏。': 'This mode is only for local proof capture: it injects unread mail samples with verification-code actions and exercises the compact portal workflow.',
    '可访问邮箱': 'Accessible mailboxes',
    '未读邮件': 'Unread messages',
    '可发件邮箱': 'Send-enabled mailboxes',
    '已启用转发': 'Forwarding enabled',
    '最近未读邮件': 'Recent unread messages',
    '只保留最近需要处理的入站消息。': 'Keep only the latest inbound messages that still need attention.',
    '当前没有未读邮件': 'No unread messages right now',
    '已读': 'Read',
    '未读': 'Unread',
    '无预览': 'No preview',
    '邮箱资源速览': 'Mailbox resource snapshot',
    '先确认哪些邮箱能发件、哪些仅收件，以及哪些已经启用转发。': 'Check which mailboxes can send, which are inbox-only, and which already have forwarding enabled.',
    '当前没有可访问邮箱': 'No accessible mailboxes right now',
    'Catch-all 目标': 'Catch-all target',
    '管理工作台': 'Admin workspace',
    '邮箱工作台': 'Mailbox workspace',
    '控制台': 'control plane',
    '运营入口': 'Operator access',
    '访问入口': 'Access point',
    '安全访问': 'Secure Access',
    '用户工作区': 'User workspace',
    'Proof scenario · unread demo': 'Proof scenario · unread demo',
    'Proof scenario · degraded data': 'Proof scenario · degraded data',
    '刷新': 'Refresh',
    '创建访问密钥': 'Create API key',
    '编辑访问密钥': 'Edit API key',
    '名称': 'Name',
    '例如：生产环境、测试环境': 'For example: production, staging',
    '速率限制（每分钟请求数）': 'Rate limit (requests per minute)',
    '过期时间（可选）': 'Expiration time (optional)',
    '不设置则永不过期': 'Leave blank for no expiration',
    '状态': 'Status',
    '可调用接口权限': 'Allowed API permissions',
    '至少选择一个权限': 'Select at least one permission',
    '可用分组（可选）': 'Allowed groups (optional)',
    '默认：全部分组': 'Default: all groups',
    '可分配邮箱（可选）': 'Allowed mailboxes (optional)',
    '默认：分组范围内全部邮箱': 'Default: all mailboxes inside the selected groups',
    '可用域名邮箱域名（可选）': 'Allowed domain mailbox domains (optional)',
    '默认：全部 API_POOL 域名': 'Default: all API_POOL domains',
    '访问密钥已创建': 'API key created',
    '关闭': 'Close',
    '总资源数': 'Total resources',
    '已分配': 'Allocated',
    '剩余可分配': 'Available',
    '全部分组': 'All groups',
    '搜索邮箱或分组': 'Search mailboxes or groups',
    '发信配置与历史': 'Sending config and history',
    '查看域名发信配置并对可发信域名执行测试发送；现在支持直接清理无效配置和历史记录。': 'Review domain sending configuration and run test sends for enabled domains. You can now clear stale configuration and history directly.',
    '发件历史': 'Sent history',
    '发送测试邮件': 'Send a test email',
    '发件邮箱': 'Sender mailbox',
    'From 地址': 'From address',
    '请输入 From 地址': 'Enter a From address',
    '请输入有效邮箱地址': 'Enter a valid email address',
    '收件人': 'Recipients',
    '请输入收件人': 'Enter at least one recipient',
    '主题': 'Subject',
    '请输入主题': 'Enter a subject',
    '纯文本内容': 'Plain-text body',
    'HTML 内容': 'HTML body',
    'API 调用日志': 'API audit logs',
    '记录所有通过 API Key 的外部调用，并把请求标识、状态码和耗时统一收口在一张审计表中。': 'Track every external request made with an API key, including request IDs, status codes, and latency in one audit table.',
    '筛选操作类型': 'Filter by action type',
    '集中维护后台管理员账号、角色、状态与 2FA 状态，避免高权限操作散落到其他设置页。': 'Manage admin accounts, roles, status, and 2FA state in one place so high-privilege actions do not leak into unrelated settings.',
    '添加管理员': 'Add admin',
    '编辑管理员': 'Edit admin',
    '用户名': 'Username',
    '请输入用户名': 'Enter a username',
    '邮箱': 'Email',
    '可选': 'Optional',
    '这里统一管理门户登录用户、初始密码和邮箱访问范围；你可以直接打开门户登录页，默认填入门户用户名，刚刚修改过的门户密码也会短时自动带入。': 'Manage portal users, bootstrap passwords, and mailbox access scopes in one place. You can open the portal login page directly with a prefilled username, and recently changed passwords will be carried over briefly.',
    '编辑门户用户': 'Edit portal user',
    '新增门户用户': 'Add portal user',
    '联系邮箱': 'Contact email',
    '可选，仅用于联系或找回，不作为默认登录名': 'Optional. Used for contact or recovery only, not as the default sign-in name.',
    '重置密码': 'Reset password',
    '门户密码': 'Portal password',
    '至少 8 位': 'At least 8 characters',
    '把 all-Mail 当成统一的邮件自动化控制面来使用：这页现在同时覆盖公开自动化 API、管理员控制面、门户用户 API 和 ingress 投递面，并按真实路由分组展示。': 'Treat all-Mail as a unified mail automation control plane. This page covers the public automation API, admin control plane, portal APIs, and ingress delivery surface, grouped by their real routes.',
    '最重要的区别：先认清你在调哪一个功能面': 'Most important: know which surface you are calling first',
    '平台功能面一览': 'Platform surfaces at a glance',
    '5 分钟上手': 'Get started in 5 minutes',
    '先把最常见的两个场景跑通': 'Start with the two most common scenarios',
    '高频功能调用剧本': 'High-frequency playbooks',
    '认证方式': 'Authentication',
    '所有外部 API 都需要访问密钥': 'Every external API requires an API key',
    '公开自动化 API 详解': 'Public automation API details',
    '什么时候最适合调这个接口？': 'When should you call this surface?',
    '兼容别名仍可使用': 'Compatibility aliases still work',
    '控制面与内部功能面详解': 'Admin and internal surfaces',
    '排错说明': 'Troubleshooting',
    '日志 action 与内部约定': 'Log actions and internal conventions',
    '后台、门户和 ingress 都是真实接口，但它们的目标受众不同': 'Admin, portal, and ingress are all real interfaces, but they target different audiences.',
    '快速导航': 'Quick navigation',
    '最快的测试顺序': 'Fastest test order',
    '如果你在用域名邮箱自动化': 'If you are automating domain mailboxes',
    '生产环境提醒': 'Production reminder',
    '健康检查': 'Health checks',
    '新手常见问题': 'Common newcomer questions',
    '统一管理 OAuth API 与 IMAP / SMTP 外部连接。': 'Manage OAuth and IMAP / SMTP external connections in one place.',
  },
};

const patternTranslations: Record<AppLanguage, PatternTranslation[]> = {
  'zh-CN': [
    {
      pattern: /^Welcome back, (.+)$/,
      replace: (match) => `欢迎回来，${match[1]}`,
    },
    {
      pattern: /^(\d+) accessible mailboxes$/,
      replace: (match) => `${match[1]} 个可访问邮箱`,
    },
    {
      pattern: /^Code (\d+)$/,
      replace: (match) => `验证码 ${match[1]}`,
    },
  ],
  'en-US': [
    {
      pattern: /^欢迎回来，(.+)$/,
      replace: (match) => `Welcome back, ${match[1]}`,
    },
    {
      pattern: /^(\d+) 个可访问邮箱$/,
      replace: (match) => `${match[1]} accessible mailboxes`,
    },
    {
      pattern: /^验证码 (\d+)$/,
      replace: (match) => `Code ${match[1]}`,
    },
    {
      pattern: /^来自 (.+) · 送达 (.+)$/,
      replace: (match) => `From ${match[1]} · Delivered to ${match[2]}`,
    },
    {
      pattern: /^域名：(.+) · (.+)$/,
      replace: (match) => `Domain: ${match[1]} · ${match[2]}`,
    },
    {
      pattern: /^还有 (\d+) 个邮箱，可在工作区或设置中心查看全部。$/,
      replace: (match) => `${match[1]} more mailboxes are available in Workspace or Settings.`,
    },
    {
      pattern: /^优先展示最值得处理的 (\d+) 个邮箱$/,
      replace: (match) => `Showing the top ${match[1]} mailboxes to review first`,
    },
    {
      pattern: /^共 (\d+) 个邮箱，其中 (\d+) 个可发件，(\d+) 个启用转发。剩余邮箱收拢到工作区与设置中心继续查看。$/,
      replace: (match) => `Total ${match[1]} mailboxes, with ${match[2]} ready to send and ${match[3]} forwarding enabled. Review the rest in Workspace or Settings.`,
    },
    {
      pattern: /^已删除 (\d+) 条日志$/,
      replace: (match) => `Deleted ${match[1]} log entries`,
    },
    {
      pattern: /^已清理 (\d+) 条域名消息$/,
      replace: (match) => `Cleared ${match[1]} domain messages`,
    },
    {
      pattern: /^已清理 (\d+) 条发件历史$/,
      replace: (match) => `Cleared ${match[1]} sent history records`,
    },
    {
      pattern: /^确定要删除选中的 (\d+) 条日志吗？$/,
      replace: (match) => `Delete the selected ${match[1]} log entries?`,
    },
    {
      pattern: /^确定要清理选中的 (\d+) 条域名消息吗？$/,
      replace: (match) => `Clear the selected ${match[1]} domain messages?`,
    },
  ],
};

function formatTemplate(template: string, params?: TranslationParams) {
  if (!params) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = params[key];
    return value === undefined ? `{${key}}` : String(value);
  });
}

export function translateText(source: string, language: AppLanguage, params?: TranslationParams) {
  const exact = exactTranslations[language][source];
  if (exact) {
    return formatTemplate(exact, params);
  }

  for (const rule of patternTranslations[language]) {
    const match = source.match(rule.pattern);
    if (match) {
      return formatTemplate(rule.replace(match), params);
    }
  }

  return formatTemplate(source, params);
}
