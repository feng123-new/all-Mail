import prisma from '../../lib/prisma.js';
import { decrypt } from '../../lib/crypto.js';
import { AppError } from '../../plugins/error.js';
import { sendWithResend } from './providers/resend.js';
import { getHostedInternalProtocolSummary } from '../mail/hostedInternal.contract.js';
import type { DeleteOutboundMessageInput, ListOutboundMessageInput, ListSendConfigInput, SendMessageInput } from './send.schema.js';

function parseOutboundMessageIds(ids: DeleteOutboundMessageInput['ids']): bigint[] {
    return Array.from(new Set(ids.map((id) => {
        try {
            return BigInt(id);
        } catch {
            throw new AppError('OUTBOUND_MESSAGE_INVALID_ID', 'Outbound message id is invalid', 400);
        }
    })));
}

function getSendErrorMessage(error: unknown): string {
    if (error instanceof AppError) {
        return error.message;
    }
    if (error instanceof Error && error.message.trim()) {
        return error.message.trim();
    }
    return 'Failed to send outbound mail';
}

function enrichOutboundMailbox<T extends {
    provisioningMode: 'MANUAL' | 'API_POOL';
    address: string;
}>(
    mailbox: T | null,
    domain: { canSend?: boolean | null; canReceive?: boolean | null } | null | undefined
) {
    if (!mailbox) {
        return mailbox;
    }

    return {
        ...mailbox,
        ...getHostedInternalProtocolSummary({
            provisioningMode: mailbox.provisioningMode,
            canSend: Boolean(domain?.canSend),
            canReceive: domain?.canReceive !== false,
        }),
    };
}

export interface ActiveDomainResendConfig {
    domain: {
        id: number;
        name: string;
    };
    apiKey: string;
    fromNameDefault: string | null;
    replyToDefault: string | null;
}

interface SendServiceDeps {
    prisma: typeof prisma;
    decrypt: typeof decrypt;
    sendWithResend: typeof sendWithResend;
}

const defaultSendServiceDeps: SendServiceDeps = {
    prisma,
    decrypt,
    sendWithResend,
};

export function formatResendFromAddress(fromAddress: string, fromNameDefault?: string | null): string {
    return fromNameDefault ? `${fromNameDefault} <${fromAddress}>` : fromAddress;
}

export async function getActiveDomainResendConfig(domainId: number, deps: SendServiceDeps = defaultSendServiceDeps): Promise<ActiveDomainResendConfig> {
    const domain = await deps.prisma.domain.findUnique({
        where: { id: domainId },
        select: {
            id: true,
            name: true,
            canSend: true,
            status: true,
            sendingConfigs: {
                where: { provider: 'RESEND', status: 'ACTIVE' },
                select: {
                    id: true,
                    apiKeyEncrypted: true,
                    fromNameDefault: true,
                    replyToDefault: true,
                },
                take: 1,
            },
        },
    });

    if (!domain) {
        throw new AppError('DOMAIN_NOT_FOUND', 'Domain not found', 404);
    }
    if (domain.status !== 'ACTIVE') {
        throw new AppError('DOMAIN_DISABLED', 'Domain is not active', 403);
    }
    if (!domain.canSend) {
        throw new AppError('DOMAIN_SEND_DISABLED', 'This domain is receive-only and cannot send mail', 400);
    }

    const config = domain.sendingConfigs[0];
    if (!config) {
        throw new AppError('SEND_CONFIG_NOT_FOUND', 'No active sending configuration is available for this domain', 404);
    }

    return {
        domain: {
            id: domain.id,
            name: domain.name,
        },
        apiKey: deps.decrypt(config.apiKeyEncrypted),
        fromNameDefault: config.fromNameDefault,
        replyToDefault: config.replyToDefault,
    };
}

export function createSendService(deps: SendServiceDeps = defaultSendServiceDeps) {
return {
    async listConfigs(input: ListSendConfigInput) {
        const list = await deps.prisma.domainSendingConfig.findMany({
            where: {
                ...(input.domainId ? { domainId: input.domainId } : {}),
            },
            select: {
                id: true,
                domainId: true,
                provider: true,
                fromNameDefault: true,
                replyToDefault: true,
                status: true,
                createdAt: true,
                updatedAt: true,
                domain: {
                    select: {
                        id: true,
                        name: true,
                        canSend: true,
                    },
                },
            },
            orderBy: [{ id: 'asc' }],
        });

        return {
            list,
            filters: input,
        };
    },

    async listMessages(input: ListOutboundMessageInput) {
        const skip = (input.page - 1) * input.pageSize;
        const where = {
            ...(input.domainId ? { domainId: input.domainId } : {}),
            ...(input.mailboxId ? { mailboxId: input.mailboxId } : {}),
        };
        const [list, total] = await Promise.all([
            deps.prisma.outboundMessage.findMany({
                where,
                select: {
                    id: true,
                    domainId: true,
                    mailboxId: true,
                    providerMessageId: true,
                    fromAddress: true,
                toAddresses: true,
                subject: true,
                status: true,
                lastError: true,
                createdAt: true,
                updatedAt: true,
                domain: { select: { id: true, name: true, canSend: true, canReceive: true } },
                    mailbox: { select: { id: true, address: true, provisioningMode: true } },
                },
                skip,
                take: input.pageSize,
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            }),
            deps.prisma.outboundMessage.count({ where }),
        ]);

        return {
            list: list.map((item) => ({
                ...item,
                id: item.id.toString(),
                mailbox: enrichOutboundMailbox(item.mailbox, item.domain),
            })),
            total,
            page: input.page,
            pageSize: input.pageSize,
        };
    },

    async getMessageById(id: string) {
        let messageId: bigint;
        try {
            messageId = BigInt(id);
        } catch {
            throw new AppError('OUTBOUND_MESSAGE_INVALID_ID', 'Outbound message id is invalid', 400);
        }

        const message = await deps.prisma.outboundMessage.findUnique({
            where: { id: messageId },
            select: {
                id: true,
                domainId: true,
                mailboxId: true,
                providerMessageId: true,
                fromAddress: true,
                toAddresses: true,
                subject: true,
                htmlBody: true,
                textBody: true,
                status: true,
                lastError: true,
                createdAt: true,
                updatedAt: true,
                domain: { select: { id: true, name: true, canSend: true, canReceive: true } },
                mailbox: { select: { id: true, address: true, provisioningMode: true } },
            },
        });

        if (!message) {
            throw new AppError('OUTBOUND_MESSAGE_NOT_FOUND', 'Outbound message not found', 404);
        }

        return {
            ...message,
            id: message.id.toString(),
            mailbox: enrichOutboundMailbox(message.mailbox, message.domain),
        };
    },

    async deleteConfig(id: number) {
        const existing = await deps.prisma.domainSendingConfig.findUnique({
            where: { id },
            select: { id: true },
        });

        if (!existing) {
            throw new AppError('SEND_CONFIG_NOT_FOUND', 'Sending configuration not found', 404);
        }

        await deps.prisma.domainSendingConfig.delete({ where: { id } });
        return { deleted: true, id };
    },

    async deleteMessages(input: DeleteOutboundMessageInput) {
        const ids = parseOutboundMessageIds(input.ids);
        const result = await deps.prisma.outboundMessage.deleteMany({
            where: {
                id: { in: ids },
            },
        });

        return {
            deleted: result.count,
            ids: ids.map((id) => id.toString()),
        };
    },

    async send(input: SendMessageInput) {
        const domainConfig = await getActiveDomainResendConfig(input.domainId, deps);

        const fromDomain = input.from.split('@')[1]?.toLowerCase();
        if (fromDomain !== domainConfig.domain.name.toLowerCase()) {
            throw new AppError('SEND_DOMAIN_MISMATCH', 'The from address does not belong to the selected domain', 400);
        }

        let mailbox: { id: number; domainId: number; address: string; status: string } | null = null;
        if (input.mailboxId) {
            mailbox = await deps.prisma.domainMailbox.findUnique({
                where: { id: input.mailboxId },
                select: { id: true, domainId: true, address: true, status: true },
            });
            if (!mailbox || mailbox.domainId !== input.domainId) {
                throw new AppError('DOMAIN_MAILBOX_NOT_FOUND', 'Mailbox was not found in this domain', 404);
            }
            if (mailbox.status !== 'ACTIVE') {
                throw new AppError('DOMAIN_MAILBOX_DISABLED', 'Mailbox is not active', 403);
            }
        }

        const outbound = await deps.prisma.outboundMessage.create({
            data: {
                domainId: input.domainId,
                mailboxId: input.mailboxId ?? null,
                fromAddress: input.from,
                toAddresses: input.to,
                subject: input.subject,
                htmlBody: input.html || null,
                textBody: input.text || null,
                status: 'PENDING',
            },
            select: { id: true },
        });

        try {
            const result = await deps.sendWithResend({
                apiKey: domainConfig.apiKey,
                from: formatResendFromAddress(input.from, domainConfig.fromNameDefault),
                to: input.to,
                subject: input.subject,
                html: input.html,
                text: input.text,
                replyTo: domainConfig.replyToDefault,
            });

            const updated = await deps.prisma.outboundMessage.update({
                where: { id: outbound.id },
                data: {
                    providerMessageId: result.id,
                    status: 'SENT',
                    lastError: null,
                },
                select: {
                    id: true,
                    providerMessageId: true,
                    status: true,
                    lastError: true,
                    createdAt: true,
                    updatedAt: true,
                },
            });

            return {
                ...updated,
                id: updated.id.toString(),
            };
        } catch (error) {
            const lastError = getSendErrorMessage(error);
            await deps.prisma.outboundMessage.update({
                where: { id: outbound.id },
                data: {
                    status: 'FAILED',
                    lastError,
                },
            });

            throw new AppError('SEND_FAILED', lastError, 502);
        }
    },
};
}

export const sendService = createSendService();
