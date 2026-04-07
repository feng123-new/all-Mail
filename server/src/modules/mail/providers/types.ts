import { AppError } from '../../../plugins/error.js';

export const emailProviders = [
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
] as const;
export const emailAuthTypes = ['MICROSOFT_OAUTH', 'GOOGLE_OAUTH', 'APP_PASSWORD'] as const;
export const representativeProtocols = ['oauth_api', 'imap_smtp', 'hosted_internal'] as const;
export const supportingProtocols = ['graph_api', 'gmail_api', 'imap', 'smtp'] as const;
export const providerProfiles = [
    'outlook-oauth',
    'gmail-oauth',
    'gmail-app-password',
    'qq-imap-smtp',
    'netease-163-imap-smtp',
    'netease-126-imap-smtp',
    'icloud-imap-smtp',
    'yahoo-imap-smtp',
    'zoho-imap-smtp',
    'aliyun-imap-smtp',
    'amazon-workmail-imap-smtp',
    'fastmail-imap-smtp',
    'aol-imap-smtp',
    'gmx-imap-smtp',
    'mailcom-imap-smtp',
    'yandex-imap-smtp',
    'custom-imap-smtp',
] as const;

export type EmailProvider = typeof emailProviders[number];
export type EmailAuthType = typeof emailAuthTypes[number];
export type MailFetchStrategy = 'GRAPH_FIRST' | 'IMAP_FIRST' | 'GRAPH_ONLY' | 'IMAP_ONLY';
export type RepresentativeProtocol = typeof representativeProtocols[number];
export type SupportingProtocol = typeof supportingProtocols[number];
export type ProviderProfile = typeof providerProfiles[number];

export interface ProviderProfileMetadata {
    profile: ProviderProfile;
    provider: EmailProvider;
    authType: EmailAuthType;
    representativeProtocol: RepresentativeProtocol;
    secondaryProtocols: SupportingProtocol[];
    importToken: string;
    summaryHint: string;
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

export type ProviderProfileCapabilities = ProtocolCapabilityMatrix;

export interface MailProtocolSummary<
    TProfile extends string = string,
    TCapabilitySummary extends ProviderProfileCapabilities = ProviderProfileCapabilities,
> {
    providerProfile: TProfile;
    representativeProtocol: RepresentativeProtocol;
    secondaryProtocols: SupportingProtocol[];
    profileSummaryHint: string;
    capabilitySummary: TCapabilitySummary;
}

export type ProviderProfileSummary = MailProtocolSummary<ProviderProfile>;

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
    [key: string]: unknown;
}

export interface MailCredentials {
    id: number;
    email: string;
    provider: EmailProvider;
    authType: EmailAuthType;
    providerProfile?: ProviderProfile;
    representativeProtocol?: RepresentativeProtocol;
    secondaryProtocols?: SupportingProtocol[];
    clientId?: string | null;
    clientSecret?: string | null;
    refreshToken?: string | null;
    password?: string | null;
    autoAssigned: boolean;
    fetchStrategy?: MailFetchStrategy;
    providerConfig?: MailProviderConfig | null;
    capabilities?: Record<string, unknown> | null;
}

export interface EmailMessage {
    id: string;
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
    date: string;
}

export interface MailboxCheckpoint {
    uidValidity: number | null;
    lastUid: number | null;
}

export interface MailFetchResult {
    email: string;
    mailbox: string;
    resolvedMailbox?: string;
    count: number;
    messages: EmailMessage[];
    mailboxCheckpoint?: MailboxCheckpoint;
    method: string;
    provider: EmailProvider;
}

export interface MailProcessResult {
    email: string;
    mailbox: string;
    message: string;
    status: 'success' | 'error';
    deletedCount: number;
    method: string;
    provider: EmailProvider;
}

export interface MailDeleteResult {
    email: string;
    mailbox: string;
    resolvedMailbox?: string;
    deletedCount: number;
    message: string;
    mailboxCheckpoint?: MailboxCheckpoint;
    method: string;
    provider: EmailProvider;
}

export interface MailboxCapabilities {
    readInbox: boolean;
    readJunk: boolean;
    readSent: boolean;
    clearMailbox: boolean;
    sendMail: boolean;
    modes: string[];
}

export interface MailFetchOptions {
    mailbox: string;
    limit?: number;
    mailboxCheckpoint?: MailboxCheckpoint | null;
    socks5?: string;
    http?: string;
}

export interface MailProcessOptions {
    mailbox: string;
    socks5?: string;
    http?: string;
}

export interface MailSendOptions {
    fromEmail: string;
    fromName?: string;
    to: string[];
    subject: string;
    text?: string;
    html?: string;
    socks5?: string;
    http?: string;
}

export interface MailDeleteOptions {
    mailbox: string;
    messageIds: string[];
    mailboxCheckpoint?: MailboxCheckpoint | null;
    socks5?: string;
    http?: string;
}

export interface MailSendResult {
    provider: EmailProvider;
    method: string;
    providerMessageId?: string | null;
    accepted: string[];
}

export interface MailProviderAdapter {
    provider: EmailProvider | RepresentativeProtocol;
    getCapabilities(credentials: MailCredentials): MailboxCapabilities;
    getEmails(credentials: MailCredentials, options: MailFetchOptions): Promise<MailFetchResult>;
    processMailbox(credentials: MailCredentials, options: MailProcessOptions): Promise<MailProcessResult>;
    deleteMessages(credentials: MailCredentials, options: MailDeleteOptions): Promise<MailDeleteResult>;
    sendEmail(credentials: MailCredentials, options: MailSendOptions): Promise<MailSendResult>;
}

export interface MailProfileDelegate extends MailProviderAdapter {
    provider: EmailProvider;
    profile: ProviderProfile;
    representativeProtocol: RepresentativeProtocol;
}

export interface MailProviderRegistryLike {
    resolve(credentials: MailCredentials): MailProviderAdapter;
}

export interface ProxyConfig {
    socks5?: string;
    http?: string;
}

interface ProviderProfileRegistryEntry extends ProviderProfileSummary {
    provider: EmailProvider;
    authType: EmailAuthType;
    importToken: string;
    providerConfigDefaults?: Partial<MailProviderConfig>;
}

type ProviderAuthKey = `${EmailProvider}:${EmailAuthType}`;

export function createProtocolCapabilityMatrix(
    overrides: Partial<Omit<ProtocolCapabilityMatrix, 'modes'>> & { modes?: string[] } = {}
): ProtocolCapabilityMatrix {
    return {
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
    };
}

const DEFAULT_AUTH_TYPE_BY_PROVIDER: Record<EmailProvider, EmailAuthType> = {
    OUTLOOK: 'MICROSOFT_OAUTH',
    GMAIL: 'GOOGLE_OAUTH',
    QQ: 'APP_PASSWORD',
    NETEASE_163: 'APP_PASSWORD',
    NETEASE_126: 'APP_PASSWORD',
    ICLOUD: 'APP_PASSWORD',
    YAHOO: 'APP_PASSWORD',
    ZOHO: 'APP_PASSWORD',
    ALIYUN: 'APP_PASSWORD',
    AMAZON_WORKMAIL: 'APP_PASSWORD',
    FASTMAIL: 'APP_PASSWORD',
    AOL: 'APP_PASSWORD',
    GMX: 'APP_PASSWORD',
    MAILCOM: 'APP_PASSWORD',
    YANDEX: 'APP_PASSWORD',
    CUSTOM_IMAP_SMTP: 'APP_PASSWORD',
};

const IMPORT_TOKEN_PROFILE_ALIASES: Record<string, ProviderProfile> = {
    OUTLOOK: 'outlook-oauth',
    GMAIL: 'gmail-oauth',
    QQ: 'qq-imap-smtp',
    NETEASE_163: 'netease-163-imap-smtp',
    NETEASE_126: 'netease-126-imap-smtp',
    ICLOUD: 'icloud-imap-smtp',
    YAHOO: 'yahoo-imap-smtp',
    ZOHO: 'zoho-imap-smtp',
    ALIYUN: 'aliyun-imap-smtp',
    AMAZON_WORKMAIL: 'amazon-workmail-imap-smtp',
    FASTMAIL: 'fastmail-imap-smtp',
    AOL: 'aol-imap-smtp',
    GMX: 'gmx-imap-smtp',
    MAILCOM: 'mailcom-imap-smtp',
    YANDEX: 'yandex-imap-smtp',
    CUSTOM_IMAP_SMTP: 'custom-imap-smtp',
};

const PROVIDER_PROFILE_REGISTRY: Record<ProviderProfile, ProviderProfileRegistryEntry> = {
    'outlook-oauth': {
        providerProfile: 'outlook-oauth',
        provider: 'OUTLOOK',
        authType: 'MICROSOFT_OAUTH',
        representativeProtocol: 'oauth_api',
        secondaryProtocols: ['imap'],
        importToken: 'OUTLOOK_OAUTH',
        profileSummaryHint: 'Microsoft OAuth / Graph 主分类，必要时可走 IMAP 辅助路径',
        capabilitySummary: createProtocolCapabilityMatrix({
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
    'gmail-oauth': {
        providerProfile: 'gmail-oauth',
        provider: 'GMAIL',
        authType: 'GOOGLE_OAUTH',
        representativeProtocol: 'oauth_api',
        secondaryProtocols: ['imap'],
        importToken: 'GMAIL_OAUTH',
        profileSummaryHint: 'Google OAuth / Gmail API 主分类，可带 IMAP 辅助或回退',
        capabilitySummary: createProtocolCapabilityMatrix({
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
    'gmail-app-password': {
        providerProfile: 'gmail-app-password',
        provider: 'GMAIL',
        authType: 'APP_PASSWORD',
        representativeProtocol: 'imap_smtp',
        secondaryProtocols: ['smtp'],
        importToken: 'GMAIL_APP_PASSWORD',
        providerConfigDefaults: {
            readMode: 'IMAP',
        },
        profileSummaryHint: 'Gmail 应用专用密码归类为 IMAP / SMTP',
        capabilitySummary: createProtocolCapabilityMatrix({
            readInbox: true,
            readJunk: true,
            readSent: true,
            clearMailbox: false,
            sendMail: true,
            usesOAuth: false,
            receiveMail: true,
            modes: ['IMAP', 'SMTP'],
        }),
    },
    'qq-imap-smtp': {
        providerProfile: 'qq-imap-smtp',
        provider: 'QQ',
        authType: 'APP_PASSWORD',
        representativeProtocol: 'imap_smtp',
        secondaryProtocols: ['smtp'],
        importToken: 'QQ_IMAP_SMTP',
        providerConfigDefaults: {
            readMode: 'IMAP',
            imapHost: 'imap.qq.com',
            imapPort: 993,
            imapTls: true,
            smtpHost: 'smtp.qq.com',
            smtpPort: 465,
            smtpSecure: true,
            folders: {
                inbox: 'INBOX',
                junk: 'Junk',
                sent: 'Sent Messages',
            },
        },
        profileSummaryHint: 'QQ 邮箱归类为 IMAP / SMTP 授权码模式',
        capabilitySummary: createProtocolCapabilityMatrix({
            readInbox: true,
            readJunk: true,
            readSent: true,
            clearMailbox: false,
            sendMail: true,
            usesOAuth: false,
            receiveMail: true,
            modes: ['IMAP', 'SMTP'],
        }),
    },
    'netease-163-imap-smtp': {
        providerProfile: 'netease-163-imap-smtp',
        provider: 'NETEASE_163',
        authType: 'APP_PASSWORD',
        representativeProtocol: 'imap_smtp',
        secondaryProtocols: ['smtp'],
        importToken: 'NETEASE_163_IMAP_SMTP',
        providerConfigDefaults: {
            readMode: 'IMAP',
            imapHost: 'imap.163.com',
            imapPort: 993,
            imapTls: true,
            smtpHost: 'smtp.163.com',
            smtpPort: 465,
            smtpSecure: true,
            folders: {
                inbox: 'INBOX',
                junk: 'Junk',
                sent: 'Sent',
            },
        },
        profileSummaryHint: '163 邮箱归类为 IMAP / SMTP 客户端授权码模式',
        capabilitySummary: createProtocolCapabilityMatrix({
            readInbox: true,
            readJunk: true,
            readSent: true,
            sendMail: true,
            receiveMail: true,
            modes: ['IMAP', 'SMTP'],
        }),
    },
    'netease-126-imap-smtp': {
        providerProfile: 'netease-126-imap-smtp',
        provider: 'NETEASE_126',
        authType: 'APP_PASSWORD',
        representativeProtocol: 'imap_smtp',
        secondaryProtocols: ['smtp'],
        importToken: 'NETEASE_126_IMAP_SMTP',
        providerConfigDefaults: {
            readMode: 'IMAP',
            imapHost: 'imap.126.com',
            imapPort: 993,
            imapTls: true,
            smtpHost: 'smtp.126.com',
            smtpPort: 465,
            smtpSecure: true,
            folders: {
                inbox: 'INBOX',
                junk: 'Junk',
                sent: 'Sent',
            },
        },
        profileSummaryHint: '126 邮箱归类为 IMAP / SMTP 客户端授权码模式',
        capabilitySummary: createProtocolCapabilityMatrix({
            readInbox: true,
            readJunk: true,
            readSent: true,
            sendMail: true,
            receiveMail: true,
            modes: ['IMAP', 'SMTP'],
        }),
    },
    'icloud-imap-smtp': {
        providerProfile: 'icloud-imap-smtp',
        provider: 'ICLOUD',
        authType: 'APP_PASSWORD',
        representativeProtocol: 'imap_smtp',
        secondaryProtocols: ['smtp'],
        importToken: 'ICLOUD_IMAP_SMTP',
        providerConfigDefaults: {
            readMode: 'IMAP',
            imapHost: 'imap.mail.me.com',
            imapPort: 993,
            imapTls: true,
            smtpHost: 'smtp.mail.me.com',
            smtpPort: 587,
            smtpSecure: false,
            folders: {
                inbox: 'INBOX',
                junk: 'Junk',
                sent: 'Sent Messages',
            },
        },
        profileSummaryHint: 'iCloud 邮箱归类为 IMAP / SMTP App 专用密码模式',
        capabilitySummary: createProtocolCapabilityMatrix({
            readInbox: true,
            readJunk: true,
            readSent: true,
            sendMail: true,
            receiveMail: true,
            modes: ['IMAP', 'SMTP'],
        }),
    },
    'yahoo-imap-smtp': {
        providerProfile: 'yahoo-imap-smtp',
        provider: 'YAHOO',
        authType: 'APP_PASSWORD',
        representativeProtocol: 'imap_smtp',
        secondaryProtocols: ['smtp'],
        importToken: 'YAHOO_IMAP_SMTP',
        providerConfigDefaults: {
            readMode: 'IMAP',
            imapHost: 'imap.mail.yahoo.com',
            imapPort: 993,
            imapTls: true,
            smtpHost: 'smtp.mail.yahoo.com',
            smtpPort: 465,
            smtpSecure: true,
            folders: {
                inbox: 'INBOX',
                junk: 'Bulk Mail',
                sent: 'Sent',
            },
        },
        profileSummaryHint: 'Yahoo 邮箱归类为 IMAP / SMTP App Password 模式',
        capabilitySummary: createProtocolCapabilityMatrix({
            readInbox: true,
            readJunk: true,
            readSent: true,
            sendMail: true,
            receiveMail: true,
            modes: ['IMAP', 'SMTP'],
        }),
    },
    'zoho-imap-smtp': {
        providerProfile: 'zoho-imap-smtp',
        provider: 'ZOHO',
        authType: 'APP_PASSWORD',
        representativeProtocol: 'imap_smtp',
        secondaryProtocols: ['smtp'],
        importToken: 'ZOHO_IMAP_SMTP',
        providerConfigDefaults: {
            readMode: 'IMAP',
            imapHost: 'imap.zoho.com',
            imapPort: 993,
            imapTls: true,
            smtpHost: 'smtp.zoho.com',
            smtpPort: 465,
            smtpSecure: true,
            folders: {
                inbox: 'INBOX',
                junk: 'Spam',
                sent: 'Sent',
            },
        },
        profileSummaryHint: 'Zoho 邮箱归类为 IMAP / SMTP 应用密码模式',
        capabilitySummary: createProtocolCapabilityMatrix({
            readInbox: true,
            readJunk: true,
            readSent: true,
            sendMail: true,
            receiveMail: true,
            modes: ['IMAP', 'SMTP'],
        }),
    },
    'aliyun-imap-smtp': {
        providerProfile: 'aliyun-imap-smtp',
        provider: 'ALIYUN',
        authType: 'APP_PASSWORD',
        representativeProtocol: 'imap_smtp',
        secondaryProtocols: ['smtp'],
        importToken: 'ALIYUN_IMAP_SMTP',
        providerConfigDefaults: {
            readMode: 'IMAP',
            imapHost: 'imap.qiye.aliyun.com',
            imapPort: 993,
            imapTls: true,
            smtpHost: 'smtp.qiye.aliyun.com',
            smtpPort: 465,
            smtpSecure: true,
            folders: {
                inbox: 'INBOX',
                junk: 'Junk',
                sent: 'Sent',
            },
        },
        profileSummaryHint: '阿里邮箱归类为 IMAP / SMTP 客户端专用密码模式',
        capabilitySummary: createProtocolCapabilityMatrix({
            readInbox: true,
            readJunk: true,
            readSent: true,
            sendMail: true,
            receiveMail: true,
            modes: ['IMAP', 'SMTP'],
        }),
    },
    'amazon-workmail-imap-smtp': {
        providerProfile: 'amazon-workmail-imap-smtp',
        provider: 'AMAZON_WORKMAIL',
        authType: 'APP_PASSWORD',
        representativeProtocol: 'imap_smtp',
        secondaryProtocols: ['smtp'],
        importToken: 'AMAZON_WORKMAIL_IMAP_SMTP',
        providerConfigDefaults: {
            readMode: 'IMAP',
            imapPort: 993,
            imapTls: true,
            smtpPort: 465,
            smtpSecure: true,
            folders: {
                inbox: 'INBOX',
                junk: 'Junk',
                sent: 'Sent Items',
            },
        },
        profileSummaryHint: 'Amazon WorkMail 归类为 IMAP / SMTP 企业邮箱模式，主机通常按区域或租户填写',
        capabilitySummary: createProtocolCapabilityMatrix({
            readInbox: true,
            readJunk: true,
            readSent: true,
            sendMail: true,
            receiveMail: true,
            modes: ['IMAP', 'SMTP'],
        }),
    },
    'fastmail-imap-smtp': {
        providerProfile: 'fastmail-imap-smtp',
        provider: 'FASTMAIL',
        authType: 'APP_PASSWORD',
        representativeProtocol: 'imap_smtp',
        secondaryProtocols: ['smtp'],
        importToken: 'FASTMAIL_IMAP_SMTP',
        providerConfigDefaults: {
            readMode: 'IMAP',
            imapHost: 'imap.fastmail.com',
            imapPort: 993,
            imapTls: true,
            smtpHost: 'smtp.fastmail.com',
            smtpPort: 465,
            smtpSecure: true,
            folders: {
                inbox: 'INBOX',
                junk: 'Junk Mail',
                sent: 'Sent',
            },
        },
        profileSummaryHint: 'Fastmail 归类为 IMAP / SMTP 国际邮箱模式',
        capabilitySummary: createProtocolCapabilityMatrix({
            readInbox: true,
            readJunk: true,
            readSent: true,
            sendMail: true,
            receiveMail: true,
            modes: ['IMAP', 'SMTP'],
        }),
    },
    'aol-imap-smtp': {
        providerProfile: 'aol-imap-smtp',
        provider: 'AOL',
        authType: 'APP_PASSWORD',
        representativeProtocol: 'imap_smtp',
        secondaryProtocols: ['smtp'],
        importToken: 'AOL_IMAP_SMTP',
        providerConfigDefaults: {
            readMode: 'IMAP',
            imapHost: 'imap.aol.com',
            imapPort: 993,
            imapTls: true,
            smtpHost: 'smtp.aol.com',
            smtpPort: 465,
            smtpSecure: true,
            folders: {
                inbox: 'INBOX',
                junk: 'Spam',
                sent: 'Sent',
            },
        },
        profileSummaryHint: 'AOL 邮箱归类为 IMAP / SMTP App Password 模式',
        capabilitySummary: createProtocolCapabilityMatrix({
            readInbox: true,
            readJunk: true,
            readSent: true,
            sendMail: true,
            receiveMail: true,
            modes: ['IMAP', 'SMTP'],
        }),
    },
    'gmx-imap-smtp': {
        providerProfile: 'gmx-imap-smtp',
        provider: 'GMX',
        authType: 'APP_PASSWORD',
        representativeProtocol: 'imap_smtp',
        secondaryProtocols: ['smtp'],
        importToken: 'GMX_IMAP_SMTP',
        providerConfigDefaults: {
            readMode: 'IMAP',
            imapHost: 'imap.gmx.com',
            imapPort: 993,
            imapTls: true,
            smtpHost: 'mail.gmx.com',
            smtpPort: 587,
            smtpSecure: false,
            folders: {
                inbox: 'INBOX',
                junk: 'Spam',
                sent: 'Sent',
            },
        },
        profileSummaryHint: 'GMX 邮箱归类为 IMAP / SMTP 标准国际邮箱模式',
        capabilitySummary: createProtocolCapabilityMatrix({
            readInbox: true,
            readJunk: true,
            readSent: true,
            sendMail: true,
            receiveMail: true,
            modes: ['IMAP', 'SMTP'],
        }),
    },
    'mailcom-imap-smtp': {
        providerProfile: 'mailcom-imap-smtp',
        provider: 'MAILCOM',
        authType: 'APP_PASSWORD',
        representativeProtocol: 'imap_smtp',
        secondaryProtocols: ['smtp'],
        importToken: 'MAILCOM_IMAP_SMTP',
        providerConfigDefaults: {
            readMode: 'IMAP',
            imapHost: 'imap.mail.com',
            imapPort: 993,
            imapTls: true,
            smtpHost: 'smtp.mail.com',
            smtpPort: 587,
            smtpSecure: false,
            folders: {
                inbox: 'INBOX',
                junk: 'Spam',
                sent: 'Sent',
            },
        },
        profileSummaryHint: 'Mail.com 归类为 IMAP / SMTP 标准国际邮箱模式',
        capabilitySummary: createProtocolCapabilityMatrix({
            readInbox: true,
            readJunk: true,
            readSent: true,
            sendMail: true,
            receiveMail: true,
            modes: ['IMAP', 'SMTP'],
        }),
    },
    'yandex-imap-smtp': {
        providerProfile: 'yandex-imap-smtp',
        provider: 'YANDEX',
        authType: 'APP_PASSWORD',
        representativeProtocol: 'imap_smtp',
        secondaryProtocols: ['smtp'],
        importToken: 'YANDEX_IMAP_SMTP',
        providerConfigDefaults: {
            readMode: 'IMAP',
            imapHost: 'imap.yandex.com',
            imapPort: 993,
            imapTls: true,
            smtpHost: 'smtp.yandex.com',
            smtpPort: 465,
            smtpSecure: true,
            folders: {
                inbox: 'INBOX',
                junk: 'Spam',
                sent: 'Sent',
            },
        },
        profileSummaryHint: 'Yandex Mail 归类为 IMAP / SMTP 国际邮箱模式',
        capabilitySummary: createProtocolCapabilityMatrix({
            readInbox: true,
            readJunk: true,
            readSent: true,
            sendMail: true,
            receiveMail: true,
            modes: ['IMAP', 'SMTP'],
        }),
    },
    'custom-imap-smtp': {
        providerProfile: 'custom-imap-smtp',
        provider: 'CUSTOM_IMAP_SMTP',
        authType: 'APP_PASSWORD',
        representativeProtocol: 'imap_smtp',
        secondaryProtocols: ['smtp'],
        importToken: 'CUSTOM_IMAP_SMTP',
        providerConfigDefaults: {
            readMode: 'IMAP',
            imapPort: 993,
            imapTls: true,
            smtpPort: 465,
            smtpSecure: true,
            folders: {
                inbox: 'INBOX',
                junk: 'Junk',
                sent: 'Sent',
            },
        },
        profileSummaryHint: 'Custom IMAP / SMTP 归类为自定义协议型邮箱接入',
        capabilitySummary: createProtocolCapabilityMatrix({
            readInbox: true,
            readJunk: true,
            readSent: true,
            sendMail: true,
            receiveMail: true,
            modes: ['IMAP', 'SMTP'],
        }),
    },
};

const PROVIDER_PROFILE_ENTRIES = providerProfiles.map((profile) => PROVIDER_PROFILE_REGISTRY[profile]);

const PROVIDER_PROFILE_BY_PROVIDER_AUTH: Partial<Record<ProviderAuthKey, ProviderProfile>> = {};
const PROVIDER_PROFILE_BY_IMPORT_TOKEN: Record<string, ProviderProfile> = {};
const PROVIDER_PROFILES_BY_REPRESENTATIVE_PROTOCOL: Record<RepresentativeProtocol, ProviderProfile[]> = {
    oauth_api: [],
    imap_smtp: [],
    hosted_internal: [],
};

for (const entry of PROVIDER_PROFILE_ENTRIES) {
    PROVIDER_PROFILE_BY_PROVIDER_AUTH[toProviderAuthKey(entry.provider, entry.authType)] = entry.providerProfile;
    PROVIDER_PROFILE_BY_IMPORT_TOKEN[entry.importToken] = entry.providerProfile;
    PROVIDER_PROFILES_BY_REPRESENTATIVE_PROTOCOL[entry.representativeProtocol].push(entry.providerProfile);
}

for (const [token, profile] of Object.entries(IMPORT_TOKEN_PROFILE_ALIASES)) {
    PROVIDER_PROFILE_BY_IMPORT_TOKEN[token] = profile;
}

function toProviderAuthKey(provider: EmailProvider, authType: EmailAuthType): ProviderAuthKey {
    return `${provider}:${authType}`;
}

function getProviderProfileRegistryEntry(profile: ProviderProfile): ProviderProfileRegistryEntry {
    return PROVIDER_PROFILE_REGISTRY[profile];
}

export function getDefaultAuthType(provider: EmailProvider): EmailAuthType {
    return DEFAULT_AUTH_TYPE_BY_PROVIDER[provider];
}

export function resolveProviderProfile(provider: EmailProvider, authType: EmailAuthType = getDefaultAuthType(provider)): ProviderProfile {
    const direct = PROVIDER_PROFILE_BY_PROVIDER_AUTH[toProviderAuthKey(provider, authType)];
    if (direct) {
        return direct;
    }

    const fallback = PROVIDER_PROFILE_BY_PROVIDER_AUTH[toProviderAuthKey(provider, getDefaultAuthType(provider))];
    if (fallback) {
        return fallback;
    }

    throw new AppError('MAIL_PROVIDER_PROFILE_UNSUPPORTED', `No provider profile registered for ${provider}`, 500);
}

export function getProviderProfileMetadata(profile: ProviderProfile): ProviderProfileMetadata {
    const entry = getProviderProfileRegistryEntry(profile);
    return {
        profile: entry.providerProfile,
        provider: entry.provider,
        authType: entry.authType,
        representativeProtocol: entry.representativeProtocol,
        secondaryProtocols: [...entry.secondaryProtocols],
        importToken: entry.importToken,
        summaryHint: entry.profileSummaryHint,
    };
}

export function getProviderProfileSummary(profile: ProviderProfile): ProviderProfileSummary {
    const entry = getProviderProfileRegistryEntry(profile);
    return {
        providerProfile: entry.providerProfile,
        representativeProtocol: entry.representativeProtocol,
        secondaryProtocols: [...entry.secondaryProtocols],
        profileSummaryHint: entry.profileSummaryHint,
        capabilitySummary: {
            ...entry.capabilitySummary,
        },
    };
}

export function getProfilesForRepresentativeProtocol(protocol: RepresentativeProtocol): ProviderProfile[] {
    return [...PROVIDER_PROFILES_BY_REPRESENTATIVE_PROTOCOL[protocol]];
}

export function getRepresentativeProtocol(provider: EmailProvider, authType: EmailAuthType = getDefaultAuthType(provider)): RepresentativeProtocol {
    return getProviderProfileSummary(resolveProviderProfile(provider, authType)).representativeProtocol;
}

export function getSecondaryProtocols(provider: EmailProvider, authType: EmailAuthType = getDefaultAuthType(provider)): SupportingProtocol[] {
    return getProviderProfileSummary(resolveProviderProfile(provider, authType)).secondaryProtocols;
}

export function getImportTokenForProfile(profile: ProviderProfile): string {
    return getProviderProfileRegistryEntry(profile).importToken;
}

export function resolveProviderProfileByImportToken(token: string): ProviderProfile | null {
    return PROVIDER_PROFILE_BY_IMPORT_TOKEN[token.toUpperCase()] || null;
}

export function getSummaryHintForProfile(profile: ProviderProfile): string {
    return getProviderProfileSummary(profile).profileSummaryHint;
}

export function getCapabilitiesForProfile(profile: ProviderProfile): ProviderProfileCapabilities {
    return {
        ...getProviderProfileRegistryEntry(profile).capabilitySummary,
        modes: [...getProviderProfileRegistryEntry(profile).capabilitySummary.modes],
    };
}

export function getCapabilitiesForProvider(provider: EmailProvider, authType: EmailAuthType = getDefaultAuthType(provider)): ProviderProfileCapabilities {
    return getCapabilitiesForProfile(resolveProviderProfile(provider, authType));
}

export function enrichMailCredentials(credentials: MailCredentials): MailCredentials {
    const profile = credentials.providerProfile || resolveProviderProfile(credentials.provider, credentials.authType);
    const summary = getProviderProfileSummary(profile);
    return {
        ...credentials,
        providerProfile: profile,
        representativeProtocol: credentials.representativeProtocol || summary.representativeProtocol,
        secondaryProtocols: credentials.secondaryProtocols || summary.secondaryProtocols,
    };
}

export function getDefaultProviderConfig(provider: EmailProvider): MailProviderConfig {
    switch (provider) {
        case 'GMAIL':
            return {
                readMode: 'GMAIL_API',
                imapHost: 'imap.gmail.com',
                imapPort: 993,
                imapTls: true,
                folders: {
                    inbox: 'INBOX',
                    junk: '[Gmail]/Spam',
                },
            };
        case 'QQ':
        case 'NETEASE_163':
        case 'NETEASE_126':
        case 'ICLOUD':
        case 'YAHOO':
        case 'ZOHO':
        case 'ALIYUN':
        case 'AMAZON_WORKMAIL':
        case 'FASTMAIL':
        case 'AOL':
        case 'GMX':
        case 'MAILCOM':
        case 'YANDEX':
        case 'CUSTOM_IMAP_SMTP':
            return {
                readMode: 'IMAP',
                imapPort: 993,
                imapTls: true,
                smtpPort: 465,
                smtpSecure: true,
                folders: {
                    inbox: 'INBOX',
                    junk: 'Junk',
                    sent: 'Sent',
                },
            };
        case 'OUTLOOK':
        default:
            return {
                readMode: 'AUTO',
                imapHost: 'outlook.office365.com',
                imapPort: 993,
                imapTls: true,
                folders: {
                    inbox: 'INBOX',
                    junk: 'Junk',
                },
            };
    }
}

export function mergeProviderConfig(provider: EmailProvider, config?: MailProviderConfig | null): MailProviderConfig {
    const defaults = getDefaultProviderConfig(provider);
    return {
        ...defaults,
        ...(config || {}),
        folders: {
            ...(defaults.folders || {}),
            ...((config?.folders as ProviderFolderMap | undefined) || {}),
        },
    };
}

export function mergeProviderConfigForProfile(profile: ProviderProfile, config?: MailProviderConfig | null): MailProviderConfig {
    const entry = getProviderProfileRegistryEntry(profile);
    return mergeProviderConfig(entry.provider, {
        ...(entry.providerConfigDefaults || {}),
        ...(config || {}),
    });
}

export function mergeProviderConfigForCredentials(credentials: Pick<MailCredentials, 'provider' | 'authType' | 'providerProfile' | 'providerConfig'>): MailProviderConfig {
    const profile = credentials.providerProfile || resolveProviderProfile(credentials.provider, credentials.authType);
    return mergeProviderConfigForProfile(profile, credentials.providerConfig);
}

export function getImportProviderConfigForProfile(profile: ProviderProfile): MailProviderConfig {
    return mergeProviderConfigForProfile(profile);
}

export function requireCredential(value: string | null | undefined, field: string, provider: EmailProvider): string {
    if (typeof value === 'string' && value.trim()) {
        return value;
    }
    throw new AppError('CREDENTIAL_REQUIRED', `${provider} provider requires ${field}`, 400);
}
