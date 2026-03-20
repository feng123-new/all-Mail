import type { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { AppError } from '../../plugins/error.js';
import type { IngressReceiveInput } from './ingress.schema.js';

function normalizeEmailAddress(value: string): string {
    return value.trim().toLowerCase();
}

function normalizeDomainName(value: string): string {
    return value.trim().toLowerCase();
}

export function extractVerificationCode(text?: string | null, html?: string | null): string | null {
    const source = `${text || ''}\n${html || ''}`;
    const match = source.match(/\b\d{4,8}\b/);
    return match?.[0] || null;
}

async function resolveTargetMailbox(domainId: number, matchedAddress: string) {
    const exactMailbox = await prisma.domainMailbox.findUnique({
        where: { address: matchedAddress },
        select: { id: true, domainId: true, address: true, status: true },
    });
    if (exactMailbox && exactMailbox.domainId === domainId) {
        return { routeKind: 'EXACT_MAILBOX', mailbox: exactMailbox } as const;
    }

    const alias = await prisma.mailboxAlias.findUnique({
        where: { aliasAddress: matchedAddress },
        select: {
            id: true,
            mailbox: {
                select: { id: true, domainId: true, address: true, status: true },
            },
        },
    });
    if (alias && alias.mailbox.domainId === domainId) {
        return { routeKind: 'ALIAS', mailbox: alias.mailbox } as const;
    }

    const domain = await prisma.domain.findUnique({
        where: { id: domainId },
        select: {
            isCatchAllEnabled: true,
            catchAllTargetMailboxId: true,
        },
    });

    if (domain?.isCatchAllEnabled && domain.catchAllTargetMailboxId) {
        const catchAllMailbox = await prisma.domainMailbox.findUnique({
            where: { id: domain.catchAllTargetMailboxId },
            select: { id: true, domainId: true, address: true, status: true },
        });
        if (catchAllMailbox && catchAllMailbox.domainId === domainId) {
            return { routeKind: 'CATCH_ALL', mailbox: catchAllMailbox } as const;
        }
    }

    return null;
}

export const ingressService = {
    async receive(input: IngressReceiveInput, endpoint: { id: number; domainId?: number | null; keyId: string; name: string }) {
        const domainName = normalizeDomainName(input.routing.domain);
        const matchedAddress = normalizeEmailAddress(input.routing.matchedAddress);
        const envelopeTo = normalizeEmailAddress(input.envelope.to);
        const envelopeFrom = normalizeEmailAddress(input.envelope.from);

        const domain = await prisma.domain.findUnique({
            where: { name: domainName },
            select: {
                id: true,
                name: true,
                status: true,
                canReceive: true,
            },
        });
        if (!domain) {
            throw new AppError('DOMAIN_NOT_FOUND', 'Ingress domain is not managed by this system', 404);
        }
        if (endpoint.domainId && endpoint.domainId !== domain.id) {
            throw new AppError('INGRESS_ENDPOINT_DOMAIN_MISMATCH', 'Ingress endpoint is not authorized for this domain', 403);
        }
        if (domain.status !== 'ACTIVE') {
            throw new AppError('DOMAIN_DISABLED', 'Domain is not active', 403);
        }
        if (!domain.canReceive) {
            throw new AppError('DOMAIN_RECEIVE_DISABLED', 'Domain cannot receive mail', 403);
        }

        const target = await resolveTargetMailbox(domain.id, matchedAddress);
        if (!target) {
            throw new AppError('DOMAIN_MAILBOX_NOT_FOUND', 'No mailbox, alias, or catch-all target matched this address', 404);
        }
        if (target.mailbox.status !== 'ACTIVE') {
            throw new AppError('DOMAIN_MAILBOX_DISABLED', 'Target mailbox is not active', 403);
        }

        const verificationCode = extractVerificationCode(input.message.textPreview, input.message.htmlPreview);
        const messageIdHeader = input.message.messageId?.trim() || null;
        if (messageIdHeader) {
            const existing = await prisma.inboundMessage.findFirst({
                where: {
                    domainId: domain.id,
                    finalAddress: target.mailbox.address,
                    messageIdHeader,
                },
                select: {
                    id: true,
                },
            });
            if (existing) {
                return {
                    accepted: true,
                    duplicate: true,
                    route: target.routeKind,
                    domainId: domain.id,
                    mailboxId: target.mailbox.id,
                    messageId: existing.id.toString(),
                };
            }
        }

        const message = await prisma.inboundMessage.create({
            data: {
                domainId: domain.id,
                mailboxId: target.mailbox.id,
                matchedAddress,
                finalAddress: target.mailbox.address,
                messageIdHeader,
                fromAddress: envelopeFrom,
                toAddress: envelopeTo,
                subject: input.message.subject?.trim() || null,
                textPreview: input.message.textPreview?.trim() || null,
                htmlPreview: input.message.htmlPreview?.trim() || null,
                verificationCode,
                routeKind: target.routeKind,
                receivedAt: new Date(input.receivedAt),
                storageStatus: input.message.rawObjectKey ? 'STORED' : 'PENDING',
                rawObjectKey: input.message.rawObjectKey?.trim() || null,
                attachmentsMeta: (input.message.attachments || []) as unknown as Prisma.InputJsonValue,
                headersJson: (input.message.headers || {}) as Prisma.InputJsonValue,
            },
            select: {
                id: true,
            },
        });

        return {
            accepted: true,
            duplicate: false,
            route: target.routeKind,
            domainId: domain.id,
            mailboxId: target.mailbox.id,
            messageId: message.id.toString(),
        };
    },
};
