import { randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { encrypt } from '../../lib/crypto.js';
import { AppError } from '../../plugins/error.js';
import { env } from '../../config/env.js';
import type {
    ConfigureCatchAllInput,
    ConfigureDomainVerificationInput,
    CreateMailboxAliasInput,
    CreateDomainInput,
    ListMailboxAliasInput,
    ListDomainInput,
    SaveDomainSendingConfigInput,
    UpdateMailboxAliasInput,
    UpdateDomainInput,
} from './domain.schema.js';

function normalizeDomainName(name: string): string {
    return name.trim().toLowerCase();
}

const SEND_ENABLED_DOMAIN_NAMES = new Set(
    (env.SEND_ENABLED_DOMAINS || '')
        .split(',')
        .map((name) => normalizeDomainName(name))
        .filter(Boolean)
);

function isSendEligibleDomain(name: string): boolean {
    return SEND_ENABLED_DOMAIN_NAMES.has(normalizeDomainName(name));
}

function ensureSendCapabilityAllowed(domainName: string, canSend: boolean): void {
    if (canSend && !isSendEligibleDomain(domainName)) {
        throw new AppError('DOMAIN_SEND_NOT_ALLOWED', `Domain ${domainName} is not listed in SEND_ENABLED_DOMAINS and cannot enable outbound sending`, 400);
    }
}

function buildDomainWhere(input: ListDomainInput): Prisma.DomainWhereInput {
    const where: Prisma.DomainWhereInput = {};
    if (input.status) {
        where.status = input.status;
    }
    if (input.keyword) {
        where.OR = [
            { name: { contains: input.keyword, mode: 'insensitive' } },
            { displayName: { contains: input.keyword, mode: 'insensitive' } },
        ];
    }
    return where;
}

function toDomainSummary(domain: {
    id: number;
    name: string;
    displayName: string | null;
    status: string;
    canReceive: boolean;
    canSend: boolean;
    isCatchAllEnabled: boolean;
    verificationToken: string | null;
    resendDomainId: string | null;
    createdAt: Date;
    updatedAt: Date;
    creator: { id: number; username: string };
    _count?: { mailboxes: number; inboundMessages: number; sendingConfigs: number };
}) {
    return {
        id: domain.id,
        name: domain.name,
        displayName: domain.displayName,
        status: domain.status,
        canReceive: domain.canReceive,
        canSend: domain.canSend,
        isCatchAllEnabled: domain.isCatchAllEnabled,
        verificationToken: domain.verificationToken,
        resendDomainId: domain.resendDomainId,
        mailboxCount: domain._count?.mailboxes ?? 0,
        inboundMessageCount: domain._count?.inboundMessages ?? 0,
        sendingConfigCount: domain._count?.sendingConfigs ?? 0,
        createdBy: domain.creator,
        createdAt: domain.createdAt,
        updatedAt: domain.updatedAt,
    };
}

function normalizeLocalPart(value: string): string {
    return value.trim().toLowerCase();
}

export const domainService = {
    async list(input: ListDomainInput) {
        const where = buildDomainWhere(input);
        const skip = (input.page - 1) * input.pageSize;
        const [list, total] = await Promise.all([
            prisma.domain.findMany({
                where,
                select: {
                    id: true,
                    name: true,
                    displayName: true,
                    status: true,
                    canReceive: true,
                    canSend: true,
                    isCatchAllEnabled: true,
                    verificationToken: true,
                    resendDomainId: true,
                    createdAt: true,
                    updatedAt: true,
                    creator: { select: { id: true, username: true } },
                    _count: { select: { mailboxes: true, inboundMessages: true, sendingConfigs: true } },
                },
                skip,
                take: input.pageSize,
                orderBy: [{ id: 'desc' }],
            }),
            prisma.domain.count({ where }),
        ]);

        return {
            list: list.map(toDomainSummary),
            total,
            page: input.page,
            pageSize: input.pageSize,
        };
    },

    async getById(id: number) {
        const domain = await prisma.domain.findUnique({
            where: { id },
            select: {
                id: true,
                name: true,
                displayName: true,
                status: true,
                provider: true,
                canReceive: true,
                canSend: true,
                isCatchAllEnabled: true,
                catchAllTargetMailboxId: true,
                verificationToken: true,
                dnsStatus: true,
                resendDomainId: true,
                createdAt: true,
                updatedAt: true,
                creator: { select: { id: true, username: true } },
                mailboxes: {
                    select: {
                        id: true,
                        address: true,
                        localPart: true,
                        status: true,
                        canLogin: true,
                        isCatchAllTarget: true,
                    },
                    orderBy: { id: 'asc' },
                },
                sendingConfigs: {
                    select: {
                        id: true,
                        provider: true,
                        fromNameDefault: true,
                        replyToDefault: true,
                        status: true,
                        createdAt: true,
                        updatedAt: true,
                    },
                    orderBy: { id: 'asc' },
                },
                _count: { select: { inboundMessages: true, outboundMessages: true } },
            },
        });

        if (!domain) {
            throw new AppError('DOMAIN_NOT_FOUND', 'Domain not found', 404);
        }

        return {
            ...domain,
            inboundMessageCount: domain._count.inboundMessages,
            outboundMessageCount: domain._count.outboundMessages,
        };
    },

    async create(input: CreateDomainInput, createdByAdminId: number) {
        const name = normalizeDomainName(input.name);
        ensureSendCapabilityAllowed(name, input.canSend);

        const existing = await prisma.domain.findUnique({ where: { name } });
        if (existing) {
            throw new AppError('DOMAIN_EXISTS', 'Domain already exists', 409);
        }

        const domain = await prisma.domain.create({
            data: {
                name,
                displayName: input.displayName?.trim() || null,
                canReceive: input.canReceive,
                canSend: input.canSend,
                isCatchAllEnabled: input.isCatchAllEnabled,
                verificationToken: randomBytes(12).toString('hex'),
                dnsStatus: {
                    provider: 'CLOUDFLARE',
                    expectedMxConfigured: false,
                    expectedIngressConfigured: false,
                },
                createdByAdminId,
            },
            select: {
                id: true,
                name: true,
                displayName: true,
                status: true,
                canReceive: true,
                canSend: true,
                isCatchAllEnabled: true,
                verificationToken: true,
                resendDomainId: true,
                createdAt: true,
                updatedAt: true,
                creator: { select: { id: true, username: true } },
                _count: { select: { mailboxes: true, inboundMessages: true, sendingConfigs: true } },
            },
        });

        return toDomainSummary(domain);
    },

    async update(id: number, input: UpdateDomainInput) {
        const existing = await prisma.domain.findUnique({ where: { id } });
        if (!existing) {
            throw new AppError('DOMAIN_NOT_FOUND', 'Domain not found', 404);
        }

        const nextCanSend = input.canSend ?? existing.canSend;
        ensureSendCapabilityAllowed(existing.name, nextCanSend);

        const domain = await prisma.domain.update({
            where: { id },
            data: {
                displayName: input.displayName === undefined ? undefined : (input.displayName?.trim() || null),
                status: input.status,
                canReceive: input.canReceive,
                canSend: input.canSend,
                isCatchAllEnabled: input.isCatchAllEnabled,
            },
            select: {
                id: true,
                name: true,
                displayName: true,
                status: true,
                canReceive: true,
                canSend: true,
                isCatchAllEnabled: true,
                verificationToken: true,
                resendDomainId: true,
                createdAt: true,
                updatedAt: true,
                creator: { select: { id: true, username: true } },
                _count: { select: { mailboxes: true, inboundMessages: true, sendingConfigs: true } },
            },
        });

        return toDomainSummary(domain);
    },

    async configureVerification(id: number, input: ConfigureDomainVerificationInput) {
        const existing = await prisma.domain.findUnique({ where: { id } });
        if (!existing) {
            throw new AppError('DOMAIN_NOT_FOUND', 'Domain not found', 404);
        }

        return prisma.domain.update({
            where: { id },
            data: {
                verificationToken: input.verificationToken?.trim() || randomBytes(12).toString('hex'),
            },
            select: {
                id: true,
                name: true,
                verificationToken: true,
                updatedAt: true,
            },
        });
    },

    async configureCatchAll(id: number, input: ConfigureCatchAllInput) {
        const domain = await prisma.domain.findUnique({
            where: { id },
            select: {
                id: true,
                catchAllTargetMailboxId: true,
            },
        });

        if (!domain) {
            throw new AppError('DOMAIN_NOT_FOUND', 'Domain not found', 404);
        }

        if (input.isCatchAllEnabled) {
            if (!input.catchAllTargetMailboxId) {
                throw new AppError('CATCH_ALL_TARGET_REQUIRED', 'Catch-all target mailbox is required when enabling catch-all', 400);
            }
            const mailbox = await prisma.domainMailbox.findUnique({
                where: { id: input.catchAllTargetMailboxId },
                select: { id: true, domainId: true, status: true },
            });
            if (!mailbox || mailbox.domainId !== id) {
                throw new AppError('DOMAIN_MAILBOX_NOT_FOUND', 'Catch-all target mailbox was not found in this domain', 404);
            }
            if (mailbox.status !== 'ACTIVE') {
                throw new AppError('DOMAIN_MAILBOX_DISABLED', 'Catch-all target mailbox must be active', 400);
            }
        }

        return prisma.domain.update({
            where: { id },
            data: {
                isCatchAllEnabled: input.isCatchAllEnabled,
                catchAllTargetMailboxId: input.isCatchAllEnabled ? (input.catchAllTargetMailboxId ?? null) : null,
            },
            select: {
                id: true,
                name: true,
                isCatchAllEnabled: true,
                catchAllTargetMailboxId: true,
                updatedAt: true,
            },
        });
    },

    async saveSendingConfig(id: number, input: SaveDomainSendingConfigInput) {
        const domain = await prisma.domain.findUnique({
            where: { id },
            select: {
                id: true,
                name: true,
                canSend: true,
                sendingConfigs: {
                    select: {
                        id: true,
                    },
                    where: { provider: input.provider },
                    take: 1,
                },
            },
        });

        if (!domain) {
            throw new AppError('DOMAIN_NOT_FOUND', 'Domain not found', 404);
        }
        if (!domain.canSend) {
            throw new AppError('DOMAIN_SEND_DISABLED', 'This domain is receive-only and cannot be configured for outbound sending', 400);
        }
        ensureSendCapabilityAllowed(domain.name, true);

        const existingConfig = domain.sendingConfigs[0];
        if (!existingConfig && !input.apiKey) {
            throw new AppError('SEND_API_KEY_REQUIRED', 'An API key is required when creating a sending configuration', 400);
        }
        const createApiKey = input.apiKey;

        const select = {
            id: true,
            provider: true,
            fromNameDefault: true,
            replyToDefault: true,
            status: true,
            createdAt: true,
            updatedAt: true,
        } satisfies Prisma.DomainSendingConfigSelect;
        type DomainSendingConfigSummary = Prisma.DomainSendingConfigGetPayload<{ select: typeof select }>;

        let result: DomainSendingConfigSummary;
        if (existingConfig) {
            result = await prisma.domainSendingConfig.update({
                where: { id: existingConfig.id },
                data: {
                    apiKeyEncrypted: input.apiKey ? encrypt(input.apiKey) : undefined,
                    fromNameDefault: input.fromNameDefault === undefined ? undefined : (input.fromNameDefault?.trim() || null),
                    replyToDefault: input.replyToDefault === undefined ? undefined : (input.replyToDefault?.trim() || null),
                    status: 'ACTIVE',
                },
                select,
            });
        } else {
            if (!createApiKey) {
                throw new AppError('SEND_API_KEY_REQUIRED', 'An API key is required when creating a sending configuration', 400);
            }
            result = await prisma.domainSendingConfig.create({
                data: {
                    domainId: id,
                    provider: input.provider,
                    apiKeyEncrypted: encrypt(createApiKey),
                    fromNameDefault: input.fromNameDefault?.trim() || null,
                    replyToDefault: input.replyToDefault?.trim() || null,
                    status: 'ACTIVE',
                },
                select,
            });
        }

        return result;
    },

    async listAliases(id: number, input: ListMailboxAliasInput) {
        const domain = await prisma.domain.findUnique({ where: { id }, select: { id: true } });
        if (!domain) {
            throw new AppError('DOMAIN_NOT_FOUND', 'Domain not found', 404);
        }

        return prisma.mailboxAlias.findMany({
            where: {
                domainId: id,
                ...(input.mailboxId ? { mailboxId: input.mailboxId } : {}),
            },
            select: {
                id: true,
                mailboxId: true,
                aliasLocalPart: true,
                aliasAddress: true,
                status: true,
                createdAt: true,
                updatedAt: true,
                mailbox: {
                    select: {
                        id: true,
                        address: true,
                        status: true,
                    },
                },
            },
            orderBy: [{ id: 'asc' }],
        });
    },

    async createAlias(id: number, input: CreateMailboxAliasInput) {
        const domain = await prisma.domain.findUnique({
            where: { id },
            select: { id: true, name: true },
        });
        if (!domain) {
            throw new AppError('DOMAIN_NOT_FOUND', 'Domain not found', 404);
        }

        const mailbox = await prisma.domainMailbox.findUnique({
            where: { id: input.mailboxId },
            select: { id: true, domainId: true, status: true },
        });
        if (!mailbox || mailbox.domainId !== id) {
            throw new AppError('DOMAIN_MAILBOX_NOT_FOUND', 'Mailbox was not found in this domain', 404);
        }

        const aliasLocalPart = normalizeLocalPart(input.aliasLocalPart);
        const aliasAddress = `${aliasLocalPart}@${domain.name}`;
        const existing = await prisma.mailboxAlias.findUnique({ where: { aliasAddress } });
        if (existing) {
            throw new AppError('MAILBOX_ALIAS_EXISTS', 'Alias already exists', 409);
        }

        return prisma.mailboxAlias.create({
            data: {
                mailboxId: input.mailboxId,
                domainId: id,
                aliasLocalPart,
                aliasAddress,
            },
            select: {
                id: true,
                mailboxId: true,
                aliasLocalPart: true,
                aliasAddress: true,
                status: true,
                createdAt: true,
                updatedAt: true,
            },
        });
    },

    async updateAlias(id: number, aliasId: number, input: UpdateMailboxAliasInput) {
        const alias = await prisma.mailboxAlias.findUnique({
            where: { id: aliasId },
            select: { id: true, domainId: true },
        });
        if (!alias || alias.domainId !== id) {
            throw new AppError('MAILBOX_ALIAS_NOT_FOUND', 'Alias not found', 404);
        }

        return prisma.mailboxAlias.update({
            where: { id: aliasId },
            data: {
                status: input.status,
            },
            select: {
                id: true,
                mailboxId: true,
                aliasLocalPart: true,
                aliasAddress: true,
                status: true,
                updatedAt: true,
            },
        });
    },

    async deleteAlias(id: number, aliasId: number) {
        const alias = await prisma.mailboxAlias.findUnique({
            where: { id: aliasId },
            select: { id: true, domainId: true },
        });
        if (!alias || alias.domainId !== id) {
            throw new AppError('MAILBOX_ALIAS_NOT_FOUND', 'Alias not found', 404);
        }

        await prisma.mailboxAlias.delete({ where: { id: aliasId } });
        return { success: true };
    },

    async delete(id: number) {
        const domain = await prisma.domain.findUnique({
            where: { id },
            select: {
                id: true,
                _count: {
                    select: {
                        mailboxes: true,
                        inboundMessages: true,
                        outboundMessages: true,
                    },
                },
            },
        });

        if (!domain) {
            throw new AppError('DOMAIN_NOT_FOUND', 'Domain not found', 404);
        }
        if (domain._count.mailboxes > 0 || domain._count.inboundMessages > 0 || domain._count.outboundMessages > 0) {
            throw new AppError('DOMAIN_NOT_EMPTY', 'Cannot delete a domain that still has mailboxes or message history', 400);
        }

        await prisma.domain.delete({ where: { id } });
        return { success: true };
    },
};
