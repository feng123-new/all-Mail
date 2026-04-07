import { AppError } from '../../../plugins/error.js';
import { buildXoauth2String, deleteMessagesViaImap, fetchMessagesViaGmailApi, fetchMessagesViaImap, requestOAuthAccessToken, resolveImapMailboxCandidate, resolveImapMailboxName, sendMailViaGmailApi, sendMailViaSmtp, toImapAppError, trashGmailMessage, trashGmailMessageStrict } from './shared.js';
import { createFamilyAwareProviderAdapter } from './family.helpers.js';
import { type MailCredentials, type MailDeleteOptions, type MailFetchOptions, type MailProcessOptions, type MailProfileDelegate, type MailProviderAdapter, type MailSendOptions, mergeProviderConfigForCredentials, requireCredential } from './types.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

function resolveMode(credentials: MailCredentials): 'GMAIL_API' | 'GMAIL_API_ONLY' | 'IMAP' | 'AUTO' {
    const readMode = credentials.providerConfig?.readMode;
    if (readMode === 'GMAIL_API_ONLY') return 'GMAIL_API_ONLY';
    if (readMode === 'IMAP') return 'IMAP';
    if (readMode === 'AUTO') return 'AUTO';
    return 'GMAIL_API';
}

async function getToken(credentials: MailCredentials, options: MailFetchOptions | MailProcessOptions | MailSendOptions): Promise<string> {
    const clientId = requireCredential(credentials.clientId, 'clientId', credentials.provider);
    const refreshToken = requireCredential(credentials.refreshToken, 'refreshToken', credentials.provider);
    const token = await requestOAuthAccessToken({
        cacheKey: `oauth:${credentials.provider}:refresh:${credentials.email}`,
        tokenUrl: TOKEN_URL,
        clientId,
        clientSecret: credentials.clientSecret,
        refreshToken,
        proxyConfig: { socks5: options.socks5, http: options.http },
    });
    if (!token) throw new AppError('GMAIL_TOKEN_FAILED', 'Failed to get Gmail access token', 502);
    return token;
}

async function viaApi(credentials: MailCredentials, options: MailFetchOptions) {
    const token = await getToken(credentials, options);
    const messages = await fetchMessagesViaGmailApi(token, options.mailbox, options.limit || 100, { socks5: options.socks5, http: options.http });
    return { email: credentials.email, mailbox: options.mailbox, count: messages.length, messages, method: 'gmail_api', provider: credentials.provider };
}

async function viaImap(credentials: MailCredentials, options: MailFetchOptions) {
    const config = mergeProviderConfigForCredentials(credentials);
    let xoauth2: string | undefined;
    let password: string | undefined;
    if (credentials.authType === 'APP_PASSWORD') {
        password = requireCredential(credentials.password, 'password', credentials.provider);
    } else {
        const token = await getToken(credentials, options);
        xoauth2 = buildXoauth2String(credentials.email, token);
    }
    try {
        const mailboxName = resolveImapMailboxName(options.mailbox, config.folders || {}, {
            inbox: 'INBOX',
            junk: '[Gmail]/Spam',
            sent: '[Gmail]/Sent Mail',
        });
        const mailboxAliases = options.mailbox.toLowerCase() === 'sent'
            ? ['[Gmail]/Sent Mail', 'Sent', 'Sent Mail', 'Sent Messages', '已发送']
            : undefined;
        const resolvedMailbox = await resolveImapMailboxCandidate({
            email: credentials.email,
            host: config.imapHost || 'imap.gmail.com',
            port: config.imapPort || 993,
            tls: config.imapTls !== false,
            mailbox: mailboxName,
            mailboxAliases,
            xoauth2,
            password,
        });
        const result = await fetchMessagesViaImap({
            email: credentials.email,
            host: config.imapHost || 'imap.gmail.com',
            port: config.imapPort || 993,
            tls: config.imapTls !== false,
            mailbox: resolvedMailbox,
            limit: options.limit || 100,
            mailboxCheckpoint: options.mailboxCheckpoint,
            xoauth2,
            password,
        });
        return { email: credentials.email, mailbox: options.mailbox, resolvedMailbox, count: result.messages.length, messages: result.messages, mailboxCheckpoint: result.mailboxCheckpoint, method: credentials.authType === 'APP_PASSWORD' ? 'gmail_imap_password' : 'gmail_imap_xoauth2', provider: credentials.provider };
    } catch (error) {
        throw toImapAppError(error, 'Gmail');
    }
}

async function deleteViaImap(credentials: MailCredentials, options: MailDeleteOptions) {
    const config = mergeProviderConfigForCredentials(credentials);
    let xoauth2: string | undefined;
    let password: string | undefined;
    if (credentials.authType === 'APP_PASSWORD') {
        password = requireCredential(credentials.password, 'password', credentials.provider);
    } else {
        const token = await getToken(credentials, options);
        xoauth2 = buildXoauth2String(credentials.email, token);
    }

    try {
        const mailboxName = resolveImapMailboxName(options.mailbox, config.folders || {}, {
            inbox: 'INBOX',
            junk: '[Gmail]/Spam',
            sent: '[Gmail]/Sent Mail',
        });
        const mailboxAliases = options.mailbox.toLowerCase() === 'sent'
            ? ['[Gmail]/Sent Mail', 'Sent', 'Sent Mail', 'Sent Messages', '已发送']
            : undefined;
        const resolvedMailbox = await resolveImapMailboxCandidate({
            email: credentials.email,
            host: config.imapHost || 'imap.gmail.com',
            port: config.imapPort || 993,
            tls: config.imapTls !== false,
            mailbox: mailboxName,
            mailboxAliases,
            xoauth2,
            password,
        });
        const result = await deleteMessagesViaImap({
            email: credentials.email,
            host: config.imapHost || 'imap.gmail.com',
            port: config.imapPort || 993,
            tls: config.imapTls !== false,
            mailbox: resolvedMailbox,
            messageIds: options.messageIds,
            mailboxCheckpoint: options.mailboxCheckpoint,
            xoauth2,
            password,
        });
        return {
            email: credentials.email,
            mailbox: options.mailbox,
            resolvedMailbox,
            deletedCount: result.deletedCount,
            message: `Deleted ${result.deletedCount} selected messages`,
            mailboxCheckpoint: result.mailboxCheckpoint,
            method: credentials.authType === 'APP_PASSWORD' ? 'gmail_imap_password' : 'gmail_imap_xoauth2',
            provider: credentials.provider,
        };
    } catch (error) {
        throw toImapAppError(error, 'Gmail');
    }
}

async function deleteViaApi(credentials: MailCredentials, options: MailDeleteOptions) {
    const token = await getToken(credentials, options);
    const proxyConfig = { socks5: options.socks5, http: options.http };
    for (const messageId of options.messageIds) {
        await trashGmailMessageStrict(token, messageId, proxyConfig);
    }
    return {
        email: credentials.email,
        mailbox: options.mailbox,
        deletedCount: options.messageIds.length,
        message: `Trashed ${options.messageIds.length} selected messages`,
        method: 'gmail_api',
        provider: credentials.provider,
    };
}

export const gmailOAuthProfileDelegate: MailProfileDelegate = {
    provider: 'GMAIL',
    profile: 'gmail-oauth',
    representativeProtocol: 'oauth_api',
    getCapabilities(credentials) {
        const canClear = credentials.authType !== 'APP_PASSWORD';
        return { readInbox: true, readJunk: true, readSent: true, clearMailbox: canClear, sendMail: true, modes: canClear ? ['GMAIL_API', 'IMAP'] : ['IMAP'] };
    },
    async getEmails(credentials, options) {
        const mode = resolveMode(credentials);
        if (mode === 'GMAIL_API' || mode === 'GMAIL_API_ONLY') return viaApi(credentials, options);
        if (mode === 'IMAP') return viaImap(credentials, options);
        try { return await viaApi(credentials, options); } catch { return viaImap(credentials, options); }
    },
    async processMailbox(credentials, options) {
        if (credentials.authType === 'APP_PASSWORD') {
            throw new AppError('MAILBOX_CLEAR_UNSUPPORTED', 'Mailbox clear is not available for Gmail APP_PASSWORD mode', 400);
        }
        const token = await getToken(credentials, options);
        const proxyConfig = { socks5: options.socks5, http: options.http };
        let deletedCount = 0;
        for (let page = 0; page < 10; page += 1) {
            const messages = await fetchMessagesViaGmailApi(token, options.mailbox, 100, proxyConfig);
            if (messages.length === 0) break;
            for (let i = 0; i < messages.length; i += 10) {
                const chunk = messages.slice(i, i + 10);
                await Promise.all(chunk.map((message) => trashGmailMessage(token, message.id, proxyConfig)));
                deletedCount += chunk.length;
            }
        }
        return { email: credentials.email, mailbox: options.mailbox, message: `Successfully trashed ${deletedCount} messages`, status: 'success' as const, deletedCount, method: 'gmail_api', provider: credentials.provider };
    },
    async deleteMessages(credentials, options) {
        if (options.messageIds.length === 0) {
            return {
                email: credentials.email,
                mailbox: options.mailbox,
                deletedCount: 0,
                message: 'No messages selected',
                method: 'noop',
                provider: credentials.provider,
            };
        }

        const usesImapIds = options.messageIds.every((messageId) => messageId.startsWith('imap:'));
        if (credentials.authType === 'APP_PASSWORD' || usesImapIds || resolveMode(credentials) === 'IMAP') {
            return deleteViaImap(credentials, options);
        }

        return deleteViaApi(credentials, options);
    },
    async sendEmail(credentials, options) {
        if (credentials.authType === 'APP_PASSWORD') {
            const password = requireCredential(credentials.password, 'password', credentials.provider);
            const result = await sendMailViaSmtp({
                host: 'smtp.gmail.com',
                port: 465,
                secure: true,
                user: credentials.email,
                password,
                message: options,
            });
            return {
                provider: credentials.provider,
                method: 'gmail_smtp_password',
                providerMessageId: result.id,
                accepted: options.to,
            };
        }

        const token = await getToken(credentials, options);
        const result = await sendMailViaGmailApi(token, options, { socks5: options.socks5, http: options.http });
        return {
            provider: credentials.provider,
            method: 'gmail_api_send',
            providerMessageId: result.id,
            accepted: options.to,
        };
    },
};

export const gmailAppPasswordProfileDelegate: MailProfileDelegate = {
    provider: 'GMAIL',
    profile: 'gmail-app-password',
    representativeProtocol: 'imap_smtp',
    getCapabilities() {
        return { readInbox: true, readJunk: true, readSent: true, clearMailbox: false, sendMail: true, modes: ['IMAP', 'SMTP'] };
    },
    getEmails(credentials, options) {
        return viaImap({
            ...credentials,
            authType: 'APP_PASSWORD',
        }, options);
    },
    async processMailbox(credentials, options) {
        throw new AppError('MAILBOX_CLEAR_UNSUPPORTED', `Mailbox clear is not available for ${credentials.provider} provider in ${options.mailbox}`, 400);
    },
    deleteMessages(credentials, options) {
        return deleteViaImap({
            ...credentials,
            authType: 'APP_PASSWORD',
        }, options);
    },
    async sendEmail(credentials, options) {
        const password = requireCredential(credentials.password, 'password', credentials.provider);
        const result = await sendMailViaSmtp({
            host: 'smtp.gmail.com',
            port: 465,
            secure: true,
            user: credentials.email,
            password,
            message: options,
        });
        return {
            provider: credentials.provider,
            method: 'gmail_smtp_password',
            providerMessageId: result.id,
            accepted: options.to,
        };
    },
};

export const gmailMailAdapter: MailProviderAdapter = createFamilyAwareProviderAdapter('GMAIL', [
    gmailOAuthProfileDelegate,
    gmailAppPasswordProfileDelegate,
]);
