import type { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { AppError } from '../../plugins/error.js';
import type { ListForwardingJobInput } from './forwardingJob.schema.js';

const LAST_ERROR_PREVIEW_LIMIT = 160;

const domainSummarySelect = {
    id: true,
    name: true,
    canSend: true,
    canReceive: true,
} satisfies Prisma.DomainSelect;

const inboundSummarySelect = {
    id: true,
    domainId: true,
    fromAddress: true,
    subject: true,
    matchedAddress: true,
    finalAddress: true,
    routeKind: true,
    receivedAt: true,
    portalState: true,
    domain: { select: domainSummarySelect },
} satisfies Prisma.InboundMessageSelect;

const forwardingJobListSelect = {
    id: true,
    inboundMessageId: true,
    mailboxId: true,
    mode: true,
    forwardTo: true,
    status: true,
    attemptCount: true,
    lastError: true,
    providerMessageId: true,
    nextAttemptAt: true,
    processedAt: true,
    createdAt: true,
    updatedAt: true,
    mailbox: {
        select: {
            id: true,
            address: true,
            provisioningMode: true,
        },
    },
    inboundMessage: { select: inboundSummarySelect },
} satisfies Prisma.MailboxForwardJobSelect;

const forwardingJobDetailSelect = {
    id: true,
    inboundMessageId: true,
    mailboxId: true,
    mode: true,
    forwardTo: true,
    status: true,
    attemptCount: true,
    lastError: true,
    providerMessageId: true,
    nextAttemptAt: true,
    processedAt: true,
    createdAt: true,
    updatedAt: true,
    mailbox: {
        select: {
            id: true,
            address: true,
            provisioningMode: true,
            forwardMode: true,
            forwardTo: true,
        },
    },
    inboundMessage: {
        select: {
            ...inboundSummarySelect,
            textPreview: true,
            htmlPreview: true,
        },
    },
} satisfies Prisma.MailboxForwardJobSelect;

type ForwardingJobListRecord = Prisma.MailboxForwardJobGetPayload<{ select: typeof forwardingJobListSelect }>;
type ForwardingJobDetailRecord = Prisma.MailboxForwardJobGetPayload<{ select: typeof forwardingJobDetailSelect }>;

function parseForwardingJobId(id: string): bigint {
    try {
        return BigInt(id);
    } catch {
        throw new AppError('FORWARDING_JOB_INVALID_ID', 'Forwarding job id is invalid', 400);
    }
}

function truncateLastError(value: string | null): string | null {
    if (!value || value.length <= LAST_ERROR_PREVIEW_LIMIT) {
        return value;
    }

    return `${value.slice(0, LAST_ERROR_PREVIEW_LIMIT - 1)}…`;
}

function buildKeywordWhere(keyword: string): Prisma.MailboxForwardJobWhereInput {
    const contains = { contains: keyword, mode: 'insensitive' as const };

    return {
        OR: [
            { forwardTo: contains },
            { inboundMessage: { is: { fromAddress: contains } } },
            { inboundMessage: { is: { subject: contains } } },
            { inboundMessage: { is: { matchedAddress: contains } } },
            { inboundMessage: { is: { finalAddress: contains } } },
        ],
    };
}

function buildListWhere(input: ListForwardingJobInput): Prisma.MailboxForwardJobWhereInput {
    return {
        ...(input.status ? { status: input.status } : {}),
        ...(input.mode ? { mode: input.mode } : {}),
        ...(input.mailboxId ? { mailboxId: input.mailboxId } : {}),
        ...(input.domainId ? { inboundMessage: { is: { domainId: input.domainId } } } : {}),
        ...(input.keyword ? buildKeywordWhere(input.keyword) : {}),
    };
}

function mapDomainSummary(domain: ForwardingJobListRecord['inboundMessage']['domain']) {
    return {
        id: domain.id,
        name: domain.name,
        canSend: domain.canSend,
        canReceive: domain.canReceive,
    };
}

function mapMailboxSummary(mailbox: ForwardingJobListRecord['mailbox']) {
    if (!mailbox) {
        return null;
    }

    return {
        id: mailbox.id,
        address: mailbox.address,
        provisioningMode: mailbox.provisioningMode,
    };
}

function mapMailboxDetail(mailbox: ForwardingJobDetailRecord['mailbox']) {
    if (!mailbox) {
        return null;
    }

    return {
        id: mailbox.id,
        address: mailbox.address,
        provisioningMode: mailbox.provisioningMode,
        forwardMode: mailbox.forwardMode,
        forwardTo: mailbox.forwardTo,
    };
}

function mapInboundSummary(inboundMessage: ForwardingJobListRecord['inboundMessage']) {
    return {
        id: inboundMessage.id.toString(),
        fromAddress: inboundMessage.fromAddress,
        subject: inboundMessage.subject,
        matchedAddress: inboundMessage.matchedAddress,
        finalAddress: inboundMessage.finalAddress,
        routeKind: inboundMessage.routeKind,
        receivedAt: inboundMessage.receivedAt,
        portalState: inboundMessage.portalState,
    };
}

function mapListItem(job: ForwardingJobListRecord) {
    return {
        id: job.id.toString(),
        inboundMessageId: job.inboundMessageId.toString(),
        mailboxId: job.mailboxId,
        domainId: job.inboundMessage.domainId,
        mode: job.mode,
        forwardTo: job.forwardTo,
        status: job.status,
        attemptCount: job.attemptCount,
        providerMessageId: job.providerMessageId,
        nextAttemptAt: job.nextAttemptAt,
        processedAt: job.processedAt,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        lastError: truncateLastError(job.lastError),
        mailbox: mapMailboxSummary(job.mailbox),
        domain: mapDomainSummary(job.inboundMessage.domain),
        inboundMessage: mapInboundSummary(job.inboundMessage),
    };
}

function mapDetail(job: ForwardingJobDetailRecord) {
    return {
        id: job.id.toString(),
        inboundMessageId: job.inboundMessageId.toString(),
        mailboxId: job.mailboxId,
        domainId: job.inboundMessage.domainId,
        mode: job.mode,
        forwardTo: job.forwardTo,
        status: job.status,
        attemptCount: job.attemptCount,
        providerMessageId: job.providerMessageId,
        nextAttemptAt: job.nextAttemptAt,
        processedAt: job.processedAt,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        lastError: job.lastError,
        mailbox: mapMailboxDetail(job.mailbox),
        domain: mapDomainSummary(job.inboundMessage.domain),
        inboundMessage: {
            ...mapInboundSummary(job.inboundMessage),
            hasTextPreview: Boolean(job.inboundMessage.textPreview?.trim()),
            hasHtmlPreview: Boolean(job.inboundMessage.htmlPreview?.trim()),
        },
    };
}

export const forwardingJobService = {
    async list(input: ListForwardingJobInput) {
        const skip = (input.page - 1) * input.pageSize;
        const where = buildListWhere(input);

        const [list, total] = await Promise.all([
            prisma.mailboxForwardJob.findMany({
                where,
                select: forwardingJobListSelect,
                skip,
                take: input.pageSize,
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            }),
            prisma.mailboxForwardJob.count({ where }),
        ]);

        return {
            list: list.map(mapListItem),
            total,
            page: input.page,
            pageSize: input.pageSize,
        };
    },

    async getById(id: string) {
        const jobId = parseForwardingJobId(id);
        const job = await prisma.mailboxForwardJob.findUnique({
            where: { id: jobId },
            select: forwardingJobDetailSelect,
        });

        if (!job) {
            throw new AppError('FORWARDING_JOB_NOT_FOUND', 'Forwarding job not found', 404);
        }

        return mapDetail(job);
    },

    async requeue(id: string) {
        const jobId = parseForwardingJobId(id);
        const existing = await prisma.mailboxForwardJob.findUnique({
            where: { id: jobId },
            select: {
                id: true,
                status: true,
            },
        });

        if (!existing) {
            throw new AppError('FORWARDING_JOB_NOT_FOUND', 'Forwarding job not found', 404);
        }
        if (existing.status !== 'FAILED' && existing.status !== 'SKIPPED') {
            throw new AppError('FORWARDING_JOB_REQUEUE_NOT_ALLOWED', 'Only failed or skipped forwarding jobs can be requeued', 400);
        }

        const updated = await prisma.mailboxForwardJob.update({
            where: { id: jobId },
            data: {
                status: 'PENDING',
                attemptCount: 0,
                lastError: null,
                providerMessageId: null,
                nextAttemptAt: new Date(),
                processedAt: null,
            },
            select: {
                id: true,
                status: true,
                attemptCount: true,
                lastError: true,
                providerMessageId: true,
                nextAttemptAt: true,
                processedAt: true,
                updatedAt: true,
            },
        });

        return {
            id: updated.id.toString(),
            status: updated.status,
            attemptCount: updated.attemptCount,
            lastError: updated.lastError,
            providerMessageId: updated.providerMessageId,
            nextAttemptAt: updated.nextAttemptAt,
            processedAt: updated.processedAt,
            updatedAt: updated.updatedAt,
        };
    },
};
