import prisma from '../../lib/prisma.js';
import { AppError } from '../../plugins/error.js';
import type { DeleteDomainMessageInput, ListDomainMessageInput } from './message.schema.js';

function parseInboundMessageIds(ids: DeleteDomainMessageInput['ids']): bigint[] {
    return Array.from(new Set(ids.map((id) => {
        try {
            return BigInt(id);
        } catch {
            throw new AppError('INBOUND_MESSAGE_INVALID_ID', 'Inbound message id is invalid', 400);
        }
    })));
}

export const messageService = {
    async list(input: ListDomainMessageInput) {
        const skip = (input.page - 1) * input.pageSize;
        const where = {
            ...(input.domainId ? { domainId: input.domainId } : {}),
            ...(input.mailboxId ? { mailboxId: input.mailboxId } : {}),
            ...(input.unreadOnly ? { isRead: false } : {}),
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
                    domain: { select: { id: true, name: true } },
                    mailbox: { select: { id: true, address: true } },
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
            })),
            total,
            page: input.page,
            pageSize: input.pageSize,
        };
    },

    async getById(id: string) {
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
                createdAt: true,
                updatedAt: true,
                domain: { select: { id: true, name: true } },
                mailbox: { select: { id: true, address: true } },
            },
        });

        if (!message) {
            throw new AppError('INBOUND_MESSAGE_NOT_FOUND', 'Inbound message not found', 404);
        }

        return {
            ...message,
            id: message.id.toString(),
        };
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
