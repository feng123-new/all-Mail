export type EmailProvider = 'OUTLOOK' | 'GMAIL' | 'QQ';
export type EmailAuthType = 'MICROSOFT_OAUTH' | 'GOOGLE_OAUTH' | 'APP_PASSWORD';

export interface ProviderAuthOption {
  value: EmailAuthType;
  label: string;
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
  summaryHint: string;
}

export const AUTH_TYPE_LABELS: Record<EmailAuthType, string> = {
  MICROSOFT_OAUTH: 'Microsoft OAuth',
  GOOGLE_OAUTH: 'Google OAuth',
  APP_PASSWORD: '应用专用密码',
};

export const PROVIDER_DEFINITIONS: Record<EmailProvider, ProviderDefinition> = {
  OUTLOOK: {
    provider: 'OUTLOOK',
    label: 'Outlook',
    title: 'Outlook / Microsoft 365',
    description: '适合 Microsoft OAuth 接入，支持 Graph 读信、垃圾箱读取与清空邮箱。',
    emailPlaceholder: 'example@outlook.com',
    tagColor: 'blue',
    addButtonLabel: '添加 Outlook',
    authTypes: [{ value: 'MICROSOFT_OAUTH', label: AUTH_TYPE_LABELS.MICROSOFT_OAUTH }],
    importTemplate: 'OUTLOOK----example@outlook.com----client_id----client_secret----refresh_token',
    summaryHint: 'Microsoft OAuth / Graph 优先',
  },
  GMAIL: {
    provider: 'GMAIL',
    label: 'Gmail',
    title: 'Gmail / Google Workspace',
    description: '支持 Google OAuth 与应用专用密码两种接入方式，推荐优先使用 Google OAuth。',
    emailPlaceholder: 'example@gmail.com',
    tagColor: 'red',
    addButtonLabel: '添加 Gmail',
    authTypes: [
      { value: 'GOOGLE_OAUTH', label: AUTH_TYPE_LABELS.GOOGLE_OAUTH },
      { value: 'APP_PASSWORD', label: AUTH_TYPE_LABELS.APP_PASSWORD },
    ],
    importTemplate: 'GMAIL----example@gmail.com----client_id----client_secret----refresh_token',
    summaryHint: 'Google OAuth 或应用专用密码',
  },
  QQ: {
    provider: 'QQ',
    label: 'QQ',
    title: 'QQ 邮箱',
    description: '使用 QQ 邮箱 IMAP/SMTP 授权码接入，适合先做真实邮箱测试。',
    emailPlaceholder: 'example@qq.com',
    tagColor: 'gold',
    addButtonLabel: '添加 QQ',
    authTypes: [{ value: 'APP_PASSWORD', label: '授权码 / 应用专用密码' }],
    importTemplate: 'QQ----example@qq.com----authorization_code',
    summaryHint: 'IMAP / SMTP 授权码接入',
  },
};

export const PROVIDER_ORDER: EmailProvider[] = ['OUTLOOK', 'GMAIL', 'QQ'];

export const EMAIL_PROVIDER_OPTIONS = PROVIDER_ORDER.map((provider) => ({
  value: provider,
  label: PROVIDER_DEFINITIONS[provider].label,
}));

export const EMAIL_PROVIDER_LABELS: Record<EmailProvider, string> = PROVIDER_ORDER.reduce(
  (accumulator, provider) => {
    accumulator[provider] = PROVIDER_DEFINITIONS[provider].label;
    return accumulator;
  },
  {} as Record<EmailProvider, string>
);

export const EMAIL_AUTH_TYPE_OPTIONS: Record<EmailProvider, ProviderAuthOption[]> = PROVIDER_ORDER.reduce(
  (accumulator, provider) => {
    accumulator[provider] = PROVIDER_DEFINITIONS[provider].authTypes;
    return accumulator;
  },
  {} as Record<EmailProvider, ProviderAuthOption[]>
);

export const getDefaultAuthType = (provider: EmailProvider): EmailAuthType =>
  PROVIDER_DEFINITIONS[provider].authTypes[0].value;

export const getProviderDefinition = (provider: EmailProvider): ProviderDefinition =>
  PROVIDER_DEFINITIONS[provider];

export const getProviderHint = (provider: EmailProvider): string =>
  PROVIDER_DEFINITIONS[provider].summaryHint;

export const canClearMailbox = (provider: EmailProvider, authType: EmailAuthType): boolean =>
  provider !== 'QQ' && authType !== 'APP_PASSWORD';

export const canSendMailbox = (provider: EmailProvider, authType: EmailAuthType): boolean => {
  if (provider === 'QQ' && authType === 'APP_PASSWORD') return true;
  if (provider === 'GMAIL' && (authType === 'GOOGLE_OAUTH' || authType === 'APP_PASSWORD')) return true;
  if (provider === 'OUTLOOK' && authType === 'MICROSOFT_OAUTH') return true;
  return false;
};
