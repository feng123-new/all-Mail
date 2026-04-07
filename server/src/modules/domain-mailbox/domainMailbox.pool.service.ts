import type { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { AppError } from '../../plugins/error.js';
import { getHostedInternalProtocolSummary } from '../mail/hostedInternal.contract.js';

interface DomainMailboxScope {
    allowedDomainIds?: number[];
}

interface DomainSelectorInput {
    domainId?: number;
    domain?: string;
    batchTag?: string;
}

function normalizeDomainName(value: string): string {
    return value.trim().toLowerCase();
}

function normalizeEmailAddress(value: string): string {
    return value.trim().toLowerCase();
}

function parseJsonIdList(value: Prisma.JsonValue | null | undefined): number[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return Array.from(new Set(value.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0)));
}

async function getApiKeyDomainScope(apiKeyId: number): Promise<DomainMailboxScope> {
    const apiKey = await prisma.apiKey.findUnique({
        where: { id: apiKeyId },
        select: { id: true, allowedDomainIds: true },
    });
    if (!apiKey) {
        throw new AppError('API_KEY_NOT_FOUND', 'API Key not found', 404);
    }

    const allowedDomainIds = parseJsonIdList(apiKey.allowedDomainIds);
    return {
        allowedDomainIds: allowedDomainIds.length > 0 ? allowedDomainIds : undefined,
    };
}

async function resolveScopedDomainIds(apiKeyId: number, input: DomainSelectorInput): Promise<number[] | undefined> {
    const scope = await getApiKeyDomainScope(apiKeyId);

    if (input.domainId) {
        if (scope.allowedDomainIds && !scope.allowedDomainIds.includes(input.domainId)) {
            throw new AppError('DOMAIN_FORBIDDEN', 'This API Key cannot access the selected domain', 403);
        }

        const domain = await prisma.domain.findUnique({
            where: { id: input.domainId },
            select: { id: true },
        });
        if (!domain) {
            throw new AppError('DOMAIN_NOT_FOUND', 'Selected domain was not found', 404);
        }
        return [domain.id];
    }

    if (input.domain) {
        const normalizedDomain = normalizeDomainName(input.domain);
        const domain = await prisma.domain.findUnique({
            where: { name: normalizedDomain },
            select: { id: true },
        });
        if (!domain) {
            throw new AppError('DOMAIN_NOT_FOUND', 'Selected domain was not found', 404);
        }
        if (scope.allowedDomainIds && !scope.allowedDomainIds.includes(domain.id)) {
            throw new AppError('DOMAIN_FORBIDDEN', 'This API Key cannot access the selected domain', 403);
        }
        return [domain.id];
    }

    return scope.allowedDomainIds;
}

async function resolveAccessibleMailbox(apiKeyId: number, email: string) {
    const normalizedEmail = normalizeEmailAddress(email);
    const scope = await getApiKeyDomainScope(apiKeyId);
    const mailbox = await prisma.domainMailbox.findUnique({
        where: { address: normalizedEmail },
        select: {
            id: true,
            domainId: true,
            address: true,
            localPart: true,
            status: true,
            provisioningMode: true,
            batchTag: true,
            domain: {
                select: {
                    id: true,
                    name: true,
                    status: true,
                    canSend: true,
                    canReceive: true,
                },
            },
        },
    });

    if (!mailbox || mailbox.provisioningMode !== 'API_POOL') {
        throw new AppError('DOMAIN_MAILBOX_NOT_FOUND', 'Domain API mailbox not found', 404);
    }
    if (scope.allowedDomainIds && !scope.allowedDomainIds.includes(mailbox.domainId)) {
        throw new AppError('DOMAIN_FORBIDDEN', 'This API Key cannot access this domain mailbox', 403);
    }
    if (mailbox.status !== 'ACTIVE' || mailbox.domain.status !== 'ACTIVE' || !mailbox.domain.canReceive) {
        throw new AppError('DOMAIN_MAILBOX_DISABLED', 'This domain mailbox is not active for receiving', 403);
    }

    return mailbox;
}

function getMailboxProtocolSummary(mailbox: {
    provisioningMode: 'MANUAL' | 'API_POOL';
    domain: {
        canSend?: boolean | null;
        canReceive?: boolean | null;
    };
}) {
    return getHostedInternalProtocolSummary({
        provisioningMode: mailbox.provisioningMode,
        canSend: Boolean(mailbox.domain.canSend),
        canReceive: mailbox.domain.canReceive !== false,
    });
}

function buildScopedMailboxWhere(domainIds: number[] | undefined, input: DomainSelectorInput): Prisma.DomainMailboxWhereInput {
    return {
        provisioningMode: 'API_POOL',
        status: 'ACTIVE',
        ...(input.batchTag ? { batchTag: input.batchTag } : {}),
        ...(domainIds ? { domainId: { in: domainIds } } : {}),
        domain: {
            status: 'ACTIVE',
            canReceive: true,
        },
    };
}

export const domainMailboxPoolService = {
    async getUnusedMailbox(apiKeyId: number, input: DomainSelectorInput) {
        const domainIds = await resolveScopedDomainIds(apiKeyId, input);
        const mailbox = await prisma.domainMailbox.findFirst({
            where: {
                ...buildScopedMailboxWhere(domainIds, input),
                NOT: {
                    usages: {
                        some: { apiKeyId },
                    },
                },
            },
                select: {
                    id: true,
                    address: true,
                    localPart: true,
                    batchTag: true,
                    domainId: true,
                    provisioningMode: true,
                    domain: {
                        select: { id: true, name: true, canSend: true, canReceive: true },
                    },
                },
            orderBy: [{ domainId: 'asc' }, { id: 'asc' }],
        });

        if (!mailbox) {
            const stats = await this.getPoolStats(apiKeyId, input);
            throw new AppError(
                'NO_UNUSED_DOMAIN_MAILBOX',
                `No unused domain mailboxes available. Used: ${stats.used}/${stats.total}`,
                400
            );
        }

        try {
            await prisma.domainMailboxUsage.create({
                data: {
                    apiKeyId,
                    domainMailboxId: mailbox.id,
                },
            });
        } catch (error) {
            if (error && typeof error === 'object' && (error as { code?: string }).code === 'P2002') {
                throw new AppError('DOMAIN_MAILBOX_ALREADY_USED', 'Domain mailbox already allocated to this API Key', 409);
            }
            throw error;
        }

        return {
            id: mailbox.id,
            email: mailbox.address,
            localPart: mailbox.localPart,
            batchTag: mailbox.batchTag,
            domainId: mailbox.domainId,
            domainName: mailbox.domain.name,
            ...getMailboxProtocolSummary(mailbox),
        };
    },

    async listMailboxes(apiKeyId: number, input: DomainSelectorInput) {
        const domainIds = await resolveScopedDomainIds(apiKeyId, input);
        const where = buildScopedMailboxWhere(domainIds, input);
        const [mailboxes, usages] = await Promise.all([
            prisma.domainMailbox.findMany({
                where,
                select: {
                    id: true,
                    address: true,
                    localPart: true,
                    batchTag: true,
                    domainId: true,
                    provisioningMode: true,
                    domain: {
                        select: { id: true, name: true, canSend: true, canReceive: true },
                    },
                },
                orderBy: [{ domainId: 'asc' }, { id: 'asc' }],
            }),
            prisma.domainMailboxUsage.findMany({
                where: { apiKeyId },
                select: { domainMailboxId: true },
            }),
        ]);

        const usedSet = new Set(usages.map((item) => item.domainMailboxId));
        return {
            total: mailboxes.length,
            mailboxes: mailboxes.map((mailbox) => ({
                id: mailbox.id,
                email: mailbox.address,
                localPart: mailbox.localPart,
                batchTag: mailbox.batchTag,
                used: usedSet.has(mailbox.id),
                domainId: mailbox.domainId,
                domainName: mailbox.domain.name,
                ...getMailboxProtocolSummary(mailbox),
            })),
        };
    },

    async getPoolStats(apiKeyId: number, input: DomainSelectorInput) {
        const domainIds = await resolveScopedDomainIds(apiKeyId, input);
        const mailboxIds = (await prisma.domainMailbox.findMany({
            where: buildScopedMailboxWhere(domainIds, input),
            select: { id: true },
        })).map((mailbox) => mailbox.id);

        const used = mailboxIds.length === 0
            ? 0
            : await prisma.domainMailboxUsage.count({
                where: {
                    apiKeyId,
                    domainMailboxId: { in: mailboxIds },
                },
            });

        return {
            total: mailboxIds.length,
            used,
            remaining: Math.max(0, mailboxIds.length - used),
        };
    },

    async resetPool(apiKeyId: number, input: DomainSelectorInput) {
        const domainIds = await resolveScopedDomainIds(apiKeyId, input);
        const mailboxIds = (await prisma.domainMailbox.findMany({
            where: buildScopedMailboxWhere(domainIds, input),
            select: { id: true },
        })).map((mailbox) => mailbox.id);

        if (mailboxIds.length === 0) {
            return { success: true, deletedCount: 0 };
        }

        const deleted = await prisma.domainMailboxUsage.deleteMany({
            where: {
                apiKeyId,
                domainMailboxId: { in: mailboxIds },
            },
        });

        return {
            success: true,
            deletedCount: deleted.count,
        };
    },

    async listMessages(apiKeyId: number, input: { email: string; limit?: number }) {
        const mailbox = await resolveAccessibleMailbox(apiKeyId, input.email);
        const take = Math.max(1, Math.min(input.limit ?? 20, 100));
        const messages = await prisma.inboundMessage.findMany({
            where: {
                mailboxId: mailbox.id,
                isDeleted: false,
            },
            select: {
                id: true,
                fromAddress: true,
                toAddress: true,
                subject: true,
                textPreview: true,
                htmlPreview: true,
                verificationCode: true,
                receivedAt: true,
                routeKind: true,
            },
            orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
            take,
        });

        return {
            email: mailbox.address,
            mailboxId: mailbox.id,
            domainId: mailbox.domainId,
            domainName: mailbox.domain.name,
            count: messages.length,
            ...getMailboxProtocolSummary(mailbox),
            messages: messages.map((message) => ({
                id: message.id.toString(),
                from: message.fromAddress,
                to: message.toAddress,
                subject: message.subject || '',
                text: message.textPreview || '',
                html: message.htmlPreview || '',
                verificationCode: message.verificationCode,
                routeKind: message.routeKind,
                date: message.receivedAt.toISOString(),
            })),
        };
    },

    async getLatestMessage(apiKeyId: number, email: string) {
        const result = await this.listMessages(apiKeyId, { email, limit: 1 });
        return result;
    },
};
