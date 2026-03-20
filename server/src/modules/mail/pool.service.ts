import prisma from '../../lib/prisma.js';
import { decrypt } from '../../lib/crypto.js';
import { AppError } from '../../plugins/error.js';
import type { Prisma } from '@prisma/client';
import type { EmailAuthType, EmailProvider, MailFetchStrategy } from './providers/types.js';

interface ApiKeyScope {
    allowedGroupIds?: number[];
    allowedEmailIds?: number[];
}

function hasErrorCode(error: unknown, code: string): boolean {
    if (!error || typeof error !== 'object') return false;
    return (error as { code?: unknown }).code === code;
}

function parseJsonIdList(value: Prisma.JsonValue | null | undefined): number[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0)));
}

function parseJsonObject(value: Prisma.JsonValue | null | undefined): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}

function decryptOptional(value: string | null | undefined): string | undefined {
    if (!value) return undefined;
    return decrypt(value);
}

async function resolveGroupId(groupName?: string): Promise<number | undefined> {
    if (!groupName) return undefined;
    const group = await prisma.emailGroup.findUnique({ where: { name: groupName } });
    if (!group) throw new AppError('GROUP_NOT_FOUND', `Email group '${groupName}' not found`, 404);
    return group.id;
}

async function getApiKeyScope(apiKeyId: number): Promise<ApiKeyScope> {
    const apiKey = await prisma.apiKey.findUnique({ where: { id: apiKeyId }, select: { id: true, allowedGroupIds: true, allowedEmailIds: true } });
    if (!apiKey) throw new AppError('API_KEY_NOT_FOUND', 'API Key not found', 404);
    const allowedGroupIds = parseJsonIdList(apiKey.allowedGroupIds);
    const allowedEmailIds = parseJsonIdList(apiKey.allowedEmailIds);
    return { allowedGroupIds: allowedGroupIds.length > 0 ? allowedGroupIds : undefined, allowedEmailIds: allowedEmailIds.length > 0 ? allowedEmailIds : undefined };
}

function isEmailInScope(scope: ApiKeyScope, emailId: number, groupId: number | null): boolean {
    if (scope.allowedGroupIds && (!groupId || !scope.allowedGroupIds.includes(groupId))) return false;
    if (scope.allowedEmailIds && !scope.allowedEmailIds.includes(emailId)) return false;
    return true;
}

function applyScopeToEmailWhere(where: Prisma.EmailAccountWhereInput, scope: ApiKeyScope, groupId?: number): Prisma.EmailAccountWhereInput {
    if (groupId !== undefined) {
        if (scope.allowedGroupIds && !scope.allowedGroupIds.includes(groupId)) throw new AppError('GROUP_FORBIDDEN', 'This API Key cannot access the selected group', 403);
        where.groupId = groupId;
    } else if (scope.allowedGroupIds) {
        where.groupId = { in: scope.allowedGroupIds };
    }
    if (scope.allowedEmailIds) where.id = { in: scope.allowedEmailIds };
    return where;
}

export const poolService = {
    async getApiKeyScope(apiKeyId: number): Promise<ApiKeyScope> {
        return getApiKeyScope(apiKeyId);
    },

    async assertEmailAccessible(apiKeyId: number, emailId: number, groupId: number | null): Promise<void> {
        const scope = await getApiKeyScope(apiKeyId);
        if (!isEmailInScope(scope, emailId, groupId)) throw new AppError('EMAIL_FORBIDDEN', 'This API Key cannot access this email', 403);
    },

    async getUnusedEmail(apiKeyId: number, groupName?: string) {
        const scope = await getApiKeyScope(apiKeyId);
        const groupId = await resolveGroupId(groupName);
        const where = applyScopeToEmailWhere({ status: 'ACTIVE', NOT: { usages: { some: { apiKeyId } } } }, scope, groupId);
        const email = await prisma.emailAccount.findFirst({
            where,
            select: {
                id: true, email: true, provider: true, authType: true, clientId: true, clientSecret: true, refreshToken: true, password: true,
                providerConfig: true, capabilities: true, groupId: true, group: { select: { fetchStrategy: true } },
            },
            orderBy: { id: 'asc' },
        });
        if (!email) return null;
        return {
            id: email.id,
            email: email.email,
            provider: email.provider as EmailProvider,
            authType: email.authType as EmailAuthType,
            clientId: email.clientId || undefined,
            clientSecret: decryptOptional(email.clientSecret),
            refreshToken: decryptOptional(email.refreshToken),
            password: decryptOptional(email.password),
            providerConfig: parseJsonObject(email.providerConfig),
            capabilities: parseJsonObject(email.capabilities),
            groupId: email.groupId,
            fetchStrategy: (email.group?.fetchStrategy || 'GRAPH_FIRST') as MailFetchStrategy,
        };
    },

    async markUsed(apiKeyId: number, emailAccountId: number) {
        try {
            await prisma.emailUsage.create({ data: { apiKeyId, emailAccountId, usedAt: new Date() } });
        } catch (error: unknown) {
            if (hasErrorCode(error, 'P2002')) throw new AppError('ALREADY_USED', 'Email already allocated to this API Key', 409);
            throw error;
        }
    },

    async checkOwnership(apiKeyId: number, emailAddress: string) {
        const email = await prisma.emailAccount.findUnique({ where: { email: emailAddress }, include: { usages: { where: { apiKeyId } } } });
        if (!email) throw new AppError('EMAIL_NOT_FOUND', 'Email account not found', 404);
        return email.usages.length > 0;
    },

    async getAllocatedEmails(apiKeyId: number) {
        const usages = await prisma.emailUsage.findMany({ where: { apiKeyId }, include: { emailAccount: { select: { id: true, email: true, provider: true, status: true } } } });
        return usages.map((usage) => ({ email: usage.emailAccount.email, provider: usage.emailAccount.provider, status: usage.emailAccount.status, allocatedAt: usage.usedAt }));
    },

    async getStats(apiKeyId: number, groupName?: string) {
        const scope = await getApiKeyScope(apiKeyId);
        const groupId = await resolveGroupId(groupName);
        const emailIds = (await prisma.emailAccount.findMany({ where: applyScopeToEmailWhere({ status: 'ACTIVE' }, scope, groupId), select: { id: true } })).map((email) => email.id);
        const usageWhere: Prisma.EmailUsageWhereInput = { apiKeyId, emailAccountId: emailIds.length > 0 ? { in: emailIds } : { in: [-1] } };
        const [total, used] = await Promise.all([Promise.resolve(emailIds.length), prisma.emailUsage.count({ where: usageWhere })]);
        return { total, used, remaining: Math.max(0, total - used) };
    },

    async reset(apiKeyId: number, groupName?: string) {
        const scope = await getApiKeyScope(apiKeyId);
        const groupId = await resolveGroupId(groupName);
        const scopedEmailIds = (await prisma.emailAccount.findMany({ where: applyScopeToEmailWhere({ status: 'ACTIVE' }, scope, groupId), select: { id: true } })).map((email) => email.id);
        if (scopedEmailIds.length === 0) return { success: true };
        await prisma.emailUsage.deleteMany({ where: { apiKeyId, emailAccountId: { in: scopedEmailIds } } });
        return { success: true };
    },

    async getEmailsWithUsage(apiKeyId: number, groupId?: number) {
        const scope = await getApiKeyScope(apiKeyId);
        const emailWhere = applyScopeToEmailWhere({ status: 'ACTIVE' }, scope, groupId);
        const [emails, usedIds] = await Promise.all([
            prisma.emailAccount.findMany({ where: emailWhere, select: { id: true, email: true, provider: true, groupId: true, group: { select: { id: true, name: true } } }, orderBy: { id: 'asc' } }),
            prisma.emailUsage.findMany({ where: { apiKeyId }, select: { emailAccountId: true } }),
        ]);
        const usedSet = new Set(usedIds.map((usage) => usage.emailAccountId));
        return emails.map((email) => ({ id: email.id, email: email.email, provider: email.provider, used: usedSet.has(email.id), groupId: email.groupId, groupName: email.group?.name || null }));
    },

    async updateEmailUsage(apiKeyId: number, emailIds: number[], groupId?: number) {
        return prisma.$transaction(async (tx) => {
            const apiKey = await tx.apiKey.findUnique({ where: { id: apiKeyId }, select: { id: true, allowedGroupIds: true, allowedEmailIds: true } });
            if (!apiKey) throw new AppError('API_KEY_NOT_FOUND', 'API Key not found', 404);
            const scope: ApiKeyScope = { allowedGroupIds: parseJsonIdList(apiKey.allowedGroupIds), allowedEmailIds: parseJsonIdList(apiKey.allowedEmailIds) };
            if (scope.allowedGroupIds && scope.allowedGroupIds.length === 0) scope.allowedGroupIds = undefined;
            if (scope.allowedEmailIds && scope.allowedEmailIds.length === 0) scope.allowedEmailIds = undefined;

            const scopedWhere = applyScopeToEmailWhere({ status: 'ACTIVE' }, scope, groupId);
            const scopedEmailIds = (await tx.emailAccount.findMany({ where: scopedWhere, select: { id: true } })).map((item) => item.id);
            const scopedSet = new Set(scopedEmailIds);
            const nextEmailIds = Array.from(new Set(emailIds.filter((id) => Number.isInteger(id) && id > 0)));
            const invalidIds = nextEmailIds.filter((id) => !scopedSet.has(id));
            if (invalidIds.length > 0) throw new AppError('EMAIL_FORBIDDEN', 'Some selected emails are outside API Key scope', 403);

            const existingUsages = await tx.emailUsage.findMany({ where: { apiKeyId, emailAccountId: { in: scopedEmailIds } }, select: { emailAccountId: true } });
            const existingSet = new Set(existingUsages.map((usage) => usage.emailAccountId));
            const nextSet = new Set(nextEmailIds);
            const toAdd = nextEmailIds.filter((id) => !existingSet.has(id));
            const toRemove = existingUsages.map((usage) => usage.emailAccountId).filter((id) => !nextSet.has(id));

            if (toRemove.length > 0) await tx.emailUsage.deleteMany({ where: { apiKeyId, emailAccountId: { in: toRemove } } });
            if (toAdd.length > 0) await tx.emailUsage.createMany({ data: toAdd.map((emailAccountId) => ({ apiKeyId, emailAccountId })), skipDuplicates: true });
            return { success: true, count: nextEmailIds.length, added: toAdd.length, removed: toRemove.length };
        });
    },
};
