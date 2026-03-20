import prisma from '../../lib/prisma.js';
import { encrypt, decrypt } from '../../lib/crypto.js';
import { AppError } from '../../plugins/error.js';
import { Prisma } from '@prisma/client';
import type { CreateEmailInput, ImportEmailInput, ListEmailInput, UpdateEmailInput } from './email.schema.js';
import { getDefaultAuthType, mergeProviderConfig, type EmailAuthType, type EmailProvider, type MailCredentials, type MailFetchStrategy, type MailProviderConfig } from '../mail/providers/types.js';

interface EmailAccountView {
    id: number;
    email: string;
    provider: EmailProvider;
    authType: EmailAuthType;
    clientId: string | null;
    clientSecret: string | null;
    refreshToken: string | null;
    password: string | null;
    providerConfig: Prisma.JsonValue | null;
    capabilities: Prisma.JsonValue | null;
    status: 'ACTIVE' | 'ERROR' | 'DISABLED';
    groupId: number | null;
    group?: { id?: number; name?: string; fetchStrategy?: MailFetchStrategy } | null;
    lastCheckAt?: Date | null;
    mailboxStatus?: Prisma.JsonValue | null;
    errorMessage?: string | null;
    createdAt?: Date;
    updatedAt?: Date;
}

export type EmailMailboxName = 'INBOX' | 'SENT' | 'Junk';

export interface EmailMailboxState {
    latestMessageId: string | null;
    latestMessageDate: string | null;
    messageCount: number;
    hasNew: boolean;
    lastSyncedAt: string | null;
    lastViewedAt: string | null;
}

export type EmailMailboxStatus = Record<EmailMailboxName, EmailMailboxState>;

function createEmptyMailboxState(): EmailMailboxState {
    return {
        latestMessageId: null,
        latestMessageDate: null,
        messageCount: 0,
        hasNew: false,
        lastSyncedAt: null,
        lastViewedAt: null,
    };
}

function createEmptyMailboxStatus(): EmailMailboxStatus {
    return {
        INBOX: createEmptyMailboxState(),
        SENT: createEmptyMailboxState(),
        Junk: createEmptyMailboxState(),
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeMailboxState(value: unknown): EmailMailboxState {
    const source = isRecord(value) ? value : {};
    const messageCount = typeof source.messageCount === 'number' && Number.isFinite(source.messageCount)
        ? source.messageCount
        : 0;

    return {
        latestMessageId: typeof source.latestMessageId === 'string' && source.latestMessageId.trim()
            ? source.latestMessageId
            : null,
        latestMessageDate: typeof source.latestMessageDate === 'string' && source.latestMessageDate.trim()
            ? source.latestMessageDate
            : null,
        messageCount,
        hasNew: Boolean(source.hasNew),
        lastSyncedAt: typeof source.lastSyncedAt === 'string' && source.lastSyncedAt.trim()
            ? source.lastSyncedAt
            : null,
        lastViewedAt: typeof source.lastViewedAt === 'string' && source.lastViewedAt.trim()
            ? source.lastViewedAt
            : null,
    };
}

function parseMailboxStatus(value: Prisma.JsonValue | null | undefined): EmailMailboxStatus {
    const source = isRecord(value) ? value : {};
    const defaults = createEmptyMailboxStatus();
    return {
        INBOX: { ...defaults.INBOX, ...normalizeMailboxState(source.INBOX) },
        SENT: { ...defaults.SENT, ...normalizeMailboxState(source.SENT) },
        Junk: { ...defaults.Junk, ...normalizeMailboxState(source.Junk) },
    };
}

function toMailboxStatusJson(value: EmailMailboxStatus): Prisma.InputJsonValue {
    return value as unknown as Prisma.InputJsonValue;
}

function buildEmailWhere(input: Pick<ListEmailInput, 'status' | 'keyword' | 'groupId' | 'groupName' | 'provider'>): Prisma.EmailAccountWhereInput {
    const { status, keyword, groupId, groupName, provider } = input;
    const where: Prisma.EmailAccountWhereInput = {};
    if (status) where.status = status;
    if (provider) where.provider = provider;
    if (keyword) where.email = { contains: keyword };
    if (groupId) where.groupId = groupId;
    else if (groupName) where.group = { name: groupName };
    return where;
}

function getLatestMailboxMessage(messages: Array<{ id: string; date: string }>) {
    const latest = messages[0];
    if (!latest || !latest.id) {
        return { latestMessageId: null, latestMessageDate: null };
    }
    return {
        latestMessageId: latest.id,
        latestMessageDate: latest.date || null,
    };
}

function parseJsonObject(value: Prisma.JsonValue | null | undefined): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

function sanitizeProviderConfig(provider: EmailProvider, value?: Record<string, unknown> | null): Prisma.InputJsonValue {
    return mergeProviderConfig(provider, value as MailProviderConfig | null | undefined) as unknown as Prisma.InputJsonValue;
}

function sanitizeCapabilities(value?: Record<string, unknown> | null): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    if (!value) {
        return Prisma.JsonNull;
    }
    return value as Prisma.InputJsonValue;
}

function decryptOptional(value: string | null | undefined): string | undefined {
    if (!value) return undefined;
    return decrypt(value);
}

function encryptOptional(value: string | null | undefined): string | null {
    if (!value || !value.trim()) return null;
    return encrypt(value);
}

function normalizeEmailAccount(account: EmailAccountView, includeSecrets: boolean) {
    const normalized = {
        ...account,
        providerConfig: parseJsonObject(account.providerConfig),
        capabilities: parseJsonObject(account.capabilities),
        mailboxStatus: parseMailboxStatus(account.mailboxStatus),
        group: account.group ? { ...account.group, fetchStrategy: account.group.fetchStrategy } : null,
    };
    if (!includeSecrets) {
        return { ...normalized, clientSecret: undefined, refreshToken: undefined, password: undefined };
    }
    return {
        ...normalized,
        clientSecret: decryptOptional(account.clientSecret),
        refreshToken: decryptOptional(account.refreshToken),
        password: decryptOptional(account.password),
    };
}

function normalizeCreateInput(input: CreateEmailInput) {
    const provider = input.provider;
    const authType = input.authType || getDefaultAuthType(provider);
    return {
        ...input,
        provider,
        authType,
        providerConfig: sanitizeProviderConfig(provider, input.providerConfig || null),
        capabilities: sanitizeCapabilities(input.capabilities || null),
    };
}

function parseImportLine(line: string, separator: string): {
    email: string;
    provider: EmailProvider;
    authType: EmailAuthType;
    clientId?: string;
    clientSecret?: string;
    refreshToken?: string;
    password?: string;
    providerConfig?: Record<string, unknown>;
} {
    const parts = line.trim().split(separator).map((item) => item.trim());
    if (parts.length < 2) throw new Error('Invalid format');

    const looksLikeEmail = (value: string | undefined) => Boolean(value && value.includes('@'));
    const looksLikeClientId = (value: string | undefined) => Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value));
    const looksLikeRefreshToken = (value: string | undefined) => Boolean(value && value.startsWith('M.'));

    const head = parts[0].toUpperCase();
    if (head === 'QQ') {
        if (parts.length < 3) throw new Error('QQ format should be QQ----email----authorizationCode');
        return { provider: 'QQ', authType: 'APP_PASSWORD', email: parts[1], password: parts[2], providerConfig: mergeProviderConfig('QQ') };
    }
    if (head === 'GMAIL' || head === 'OUTLOOK') {
        if (parts.length < 5) throw new Error(`${head} format should be ${head}----email----clientId----clientSecret----refreshToken`);
        return { provider: head, authType: head === 'GMAIL' ? 'GOOGLE_OAUTH' : 'MICROSOFT_OAUTH', email: parts[1], clientId: parts[2], clientSecret: parts[3] || undefined, refreshToken: parts[4], providerConfig: mergeProviderConfig(head) };
    }

    if (parts.length < 3) throw new Error('Legacy format requires at least 3 columns');
    let email: string | undefined;
    let clientId: string | undefined;
    let refreshToken: string | undefined;
    let password: string | undefined;
    let clientSecret: string | undefined;

    if (parts.length === 4 && looksLikeEmail(parts[0]) && looksLikeRefreshToken(parts[2]) && looksLikeClientId(parts[3])) {
        return {
            provider: 'OUTLOOK',
            authType: 'MICROSOFT_OAUTH',
            email: parts[0],
            clientId: parts[3],
            refreshToken: parts[2],
            clientSecret: undefined,
            providerConfig: mergeProviderConfig('OUTLOOK'),
        };
    }

    if (parts.length >= 5 && parts[3].toLowerCase() === 'oauth') {
        email = parts[0]; clientId = parts[1]; clientSecret = parts[2]; refreshToken = parts[4];
    } else if (parts.length >= 5) {
        email = parts[0]; clientId = parts[1]; refreshToken = parts[4];
    } else if (parts.length === 4) {
        email = parts[0]; password = parts[1]; clientId = parts[2]; refreshToken = parts[3];
    } else {
        email = parts[0]; clientId = parts[1]; refreshToken = parts[2];
    }
    if (!email || !clientId || !refreshToken) throw new Error('Missing required fields');
    return { provider: 'OUTLOOK', authType: 'MICROSOFT_OAUTH', email, clientId, clientSecret, refreshToken, password, providerConfig: mergeProviderConfig('OUTLOOK') };
}

export const emailService = {
    async list(input: ListEmailInput) {
        const { page, pageSize, status, keyword, groupId, groupName, provider } = input;
        const skip = (page - 1) * pageSize;
        const where = buildEmailWhere({ status, keyword, groupId, groupName, provider });

        const [list, total] = await Promise.all([
            prisma.emailAccount.findMany({
                where,
                select: {
                    id: true, email: true, provider: true, authType: true, clientId: true, providerConfig: true,
                    status: true, groupId: true, group: { select: { id: true, name: true, fetchStrategy: true } },
                    lastCheckAt: true, mailboxStatus: true, errorMessage: true, createdAt: true,
                },
                skip, take: pageSize, orderBy: { id: 'desc' },
            }),
            prisma.emailAccount.count({ where }),
        ]);

        return {
            list: list.map((item) => ({
                ...item,
                providerConfig: parseJsonObject(item.providerConfig),
                mailboxStatus: parseMailboxStatus(item.mailboxStatus),
            })),
            total,
            page,
            pageSize,
        };
    },

    async getById(id: number, includeSecrets = false) {
        const email = await prisma.emailAccount.findUnique({
            where: { id },
            select: {
                id: true, email: true, provider: true, authType: true, clientId: true,
                clientSecret: true, password: true, refreshToken: true, providerConfig: true, capabilities: true,
                status: true, groupId: true, group: { select: { id: true, name: true, fetchStrategy: true } },
                lastCheckAt: true, mailboxStatus: true, errorMessage: true, createdAt: true, updatedAt: true,
            },
        });
        if (!email) throw new AppError('NOT_FOUND', 'Email account not found', 404);
        return normalizeEmailAccount(email as EmailAccountView, includeSecrets);
    },

    async getByEmail(emailAddress: string) {
        const email = await prisma.emailAccount.findUnique({
            where: { email: emailAddress },
            select: {
                id: true, email: true, provider: true, authType: true, clientId: true, clientSecret: true, refreshToken: true, password: true,
                providerConfig: true, capabilities: true, status: true, groupId: true,
                group: { select: { fetchStrategy: true } }, mailboxStatus: true,
            },
        });
        if (!email) return null;
        const normalized = normalizeEmailAccount(email as EmailAccountView, true);
        return { ...normalized, fetchStrategy: email.group?.fetchStrategy || 'GRAPH_FIRST' };
    },

    async getBatchTargets(input: {
        ids?: number[];
        status?: ListEmailInput['status'];
        keyword?: string;
        groupId?: number;
        groupName?: string;
        provider?: EmailProvider;
    }) {
        const ids = Array.isArray(input.ids)
            ? Array.from(new Set(input.ids.filter((item) => Number.isInteger(item) && item > 0)))
            : [];

        const where = ids.length > 0
            ? { id: { in: ids } }
            : buildEmailWhere({
                status: input.status,
                keyword: input.keyword,
                groupId: input.groupId,
                groupName: input.groupName,
                provider: input.provider,
            });

        const accounts = await prisma.emailAccount.findMany({
            where,
            select: {
                id: true,
                email: true,
                provider: true,
                authType: true,
                clientId: true,
                clientSecret: true,
                refreshToken: true,
                password: true,
                providerConfig: true,
                capabilities: true,
                status: true,
                groupId: true,
                mailboxStatus: true,
                group: { select: { id: true, name: true, fetchStrategy: true } },
            },
            orderBy: { id: 'desc' },
        });

        return accounts.map((account) => {
            const normalized = normalizeEmailAccount(account as EmailAccountView, true);
            return {
                ...normalized,
                fetchStrategy: account.group?.fetchStrategy || 'GRAPH_FIRST',
            };
        });
    },

    async updateMailboxStatus(id: number, mailbox: EmailMailboxName, messages: Array<{ id: string; date: string }>, options?: { markAsSeen?: boolean }) {
        const existing = await prisma.emailAccount.findUnique({
            where: { id },
            select: { mailboxStatus: true },
        });
        if (!existing) {
            throw new AppError('NOT_FOUND', 'Email account not found', 404);
        }

        const mailboxStatus = parseMailboxStatus(existing.mailboxStatus);
        const previous = mailboxStatus[mailbox] || createEmptyMailboxState();
        const { latestMessageId, latestMessageDate } = getLatestMailboxMessage(messages);
        const now = new Date().toISOString();

        let hasNew = false;
        if (options?.markAsSeen) {
            hasNew = false;
        } else if (!latestMessageId) {
            hasNew = false;
        } else if (!previous.lastSyncedAt) {
            hasNew = false;
        } else if (previous.latestMessageId && previous.latestMessageId !== latestMessageId) {
            hasNew = true;
        } else {
            hasNew = previous.hasNew;
        }

        mailboxStatus[mailbox] = {
            latestMessageId,
            latestMessageDate,
            messageCount: messages.length,
            hasNew,
            lastSyncedAt: now,
            lastViewedAt: options?.markAsSeen ? now : previous.lastViewedAt,
        };

        await prisma.emailAccount.update({
            where: { id },
            data: {
                mailboxStatus: toMailboxStatusJson(mailboxStatus),
            },
        });

        return mailboxStatus;
    },

    async updateResolvedMailboxFolder(id: number, mailbox: EmailMailboxName, resolvedMailbox: string) {
        if (!resolvedMailbox.trim()) {
            return null;
        }

        const existing = await prisma.emailAccount.findUnique({
            where: { id },
            select: { provider: true, providerConfig: true },
        });
        if (!existing) {
            throw new AppError('NOT_FOUND', 'Email account not found', 404);
        }

        const providerConfig = mergeProviderConfig(existing.provider, parseJsonObject(existing.providerConfig) as MailProviderConfig | null | undefined);
        const folderKey = mailbox.toLowerCase() === 'sent'
            ? 'sent'
            : mailbox.toLowerCase() === 'junk'
                ? 'junk'
                : 'inbox';

        if (providerConfig.folders?.[folderKey] === resolvedMailbox) {
            return providerConfig;
        }

        const nextConfig: MailProviderConfig = {
            ...providerConfig,
            folders: {
                ...(providerConfig.folders || {}),
                [folderKey]: resolvedMailbox,
            },
        };

        await prisma.emailAccount.update({
            where: { id },
            data: {
                providerConfig: sanitizeProviderConfig(existing.provider, nextConfig),
            },
        });

        return nextConfig;
    },

    async clearMailboxStatus(id: number, mailbox: EmailMailboxName) {
        const existing = await prisma.emailAccount.findUnique({
            where: { id },
            select: { mailboxStatus: true },
        });
        if (!existing) {
            throw new AppError('NOT_FOUND', 'Email account not found', 404);
        }

        const mailboxStatus = parseMailboxStatus(existing.mailboxStatus);
        const now = new Date().toISOString();
        mailboxStatus[mailbox] = {
            latestMessageId: null,
            latestMessageDate: null,
            messageCount: 0,
            hasNew: false,
            lastSyncedAt: now,
            lastViewedAt: now,
        };

        await prisma.emailAccount.update({
            where: { id },
            data: {
                mailboxStatus: toMailboxStatusJson(mailboxStatus),
            },
        });

        return mailboxStatus;
    },

    toMailCredentials(account: {
        id: number; email: string; provider: EmailProvider; authType: EmailAuthType;
        clientId?: string | null; clientSecret?: string | null; refreshToken?: string | null; password?: string | null;
        providerConfig?: Record<string, unknown> | null; capabilities?: Record<string, unknown> | null; fetchStrategy?: MailFetchStrategy;
    }, autoAssigned = false): MailCredentials {
        return {
            id: account.id, email: account.email, provider: account.provider, authType: account.authType,
            clientId: account.clientId || undefined, clientSecret: account.clientSecret || undefined, refreshToken: account.refreshToken || undefined,
            password: account.password || undefined, autoAssigned, fetchStrategy: account.fetchStrategy,
            providerConfig: account.providerConfig as MailProviderConfig | null | undefined, capabilities: account.capabilities || null,
        };
    },

    async create(input: CreateEmailInput) {
        const normalized = normalizeCreateInput(input);
        const { email, provider, authType, clientId, refreshToken, clientSecret, password, groupId, providerConfig, capabilities } = normalized;
        const exists = await prisma.emailAccount.findUnique({ where: { email } });
        if (exists) throw new AppError('DUPLICATE_EMAIL', 'Email already exists', 400);

        return prisma.emailAccount.create({
            data: { email, provider, authType, clientId: clientId || null, refreshToken: encryptOptional(refreshToken), clientSecret: encryptOptional(clientSecret), password: encryptOptional(password), groupId: groupId || null, providerConfig, capabilities },
            select: { id: true, email: true, provider: true, authType: true, clientId: true, status: true, groupId: true, createdAt: true },
        });
    },

    async update(id: number, input: UpdateEmailInput) {
        const exists = await prisma.emailAccount.findUnique({ where: { id } });
        if (!exists) throw new AppError('NOT_FOUND', 'Email account not found', 404);
        const provider = input.provider || exists.provider as EmailProvider;
        const authType = input.authType || exists.authType as EmailAuthType;
        const updateData: Prisma.EmailAccountUncheckedUpdateInput = { email: input.email, provider, authType, status: input.status, groupId: input.groupId === undefined ? undefined : input.groupId };
        if (input.clientId !== undefined) updateData.clientId = input.clientId || null;
        if (input.refreshToken !== undefined) updateData.refreshToken = encryptOptional(input.refreshToken);
        if (input.clientSecret !== undefined) updateData.clientSecret = encryptOptional(input.clientSecret || undefined);
        if (input.password !== undefined) updateData.password = encryptOptional(typeof input.password === 'string' ? input.password : undefined);
        if (input.providerConfig !== undefined) updateData.providerConfig = sanitizeProviderConfig(provider, input.providerConfig ?? null);
        if (input.capabilities !== undefined) updateData.capabilities = input.capabilities === null ? Prisma.JsonNull : sanitizeCapabilities(input.capabilities);

        return prisma.emailAccount.update({ where: { id }, data: updateData, select: { id: true, email: true, provider: true, authType: true, clientId: true, status: true, updatedAt: true } });
    },

    async updateStatus(id: number, status: 'ACTIVE' | 'ERROR' | 'DISABLED', errorMessage?: string | null) {
        await prisma.emailAccount.update({ where: { id }, data: { status, errorMessage: errorMessage || null, lastCheckAt: new Date() } });
    },

    async delete(id: number) {
        const exists = await prisma.emailAccount.findUnique({ where: { id } });
        if (!exists) throw new AppError('NOT_FOUND', 'Email account not found', 404);
        await prisma.emailAccount.delete({ where: { id } });
        return { success: true };
    },

    async batchDelete(ids: number[]) {
        await prisma.emailAccount.deleteMany({ where: { id: { in: ids } } });
        return { deleted: ids.length };
    },

    async import(input: ImportEmailInput) {
        const { content, separator, groupId } = input;
        const lines = content.split('\n').filter((line) => line.trim());
        if (groupId !== undefined) {
            const group = await prisma.emailGroup.findUnique({ where: { id: groupId } });
            if (!group) throw new AppError('GROUP_NOT_FOUND', 'Email group not found', 404);
        }
        let success = 0;
        let failed = 0;
        const errors: string[] = [];

        for (const line of lines) {
            try {
                const parsed = parseImportLine(line, separator);
                const updateData: Prisma.EmailAccountUncheckedUpdateInput = {
                    provider: parsed.provider,
                    authType: parsed.authType,
                    clientId: parsed.clientId || null,
                    refreshToken: encryptOptional(parsed.refreshToken),
                    clientSecret: encryptOptional(parsed.clientSecret),
                    password: encryptOptional(parsed.password),
                    providerConfig: sanitizeProviderConfig(parsed.provider, parsed.providerConfig || null),
                    status: 'ACTIVE',
                    groupId: groupId === undefined ? undefined : groupId,
                };
                const exists = await prisma.emailAccount.findUnique({ where: { email: parsed.email } });
                if (exists) {
                    await prisma.emailAccount.update({ where: { email: parsed.email }, data: updateData });
                } else {
                    await prisma.emailAccount.create({ data: { email: parsed.email, provider: parsed.provider, authType: parsed.authType, clientId: parsed.clientId || null, refreshToken: encryptOptional(parsed.refreshToken), clientSecret: encryptOptional(parsed.clientSecret), password: encryptOptional(parsed.password), providerConfig: sanitizeProviderConfig(parsed.provider, parsed.providerConfig || null), status: 'ACTIVE', groupId: groupId || null } });
                }
                success += 1;
            } catch (error) {
                failed += 1;
                errors.push(`Line "${line.substring(0, 50)}...": ${(error as Error).message}`);
            }
        }

        if (success === 0 && failed > 0) {
            throw new AppError('IMPORT_FAILED', `Import failed for all ${failed} lines`, 400);
        }

        return { success, failed, errors };
    },

    async export(ids?: number[], separator = '----', groupId?: number) {
        const where: Prisma.EmailAccountWhereInput = {};
        if (ids?.length) where.id = { in: ids };
        if (groupId !== undefined) where.groupId = groupId;
        const accounts = await prisma.emailAccount.findMany({ where, select: { email: true, provider: true, clientId: true, clientSecret: true, refreshToken: true, password: true } });
        const lines = accounts.map((account) => {
            if (account.provider === 'QQ') {
                return `QQ${separator}${account.email}${separator}${decryptOptional(account.password) || ''}`;
            }
            return `${account.provider}${separator}${account.email}${separator}${account.clientId || ''}${separator}${decryptOptional(account.clientSecret) || ''}${separator}${decryptOptional(account.refreshToken) || ''}`;
        });
        return lines.join('\n');
    },

    async getStats() {
        const [total, active, error, outlook, gmail, qq] = await Promise.all([
            prisma.emailAccount.count(),
            prisma.emailAccount.count({ where: { status: 'ACTIVE' } }),
            prisma.emailAccount.count({ where: { status: 'ERROR' } }),
            prisma.emailAccount.count({ where: { provider: 'OUTLOOK' } }),
            prisma.emailAccount.count({ where: { provider: 'GMAIL' } }),
            prisma.emailAccount.count({ where: { provider: 'QQ' } }),
        ]);
        return { total, active, error, providers: { outlook, gmail, qq } };
    },
};
