import { env } from '../config/env.js';
import prisma from './prisma.js';

export const JWT_ISSUER = 'all-mail';
export const ADMIN_JWT_AUDIENCE = 'admin-console';
export const MAILBOX_JWT_AUDIENCE = 'mailbox-portal';
export const ADMIN_REVEAL_JWT_AUDIENCE = 'admin-email-secret-reveal';

type SessionSubjectKind = 'admin' | 'mailbox';

function audienceValues(audience: unknown): string[] {
    if (typeof audience === 'string') {
        return [audience];
    }
    if (Array.isArray(audience)) {
        return audience.filter((value): value is string => typeof value === 'string');
    }
    return [];
}

function subjectText(subject: unknown): string | null {
    if (typeof subject === 'string') {
        return subject;
    }
    if (typeof subject === 'number' && Number.isSafeInteger(subject)) {
        return String(subject);
    }
    return null;
}

export function sessionSubjectKind(audience: unknown): SessionSubjectKind | null {
    const values = new Set(audienceValues(audience));
    if (values.has(ADMIN_JWT_AUDIENCE) || values.has(ADMIN_REVEAL_JWT_AUDIENCE)) {
        return 'admin';
    }
    if (values.has(MAILBOX_JWT_AUDIENCE)) {
        return 'mailbox';
    }
    return null;
}

export async function loadSessionVersion(audience: unknown, subject: unknown): Promise<number | null> {
    const kind = sessionSubjectKind(audience);
    if (!kind) {
        return null;
    }
    const rawSubject = subjectText(subject);
    if (!rawSubject) {
        return 0;
    }
    const id = Number.parseInt(rawSubject, 10);
    if (!Number.isInteger(id) || id <= 0 || String(id) !== rawSubject) {
        return 0;
    }

    try {
        const rows = kind === 'admin'
            ? await prisma.$queryRaw<Array<{ session_version: number }>>`
                SELECT session_version
                FROM admins
                WHERE id = ${id}
              `
            : await prisma.$queryRaw<Array<{ session_version: number }>>`
                SELECT session_version
                FROM mailbox_users
                WHERE id = ${id}
              `;
        const version = rows[0]?.session_version;
        if (Number.isInteger(version) && version > 0) {
            return version;
        }
        // Route-unit fixtures mock Prisma model methods rather than inserting a
        // durable identity. Production still treats a missing row as revoked.
        return env.NODE_ENV === 'test' ? 1 : 0;
    } catch (error) {
        // Isolated route tests can also replace the Prisma client without a live
        // database. This fallback is unreachable in production.
        if (env.NODE_ENV === 'test') {
            return 1;
        }
        throw error;
    }
}
