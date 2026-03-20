import prisma from '../../lib/prisma.js';
import { decrypt } from '../../lib/crypto.js';
import { AppError } from '../../plugins/error.js';
import { sendWithResend } from './providers/resend.js';
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

export const sendService = {
    async listConfigs(input: ListSendConfigInput) {
        const list = await prisma.domainSendingConfig.findMany({
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
            prisma.outboundMessage.findMany({
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
                    createdAt: true,
                    updatedAt: true,
                    domain: { select: { id: true, name: true } },
                    mailbox: { select: { id: true, address: true } },
                },
                skip,
                take: input.pageSize,
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            }),
            prisma.outboundMessage.count({ where }),
        ]);

        return {
            list: list.map((item) => ({
                ...item,
                id: item.id.toString(),
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

        const message = await prisma.outboundMessage.findUnique({
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
                scheduledAt: true,
                createdAt: true,
                updatedAt: true,
                domain: { select: { id: true, name: true } },
                mailbox: { select: { id: true, address: true } },
            },
        });

        if (!message) {
            throw new AppError('OUTBOUND_MESSAGE_NOT_FOUND', 'Outbound message not found', 404);
        }

        return {
            ...message,
            id: message.id.toString(),
        };
    },

    async deleteConfig(id: number) {
        const existing = await prisma.domainSendingConfig.findUnique({
            where: { id },
            select: { id: true },
        });

        if (!existing) {
            throw new AppError('SEND_CONFIG_NOT_FOUND', 'Sending configuration not found', 404);
        }

        await prisma.domainSendingConfig.delete({ where: { id } });
        return { deleted: true, id };
    },

    async deleteMessages(input: DeleteOutboundMessageInput) {
        const ids = parseOutboundMessageIds(input.ids);
        const result = await prisma.outboundMessage.deleteMany({
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
        const domain = await prisma.domain.findUnique({
            where: { id: input.domainId },
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

        const fromDomain = input.from.split('@')[1]?.toLowerCase();
        if (fromDomain !== domain.name.toLowerCase()) {
            throw new AppError('SEND_DOMAIN_MISMATCH', 'The from address does not belong to the selected domain', 400);
        }

        let mailbox: { id: number; domainId: number; address: string; status: string } | null = null;
        if (input.mailboxId) {
            mailbox = await prisma.domainMailbox.findUnique({
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

        const config = domain.sendingConfigs[0];
        if (!config) {
            throw new AppError('SEND_CONFIG_NOT_FOUND', 'No active sending configuration is available for this domain', 404);
        }

        const outbound = await prisma.outboundMessage.create({
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
            const result = await sendWithResend({
                apiKey: decrypt(config.apiKeyEncrypted),
                from: config.fromNameDefault ? `${config.fromNameDefault} <${input.from}>` : input.from,
                to: input.to,
                subject: input.subject,
                html: input.html,
                text: input.text,
                replyTo: config.replyToDefault,
            });

            const updated = await prisma.outboundMessage.update({
                where: { id: outbound.id },
                data: {
                    providerMessageId: result.id,
                    status: 'SENT',
                },
                select: {
                    id: true,
                    providerMessageId: true,
                    status: true,
                    createdAt: true,
                    updatedAt: true,
                },
            });

            return {
                ...updated,
                id: updated.id.toString(),
            };
        } catch (error) {
            await prisma.outboundMessage.update({
                where: { id: outbound.id },
                data: {
                    status: 'FAILED',
                },
            });

            throw new AppError('SEND_FAILED', (error as Error).message || 'Failed to send outbound mail', 502);
        }
    },
};
