export type EmailProvider =
  | 'OUTLOOK'
  | 'GMAIL'
  | 'QQ'
  | 'NETEASE_163'
  | 'NETEASE_126'
  | 'ICLOUD'
  | 'YAHOO'
  | 'ZOHO'
  | 'ALIYUN'
  | 'AMAZON_WORKMAIL'
  | 'FASTMAIL'
  | 'AOL'
  | 'GMX'
  | 'MAILCOM'
  | 'YANDEX'
  | 'CUSTOM_IMAP_SMTP';
export type EmailAuthType = 'MICROSOFT_OAUTH' | 'GOOGLE_OAUTH' | 'APP_PASSWORD';
export type RepresentativeProtocol = 'oauth_api' | 'imap_smtp' | 'hosted_internal';
export type SecondaryProtocol = 'graph_api' | 'gmail_api' | 'imap' | 'smtp';
export type ProviderProfileKey =
  | 'outlook-oauth'
  | 'gmail-oauth'
  | 'gmail-app-password'
  | 'qq-imap-smtp'
  | 'netease-163-imap-smtp'
  | 'netease-126-imap-smtp'
  | 'icloud-imap-smtp'
  | 'yahoo-imap-smtp'
  | 'zoho-imap-smtp'
  | 'aliyun-imap-smtp'
  | 'amazon-workmail-imap-smtp'
  | 'fastmail-imap-smtp'
  | 'aol-imap-smtp'
  | 'gmx-imap-smtp'
  | 'mailcom-imap-smtp'
  | 'yandex-imap-smtp'
  | 'custom-imap-smtp';
export type HostedInternalProfileKey = 'hosted-internal-manual' | 'hosted-internal-api-pool';

export interface ProviderFolderMap {
  inbox?: string;
  junk?: string;
  sent?: string;
}

export interface MailProviderConfig {
  readMode?: string;
  imapHost?: string;
  imapPort?: number;
  imapTls?: boolean;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  folders?: ProviderFolderMap;
}

export interface RepresentativeProtocolDefinition {
  key: RepresentativeProtocol;
  label: string;
  description: string;
  tagColor: string;
  connectionLabel: string;
  external: boolean;
}

export interface ProviderAuthOption {
  value: EmailAuthType;
  label: string;
}

export interface ProtocolCapabilityMatrix {
  readInbox: boolean;
  readJunk: boolean;
  readSent: boolean;
  clearMailbox: boolean;
  sendMail: boolean;
  usesOAuth: boolean;
  receiveMail: boolean;
  apiAccess: boolean;
  forwarding: boolean;
  search: boolean;
  refreshToken: boolean;
  webhook: boolean;
  aliasSupport: boolean;
  modes: string[];
}

interface ProtocolProfileDefinitionBase<TKey extends string> {
  key: TKey;
  representativeProtocol: RepresentativeProtocol;
  secondaryProtocols: SecondaryProtocol[];
  description: string;
  summaryHint: string;
  capabilitySummary: ProtocolCapabilityMatrix;
}

export interface ProviderProfileDefinition extends ProtocolProfileDefinitionBase<ProviderProfileKey> {
  provider: EmailProvider;
  authType: EmailAuthType;
  label: string;
  importTemplate: string;
  providerConfigDefaults?: Partial<MailProviderConfig>;
  requiresManualServerConfig?: boolean;
  serverConfigHelpText?: string;
  secretLabel?: string;
  secretPlaceholder?: string;
  secretHelpText?: string;
  supportsBulkImport?: boolean;
}

export type ProviderProfileCapabilities = ProtocolCapabilityMatrix;
export type HostedInternalCapabilitySummary = ProtocolCapabilityMatrix;

export interface HostedInternalProfileDefinition extends ProtocolProfileDefinitionBase<HostedInternalProfileKey> {
  provisioningMode: 'MANUAL' | 'API_POOL';
  label: string;
  classificationNote: string;
}

export interface ProviderDefinition {
  provider: EmailProvider;
  label: string;
  title: string;
  description: string;
  emailPlaceholder: string;
  tagColor: string;
  addButtonLabel: string;
  authTypes: ProviderAuthOption[];
  importTemplate: string;
  importTemplates: string[];
  summaryHint: string;
  representativeProtocol: RepresentativeProtocol;
  secondaryProtocols: SecondaryProtocol[];
  classificationNote: string;
  authTypeNotes: Partial<Record<EmailAuthType, string>>;
  profileDefinitions: Partial<Record<EmailAuthType, ProviderProfileDefinition>>;
}

interface ProviderBaseDefinition {
  provider: EmailProvider;
  label: string;
  title: string;
  description: string;
  emailPlaceholder: string;
  tagColor: string;
  addButtonLabel: string;
  classificationNote: string;
}

const createCapabilityMatrix = (overrides: Partial<Omit<ProtocolCapabilityMatrix, 'modes'>> & { modes?: string[] } = {}): ProtocolCapabilityMatrix => ({
  readInbox: false,
  readJunk: false,
  readSent: false,
  clearMailbox: false,
  sendMail: false,
  usesOAuth: false,
  receiveMail: false,
  apiAccess: false,
  forwarding: false,
  search: false,
  refreshToken: false,
  webhook: false,
  aliasSupport: false,
  ...overrides,
  modes: overrides.modes ? [...overrides.modes] : [],
});

const createImapSmtpConfigDefaults = (overrides: Partial<MailProviderConfig> = {}): Partial<MailProviderConfig> => ({
  readMode: 'IMAP',
  imapPort: 993,
  imapTls: true,
  smtpPort: 465,
  smtpSecure: true,
  folders: {
    inbox: 'INBOX',
    junk: 'Junk',
    sent: 'Sent',
    ...(overrides.folders || {}),
  },
  ...overrides,
});

const createImapSmtpProfile = (input: {
  key: ProviderProfileKey;
  provider: EmailProvider;
  label: string;
  summaryHint: string;
  description: string;
  importTemplate: string;
  secretLabel: string;
  secretPlaceholder: string;
  secretHelpText: string;
  providerConfigDefaults?: Partial<MailProviderConfig>;
  requiresManualServerConfig?: boolean;
  serverConfigHelpText?: string;
  supportsBulkImport?: boolean;
}): ProviderProfileDefinition => ({
  key: input.key,
  provider: input.provider,
  authType: 'APP_PASSWORD',
  label: input.label,
  representativeProtocol: 'imap_smtp',
  secondaryProtocols: ['smtp'],
  description: input.description,
  summaryHint: input.summaryHint,
  importTemplate: input.importTemplate,
  providerConfigDefaults: input.providerConfigDefaults,
  requiresManualServerConfig: input.requiresManualServerConfig,
  serverConfigHelpText: input.serverConfigHelpText,
  secretLabel: input.secretLabel,
  secretPlaceholder: input.secretPlaceholder,
  secretHelpText: input.secretHelpText,
  supportsBulkImport: input.supportsBulkImport,
  capabilitySummary: createCapabilityMatrix({
    readInbox: true,
    readJunk: true,
    readSent: true,
    sendMail: true,
    receiveMail: true,
    modes: ['IMAP', 'SMTP'],
  }),
});

export const AUTH_TYPE_LABELS: Record<EmailAuthType, string> = {
  MICROSOFT_OAUTH: 'Microsoft OAuth',
  GOOGLE_OAUTH: 'Google OAuth',
  APP_PASSWORD: '应用专用密码',
};

export const REPRESENTATIVE_PROTOCOL_LABELS: Record<RepresentativeProtocol, string> = {
  oauth_api: 'OAuth API',
  imap_smtp: 'IMAP / SMTP',
  hosted_internal: 'Hosted Internal',
};

export const SECONDARY_PROTOCOL_LABELS: Record<SecondaryProtocol, string> = {
  graph_api: 'Graph API',
  gmail_api: 'Gmail API',
  imap: 'IMAP',
  smtp: 'SMTP',
};

export const REPRESENTATIVE_PROTOCOL_TAG_COLORS: Record<RepresentativeProtocol, string> = {
  oauth_api: 'processing',
  imap_smtp: 'purple',
  hosted_internal: 'green',
};

export const REPRESENTATIVE_PROTOCOL_DEFINITIONS: Record<RepresentativeProtocol, RepresentativeProtocolDefinition> = {
  oauth_api: {
    key: 'oauth_api',
    label: REPRESENTATIVE_PROTOCOL_LABELS.oauth_api,
    description: '以 OAuth 授权 + Provider API 为主路径，适合 Outlook OAuth、Gmail OAuth 等能力更完整的外部邮箱。',
    tagColor: REPRESENTATIVE_PROTOCOL_TAG_COLORS.oauth_api,
    connectionLabel: '添加 OAuth API 邮箱',
    external: true,
  },
  imap_smtp: {
    key: 'imap_smtp',
    label: REPRESENTATIVE_PROTOCOL_LABELS.imap_smtp,
    description: '以 IMAP 收信 + SMTP 发信为主路径，适合应用专用密码、授权码类的外部邮箱接入。',
    tagColor: REPRESENTATIVE_PROTOCOL_TAG_COLORS.imap_smtp,
    connectionLabel: '添加 IMAP / SMTP 邮箱',
    external: true,
  },
  hosted_internal: {
    key: 'hosted_internal',
    label: REPRESENTATIVE_PROTOCOL_LABELS.hosted_internal,
    description: 'all-Mail 自己的站内托管邮箱协议族，独立在域名邮箱 / 门户页面中管理，不从外部邮箱连接入口创建。',
    tagColor: REPRESENTATIVE_PROTOCOL_TAG_COLORS.hosted_internal,
    connectionLabel: '前往 Hosted Internal 邮箱',
    external: false,
  },
};

export const EXTERNAL_REPRESENTATIVE_PROTOCOLS: RepresentativeProtocol[] = ['oauth_api', 'imap_smtp'];

const EXTERNAL_PROVIDER_PROFILE_REGISTRY: ProviderProfileDefinition[] = [
  {
    key: 'outlook-oauth',
    provider: 'OUTLOOK',
    authType: 'MICROSOFT_OAUTH',
    label: 'Outlook OAuth / Graph',
    representativeProtocol: 'oauth_api',
    secondaryProtocols: ['imap'],
    description: '对用户按 Microsoft OAuth / Graph 主分类展示，底层可带 IMAP 辅助读取或 UID 删除回退。',
    summaryHint: '主分类：OAuth API（Graph）；辅助协议：IMAP',
    importTemplate: 'OUTLOOK_OAUTH----example@outlook.com----client_id----client_secret----refresh_token',
    capabilitySummary: createCapabilityMatrix({
      readInbox: true,
      readJunk: true,
      readSent: true,
      clearMailbox: true,
      sendMail: true,
      usesOAuth: true,
      receiveMail: true,
      refreshToken: true,
      modes: ['GRAPH_API', 'IMAP'],
    }),
  },
  {
    key: 'gmail-oauth',
    provider: 'GMAIL',
    authType: 'GOOGLE_OAUTH',
    label: 'Gmail OAuth / Gmail API',
    representativeProtocol: 'oauth_api',
    secondaryProtocols: ['imap'],
    description: '对用户按 Google OAuth / Gmail API 主分类展示，底层仍可能使用 IMAP 作为补充路径。',
    summaryHint: '主分类：OAuth API（Gmail API）；辅助协议：IMAP',
    importTemplate: 'GMAIL_OAUTH----example@gmail.com----client_id----client_secret----refresh_token',
    capabilitySummary: createCapabilityMatrix({
      readInbox: true,
      readJunk: true,
      readSent: true,
      clearMailbox: true,
      sendMail: true,
      usesOAuth: true,
      receiveMail: true,
      refreshToken: true,
      modes: ['GMAIL_API', 'IMAP'],
    }),
  },
  createImapSmtpProfile({
    key: 'gmail-app-password',
    provider: 'GMAIL',
    label: 'Gmail App Password',
    summaryHint: '主分类：IMAP / SMTP；发送协议：SMTP',
    description: 'Gmail 应用专用密码模式按 IMAP / SMTP 主分类展示，不走 OAuth API。',
    importTemplate: 'GMAIL_APP_PASSWORD----example@gmail.com----app_password',
    secretLabel: 'Gmail 应用专用密码',
    secretPlaceholder: 'Gmail App Password',
    secretHelpText: '适用于已开启两步验证后的 Gmail 应用专用密码模式。',
    providerConfigDefaults: createImapSmtpConfigDefaults({
      imapHost: 'imap.gmail.com',
      smtpHost: 'smtp.gmail.com',
      folders: { junk: '[Gmail]/Spam', sent: '[Gmail]/Sent Mail' },
    }),
    supportsBulkImport: true,
  }),
  createImapSmtpProfile({
    key: 'qq-imap-smtp',
    provider: 'QQ',
    label: 'QQ IMAP / SMTP',
    summaryHint: '主分类：IMAP / SMTP；发送协议：SMTP',
    description: 'QQ 邮箱按 IMAP / SMTP 授权码模式展示，是最典型的协议型接入。',
    importTemplate: 'QQ_IMAP_SMTP----example@qq.com----authorization_code',
    secretLabel: 'QQ 授权码',
    secretPlaceholder: 'QQ IMAP / SMTP 授权码',
    secretHelpText: '请填写 QQ 邮箱后台生成的授权码，不是网页登录密码。',
    providerConfigDefaults: createImapSmtpConfigDefaults({
      imapHost: 'imap.qq.com',
      smtpHost: 'smtp.qq.com',
      folders: { sent: 'Sent Messages' },
    }),
    supportsBulkImport: true,
  }),
  createImapSmtpProfile({
    key: 'netease-163-imap-smtp',
    provider: 'NETEASE_163',
    label: '163 IMAP / SMTP',
    summaryHint: '主分类：IMAP / SMTP；provider：163 邮箱',
    description: '163 邮箱按 IMAP / SMTP 客户端授权码模式展示，适合验证码与普通收件自动化。',
    importTemplate: 'NETEASE_163_IMAP_SMTP----example@163.com----authorization_code',
    secretLabel: '163 客户端授权码',
    secretPlaceholder: '163 客户端授权码',
    secretHelpText: '请先在 163 邮箱后台开启 IMAP/SMTP 并生成客户端授权码；这里不能填写网页登录密码。',
    providerConfigDefaults: createImapSmtpConfigDefaults({
      imapHost: 'imap.163.com',
      smtpHost: 'smtp.163.com',
    }),
    supportsBulkImport: true,
  }),
  createImapSmtpProfile({
    key: 'netease-126-imap-smtp',
    provider: 'NETEASE_126',
    label: '126 IMAP / SMTP',
    summaryHint: '主分类：IMAP / SMTP；provider：126 邮箱',
    description: '126 邮箱按 IMAP / SMTP 客户端授权码模式展示，接入方式与 163 保持一致。',
    importTemplate: 'NETEASE_126_IMAP_SMTP----example@126.com----authorization_code',
    secretLabel: '126 客户端授权码',
    secretPlaceholder: '126 客户端授权码',
    secretHelpText: '请先在 126 邮箱后台开启 IMAP/SMTP 并生成客户端授权码；这里不能填写网页登录密码。',
    providerConfigDefaults: createImapSmtpConfigDefaults({
      imapHost: 'imap.126.com',
      smtpHost: 'smtp.126.com',
    }),
    supportsBulkImport: true,
  }),
  createImapSmtpProfile({
    key: 'icloud-imap-smtp',
    provider: 'ICLOUD',
    label: 'iCloud IMAP / SMTP',
    summaryHint: '主分类：IMAP / SMTP；provider：iCloud',
    description: 'iCloud 邮箱按 IMAP / SMTP App 专用密码模式展示，适合 Apple 生态下的标准接入。',
    importTemplate: 'ICLOUD_IMAP_SMTP----example@icloud.com----app_specific_password',
    secretLabel: 'iCloud App 专用密码',
    secretPlaceholder: 'iCloud App-Specific Password',
    secretHelpText: '请在 Apple ID 安全设置中生成 App 专用密码后再接入。',
    providerConfigDefaults: createImapSmtpConfigDefaults({
      imapHost: 'imap.mail.me.com',
      smtpHost: 'smtp.mail.me.com',
      smtpPort: 587,
      smtpSecure: false,
      folders: { sent: 'Sent Messages' },
    }),
    supportsBulkImport: true,
  }),
  createImapSmtpProfile({
    key: 'yahoo-imap-smtp',
    provider: 'YAHOO',
    label: 'Yahoo IMAP / SMTP',
    summaryHint: '主分类：IMAP / SMTP；provider：Yahoo',
    description: 'Yahoo 邮箱按 IMAP / SMTP App Password 模式展示，适合已有 Yahoo 账号池接入。',
    importTemplate: 'YAHOO_IMAP_SMTP----example@yahoo.com----app_password',
    secretLabel: 'Yahoo App Password',
    secretPlaceholder: 'Yahoo App Password',
    secretHelpText: '请先在 Yahoo 账号安全设置中生成 App Password。',
    providerConfigDefaults: createImapSmtpConfigDefaults({
      imapHost: 'imap.mail.yahoo.com',
      smtpHost: 'smtp.mail.yahoo.com',
      folders: { junk: 'Bulk Mail' },
    }),
    supportsBulkImport: true,
  }),
  createImapSmtpProfile({
    key: 'zoho-imap-smtp',
    provider: 'ZOHO',
    label: 'Zoho IMAP / SMTP',
    summaryHint: '主分类：IMAP / SMTP；provider：Zoho Mail',
    description: 'Zoho Mail 按 IMAP / SMTP 应用密码模式展示，适合企业邮箱类标准接入。',
    importTemplate: 'ZOHO_IMAP_SMTP----example@zoho.com----app_password',
    secretLabel: 'Zoho 应用密码',
    secretPlaceholder: 'Zoho App Password',
    secretHelpText: '如果租户启用了 MFA，请使用 Zoho App Password 或客户端授权密码。',
    providerConfigDefaults: createImapSmtpConfigDefaults({
      imapHost: 'imap.zoho.com',
      smtpHost: 'smtp.zoho.com',
      folders: { junk: 'Spam' },
    }),
    supportsBulkImport: true,
  }),
  createImapSmtpProfile({
    key: 'aliyun-imap-smtp',
    provider: 'ALIYUN',
    label: '阿里邮箱 IMAP / SMTP',
    summaryHint: '主分类：IMAP / SMTP；provider：阿里邮箱',
    description: '阿里邮箱按 IMAP / SMTP 客户端专用密码模式展示，适合企业邮箱场景的标准协议接入。',
    importTemplate: 'ALIYUN_IMAP_SMTP----example@aliyun.com----authorization_code',
    secretLabel: '阿里邮箱客户端专用密码',
    secretPlaceholder: '阿里邮箱客户端专用密码 / 授权码',
    secretHelpText: '请确认已在阿里邮箱后台开启客户端收发权限并生成专用密码。',
    providerConfigDefaults: createImapSmtpConfigDefaults({
      imapHost: 'imap.qiye.aliyun.com',
      smtpHost: 'smtp.qiye.aliyun.com',
    }),
    supportsBulkImport: true,
  }),
  createImapSmtpProfile({
    key: 'amazon-workmail-imap-smtp',
    provider: 'AMAZON_WORKMAIL',
    label: 'Amazon WorkMail IMAP / SMTP',
    summaryHint: '主分类：IMAP / SMTP；provider：Amazon WorkMail',
    description: 'Amazon WorkMail 属于标准 IMAP / SMTP 企业邮箱，但服务器地址按 AWS Region 区分，通常需要手工确认。',
    importTemplate: 'AMAZON_WORKMAIL_IMAP_SMTP----example@yourdomain.com----password',
    secretLabel: 'Amazon WorkMail 密码',
    secretPlaceholder: 'Amazon WorkMail Password',
    secretHelpText: '请填写邮箱密码，并在下方服务器配置中填写对应区域的 imap.mail.{region}.awsapps.com / smtp.mail.{region}.awsapps.com。',
    providerConfigDefaults: createImapSmtpConfigDefaults({
      folders: { sent: 'Sent Items' },
    }),
    requiresManualServerConfig: true,
    serverConfigHelpText: 'Amazon WorkMail 没有单一全局主机名，请填写与你的 AWS Region 对应的 IMAP / SMTP 主机地址。',
    supportsBulkImport: false,
  }),
  createImapSmtpProfile({
    key: 'fastmail-imap-smtp',
    provider: 'FASTMAIL',
    label: 'Fastmail IMAP / SMTP',
    summaryHint: '主分类：IMAP / SMTP；provider：Fastmail',
    description: 'Fastmail 通过标准 IMAP / SMTP 接入，适合国际化个人/企业邮箱统一纳管。',
    importTemplate: 'FASTMAIL_IMAP_SMTP----example@fastmail.com----app_password',
    secretLabel: 'Fastmail 密码 / App Password',
    secretPlaceholder: 'Fastmail Password or App Password',
    secretHelpText: '若账号启用了两步验证，请优先使用 Fastmail App Password。',
    providerConfigDefaults: createImapSmtpConfigDefaults({
      imapHost: 'imap.fastmail.com',
      smtpHost: 'smtp.fastmail.com',
      folders: { junk: 'Junk Mail' },
    }),
    supportsBulkImport: true,
  }),
  createImapSmtpProfile({
    key: 'aol-imap-smtp',
    provider: 'AOL',
    label: 'AOL Mail IMAP / SMTP',
    summaryHint: '主分类：IMAP / SMTP；provider：AOL Mail',
    description: 'AOL Mail 使用标准 IMAP / SMTP 接入，通常需要 App Password。',
    importTemplate: 'AOL_IMAP_SMTP----example@aol.com----app_password',
    secretLabel: 'AOL App Password',
    secretPlaceholder: 'AOL App Password',
    secretHelpText: '建议使用 AOL 后台生成的 App Password，而不是网页登录密码。',
    providerConfigDefaults: createImapSmtpConfigDefaults({
      imapHost: 'imap.aol.com',
      smtpHost: 'smtp.aol.com',
      folders: { junk: 'Spam' },
    }),
    supportsBulkImport: true,
  }),
  createImapSmtpProfile({
    key: 'gmx-imap-smtp',
    provider: 'GMX',
    label: 'GMX IMAP / SMTP',
    summaryHint: '主分类：IMAP / SMTP；provider：GMX',
    description: 'GMX 使用标准 IMAP / SMTP 接入，是常见的国外通用邮箱。',
    importTemplate: 'GMX_IMAP_SMTP----example@gmx.com----password',
    secretLabel: 'GMX 密码',
    secretPlaceholder: 'GMX Password',
    secretHelpText: '请填写 GMX 邮箱密码；如租户策略要求，也可改用应用专用密码。',
    providerConfigDefaults: createImapSmtpConfigDefaults({
      imapHost: 'imap.gmx.com',
      smtpHost: 'mail.gmx.com',
      smtpPort: 587,
      smtpSecure: false,
      folders: { junk: 'Spam' },
    }),
    supportsBulkImport: true,
  }),
  createImapSmtpProfile({
    key: 'mailcom-imap-smtp',
    provider: 'MAILCOM',
    label: 'Mail.com IMAP / SMTP',
    summaryHint: '主分类：IMAP / SMTP；provider：Mail.com',
    description: 'Mail.com 使用标准 IMAP / SMTP 接入，适合常见的国外通用邮箱场景。',
    importTemplate: 'MAILCOM_IMAP_SMTP----example@mail.com----password',
    secretLabel: 'Mail.com 密码',
    secretPlaceholder: 'Mail.com Password',
    secretHelpText: '请确认账号支持 IMAP/SMTP 功能后再接入。',
    providerConfigDefaults: createImapSmtpConfigDefaults({
      imapHost: 'imap.mail.com',
      smtpHost: 'smtp.mail.com',
      smtpPort: 587,
      smtpSecure: false,
      folders: { junk: 'Spam' },
    }),
    supportsBulkImport: true,
  }),
  createImapSmtpProfile({
    key: 'yandex-imap-smtp',
    provider: 'YANDEX',
    label: 'Yandex IMAP / SMTP',
    summaryHint: '主分类：IMAP / SMTP；provider：Yandex Mail',
    description: 'Yandex Mail 使用标准 IMAP / SMTP 接入，适合国际化或区域性邮箱池场景。',
    importTemplate: 'YANDEX_IMAP_SMTP----example@yandex.com----password',
    secretLabel: 'Yandex 密码 / App Password',
    secretPlaceholder: 'Yandex Password or App Password',
    secretHelpText: '请优先使用 Yandex 后台允许的应用密码；在特定区域可改用 imap.ya.ru 作为 IMAP 主机。',
    providerConfigDefaults: createImapSmtpConfigDefaults({
      imapHost: 'imap.yandex.com',
      smtpHost: 'smtp.yandex.com',
      folders: { junk: 'Spam' },
    }),
    supportsBulkImport: true,
  }),
  createImapSmtpProfile({
    key: 'custom-imap-smtp',
    provider: 'CUSTOM_IMAP_SMTP',
    label: 'Custom IMAP / SMTP',
    summaryHint: '主分类：IMAP / SMTP；provider：自定义服务器',
    description: '用于接入企业自建邮箱、普通域名邮箱、cPanel、自定义 IMAP / SMTP 服务等长尾场景。',
    importTemplate: 'CUSTOM_IMAP_SMTP----example@yourdomain.com----password',
    secretLabel: '登录密码 / 授权码',
    secretPlaceholder: 'Password / App Password / Authorization Code',
    secretHelpText: '请填写支持 IMAP / SMTP 的登录凭据；如果服务商启用了两步验证，通常需要使用 App Password 或授权码。',
    providerConfigDefaults: createImapSmtpConfigDefaults(),
    requiresManualServerConfig: true,
    serverConfigHelpText: '自定义模式需要你填写 IMAP / SMTP 主机、端口、TLS 设置以及可选文件夹映射。',
    supportsBulkImport: false,
  }),
];

const PROVIDER_PROFILE_DEFINITIONS: Record<ProviderProfileKey, ProviderProfileDefinition> = EXTERNAL_PROVIDER_PROFILE_REGISTRY.reduce((accumulator, profile) => {
  accumulator[profile.key] = profile;
  return accumulator;
}, {} as Record<ProviderProfileKey, ProviderProfileDefinition>);

const PROVIDER_BASE_DEFINITIONS: Record<EmailProvider, ProviderBaseDefinition> = {
  OUTLOOK: {
    provider: 'OUTLOOK',
    label: 'Outlook',
    title: 'Outlook / Microsoft 365',
    description: '适合 Microsoft OAuth 接入。产品层按 OAuth API 主分类展示，默认用 Graph 完成读信、清空与发信。',
    emailPlaceholder: 'example@outlook.com',
    tagColor: 'blue',
    addButtonLabel: '添加 Outlook',
    classificationNote: 'Outlook 对用户按 OAuth API（Microsoft Graph）主分类展示；若出现老账号或特定邮箱夹兼容性问题，底层仍可能借助 IMAP。',
  },
  GMAIL: {
    provider: 'GMAIL',
    label: 'Gmail',
    title: 'Gmail / Google Workspace',
    description: 'Gmail 同时支持 Google OAuth 与应用专用密码。产品层会按所选鉴权方式切到不同的代表协议分类。',
    emailPlaceholder: 'example@gmail.com',
    tagColor: 'red',
    addButtonLabel: '添加 Gmail',
    classificationNote: 'Gmail 是最典型的多协议 provider：Google OAuth 按 OAuth API 主分类展示，应用专用密码则改归 IMAP / SMTP。',
  },
  QQ: {
    provider: 'QQ',
    label: 'QQ',
    title: 'QQ 邮箱',
    description: '使用 QQ 邮箱 IMAP / SMTP 授权码接入，产品层直接按 IMAP / SMTP 主分类展示。',
    emailPlaceholder: 'example@qq.com',
    tagColor: 'gold',
    addButtonLabel: '添加 QQ',
    classificationNote: 'QQ 本身就是标准的 IMAP / SMTP 授权码接入，没有额外的 OAuth API 主路径。',
  },
  NETEASE_163: {
    provider: 'NETEASE_163',
    label: '163',
    title: '163 邮箱',
    description: '163 邮箱通过 IMAP / SMTP 客户端授权码接入，适合协议型验证码和收件自动化。',
    emailPlaceholder: 'example@163.com',
    tagColor: 'orange',
    addButtonLabel: '添加 163',
    classificationNote: '163 邮箱属于标准 IMAP / SMTP provider，建议用客户端授权码接入。',
  },
  NETEASE_126: {
    provider: 'NETEASE_126',
    label: '126',
    title: '126 邮箱',
    description: '126 邮箱通过 IMAP / SMTP 客户端授权码接入，适合标准邮箱池与验证邮件读取。',
    emailPlaceholder: 'example@126.com',
    tagColor: 'cyan',
    addButtonLabel: '添加 126',
    classificationNote: '126 邮箱属于标准 IMAP / SMTP provider，接入方式与 163 保持一致。',
  },
  ICLOUD: {
    provider: 'ICLOUD',
    label: 'iCloud',
    title: 'iCloud Mail',
    description: 'iCloud 使用 IMAP / SMTP + App 专用密码接入，适合 Apple 账号侧的标准协议联通。',
    emailPlaceholder: 'example@icloud.com',
    tagColor: 'geekblue',
    addButtonLabel: '添加 iCloud',
    classificationNote: 'iCloud 邮箱属于标准 IMAP / SMTP provider，需要 Apple App 专用密码。',
  },
  YAHOO: {
    provider: 'YAHOO',
    label: 'Yahoo',
    title: 'Yahoo Mail',
    description: 'Yahoo 使用 IMAP / SMTP + App Password 接入，适合已有 Yahoo 账号的协议统一管理。',
    emailPlaceholder: 'example@yahoo.com',
    tagColor: 'purple',
    addButtonLabel: '添加 Yahoo',
    classificationNote: 'Yahoo 邮箱属于标准 IMAP / SMTP provider，推荐使用 App Password。',
  },
  ZOHO: {
    provider: 'ZOHO',
    label: 'Zoho',
    title: 'Zoho Mail',
    description: 'Zoho Mail 使用 IMAP / SMTP 应用密码接入，适合企业邮箱协议化统一接管。',
    emailPlaceholder: 'example@zoho.com',
    tagColor: 'green',
    addButtonLabel: '添加 Zoho',
    classificationNote: 'Zoho Mail 属于标准 IMAP / SMTP provider，适合企业邮箱型外部接入。',
  },
  ALIYUN: {
    provider: 'ALIYUN',
    label: '阿里邮箱',
    title: '阿里邮箱 / Aliyun Mail',
    description: '阿里邮箱通过 IMAP / SMTP 客户端专用密码接入，适合企业邮箱场景和多账号协议统一。',
    emailPlaceholder: 'example@aliyun.com',
    tagColor: 'volcano',
    addButtonLabel: '添加阿里邮箱',
    classificationNote: '阿里邮箱属于标准 IMAP / SMTP provider，适合走客户端专用密码或授权码。',
  },
  AMAZON_WORKMAIL: {
    provider: 'AMAZON_WORKMAIL',
    label: 'Amazon WorkMail',
    title: 'Amazon WorkMail',
    description: 'Amazon WorkMail 使用标准 IMAP / SMTP 接入，但主机地址通常按 AWS Region 区分。',
    emailPlaceholder: 'example@yourdomain.com',
    tagColor: 'orange',
    addButtonLabel: '添加 Amazon WorkMail',
    classificationNote: 'Amazon WorkMail 仍属于 IMAP / SMTP provider，但通常需要手工填写区域相关的 IMAP / SMTP 主机。',
  },
  FASTMAIL: {
    provider: 'FASTMAIL',
    label: 'Fastmail',
    title: 'Fastmail',
    description: 'Fastmail 使用标准 IMAP / SMTP 接入，适合国际个人与企业邮箱统一管理。',
    emailPlaceholder: 'example@fastmail.com',
    tagColor: 'magenta',
    addButtonLabel: '添加 Fastmail',
    classificationNote: 'Fastmail 属于标准 IMAP / SMTP provider，可使用密码或 App Password。',
  },
  AOL: {
    provider: 'AOL',
    label: 'AOL',
    title: 'AOL Mail',
    description: 'AOL Mail 使用标准 IMAP / SMTP 接入，推荐 App Password。',
    emailPlaceholder: 'example@aol.com',
    tagColor: 'blue',
    addButtonLabel: '添加 AOL',
    classificationNote: 'AOL Mail 属于标准 IMAP / SMTP provider，常见接入方式是 App Password。',
  },
  GMX: {
    provider: 'GMX',
    label: 'GMX',
    title: 'GMX Mail',
    description: 'GMX Mail 使用标准 IMAP / SMTP 接入，适合国外通用邮箱场景。',
    emailPlaceholder: 'example@gmx.com',
    tagColor: 'lime',
    addButtonLabel: '添加 GMX',
    classificationNote: 'GMX 属于标准 IMAP / SMTP provider。',
  },
  MAILCOM: {
    provider: 'MAILCOM',
    label: 'Mail.com',
    title: 'Mail.com',
    description: 'Mail.com 使用标准 IMAP / SMTP 接入，适合通用的国际邮箱场景。',
    emailPlaceholder: 'example@mail.com',
    tagColor: 'gold',
    addButtonLabel: '添加 Mail.com',
    classificationNote: 'Mail.com 属于标准 IMAP / SMTP provider，需确认账号支持 IMAP/SMTP。',
  },
  YANDEX: {
    provider: 'YANDEX',
    label: 'Yandex',
    title: 'Yandex Mail',
    description: 'Yandex Mail 使用标准 IMAP / SMTP 接入，适合国际化或区域型邮箱池。',
    emailPlaceholder: 'example@yandex.com',
    tagColor: 'red',
    addButtonLabel: '添加 Yandex',
    classificationNote: 'Yandex Mail 属于标准 IMAP / SMTP provider；某些区域可使用备用 IMAP 主机。',
  },
  CUSTOM_IMAP_SMTP: {
    provider: 'CUSTOM_IMAP_SMTP',
    label: 'Custom IMAP / SMTP',
    title: 'Custom IMAP / SMTP',
    description: '适合企业自建邮箱、普通域名邮箱、cPanel、自定义 IMAP / SMTP 服务等长尾场景。',
    emailPlaceholder: 'example@yourdomain.com',
    tagColor: 'cyan',
    addButtonLabel: '添加 Custom IMAP / SMTP',
    classificationNote: 'Custom IMAP / SMTP 仍属于标准 IMAP / SMTP 家族，只是把服务器配置改为手工输入。',
  },
};

export const PROVIDER_ORDER: EmailProvider[] = [
  'OUTLOOK',
  'GMAIL',
  'QQ',
  'NETEASE_163',
  'NETEASE_126',
  'ICLOUD',
  'YAHOO',
  'ZOHO',
  'ALIYUN',
  'AMAZON_WORKMAIL',
  'FASTMAIL',
  'AOL',
  'GMX',
  'MAILCOM',
  'YANDEX',
  'CUSTOM_IMAP_SMTP',
];

function getProfilesByProvider(provider: EmailProvider): ProviderProfileDefinition[] {
  return EXTERNAL_PROVIDER_PROFILE_REGISTRY.filter((profile) => profile.provider === provider);
}

function buildProviderDefinition(provider: EmailProvider): ProviderDefinition {
  const providerBase = PROVIDER_BASE_DEFINITIONS[provider];
  const profiles = getProfilesByProvider(provider);
  const defaultProfile = profiles[0];
  if (!defaultProfile) {
    throw new Error(`No provider profiles configured for provider ${provider}`);
  }

  const authTypes = profiles.map((profile) => ({
    value: profile.authType,
    label: profile.authType === 'APP_PASSWORD' && provider !== 'GMAIL'
      ? '授权码 / 应用专用密码'
      : AUTH_TYPE_LABELS[profile.authType],
  }));

  const profileDefinitions = profiles.reduce((accumulator, profile) => {
    accumulator[profile.authType] = profile;
    return accumulator;
  }, {} as Partial<Record<EmailAuthType, ProviderProfileDefinition>>);

  const authTypeNotes = profiles.reduce((accumulator, profile) => {
    accumulator[profile.authType] = profile.description;
    return accumulator;
  }, {} as Partial<Record<EmailAuthType, string>>);

  return {
    ...providerBase,
    authTypes,
    importTemplate: defaultProfile.importTemplate,
    importTemplates: profiles.map((profile) => profile.importTemplate),
    summaryHint: profiles.length === 1
      ? defaultProfile.summaryHint
      : profiles.map((profile) => `${AUTH_TYPE_LABELS[profile.authType]}：${profile.summaryHint}`).join('；'),
    representativeProtocol: defaultProfile.representativeProtocol,
    secondaryProtocols: Array.from(new Set(profiles.flatMap((profile) => profile.secondaryProtocols))),
    authTypeNotes,
    profileDefinitions,
  };
}

export const PROVIDER_DEFINITIONS: Record<EmailProvider, ProviderDefinition> = PROVIDER_ORDER.reduce((accumulator, provider) => {
  accumulator[provider] = buildProviderDefinition(provider);
  return accumulator;
}, {} as Record<EmailProvider, ProviderDefinition>);

const HOSTED_INTERNAL_PROFILE_DEFINITIONS: Record<HostedInternalProfileKey, HostedInternalProfileDefinition> = {
  'hosted-internal-manual': {
    key: 'hosted-internal-manual',
    provisioningMode: 'MANUAL',
    label: 'Hosted Internal / Manual',
    representativeProtocol: 'hosted_internal',
    secondaryProtocols: [],
    description: '站内托管邮箱的人工维护 profile，适合门户运营、人工绑定负责人和日常收发协同。',
    summaryHint: '主分类：Hosted Internal；profile：MANUAL',
    classificationNote: '该邮箱走 all-Mail 自己的域名收件、门户访问和站内发信链路，不再按 OAuth API 或 IMAP / SMTP 归类。',
    capabilitySummary: createCapabilityMatrix({
      readInbox: true,
      sendMail: true,
      receiveMail: true,
      forwarding: true,
    }),
  },
  'hosted-internal-api-pool': {
    key: 'hosted-internal-api-pool',
    provisioningMode: 'API_POOL',
    label: 'Hosted Internal / API Pool',
    representativeProtocol: 'hosted_internal',
    secondaryProtocols: [],
    description: '站内托管邮箱的 API 池 profile，适合批量分配、脚本取号和验证码/收件自动化。',
    summaryHint: '主分类：Hosted Internal；profile：API_POOL',
    classificationNote: '该邮箱仍属于 Hosted Internal，只是供给方式切到 API_POOL，便于域名池分配和程序化领取。',
    capabilitySummary: createCapabilityMatrix({
      readInbox: true,
      sendMail: true,
      receiveMail: true,
      apiAccess: true,
      forwarding: true,
    }),
  },
};

export const EMAIL_PROVIDER_OPTIONS = PROVIDER_ORDER.map((provider) => ({
  value: provider,
  label: PROVIDER_DEFINITIONS[provider].label,
}));

export const EMAIL_PROVIDER_LABELS: Record<EmailProvider, string> = PROVIDER_ORDER.reduce(
  (accumulator, provider) => {
    accumulator[provider] = PROVIDER_DEFINITIONS[provider].label;
    return accumulator;
  },
  {} as Record<EmailProvider, string>,
);

export const EMAIL_AUTH_TYPE_OPTIONS: Record<EmailProvider, ProviderAuthOption[]> = PROVIDER_ORDER.reduce(
  (accumulator, provider) => {
    accumulator[provider] = PROVIDER_DEFINITIONS[provider].authTypes;
    return accumulator;
  },
  {} as Record<EmailProvider, ProviderAuthOption[]>,
);

export const getDefaultAuthType = (provider: EmailProvider): EmailAuthType =>
  PROVIDER_DEFINITIONS[provider].authTypes[0].value;

export const resolveProviderProfile = (provider: EmailProvider, authType: EmailAuthType = getDefaultAuthType(provider)): ProviderProfileKey => {
  const definition = PROVIDER_DEFINITIONS[provider].profileDefinitions[authType];
  if (!definition) {
    throw new Error(`Unsupported provider profile for ${provider}:${authType}`);
  }
  return definition.key;
};

export const getProviderProfileDefinition = (provider: EmailProvider, authType: EmailAuthType = getDefaultAuthType(provider)): ProviderProfileDefinition => {
  const definition = PROVIDER_DEFINITIONS[provider].profileDefinitions[authType];
  if (!definition) {
    throw new Error(`Unsupported provider profile for ${provider}:${authType}`);
  }
  return definition;
};

export const getProviderProfileDefinitionByKey = (profile: ProviderProfileKey): ProviderProfileDefinition =>
  PROVIDER_PROFILE_DEFINITIONS[profile];

export const getProviderDefinition = (provider: EmailProvider): ProviderDefinition =>
  PROVIDER_DEFINITIONS[provider];

export const getProviderHint = (provider: EmailProvider): string =>
  PROVIDER_DEFINITIONS[provider].summaryHint;

export const getRepresentativeProtocolLabel = (protocol: RepresentativeProtocol): string =>
  REPRESENTATIVE_PROTOCOL_LABELS[protocol];

export const getRepresentativeProtocolDefinition = (protocol: RepresentativeProtocol): RepresentativeProtocolDefinition =>
  REPRESENTATIVE_PROTOCOL_DEFINITIONS[protocol];

export const getRepresentativeProtocolTagColor = (protocol: RepresentativeProtocol): string =>
  REPRESENTATIVE_PROTOCOL_TAG_COLORS[protocol];

export const getSecondaryProtocolLabel = (protocol: SecondaryProtocol): string =>
  SECONDARY_PROTOCOL_LABELS[protocol];

export const getProviderImportTemplates = (separator = '----'): string[] =>
  [
    `email${separator}password`,
    `email${separator}password${separator}clientId${separator}refreshToken`,
    `email${separator}password${separator}clientId${separator}refreshToken${separator}clientSecret`,
    ...EXTERNAL_PROVIDER_PROFILE_REGISTRY
      .filter((profile) => profile.supportsBulkImport !== false)
      .map((profile) => profile.importTemplate.replaceAll('----', separator)),
  ];

export const getProviderProfileCapabilities = (provider: EmailProvider, authType: EmailAuthType = getDefaultAuthType(provider)): ProviderProfileCapabilities =>
  getProviderProfileDefinition(provider, authType).capabilitySummary;

export const getProviderProfilesByRepresentativeProtocol = (protocol: RepresentativeProtocol): ProviderProfileDefinition[] =>
  EXTERNAL_PROVIDER_PROFILE_REGISTRY.filter((profile) => profile.representativeProtocol === protocol);

export const getProvidersByRepresentativeProtocol = (protocol: RepresentativeProtocol): EmailProvider[] =>
  Array.from(new Set(getProviderProfilesByRepresentativeProtocol(protocol).map((profile) => profile.provider)));

export const getDefaultProfileForRepresentativeProtocol = (protocol: RepresentativeProtocol): ProviderProfileDefinition => {
  const profiles = getProviderProfilesByRepresentativeProtocol(protocol);
  if (profiles.length === 0) {
    throw new Error(`No provider profiles configured for representative protocol ${protocol}`);
  }
  return profiles[0];
};

export const getHostedInternalProfileDefinition = (profile: HostedInternalProfileKey): HostedInternalProfileDefinition =>
  HOSTED_INTERNAL_PROFILE_DEFINITIONS[profile];

export const getHostedInternalProfileByProvisioningMode = (provisioningMode: 'MANUAL' | 'API_POOL'): HostedInternalProfileDefinition =>
  provisioningMode === 'API_POOL'
    ? HOSTED_INTERNAL_PROFILE_DEFINITIONS['hosted-internal-api-pool']
    : HOSTED_INTERNAL_PROFILE_DEFINITIONS['hosted-internal-manual'];

export const canClearMailbox = (provider: EmailProvider, authType: EmailAuthType): boolean =>
  getProviderProfileCapabilities(provider, authType).clearMailbox;

export const canSendMailbox = (provider: EmailProvider, authType: EmailAuthType): boolean =>
  getProviderProfileCapabilities(provider, authType).sendMail;
