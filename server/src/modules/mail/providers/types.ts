import { AppError } from '../../../plugins/error.js';

export type EmailProvider = 'OUTLOOK' | 'GMAIL' | 'QQ';
export type EmailAuthType = 'MICROSOFT_OAUTH' | 'GOOGLE_OAUTH' | 'APP_PASSWORD';
export type MailFetchStrategy = 'GRAPH_FIRST' | 'IMAP_FIRST' | 'GRAPH_ONLY' | 'IMAP_ONLY';

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
    folders?: ProviderFolderMap;
    [key: string]: unknown;
}

export interface MailCredentials {
    id: number;
    email: string;
    provider: EmailProvider;
    authType: EmailAuthType;
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

export interface MailFetchResult {
    email: string;
    mailbox: string;
    resolvedMailbox?: string;
    count: number;
    messages: EmailMessage[];
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
    provider: EmailProvider;
    getCapabilities(credentials: MailCredentials): MailboxCapabilities;
    getEmails(credentials: MailCredentials, options: MailFetchOptions): Promise<MailFetchResult>;
    processMailbox(credentials: MailCredentials, options: MailProcessOptions): Promise<MailProcessResult>;
    deleteMessages(credentials: MailCredentials, options: MailDeleteOptions): Promise<MailDeleteResult>;
    sendEmail(credentials: MailCredentials, options: MailSendOptions): Promise<MailSendResult>;
}

export interface MailProviderRegistryLike {
    resolve(credentials: MailCredentials): MailProviderAdapter;
}

export interface ProxyConfig {
    socks5?: string;
    http?: string;
}

export function getDefaultAuthType(provider: EmailProvider): EmailAuthType {
    switch (provider) {
        case 'GMAIL':
            return 'GOOGLE_OAUTH';
        case 'QQ':
            return 'APP_PASSWORD';
        case 'OUTLOOK':
        default:
            return 'MICROSOFT_OAUTH';
    }
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
            return {
                readMode: 'IMAP',
                imapHost: 'imap.qq.com',
                imapPort: 993,
                imapTls: true,
                folders: {
                    inbox: 'INBOX',
                    junk: 'Junk',
                    sent: 'Sent Messages',
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

export function requireCredential(value: string | null | undefined, field: string, provider: EmailProvider): string {
    if (typeof value === 'string' && value.trim()) {
        return value;
    }
    throw new AppError('CREDENTIAL_REQUIRED', `${provider} provider requires ${field}`, 400);
}
