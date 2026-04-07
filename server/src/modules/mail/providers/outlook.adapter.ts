import { AppError } from '../../../plugins/error.js';
import { buildXoauth2String, deleteMessageViaGraphApi, deleteMessageViaGraphApiStrict, deleteMessagesViaImap, fetchMessagesViaGraphApi, fetchMessagesViaImap, requestOAuthAccessToken, resolveImapMailboxCandidate, resolveImapMailboxName, sendMailViaGraphApi, toImapAppError } from './shared.js';
import { createFamilyAwareProviderAdapter } from './family.helpers.js';
import { type MailCredentials, type MailDeleteOptions, type MailFetchOptions, type MailProcessOptions, type MailProfileDelegate, type MailProviderAdapter, type MailSendOptions, mergeProviderConfigForCredentials, requireCredential } from './types.js';

const TOKEN_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
const GRAPH_WRITE_SCOPE = 'https://graph.microsoft.com/Mail.ReadWrite';
const GRAPH_SEND_SCOPE = 'https://graph.microsoft.com/Mail.Send';
const IMAP_SCOPE = 'https://outlook.office.com/IMAP.AccessAsUser.All';

function resolveMode(credentials: MailCredentials): 'GRAPH_FIRST' | 'IMAP_FIRST' | 'GRAPH_ONLY' | 'IMAP_ONLY' {
    const readMode = credentials.providerConfig?.readMode;
    if (readMode === 'GRAPH_ONLY' || readMode === 'IMAP_ONLY' || readMode === 'IMAP_FIRST' || readMode === 'GRAPH_FIRST') return readMode;
    if (readMode === 'GRAPH_API') return 'GRAPH_ONLY';
    if (readMode === 'IMAP') return 'IMAP_ONLY';
    return credentials.fetchStrategy || 'GRAPH_FIRST';
}

async function getToken(credentials: MailCredentials, scope: string, options: MailFetchOptions | MailProcessOptions | MailSendOptions): Promise<string> {
    const clientId = requireCredential(credentials.clientId, 'clientId', credentials.provider);
    const refreshToken = requireCredential(credentials.refreshToken, 'refreshToken', credentials.provider);
    const token = await requestOAuthAccessToken({
        cacheKey: `oauth:${credentials.provider}:${scope}:${credentials.email}`,
        tokenUrl: TOKEN_URL,
        clientId,
        clientSecret: credentials.clientSecret,
        refreshToken,
        scope,
        proxyConfig: { socks5: options.socks5, http: options.http },
    });
    if (!token) {
        if (scope === GRAPH_SEND_SCOPE) {
            throw new AppError('OUTLOOK_SEND_SCOPE_REQUIRED', 'Outlook account must be re-authorized with Mail.Send scope before sending mail', 400);
        }
        throw new AppError('OUTLOOK_TOKEN_FAILED', 'Failed to get Outlook access token', 502);
    }
    return token;
}

async function viaGraph(credentials: MailCredentials, options: MailFetchOptions) {
    const token = await getToken(credentials, GRAPH_WRITE_SCOPE, options);
    const messages = await fetchMessagesViaGraphApi(token, options.mailbox, options.limit || 100, { socks5: options.socks5, http: options.http });
    return { email: credentials.email, mailbox: options.mailbox, count: messages.length, messages, method: 'outlook_graph_api', provider: credentials.provider };
}

async function viaImap(credentials: MailCredentials, options: MailFetchOptions) {
    const config = mergeProviderConfigForCredentials(credentials);
    const token = await getToken(credentials, IMAP_SCOPE, options);
    const xoauth2 = buildXoauth2String(credentials.email, token);
    try {
        const mailboxName = resolveImapMailboxName(options.mailbox, config.folders || {}, {
            inbox: 'INBOX',
            junk: 'Junk',
            sent: 'Sent Items',
        });
        const mailboxAliases = options.mailbox.toLowerCase() === 'sent'
            ? ['Sent', 'Sent Mail', 'Sent Messages', 'Sent Items', '已发送']
            : undefined;
        const resolvedMailbox = await resolveImapMailboxCandidate({
            email: credentials.email,
            host: config.imapHost || 'outlook.office365.com',
            port: config.imapPort || 993,
            tls: config.imapTls !== false,
            mailbox: mailboxName,
            mailboxAliases,
            xoauth2,
        });
        const result = await fetchMessagesViaImap({
            email: credentials.email,
            host: config.imapHost || 'outlook.office365.com',
            port: config.imapPort || 993,
            tls: config.imapTls !== false,
            mailbox: resolvedMailbox,
            limit: options.limit || 100,
            mailboxCheckpoint: options.mailboxCheckpoint,
            xoauth2,
        });
        return { email: credentials.email, mailbox: options.mailbox, resolvedMailbox, count: result.messages.length, messages: result.messages, mailboxCheckpoint: result.mailboxCheckpoint, method: 'outlook_imap', provider: credentials.provider };
    } catch (error) {
        throw toImapAppError(error, 'Outlook');
    }
}

async function deleteViaImap(credentials: MailCredentials, options: MailDeleteOptions) {
    const config = mergeProviderConfigForCredentials(credentials);
    const token = await getToken(credentials, IMAP_SCOPE, options);
    const xoauth2 = buildXoauth2String(credentials.email, token);
    try {
        const mailboxName = resolveImapMailboxName(options.mailbox, config.folders || {}, {
            inbox: 'INBOX',
            junk: 'Junk',
            sent: 'Sent Items',
        });
        const mailboxAliases = options.mailbox.toLowerCase() === 'sent'
            ? ['Sent', 'Sent Mail', 'Sent Messages', 'Sent Items', '已发送']
            : undefined;
        const resolvedMailbox = await resolveImapMailboxCandidate({
            email: credentials.email,
            host: config.imapHost || 'outlook.office365.com',
            port: config.imapPort || 993,
            tls: config.imapTls !== false,
            mailbox: mailboxName,
            mailboxAliases,
            xoauth2,
        });
        const result = await deleteMessagesViaImap({
            email: credentials.email,
            host: config.imapHost || 'outlook.office365.com',
            port: config.imapPort || 993,
            tls: config.imapTls !== false,
            mailbox: resolvedMailbox,
            messageIds: options.messageIds,
            mailboxCheckpoint: options.mailboxCheckpoint,
            xoauth2,
        });
        return {
            email: credentials.email,
            mailbox: options.mailbox,
            resolvedMailbox,
            deletedCount: result.deletedCount,
            message: `Deleted ${result.deletedCount} selected messages`,
            mailboxCheckpoint: result.mailboxCheckpoint,
            method: 'outlook_imap',
            provider: credentials.provider,
        };
    } catch (error) {
        throw toImapAppError(error, 'Outlook');
    }
}

async function deleteViaGraph(credentials: MailCredentials, options: MailDeleteOptions) {
    const token = await getToken(credentials, GRAPH_WRITE_SCOPE, options);
    const proxyConfig = { socks5: options.socks5, http: options.http };
    for (const messageId of options.messageIds) {
        await deleteMessageViaGraphApiStrict(token, messageId, proxyConfig);
    }
    return {
        email: credentials.email,
        mailbox: options.mailbox,
        deletedCount: options.messageIds.length,
        message: `Deleted ${options.messageIds.length} selected messages`,
        method: 'outlook_graph_api',
        provider: credentials.provider,
    };
}

export const outlookOAuthProfileDelegate: MailProfileDelegate = {
    provider: 'OUTLOOK',
    profile: 'outlook-oauth',
    representativeProtocol: 'oauth_api',
    getCapabilities() { return { readInbox: true, readJunk: true, readSent: true, clearMailbox: true, sendMail: true, modes: ['GRAPH_API', 'IMAP'] }; },
    async getEmails(credentials, options) {
        const mode = resolveMode(credentials);
        if (mode === 'GRAPH_ONLY') return viaGraph(credentials, options);
        if (mode === 'IMAP_ONLY') return viaImap(credentials, options);
        if (mode === 'IMAP_FIRST') {
            try { return await viaImap(credentials, options); } catch { return viaGraph(credentials, options); }
        }
        try { return await viaGraph(credentials, options); } catch { return viaImap(credentials, options); }
    },
    async processMailbox(credentials, options) {
        if (resolveMode(credentials) === 'IMAP_ONLY') {
            throw new AppError('MAILBOX_CLEAR_UNSUPPORTED', 'Mailbox clear is not available for Outlook IMAP_ONLY mode', 400);
        }
        const token = await getToken(credentials, GRAPH_WRITE_SCOPE, options);
        const proxyConfig = { socks5: options.socks5, http: options.http };
        let deletedCount = 0;
        let page = 0;
        while (page < 10) {
            const messages = await fetchMessagesViaGraphApi(token, options.mailbox, 500, proxyConfig);
            if (messages.length === 0) break;
            for (let i = 0; i < messages.length; i += 10) {
                const chunk = messages.slice(i, i + 10);
                await Promise.all(chunk.map((message) => deleteMessageViaGraphApi(token, message.id, proxyConfig)));
                deletedCount += chunk.length;
            }
            page += 1;
        }
        return { email: credentials.email, mailbox: options.mailbox, message: `Successfully deleted ${deletedCount} messages`, status: 'success' as const, deletedCount, method: 'outlook_graph_api', provider: credentials.provider };
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
        if (resolveMode(credentials) === 'IMAP_ONLY' || usesImapIds) {
            return deleteViaImap(credentials, options);
        }
        return deleteViaGraph(credentials, options);
    },
    async sendEmail(credentials, options) {
        const token = await getToken(credentials, GRAPH_SEND_SCOPE, options);
        const result = await sendMailViaGraphApi(token, options, { socks5: options.socks5, http: options.http });
        return {
            provider: credentials.provider,
            method: 'outlook_graph_send',
            providerMessageId: result.id,
            accepted: options.to,
        };
    },
};

export const outlookMailAdapter: MailProviderAdapter = createFamilyAwareProviderAdapter('OUTLOOK', [
    outlookOAuthProfileDelegate,
]);
