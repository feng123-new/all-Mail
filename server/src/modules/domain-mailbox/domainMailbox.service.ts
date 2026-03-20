import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { hashPassword } from '../../lib/crypto.js';
import { AppError } from '../../plugins/error.js';
import type {
    BatchCreateDomainMailboxInput,
    BatchDeleteDomainMailboxInput,
    CreateDomainMailboxInput,
    ListDomainMailboxInput,
    UpdateDomainMailboxInput,
} from './domainMailbox.schema.js';

function normalizeLocalPart(localPart: string): string {
    return localPart.trim().toLowerCase();
}

function normalizeBatchTag(batchTag: string | null | undefined): string | null {
    if (typeof batchTag !== 'string') {
        return null;
    }
    const normalized = batchTag.trim();
    return normalized ? normalized : null;
}

function buildAddress(localPart: string, domainName: string): string {
    return `${normalizeLocalPart(localPart)}@${domainName.toLowerCase()}`;
}

function buildSequentialLocalParts(prefix: string, count: number, startFrom: number, padding: number): string[] {
    return Array.from({ length: count }, (_, index) => {
        const currentNumber = startFrom + index;
        const suffix = padding > 0 ? String(currentNumber).padStart(padding, '0') : String(currentNumber);
        return `${prefix}${suffix}`;
    });
}

function normalizeGeneratedLocalParts(input: BatchCreateDomainMailboxInput): string[] {
    let rawLocalParts: string[];
    if ('localParts' in input && Array.isArray(input.localParts)) {
        rawLocalParts = input.localParts;
    } else if (typeof input.prefix === 'string' && typeof input.count === 'number') {
        rawLocalParts = buildSequentialLocalParts(input.prefix, input.count, input.startFrom, input.padding);
    } else {
        throw new AppError('DOMAIN_MAILBOX_BATCH_INPUT_INVALID', 'Batch create requires either localParts or prefix/count generation parameters', 400);
    }

    const normalized = Array.from(new Set(rawLocalParts.map((item) => normalizeLocalPart(item)).filter(Boolean)));
    if (normalized.length === 0) {
        throw new AppError('DOMAIN_MAILBOX_LOCAL_PART_REQUIRED', 'At least one mailbox local-part is required', 400);
    }
    return normalized;
}

async function ensureForwardConfig(forwardMode: CreateDomainMailboxInput['forwardMode'] | UpdateDomainMailboxInput['forwardMode'], forwardTo: string | null | undefined): Promise<{ forwardMode: 'DISABLED' | 'COPY' | 'MOVE'; forwardTo: string | null }> {
    const nextMode = (forwardMode ?? 'DISABLED') as 'DISABLED' | 'COPY' | 'MOVE';
    if (nextMode !== 'DISABLED' && !forwardTo) {
        throw new AppError('FORWARD_TARGET_REQUIRED', 'A forward target email is required when forwarding is enabled', 400);
    }
    return {
        forwardMode: nextMode,
        forwardTo: nextMode === 'DISABLED' ? null : (forwardTo ?? null),
    };
}

function normalizeDistinctIds(ids: number[] | undefined): number[] {
    return Array.from(new Set((ids || []).filter((id) => Number.isInteger(id) && id > 0)));
}

async function ensureMailboxUsersExist(ids: number[]): Promise<void> {
    if (ids.length === 0) {
        return;
    }
    const count = await prisma.mailboxUser.count({ where: { id: { in: ids } } });
    if (count !== ids.length) {
        throw new AppError('MAILBOX_USER_NOT_FOUND', 'One or more mailbox users do not exist', 404);
    }
}

async function ensureApiKeysExist(ids: number[]): Promise<void> {
    if (ids.length === 0) {
        return;
    }
    const count = await prisma.apiKey.count({ where: { id: { in: ids } } });
    if (count !== ids.length) {
        throw new AppError('API_KEY_NOT_FOUND', 'One or more API Keys do not exist', 404);
    }
}

function toNullableJsonIds(value: number[]): Prisma.InputJsonValue | Prisma.NullTypes.DbNull {
    return value.length > 0 ? value : Prisma.DbNull;
}

function parseJsonIdList(value: unknown): number[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return Array.from(new Set(value.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0)));
}

function buildListWhere(input: ListDomainMailboxInput) {
    return {
        ...(input.domainId ? { domainId: input.domainId } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.batchTag ? { batchTag: input.batchTag } : {}),
        ...(input.provisioningMode ? { provisioningMode: input.provisioningMode } : {}),
        ...(input.keyword
            ? {
                OR: [
                    { address: { contains: input.keyword, mode: 'insensitive' as const } },
                    { displayName: { contains: input.keyword, mode: 'insensitive' as const } },
                    { localPart: { contains: input.keyword, mode: 'insensitive' as const } },
                    { batchTag: { contains: input.keyword, mode: 'insensitive' as const } },
                ],
            }
            : {}),
    };
}

function buildBatchDeleteWhere(input: BatchDeleteDomainMailboxInput) {
    return {
        ...(input.ids.length > 0 ? { id: { in: input.ids } } : {}),
        ...(input.domainId ? { domainId: input.domainId } : {}),
        ...(input.batchTag ? { batchTag: input.batchTag } : {}),
        ...(input.provisioningMode ? { provisioningMode: input.provisioningMode } : {}),
    };
}

async function ensureExistingBatchMailboxes(domainId: number, addresses: string[]) {
    const existing = await prisma.domainMailbox.findMany({
        where: {
            domainId,
            address: { in: addresses },
        },
        select: { address: true },
    });

    if (existing.length > 0) {
        throw new AppError(
            'DOMAIN_MAILBOX_EXISTS',
            `Some domain mailboxes already exist: ${existing.map((item) => item.address).join(', ')}`,
            409
        );
    }
}

function buildMailboxMetadata(metadata: Record<string, unknown> | null, input: { provisioningMode: 'MANUAL' | 'API_POOL'; batchTag: string | null; bindApiKeyIds?: number[] }) {
    return {
        ...(metadata || {}),
        provisioningMode: input.provisioningMode,
        batchTag: input.batchTag,
        ...(input.bindApiKeyIds && input.bindApiKeyIds.length > 0 ? { boundApiKeyIds: input.bindApiKeyIds } : {}),
        updatedAt: new Date().toISOString(),
    };
}

export const domainMailboxService = {
    async list(input: ListDomainMailboxInput) {
        const skip = (input.page - 1) * input.pageSize;
        const where = buildListWhere(input);

        const [list, total] = await Promise.all([
            prisma.domainMailbox.findMany({
                where,
                select: {
                    id: true,
                    domainId: true,
                    localPart: true,
                    address: true,
                    displayName: true,
                    status: true,
                    provisioningMode: true,
                    batchTag: true,
                    quotaMb: true,
                    canLogin: true,
                    isCatchAllTarget: true,
                    forwardMode: true,
                    forwardTo: true,
                    createdAt: true,
                    updatedAt: true,
                    domain: { select: { id: true, name: true, canSend: true, canReceive: true } },
                    ownerUser: { select: { id: true, username: true, email: true } },
                    _count: { select: { inboundMessages: true, outboundMessages: true, usages: true } },
                },
                skip,
                take: input.pageSize,
                orderBy: [{ domainId: 'asc' }, { id: 'desc' }],
            }),
            prisma.domainMailbox.count({ where }),
        ]);

        return {
            list: list.map((item) => ({
                ...item,
                inboundMessageCount: item._count.inboundMessages,
                outboundMessageCount: item._count.outboundMessages,
                apiUsageCount: item._count.usages,
            })),
            total,
            page: input.page,
            pageSize: input.pageSize,
        };
    },

    async getById(id: number) {
        const mailbox = await prisma.domainMailbox.findUnique({
            where: { id },
            select: {
                id: true,
                domainId: true,
                localPart: true,
                address: true,
                displayName: true,
                status: true,
                provisioningMode: true,
                batchTag: true,
                quotaMb: true,
                canLogin: true,
                isCatchAllTarget: true,
                ownerUserId: true,
                forwardMode: true,
                forwardTo: true,
                metadata: true,
                createdAt: true,
                updatedAt: true,
                domain: {
                    select: {
                        id: true,
                        name: true,
                        canReceive: true,
                        canSend: true,
                        status: true,
                    },
                },
                ownerUser: { select: { id: true, username: true, email: true } },
                memberships: {
                    select: {
                        id: true,
                        role: true,
                        user: {
                            select: { id: true, username: true, email: true, status: true },
                        },
                    },
                },
                aliases: {
                    select: {
                        id: true,
                        aliasLocalPart: true,
                        aliasAddress: true,
                        status: true,
                    },
                    orderBy: { id: 'asc' },
                },
                _count: {
                    select: {
                        inboundMessages: true,
                        outboundMessages: true,
                        usages: true,
                    },
                },
            },
        });

        if (!mailbox) {
            throw new AppError('DOMAIN_MAILBOX_NOT_FOUND', 'Domain mailbox not found', 404);
        }

        return {
            ...mailbox,
            inboundMessageCount: mailbox._count.inboundMessages,
            outboundMessageCount: mailbox._count.outboundMessages,
            apiUsageCount: mailbox._count.usages,
        };
    },

    async create(input: CreateDomainMailboxInput) {
        const domain = await prisma.domain.findUnique({
            where: { id: input.domainId },
            select: { id: true, name: true, status: true },
        });
        if (!domain) {
            throw new AppError('DOMAIN_NOT_FOUND', 'Domain not found', 404);
        }

        const localPart = normalizeLocalPart(input.localPart);
        const address = buildAddress(localPart, domain.name);
        const existing = await prisma.domainMailbox.findUnique({ where: { address } });
        if (existing) {
            throw new AppError('DOMAIN_MAILBOX_EXISTS', 'Domain mailbox already exists', 409);
        }

        const forwardConfig = await ensureForwardConfig(input.forwardMode, input.forwardTo ?? null);
        const memberUserIds = normalizeDistinctIds(input.memberUserIds);
        const batchTag = normalizeBatchTag(input.batchTag);

        if (input.ownerUserId) {
            await ensureMailboxUsersExist([input.ownerUserId]);
        }
        await ensureMailboxUsersExist(memberUserIds);

        return prisma.domainMailbox.create({
            data: {
                domainId: input.domainId,
                localPart,
                address,
                displayName: input.displayName?.trim() || null,
                status: 'ACTIVE',
                provisioningMode: input.provisioningMode,
                batchTag,
                canLogin: input.canLogin,
                quotaMb: input.quotaMb ?? null,
                passwordHash: input.password ? await hashPassword(input.password) : null,
                ownerUserId: input.ownerUserId ?? null,
                forwardMode: forwardConfig.forwardMode,
                forwardTo: forwardConfig.forwardTo,
                metadata: buildMailboxMetadata(null, {
                    provisioningMode: input.provisioningMode,
                    batchTag,
                }),
                memberships: memberUserIds.length > 0 ? {
                    create: memberUserIds.map((userId) => ({ userId, role: 'MEMBER' as const })),
                } : undefined,
            },
            select: {
                id: true,
                domainId: true,
                localPart: true,
                address: true,
                displayName: true,
                status: true,
                provisioningMode: true,
                batchTag: true,
                quotaMb: true,
                canLogin: true,
                ownerUserId: true,
                forwardMode: true,
                forwardTo: true,
                createdAt: true,
                updatedAt: true,
            },
        });
    },

    async batchCreate(input: BatchCreateDomainMailboxInput) {
        const domain = await prisma.domain.findUnique({
            where: { id: input.domainId },
            select: { id: true, name: true, status: true, canReceive: true },
        });
        if (!domain) {
            throw new AppError('DOMAIN_NOT_FOUND', 'Domain not found', 404);
        }

        const localParts = normalizeGeneratedLocalParts(input);
        const addresses = localParts.map((localPart) => buildAddress(localPart, domain.name));
        await ensureExistingBatchMailboxes(domain.id, addresses);

        const forwardConfig = await ensureForwardConfig(input.forwardMode, input.forwardTo ?? null);
        const memberUserIds = normalizeDistinctIds(input.memberUserIds);
        const bindApiKeyIds = normalizeDistinctIds(input.bindApiKeyIds);
        const batchTag = normalizeBatchTag(input.batchTag) || `${normalizeLocalPart(domain.name.split('.')[0])}-${Date.now()}`;

        if (input.ownerUserId) {
            await ensureMailboxUsersExist([input.ownerUserId]);
        }
        await ensureMailboxUsersExist(memberUserIds);
        await ensureApiKeysExist(bindApiKeyIds);

        const passwordHash = input.password ? await hashPassword(input.password) : null;

        const created = await prisma.$transaction(async (tx) => {
            const createdMailboxes = await Promise.all(localParts.map((localPart) => tx.domainMailbox.create({
                data: {
                    domainId: domain.id,
                    localPart,
                    address: buildAddress(localPart, domain.name),
                    displayName: input.displayName?.trim() || null,
                    status: 'ACTIVE',
                    provisioningMode: input.provisioningMode,
                    batchTag,
                    canLogin: input.canLogin,
                    quotaMb: input.quotaMb ?? null,
                    passwordHash,
                    ownerUserId: input.ownerUserId ?? null,
                    forwardMode: forwardConfig.forwardMode,
                    forwardTo: forwardConfig.forwardTo,
                    metadata: buildMailboxMetadata(null, {
                        provisioningMode: input.provisioningMode,
                        batchTag,
                        bindApiKeyIds,
                    }),
                    memberships: memberUserIds.length > 0 ? {
                        create: memberUserIds.map((userId) => ({ userId, role: 'MEMBER' as const })),
                    } : undefined,
                },
                select: {
                    id: true,
                    domainId: true,
                    localPart: true,
                    address: true,
                    displayName: true,
                    status: true,
                    provisioningMode: true,
                    batchTag: true,
                    canLogin: true,
                    createdAt: true,
                },
            })));

            if (bindApiKeyIds.length > 0) {
                const apiKeys = await tx.apiKey.findMany({
                    where: { id: { in: bindApiKeyIds } },
                    select: { id: true, allowedDomainIds: true },
                });
                await Promise.all(apiKeys.map((apiKey) => tx.apiKey.update({
                    where: { id: apiKey.id },
                    data: {
                        allowedDomainIds: toNullableJsonIds(Array.from(new Set([...parseJsonIdList(apiKey.allowedDomainIds), domain.id]))),
                    },
                })));
            }

            return createdMailboxes;
        });

        return {
            success: true,
            createdCount: created.length,
            batchTag,
            provisioningMode: input.provisioningMode,
            domainId: domain.id,
            boundApiKeyIds: bindApiKeyIds,
            mailboxes: created,
        };
    },

    async update(id: number, input: UpdateDomainMailboxInput) {
        const mailbox = await prisma.domainMailbox.findUnique({
            where: { id },
            select: {
                id: true,
                forwardMode: true,
                forwardTo: true,
                metadata: true,
                provisioningMode: true,
                batchTag: true,
            },
        });

        if (!mailbox) {
            throw new AppError('DOMAIN_MAILBOX_NOT_FOUND', 'Domain mailbox not found', 404);
        }

        const forwardConfig = await ensureForwardConfig(
            input.forwardMode ?? mailbox.forwardMode,
            input.forwardTo === undefined ? mailbox.forwardTo : input.forwardTo,
        );
        const memberUserIds = input.memberUserIds === undefined ? undefined : normalizeDistinctIds(input.memberUserIds);
        const nextProvisioningMode = input.provisioningMode ?? mailbox.provisioningMode;
        const nextBatchTag = input.batchTag === undefined ? mailbox.batchTag : normalizeBatchTag(input.batchTag);

        if (input.ownerUserId !== undefined && input.ownerUserId !== null) {
            await ensureMailboxUsersExist([input.ownerUserId]);
        }
        if (memberUserIds) {
            await ensureMailboxUsersExist(memberUserIds);
        }

        return prisma.$transaction(async (tx) => {
            if (memberUserIds) {
                await tx.mailboxMembership.deleteMany({ where: { mailboxId: id } });
            }

            return tx.domainMailbox.update({
                where: { id },
                data: {
                    displayName: input.displayName === undefined ? undefined : (input.displayName?.trim() || null),
                    status: input.status,
                    canLogin: input.canLogin,
                    provisioningMode: input.provisioningMode,
                    batchTag: input.batchTag === undefined ? undefined : nextBatchTag,
                    quotaMb: input.quotaMb === undefined ? undefined : input.quotaMb,
                    passwordHash: input.password === undefined ? undefined : (input.password ? await hashPassword(input.password) : null),
                    ownerUserId: input.ownerUserId === undefined ? undefined : input.ownerUserId,
                    forwardMode: forwardConfig.forwardMode,
                    forwardTo: forwardConfig.forwardTo,
                    metadata: (input.provisioningMode !== undefined || input.batchTag !== undefined)
                        ? buildMailboxMetadata((mailbox.metadata as Record<string, unknown> | null) || null, {
                            provisioningMode: nextProvisioningMode,
                            batchTag: nextBatchTag,
                        })
                        : undefined,
                    memberships: memberUserIds ? {
                        create: memberUserIds.map((userId) => ({ userId, role: 'MEMBER' as const })),
                    } : undefined,
                },
                select: {
                    id: true,
                    domainId: true,
                    localPart: true,
                    address: true,
                    displayName: true,
                    status: true,
                    provisioningMode: true,
                    batchTag: true,
                    quotaMb: true,
                    canLogin: true,
                    ownerUserId: true,
                    forwardMode: true,
                    forwardTo: true,
                    updatedAt: true,
                },
            });
        });
    },

    async batchDelete(input: BatchDeleteDomainMailboxInput) {
        const where = buildBatchDeleteWhere(input);
        const targets = await prisma.domainMailbox.findMany({
            where,
            select: {
                id: true,
                address: true,
                domainId: true,
                isCatchAllTarget: true,
            },
            orderBy: [{ domainId: 'asc' }, { id: 'asc' }],
        });

        if (targets.length === 0) {
            throw new AppError('DOMAIN_MAILBOX_NOT_FOUND', 'No domain mailboxes matched the selected batch delete scope', 404);
        }

        const mailboxIds = targets.map((item) => item.id);
        await prisma.$transaction(async (tx) => {
            await tx.domain.updateMany({
                where: { catchAllTargetMailboxId: { in: mailboxIds } },
                data: {
                    catchAllTargetMailboxId: null,
                    isCatchAllEnabled: false,
                },
            });

            await tx.domainMailbox.deleteMany({ where: { id: { in: mailboxIds } } });
        });

        return {
            success: true,
            deletedCount: targets.length,
            deletedIds: mailboxIds,
            deletedAddresses: targets.map((item) => item.address),
        };
    },

    async delete(id: number) {
        const mailbox = await prisma.domainMailbox.findUnique({
            where: { id },
            select: {
                id: true,
                domainId: true,
            },
        });
        if (!mailbox) {
            throw new AppError('DOMAIN_MAILBOX_NOT_FOUND', 'Domain mailbox not found', 404);
        }

        await prisma.domain.updateMany({
            where: { catchAllTargetMailboxId: id },
            data: {
                catchAllTargetMailboxId: null,
                isCatchAllEnabled: false,
            },
        });

        await prisma.domainMailbox.delete({ where: { id } });
        return { success: true };
    },
};
