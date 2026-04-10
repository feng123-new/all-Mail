import type { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { AppError } from '../../plugins/error.js';
import type { MailboxCheckpoint } from '../mail/providers/types.js';

export type EmailMailboxName = 'INBOX' | 'SENT' | 'Junk';

export interface EmailMailboxState {
    latestMessageId: string | null;
    latestMessageDate: string | null;
    messageCount: number;
    hasNew: boolean;
    lastSyncedAt: string | null;
    lastViewedAt: string | null;
    uidValidity: number | null;
    lastUid: number | null;
}

export type EmailMailboxStatus = Record<EmailMailboxName, EmailMailboxState>;

function createEmptyMailboxState(): EmailMailboxState {
    return {
        latestMessageId: null,
        latestMessageDate: null,
        messageCount: 0,
        hasNew: false,
        lastSyncedAt: null,
        lastViewedAt: null,
        uidValidity: null,
        lastUid: null,
    };
}

function createEmptyMailboxStatus(): EmailMailboxStatus {
    return {
        INBOX: createEmptyMailboxState(),
        SENT: createEmptyMailboxState(),
        Junk: createEmptyMailboxState(),
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeMailboxState(value: unknown): EmailMailboxState {
    const source = isRecord(value) ? value : {};
    const messageCount =
        typeof source.messageCount === 'number' && Number.isFinite(source.messageCount)
            ? source.messageCount
            : 0;

    return {
        latestMessageId:
            typeof source.latestMessageId === 'string' && source.latestMessageId.trim()
                ? source.latestMessageId
                : null,
        latestMessageDate:
            typeof source.latestMessageDate === 'string' && source.latestMessageDate.trim()
                ? source.latestMessageDate
                : null,
        messageCount,
        hasNew: Boolean(source.hasNew),
        lastSyncedAt:
            typeof source.lastSyncedAt === 'string' && source.lastSyncedAt.trim()
                ? source.lastSyncedAt
                : null,
        lastViewedAt:
            typeof source.lastViewedAt === 'string' && source.lastViewedAt.trim()
                ? source.lastViewedAt
                : null,
        uidValidity:
            typeof source.uidValidity === 'number' &&
            Number.isInteger(source.uidValidity) &&
            source.uidValidity > 0
                ? source.uidValidity
                : null,
        lastUid:
            typeof source.lastUid === 'number' &&
            Number.isInteger(source.lastUid) &&
            source.lastUid > 0
                ? source.lastUid
                : null,
    };
}

export function parseMailboxStatus(
    value: Prisma.JsonValue | null | undefined,
): EmailMailboxStatus {
    const source = isRecord(value) ? value : {};
    const defaults = createEmptyMailboxStatus();
    return {
        INBOX: { ...defaults.INBOX, ...normalizeMailboxState(source.INBOX) },
        SENT: { ...defaults.SENT, ...normalizeMailboxState(source.SENT) },
        Junk: { ...defaults.Junk, ...normalizeMailboxState(source.Junk) },
    };
}

function toMailboxStatusJson(value: EmailMailboxStatus): Prisma.InputJsonValue {
    return value as unknown as Prisma.InputJsonValue;
}

function getLatestMailboxMessage(messages: Array<{ id: string; date: string }>) {
    const latest = messages[0];
    if (!latest || !latest.id) {
        return { latestMessageId: null, latestMessageDate: null };
    }
    return {
        latestMessageId: latest.id,
        latestMessageDate: latest.date || null,
    };
}

export async function updateMailboxStatus(
    id: number,
    mailbox: EmailMailboxName,
    messages: Array<{ id: string; date: string }>,
    options?: {
        markAsSeen?: boolean;
        mailboxCheckpoint?: MailboxCheckpoint | null;
    },
) {
    const existing = await prisma.emailAccount.findUnique({
        where: { id },
        select: { mailboxStatus: true },
    });
    if (!existing) {
        throw new AppError('NOT_FOUND', 'Email account not found', 404);
    }

    const mailboxStatus = parseMailboxStatus(existing.mailboxStatus);
    const previous = mailboxStatus[mailbox] || createEmptyMailboxState();
    const { latestMessageId, latestMessageDate } = getLatestMailboxMessage(messages);
    const now = new Date().toISOString();

    let hasNew = false;
    if (options?.markAsSeen) {
        hasNew = false;
    } else if (!latestMessageId) {
        hasNew = false;
    } else if (!previous.lastSyncedAt) {
        hasNew = false;
    } else if (previous.latestMessageId && previous.latestMessageId !== latestMessageId) {
        hasNew = true;
    } else {
        hasNew = previous.hasNew;
    }

    mailboxStatus[mailbox] = {
        latestMessageId,
        latestMessageDate,
        messageCount: messages.length,
        hasNew,
        lastSyncedAt: now,
        lastViewedAt: options?.markAsSeen ? now : previous.lastViewedAt,
        uidValidity: options?.mailboxCheckpoint?.uidValidity ?? previous.uidValidity,
        lastUid: options?.mailboxCheckpoint?.lastUid ?? previous.lastUid,
    };

    await prisma.emailAccount.update({
        where: { id },
        data: {
            mailboxStatus: toMailboxStatusJson(mailboxStatus),
        },
    });

    return mailboxStatus;
}

export async function clearMailboxStatus(id: number, mailbox: EmailMailboxName) {
    const existing = await prisma.emailAccount.findUnique({
        where: { id },
        select: { mailboxStatus: true },
    });
    if (!existing) {
        throw new AppError('NOT_FOUND', 'Email account not found', 404);
    }

    const mailboxStatus = parseMailboxStatus(existing.mailboxStatus);
    const now = new Date().toISOString();
    mailboxStatus[mailbox] = {
        latestMessageId: null,
        latestMessageDate: null,
        messageCount: 0,
        hasNew: false,
        lastSyncedAt: now,
        lastViewedAt: now,
        uidValidity: null,
        lastUid: null,
    };

    await prisma.emailAccount.update({
        where: { id },
        data: {
            mailboxStatus: toMailboxStatusJson(mailboxStatus),
        },
    });

    return mailboxStatus;
}
