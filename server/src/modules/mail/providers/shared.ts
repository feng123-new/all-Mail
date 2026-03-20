import Imap from 'node-imap';
import { simpleParser, type ParsedMail, type Source } from 'mailparser';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { createTransport } from 'nodemailer';
import { getCache, setCache } from '../../../lib/redis.js';
import { proxyFetch } from '../../../lib/proxy.js';
import { logger } from '../../../lib/logger.js';
import { AppError } from '../../../plugins/error.js';
import type { EmailMessage, MailSendOptions, ProxyConfig } from './types.js';

export interface OAuthTokenResponse {
    access_token?: string;
    expires_in?: number;
}

interface GraphMessage {
    id?: string;
    from?: { emailAddress?: { address?: string } };
    toRecipients?: Array<{ emailAddress?: { address?: string } }>;
    subject?: string;
    bodyPreview?: string;
    body?: { content?: string };
    createdDateTime?: string;
    sentDateTime?: string;
}

interface GraphMessagesResponse {
    value?: GraphMessage[];
}

interface GmailHeader { name?: string; value?: string; }
interface GmailMessagePart {
    mimeType?: string;
    headers?: GmailHeader[];
    body?: { data?: string };
    parts?: GmailMessagePart[];
}
interface GmailListResponse { messages?: { id?: string }[]; }
interface GmailMessageDetail {
    id?: string;
    internalDate?: string;
    snippet?: string;
    payload?: GmailMessagePart;
}

function encodeBase64Url(input: Buffer | string): string {
    return Buffer.from(input).toString('base64url');
}

function resolveGraphFolder(mailbox: string): string {
    const normalized = mailbox.toLowerCase();
    if (normalized === 'junk' || normalized === 'spam') return 'junkemail';
    if (normalized === 'sent') return 'sentitems';
    return 'inbox';
}

function resolveGmailLabel(mailbox: string): { label: string; includeSpamTrash?: boolean } {
    const normalized = mailbox.toLowerCase();
    if (normalized === 'junk' || normalized === 'spam') return { label: 'SPAM', includeSpamTrash: true };
    if (normalized === 'sent') return { label: 'SENT' };
    return { label: 'INBOX' };
}

export function resolveImapMailboxName(mailbox: string, folders: { inbox?: string; junk?: string; sent?: string }, fallback: { inbox: string; junk: string; sent: string }): string {
    const normalized = mailbox.toLowerCase();
    if (normalized === 'junk' || normalized === 'spam') return folders.junk || fallback.junk;
    if (normalized === 'sent') return folders.sent || fallback.sent;
    return folders.inbox || fallback.inbox;
}

interface ImapFolderNode {
    delimiter?: string;
    children?: Record<string, ImapFolderNode> | null;
}

function flattenImapBoxes(boxes: Record<string, ImapFolderNode> | undefined, prefix = ''): string[] {
    if (!boxes) {
        return [];
    }

    const names: string[] = [];
    for (const [name, box] of Object.entries(boxes)) {
        const delimiter = box.delimiter || '/';
        const fullName = prefix ? `${prefix}${delimiter}${name}` : name;
        names.push(fullName);
        if (box.children) {
            names.push(...flattenImapBoxes(box.children, fullName));
        }
    }

    return names;
}

function normalizeMailboxAlias(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
}

function buildMailboxCandidates(preferred: string, aliases?: string[]): string[] {
    return Array.from(new Set([preferred, ...(aliases || [])].filter(Boolean)));
}

function matchExistingMailbox(availableBoxes: string[], preferred: string, aliases?: string[]): string | null {
    const candidates = buildMailboxCandidates(preferred, aliases);

    for (const candidate of candidates) {
        const exact = availableBoxes.find((box) => box.toLowerCase() === candidate.toLowerCase());
        if (exact) {
            return exact;
        }
    }

    const normalizedAvailable = availableBoxes.map((box) => ({
        original: box,
        normalized: normalizeMailboxAlias(box),
    }));

    for (const candidate of candidates) {
        const normalizedCandidate = normalizeMailboxAlias(candidate);
        const aliasMatch = normalizedAvailable.find((box) => box.normalized === normalizedCandidate);
        if (aliasMatch) {
            return aliasMatch.original;
        }
    }

    return null;
}

function resolveExistingImapMailbox(imap: Imap, preferred: string, aliases?: string[]): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        imap.getBoxes((error, boxes) => {
            if (error) {
                reject(error);
                return;
            }

            const availableBoxes = flattenImapBoxes(boxes);
            const matched = matchExistingMailbox(availableBoxes, preferred, aliases);
            if (!matched) {
                reject(new Error(`"${preferred}" doesn't exist`));
                return;
            }

            resolve(matched);
        });
    });
}

export async function resolveImapMailboxCandidate(input: {
    email: string;
    host: string;
    port?: number;
    tls?: boolean;
    mailbox: string;
    xoauth2?: string;
    password?: string;
    mailboxAliases?: string[];
}): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const imapConfig: Imap.Config = {
            user: input.email,
            password: '',
            host: input.host,
            port: input.port || 993,
            tls: input.tls !== false,
            tlsOptions: { rejectUnauthorized: false },
            connTimeout: 10000,
            authTimeout: 10000,
            keepalive: false,
        };

        if (input.xoauth2) {
            imapConfig.xoauth2 = input.xoauth2;
        } else if (input.password) {
            imapConfig.password = input.password;
        } else {
            reject(new AppError('IMAP_AUTH_REQUIRED', 'IMAP authentication secret is required', 400));
            return;
        }

        const imap = new Imap(imapConfig);
        imap.once('ready', () => {
            resolveExistingImapMailbox(imap, input.mailbox, input.mailboxAliases)
                .then((resolvedMailbox) => {
                    imap.end();
                    resolve(resolvedMailbox);
                })
                .catch((error) => {
                    imap.end();
                    reject(error);
                });
        });
        imap.once('error', reject);
        imap.connect();
    });
}

function parseImapMessageUid(messageId: string): number | null {
    const normalized = messageId.startsWith('imap:') ? messageId.slice(5) : messageId;
    const uid = Number.parseInt(normalized, 10);
    return Number.isInteger(uid) && uid > 0 ? uid : null;
}

async function buildMimeMessage(input: MailSendOptions): Promise<string> {
    const composer = new MailComposer({
        from: input.fromName ? `${input.fromName} <${input.fromEmail}>` : input.fromEmail,
        to: input.to.join(', '),
        subject: input.subject,
        text: input.text,
        html: input.html,
    });
    const raw = await composer.compile().build();
    return raw.toString('utf8');
}

export async function sendMailViaGraphApi(accessToken: string, input: MailSendOptions, proxyConfig?: ProxyConfig): Promise<{ id: string | null }> {
    const response = await proxyFetch('https://graph.microsoft.com/v1.0/me/sendMail', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            message: {
                subject: input.subject,
                body: {
                    contentType: input.html ? 'HTML' : 'Text',
                    content: input.html || input.text || '',
                },
                toRecipients: input.to.map((address) => ({ emailAddress: { address } })),
            },
            saveToSentItems: true,
        }),
    }, proxyConfig);

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Graph API send failed: ${response.status} - ${errorText}`);
    }

    return { id: response.headers.get('request-id') || response.headers.get('client-request-id') };
}

export async function sendMailViaGmailApi(accessToken: string, input: MailSendOptions, proxyConfig?: ProxyConfig): Promise<{ id: string | null }> {
    const rawMime = await buildMimeMessage(input);
    const response = await proxyFetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw: encodeBase64Url(rawMime) }),
    }, proxyConfig);

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gmail API send failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as { id?: string };
    return { id: data.id || null };
}

export async function sendMailViaSmtp(input: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    password: string;
    message: MailSendOptions;
}): Promise<{ id: string | null }> {
    const transport = createTransport({
        host: input.host,
        port: input.port,
        secure: input.secure,
        auth: {
            user: input.user,
            pass: input.password,
        },
    });

    const info = await transport.sendMail({
        from: input.message.fromName ? `${input.message.fromName} <${input.message.fromEmail}>` : input.message.fromEmail,
        to: input.message.to,
        subject: input.message.subject,
        text: input.message.text,
        html: input.message.html,
    });

    return { id: info.messageId || null };
}

function ensureBase64Padding(input: string): string {
    return input + '='.repeat((4 - input.length % 4) % 4);
}

export function decodeBase64Url(input: string): string {
    return Buffer.from(ensureBase64Padding(input), 'base64url').toString('utf8');
}

export function getErrorMessage(error: unknown): string {
    if (!error || typeof error !== 'object') {
        return 'Unknown error';
    }
    const message = (error as { message?: unknown }).message;
    return typeof message === 'string' && message.trim() ? message : 'Unknown error';
}

export function toImapAppError(error: unknown, providerLabel: string): AppError {
    if (error instanceof AppError) {
        return error;
    }
    const message = getErrorMessage(error);
    if (message.includes('authenticated but not connected')) {
        return new AppError('IMAP_PROTOCOL_ERROR', `${providerLabel} IMAP accepted authentication but did not establish a mailbox session. Check IMAP availability and retry.`, 502);
    }
    if (message.toLowerCase().includes('timed out')) {
        return new AppError('IMAP_CONNECT_TIMEOUT', `Timed out while connecting to ${providerLabel} IMAP server`, 504);
    }
    return new AppError('IMAP_FETCH_FAILED', `IMAP fetch failed: ${message}`, 502);
}

export async function requestOAuthAccessToken(input: {
    cacheKey: string;
    tokenUrl: string;
    clientId: string;
    refreshToken: string;
    scope?: string | null;
    clientSecret?: string | null;
    proxyConfig?: ProxyConfig;
}): Promise<string | null> {
    const cachedToken = await getCache(input.cacheKey);
    if (cachedToken) return cachedToken;

    try {
        const body = new URLSearchParams({
            client_id: input.clientId,
            grant_type: 'refresh_token',
            refresh_token: input.refreshToken,
        });
        if (input.scope) body.set('scope', input.scope);
        if (input.clientSecret) body.set('client_secret', input.clientSecret);

        const response = await proxyFetch(input.tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        }, input.proxyConfig);

        if (!response.ok) {
            const errorText = await response.text();
            logger.error({ status: response.status, error: errorText }, 'OAuth token request failed');
            return null;
        }

        const data = await response.json() as OAuthTokenResponse;
        const accessToken = typeof data.access_token === 'string' ? data.access_token : null;
        if (!accessToken) return null;

        const expireTime = Math.max(60, (typeof data.expires_in === 'number' ? data.expires_in : 3600) - 60);
        await setCache(input.cacheKey, accessToken, expireTime);
        return accessToken;
    } catch (error) {
        logger.error({ error }, 'Failed to request OAuth access token');
        return null;
    }
}

export function buildXoauth2String(email: string, accessToken: string): string {
    const authString = `user=${email}\x01auth=Bearer ${accessToken}\x01\x01`;
    return Buffer.from(authString).toString('base64');
}

function toParsedAddressText(addresses: ParsedMail['to'] | ParsedMail['from'] | undefined): string {
    if (!addresses) {
        return '';
    }
    if ('text' in addresses && typeof addresses.text === 'string') {
        return addresses.text;
    }
    if ('value' in addresses && Array.isArray(addresses.value)) {
        return addresses.value
            .map((item) => item.address || item.name || '')
            .filter(Boolean)
            .join(', ');
    }
    return '';
}

export async function fetchMessagesViaImap(input: {
    email: string;
    host: string;
    port?: number;
    tls?: boolean;
    mailbox: string;
    limit: number;
    xoauth2?: string;
    password?: string;
    mailboxAliases?: string[];
}): Promise<EmailMessage[]> {
    return new Promise<EmailMessage[]>((resolve, reject) => {
        const emailList: EmailMessage[] = [];
        let processedCount = 0;
        let messageCount = 0;

        const imapConfig: Imap.Config = {
            user: input.email,
            password: '',
            host: input.host,
            port: input.port || 993,
            tls: input.tls !== false,
            tlsOptions: { rejectUnauthorized: false },
            connTimeout: 10000,
            authTimeout: 10000,
            keepalive: false,
        };

        if (input.xoauth2) {
            imapConfig.xoauth2 = input.xoauth2;
        } else if (input.password) {
            imapConfig.password = input.password;
        } else {
            reject(new AppError('IMAP_AUTH_REQUIRED', 'IMAP authentication secret is required', 400));
            return;
        }

        const imap = new Imap(imapConfig);

        imap.once('ready', () => {
            resolveExistingImapMailbox(imap, input.mailbox, input.mailboxAliases)
                .then((resolvedMailbox) => {
                    imap.openBox(resolvedMailbox, true, (openErr, box) => {
                        if (openErr) {
                            imap.end();
                            reject(openErr);
                            return;
                        }

                        try {
                            if ((box?.messages?.total || 0) === 0) {
                                imap.end();
                                resolve([]);
                                return;
                            }

                            imap.search(['ALL'], (searchErr, results) => {
                                if (searchErr) {
                                    imap.end();
                                    reject(searchErr);
                                    return;
                                }
                                if (!results || results.length === 0) {
                                    imap.end();
                                    resolve([]);
                                    return;
                                }
                                const limitedResults = results.slice(-input.limit);
                                messageCount = limitedResults.length;
                                const fetcher = imap.fetch(limitedResults, { bodies: '' });
                                fetcher.on('message', (msg) => {
                                    let messageUid: number | null = null;
                                    let parsePromise: Promise<ParsedMail> | null = null;
                                    msg.once('attributes', (attrs: { uid?: number }) => {
                                        messageUid = typeof attrs.uid === 'number' ? attrs.uid : null;
                                    });
                                    msg.on('body', (stream) => {
                                        parsePromise = simpleParser(stream as unknown as Source);
                                    });
                                    msg.once('end', () => {
                                        (parsePromise || Promise.resolve(null as unknown as ParsedMail))
                                            .then((mail) => {
                                                if (!mail) {
                                                    return;
                                                }
                                                emailList.push({
                                                    id: messageUid ? `imap:${messageUid}` : `imap:${Date.now()}_${processedCount}`,
                                                    from: toParsedAddressText(mail.from),
                                                    to: toParsedAddressText(mail.to),
                                                    subject: mail.subject || '',
                                                    text: mail.text || '',
                                                    html: typeof mail.html === 'string' ? mail.html : '',
                                                    date: mail.date?.toISOString() || '',
                                                });
                                            })
                                            .catch((parseErr: Error) => logger.error({ parseErr }, 'Error parsing IMAP email'))
                                            .finally(() => {
                                                processedCount += 1;
                                                if (processedCount === messageCount) imap.end();
                                            });
                                    });
                                });
                                fetcher.once('error', (fetchErr: Error) => {
                                    imap.end();
                                    reject(fetchErr);
                                });
                            });
                        } catch (error) {
                            imap.end();
                            reject(error);
                        }
                    });
                })
                .catch((error) => {
                    imap.end();
                    reject(error);
                });
        });

        imap.once('error', reject);
        imap.once('end', () => {
            emailList.sort((a, b) => (b.date ? new Date(b.date).getTime() : 0) - (a.date ? new Date(a.date).getTime() : 0));
            resolve(emailList);
        });
        imap.connect();
    });
}

export async function fetchMessagesViaGraphApi(accessToken: string, mailbox: string, limit = 100, proxyConfig?: ProxyConfig): Promise<EmailMessage[]> {
    const folder = resolveGraphFolder(mailbox);
    const orderBy = folder === 'sentitems' ? 'sentDateTime desc' : 'receivedDateTime desc';
    const response = await proxyFetch(`https://graph.microsoft.com/v1.0/me/mailFolders/${folder}/messages?$top=${limit}&$orderby=${encodeURIComponent(orderBy)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    }, proxyConfig);
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Graph API error: ${response.status} - ${errorText}`);
    }
    const data = await response.json() as GraphMessagesResponse;
    return (data.value || []).map((message) => ({
        id: message.id || '',
        from: message.from?.emailAddress?.address || '',
        to: (message.toRecipients || []).map((item) => item.emailAddress?.address || '').filter(Boolean).join(', '),
        subject: message.subject || '',
        text: message.bodyPreview || '',
        html: message.body?.content || '',
        date: message.sentDateTime || message.createdDateTime || '',
    }));
}

export async function deleteMessageViaGraphApi(accessToken: string, messageId: string, proxyConfig?: ProxyConfig): Promise<void> {
    try {
        await proxyFetch(`https://graph.microsoft.com/v1.0/me/messages/${messageId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } }, proxyConfig);
    } catch (error) {
        logger.warn({ messageId, error }, 'Failed to delete Graph message');
    }
}

export async function deleteMessageViaGraphApiStrict(accessToken: string, messageId: string, proxyConfig?: ProxyConfig): Promise<void> {
    const response = await proxyFetch(`https://graph.microsoft.com/v1.0/me/messages/${messageId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
    }, proxyConfig);
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Graph API delete failed: ${response.status} - ${errorText}`);
    }
}

function getHeaderValue(headers: GmailHeader[] | undefined, name: string): string {
    const header = (headers || []).find((item) => item.name?.toLowerCase() === name.toLowerCase());
    return header?.value || '';
}

function extractGmailBodies(part?: GmailMessagePart): { text: string; html: string } {
    if (!part) return { text: '', html: '' };
    const bodies = { text: '', html: '' };
    if (part.body?.data) {
        const decoded = decodeBase64Url(part.body.data);
        if (part.mimeType === 'text/plain') bodies.text += decoded;
        if (part.mimeType === 'text/html') bodies.html += decoded;
    }
    for (const child of part.parts || []) {
        const nested = extractGmailBodies(child);
        bodies.text += nested.text;
        bodies.html += nested.html;
    }
    return bodies;
}

export async function fetchMessagesViaGmailApi(accessToken: string, mailbox: string, limit = 100, proxyConfig?: ProxyConfig): Promise<EmailMessage[]> {
    const params = new URLSearchParams({ maxResults: String(Math.min(limit, 500)) });
    const folder = resolveGmailLabel(mailbox);
    params.append('labelIds', folder.label);
    if (folder.includeSpamTrash) params.set('includeSpamTrash', 'true');

    const listResponse = await proxyFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params.toString()}`, { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } }, proxyConfig);
    if (!listResponse.ok) {
        const errorText = await listResponse.text();
        throw new Error(`Gmail API list failed: ${listResponse.status} - ${errorText}`);
    }
    const listData = await listResponse.json() as GmailListResponse;
    const ids = (listData.messages || []).map((item) => item.id).filter((item): item is string => Boolean(item));
    const results = await Promise.all(ids.map(async (id) => {
        const response = await proxyFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } }, proxyConfig);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Gmail API get failed: ${response.status} - ${errorText}`);
        }
        const detail = await response.json() as GmailMessageDetail;
        const bodies = extractGmailBodies(detail.payload);
        const dateHeader = getHeaderValue(detail.payload?.headers, 'Date');
        const internalDate = detail.internalDate ? Number(detail.internalDate) : 0;
        return {
            id: detail.id || id,
            from: getHeaderValue(detail.payload?.headers, 'From'),
            to: getHeaderValue(detail.payload?.headers, 'To'),
            subject: getHeaderValue(detail.payload?.headers, 'Subject'),
            text: bodies.text || detail.snippet || '',
            html: bodies.html || '',
            date: dateHeader ? new Date(dateHeader).toISOString() : (internalDate ? new Date(internalDate).toISOString() : ''),
        } satisfies EmailMessage;
    }));
    return results.sort((a, b) => (b.date ? new Date(b.date).getTime() : 0) - (a.date ? new Date(a.date).getTime() : 0));
}

export async function trashGmailMessage(accessToken: string, messageId: string, proxyConfig?: ProxyConfig): Promise<void> {
    const response = await proxyFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/trash`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } }, proxyConfig);
    if (!response.ok) {
        const errorText = await response.text();
        logger.warn({ messageId, errorText }, 'Failed to trash Gmail message');
    }
}

export async function trashGmailMessageStrict(accessToken: string, messageId: string, proxyConfig?: ProxyConfig): Promise<void> {
    const response = await proxyFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/trash`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
    }, proxyConfig);
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gmail API trash failed: ${response.status} - ${errorText}`);
    }
}

export async function deleteMessagesViaImap(input: {
    email: string;
    host: string;
    port?: number;
    tls?: boolean;
    mailbox: string;
    messageIds: string[];
    xoauth2?: string;
    password?: string;
    mailboxAliases?: string[];
}): Promise<number> {
    const uids = Array.from(new Set(input.messageIds.map(parseImapMessageUid).filter((uid): uid is number => uid !== null)));
    if (uids.length === 0) {
        return 0;
    }

    return new Promise<number>((resolve, reject) => {
        const imapConfig: Imap.Config = {
            user: input.email,
            password: '',
            host: input.host,
            port: input.port || 993,
            tls: input.tls !== false,
            tlsOptions: { rejectUnauthorized: false },
            connTimeout: 10000,
            authTimeout: 10000,
            keepalive: false,
        };

        if (input.xoauth2) {
            imapConfig.xoauth2 = input.xoauth2;
        } else if (input.password) {
            imapConfig.password = input.password;
        } else {
            reject(new AppError('IMAP_AUTH_REQUIRED', 'IMAP authentication secret is required', 400));
            return;
        }

        const imap = new Imap(imapConfig);

        imap.once('ready', () => {
            resolveExistingImapMailbox(imap, input.mailbox, input.mailboxAliases)
                .then((resolvedMailbox) => {
                    imap.openBox(resolvedMailbox, false, (openErr) => {
                        if (openErr) {
                            imap.end();
                            reject(openErr);
                            return;
                        }

                        imap.addFlags(uids, '\\Deleted', (flagErr) => {
                            if (flagErr) {
                                imap.end();
                                reject(flagErr);
                                return;
                            }

                            const expungeCallback = (expungeErr?: Error | null) => {
                                if (expungeErr) {
                                    imap.end();
                                    reject(expungeErr);
                                    return;
                                }

                                imap.end();
                                resolve(uids.length);
                            };

                            if (imap.serverSupports('UIDPLUS')) {
                                imap.expunge(uids, expungeCallback);
                                return;
                            }

                            imap.expunge(expungeCallback);
                        });
                    });
                })
                .catch((error) => {
                    imap.end();
                    reject(error);
                });
        });

        imap.once('error', reject);
        imap.connect();
    });
}
