import type { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { AppError } from '../../plugins/error.js';
import { getHostedInternalProtocolSummary } from '../mail/hostedInternal.contract.js';
import type { DeleteDomainMessageInput, ListDomainMessageInput } from './message.schema.js';

interface MessageVisibilityOptions {
    portalVisibleOnly?: boolean;
}

function parseInboundMessageIds(ids: DeleteDomainMessageInput['ids']): bigint[] {
    return Array.from(new Set(ids.map((id) => {
        try {
            return BigInt(id);
        } catch {
            throw new AppError('INBOUND_MESSAGE_INVALID_ID', 'Inbound message id is invalid', 400);
        }
    })));
}

function enrichInboundMailbox<T extends {
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

export const messageService = {
    async list(input: ListDomainMessageInput, options?: MessageVisibilityOptions) {
        const allowedMailboxIds = input.allowedMailboxIds
            ? Array.from(new Set(input.allowedMailboxIds.filter((id) => Number.isInteger(id) && id > 0)))
            : undefined;

        if (allowedMailboxIds && input.mailboxId && !allowedMailboxIds.includes(input.mailboxId)) {
            return {
                list: [],
                total: 0,
                page: input.page,
                pageSize: input.pageSize,
            };
        }

        const skip = (input.page - 1) * input.pageSize;
        const where: Prisma.InboundMessageWhereInput = {
            ...(input.domainId ? { domainId: input.domainId } : {}),
            ...(input.mailboxId
                ? { mailboxId: input.mailboxId }
                : allowedMailboxIds
                    ? { mailboxId: { in: allowedMailboxIds } }
                    : {}),
            ...(input.unreadOnly ? { isRead: false } : {}),
            ...(options?.portalVisibleOnly ? { portalState: 'VISIBLE' } : {}),
            isDeleted: false,
        };
        const [list, total] = await Promise.all([
            prisma.inboundMessage.findMany({
                where,
                select: {
                    id: true,
                    matchedAddress: true,
                    finalAddress: true,
                    fromAddress: true,
                    toAddress: true,
                    subject: true,
                    textPreview: true,
                    htmlPreview: true,
                    verificationCode: true,
                    routeKind: true,
                    receivedAt: true,
                    storageStatus: true,
                    isRead: true,
                    domain: { select: { id: true, name: true, canSend: true, canReceive: true } },
                    mailbox: { select: { id: true, address: true, provisioningMode: true } },
                },
                skip,
                take: input.pageSize,
                orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
            }),
            prisma.inboundMessage.count({ where }),
        ]);

        return {
            list: list.map((item) => ({
                ...item,
                id: item.id.toString(),
                mailbox: enrichInboundMailbox(item.mailbox, item.domain),
            })),
            total,
            page: input.page,
            pageSize: input.pageSize,
        };
    },

    async getById(id: string, options?: MessageVisibilityOptions) {
        let messageId: bigint;
        try {
            messageId = BigInt(id);
        } catch {
            throw new AppError('INBOUND_MESSAGE_INVALID_ID', 'Inbound message id is invalid', 400);
        }
        const message = await prisma.inboundMessage.findUnique({
            where: { id: messageId },
            select: {
                id: true,
                domainId: true,
                mailboxId: true,
                matchedAddress: true,
                finalAddress: true,
                messageIdHeader: true,
                fromAddress: true,
                toAddress: true,
                subject: true,
                textPreview: true,
                htmlPreview: true,
                verificationCode: true,
                routeKind: true,
                receivedAt: true,
                storageStatus: true,
                rawObjectKey: true,
                attachmentsMeta: true,
                headersJson: true,
                isRead: true,
                isDeleted: true,
                portalState: true,
                createdAt: true,
                updatedAt: true,
                domain: { select: { id: true, name: true, canSend: true, canReceive: true } },
                mailbox: { select: { id: true, address: true, provisioningMode: true } },
            },
        });

        if (!message || (options?.portalVisibleOnly && message.portalState === 'FORWARDED_HIDDEN')) {
            throw new AppError('INBOUND_MESSAGE_NOT_FOUND', 'Inbound message not found', 404);
        }

        return {
            ...message,
            id: message.id.toString(),
            mailbox: enrichInboundMailbox(message.mailbox, message.domain),
        };
    },

    async markRead(id: string, allowedMailboxIds?: number[]) {
        let messageId: bigint;
        try {
            messageId = BigInt(id);
        } catch {
            throw new AppError('INBOUND_MESSAGE_INVALID_ID', 'Inbound message id is invalid', 400);
        }

        const normalizedMailboxIds = allowedMailboxIds
            ? Array.from(new Set(allowedMailboxIds.filter((value) => Number.isInteger(value) && value > 0)))
            : undefined;

        const result = await prisma.inboundMessage.updateMany({
            where: {
                id: messageId,
                isDeleted: false,
                ...(normalizedMailboxIds ? { mailboxId: { in: normalizedMailboxIds } } : {}),
            },
            data: {
                isRead: true,
            },
        });

        return { updated: result.count > 0 };
    },

    async deleteByIds(input: DeleteDomainMessageInput) {
        const ids = parseInboundMessageIds(input.ids);
        const result = await prisma.inboundMessage.updateMany({
            where: {
                id: { in: ids },
                isDeleted: false,
            },
            data: {
                isDeleted: true,
            },
        });

        return {
            deleted: result.count,
            ids: ids.map((id) => id.toString()),
        };
    },
};
