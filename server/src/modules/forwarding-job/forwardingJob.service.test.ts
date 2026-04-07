import assert from 'node:assert/strict';
import type { Prisma } from '@prisma/client';
import test from 'node:test';

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://tester:tester@127.0.0.1:15433/all_mail_test';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6380/0';
process.env.JWT_SECRET ??= 'test-jwt-secret-1234567890abcdef';
process.env.ENCRYPTION_KEY ??= 'test-encryption-key-1234567890ab';
process.env.ADMIN_PASSWORD ??= 'test-admin-password';

function toPrismaPromise<T>(value: T): Prisma.PrismaPromise<T> {
    return Promise.resolve(value) as Prisma.PrismaPromise<T>;
}

void test('forwardingJobService.list applies status, mode, mailbox, domain, and keyword filters', async () => {
    const [{ default: prisma }, { forwardingJobService }] = await Promise.all([
        import('../../lib/prisma.js'),
        import('./forwardingJob.service.js'),
    ]);

    let capturedWhere: unknown;
    const originalFindMany = prisma.mailboxForwardJob.findMany.bind(prisma.mailboxForwardJob);
    const originalCount = prisma.mailboxForwardJob.count.bind(prisma.mailboxForwardJob);

    const findManyMock: typeof prisma.mailboxForwardJob.findMany = (args) => {
        capturedWhere = args?.where;
        return toPrismaPromise([]);
    };
    const countMock: typeof prisma.mailboxForwardJob.count = (args) => {
        assert.deepEqual(args?.where, capturedWhere);
        return toPrismaPromise(0);
    };

    prisma.mailboxForwardJob.findMany = findManyMock;
    prisma.mailboxForwardJob.count = countMock;

    try {
        const result = await forwardingJobService.list({
            page: 2,
            pageSize: 10,
            status: 'FAILED',
            mode: 'COPY',
            mailboxId: 7,
            domainId: 3,
            keyword: 'sender@example.org',
        });

        assert.deepEqual(result, {
            list: [],
            total: 0,
            page: 2,
            pageSize: 10,
        });
        assert.deepEqual(capturedWhere, {
            status: 'FAILED',
            mode: 'COPY',
            mailboxId: 7,
            inboundMessage: { is: { domainId: 3 } },
            OR: [
                { forwardTo: { contains: 'sender@example.org', mode: 'insensitive' } },
                { inboundMessage: { is: { fromAddress: { contains: 'sender@example.org', mode: 'insensitive' } } } },
                { inboundMessage: { is: { subject: { contains: 'sender@example.org', mode: 'insensitive' } } } },
                { inboundMessage: { is: { matchedAddress: { contains: 'sender@example.org', mode: 'insensitive' } } } },
                { inboundMessage: { is: { finalAddress: { contains: 'sender@example.org', mode: 'insensitive' } } } },
            ],
        });
    } finally {
        prisma.mailboxForwardJob.findMany = originalFindMany;
        prisma.mailboxForwardJob.count = originalCount;
    }
});

void test('forwardingJobService.list stringifies BigInt ids and returns joined mailbox, domain, and inbound summaries', async () => {
    const [{ default: prisma }, { forwardingJobService }] = await Promise.all([
        import('../../lib/prisma.js'),
        import('./forwardingJob.service.js'),
    ]);

    const originalFindMany = prisma.mailboxForwardJob.findMany.bind(prisma.mailboxForwardJob);
    const originalCount = prisma.mailboxForwardJob.count.bind(prisma.mailboxForwardJob);

    const findManyMock: typeof prisma.mailboxForwardJob.findMany = () => toPrismaPromise([{
        id: 51n,
        inboundMessageId: 100n,
        mailboxId: 7,
        mode: 'COPY',
        forwardTo: 'forward@example.net',
        status: 'FAILED',
        attemptCount: 2,
        lastError: 'x'.repeat(200),
        providerMessageId: 'provider-1',
        nextAttemptAt: new Date('2026-03-29T12:10:00.000Z'),
        processedAt: new Date('2026-03-29T12:00:00.000Z'),
        createdAt: new Date('2026-03-29T11:55:00.000Z'),
        updatedAt: new Date('2026-03-29T12:00:00.000Z'),
        mailbox: {
            id: 7,
            address: 'inbox@example.com',
            provisioningMode: 'API_POOL',
        },
        inboundMessage: {
            id: 100n,
            domainId: 3,
            fromAddress: 'sender@example.org',
            subject: 'Need help',
            matchedAddress: 'sales@example.com',
            finalAddress: 'sales@example.com',
            routeKind: 'EXACT_MAILBOX',
            receivedAt: new Date('2026-03-29T11:50:00.000Z'),
            portalState: 'VISIBLE',
            domain: {
                id: 3,
                name: 'example.com',
                canSend: true,
                canReceive: true,
            },
        },
    }]);
    const countMock: typeof prisma.mailboxForwardJob.count = () => toPrismaPromise(1);

    prisma.mailboxForwardJob.findMany = findManyMock;
    prisma.mailboxForwardJob.count = countMock;

    try {
        const result = await forwardingJobService.list({
            page: 1,
            pageSize: 20,
        });

        assert.equal(result.total, 1);
        assert.equal(result.list[0]?.id, '51');
        assert.equal(result.list[0]?.inboundMessageId, '100');
        assert.equal(result.list[0]?.mailbox?.id, 7);
        assert.deepEqual(result.list[0]?.domain, {
            id: 3,
            name: 'example.com',
            canSend: true,
            canReceive: true,
        });
        assert.deepEqual(result.list[0]?.inboundMessage, {
            id: '100',
            fromAddress: 'sender@example.org',
            subject: 'Need help',
            matchedAddress: 'sales@example.com',
            finalAddress: 'sales@example.com',
            routeKind: 'EXACT_MAILBOX',
            receivedAt: new Date('2026-03-29T11:50:00.000Z'),
            portalState: 'VISIBLE',
        });
        assert.equal(result.list[0]?.lastError?.length, 160);
        assert.match(result.list[0]?.lastError ?? '', /…$/);
    } finally {
        prisma.mailboxForwardJob.findMany = originalFindMany;
        prisma.mailboxForwardJob.count = originalCount;
    }
});

void test('forwardingJobService.getById accepts string ids and exposes detail-only mailbox and preview summary fields', async () => {
    const [{ default: prisma }, { forwardingJobService }] = await Promise.all([
        import('../../lib/prisma.js'),
        import('./forwardingJob.service.js'),
    ]);

    let capturedWhere: unknown;
    const originalFindUnique = prisma.mailboxForwardJob.findUnique.bind(prisma.mailboxForwardJob);

    const findUniqueMock: typeof prisma.mailboxForwardJob.findUnique = (args) => {
        capturedWhere = args.where;
        return toPrismaPromise({
            id: 84n,
            inboundMessageId: 101n,
            mailboxId: 7,
            mode: 'MOVE',
            forwardTo: 'forward@example.net',
            status: 'SKIPPED',
            attemptCount: 1,
            lastError: 'Forwarding configuration changed after job creation',
            providerMessageId: null,
            nextAttemptAt: null,
            processedAt: new Date('2026-03-29T12:00:00.000Z'),
            createdAt: new Date('2026-03-29T11:58:00.000Z'),
            updatedAt: new Date('2026-03-29T12:00:00.000Z'),
            mailbox: {
                id: 7,
                address: 'inbox@example.com',
                provisioningMode: 'MANUAL',
                forwardMode: 'MOVE',
                forwardTo: 'forward@example.net',
            },
            inboundMessage: {
                id: 101n,
                domainId: 3,
                fromAddress: 'sender@example.org',
                subject: 'Need help',
                matchedAddress: 'sales@example.com',
                finalAddress: 'sales@example.com',
                routeKind: 'EXACT_MAILBOX',
                receivedAt: new Date('2026-03-29T11:50:00.000Z'),
                portalState: 'FORWARDED_HIDDEN',
                textPreview: 'hello world',
                htmlPreview: '<p>hello world</p>',
                domain: {
                    id: 3,
                    name: 'example.com',
                    canSend: true,
                    canReceive: true,
                },
            },
        });
    };

    prisma.mailboxForwardJob.findUnique = findUniqueMock;

    try {
        const result = await forwardingJobService.getById('84');

        assert.deepEqual(capturedWhere, { id: 84n });
        assert.equal(result.id, '84');
        assert.equal(result.inboundMessageId, '101');
        assert.deepEqual(result.mailbox, {
            id: 7,
            address: 'inbox@example.com',
            provisioningMode: 'MANUAL',
            forwardMode: 'MOVE',
            forwardTo: 'forward@example.net',
        });
        assert.deepEqual(result.inboundMessage, {
            id: '101',
            fromAddress: 'sender@example.org',
            subject: 'Need help',
            matchedAddress: 'sales@example.com',
            finalAddress: 'sales@example.com',
            routeKind: 'EXACT_MAILBOX',
            receivedAt: new Date('2026-03-29T11:50:00.000Z'),
            portalState: 'FORWARDED_HIDDEN',
            hasTextPreview: true,
            hasHtmlPreview: true,
        });
    } finally {
        prisma.mailboxForwardJob.findUnique = originalFindUnique;
    }
});

void test('forwardingJobService.getById rejects invalid or missing job ids', async () => {
    const [{ default: prisma }, { forwardingJobService }] = await Promise.all([
        import('../../lib/prisma.js'),
        import('./forwardingJob.service.js'),
    ]);

    const originalFindUnique = prisma.mailboxForwardJob.findUnique.bind(prisma.mailboxForwardJob);
    const findUniqueMock: typeof prisma.mailboxForwardJob.findUnique = () => toPrismaPromise(null);
    prisma.mailboxForwardJob.findUnique = findUniqueMock;

    try {
        await assert.rejects(
            () => forwardingJobService.getById('not-a-job-id'),
            (error: unknown) => {
                assert.equal((error as { code?: string }).code, 'FORWARDING_JOB_INVALID_ID');
                return true;
            }
        );

        await assert.rejects(
            () => forwardingJobService.getById('999'),
            (error: unknown) => {
                assert.equal((error as { code?: string }).code, 'FORWARDING_JOB_NOT_FOUND');
                return true;
            }
        );
    } finally {
        prisma.mailboxForwardJob.findUnique = originalFindUnique;
    }
});

void test('forwardingJobService.requeue resets terminal failed jobs for a fresh retry cycle', async () => {
    const [{ default: prisma }, { forwardingJobService }] = await Promise.all([
        import('../../lib/prisma.js'),
        import('./forwardingJob.service.js'),
    ]);

    const originalFindUnique = prisma.mailboxForwardJob.findUnique.bind(prisma.mailboxForwardJob);
    const originalUpdate = prisma.mailboxForwardJob.update.bind(prisma.mailboxForwardJob);

    let capturedWhere: unknown;
    let capturedData: unknown;
    prisma.mailboxForwardJob.findUnique = (() => toPrismaPromise({
        id: 91n,
        status: 'FAILED',
    })) as typeof prisma.mailboxForwardJob.findUnique;
    prisma.mailboxForwardJob.update = ((args) => {
        capturedWhere = args.where;
        capturedData = args.data;
        return toPrismaPromise({
            id: 91n,
            status: 'PENDING',
            attemptCount: 0,
            lastError: null,
            providerMessageId: null,
            nextAttemptAt: new Date('2026-04-02T13:00:00.000Z'),
            processedAt: null,
            updatedAt: new Date('2026-04-02T13:00:00.000Z'),
        });
    }) as typeof prisma.mailboxForwardJob.update;

    try {
        const result = await forwardingJobService.requeue('91');

        assert.deepEqual(capturedWhere, { id: 91n });
        assert.equal((capturedData as { status: string }).status, 'PENDING');
        assert.equal((capturedData as { attemptCount: number }).attemptCount, 0);
        assert.equal((capturedData as { lastError: string | null }).lastError, null);
        assert.equal((capturedData as { providerMessageId: string | null }).providerMessageId, null);
        assert.equal((capturedData as { processedAt: Date | null }).processedAt, null);
        assert.ok((capturedData as { nextAttemptAt: Date }).nextAttemptAt instanceof Date);
        assert.deepEqual(result, {
            id: '91',
            status: 'PENDING',
            attemptCount: 0,
            lastError: null,
            providerMessageId: null,
            nextAttemptAt: new Date('2026-04-02T13:00:00.000Z'),
            processedAt: null,
            updatedAt: new Date('2026-04-02T13:00:00.000Z'),
        });
    } finally {
        prisma.mailboxForwardJob.findUnique = originalFindUnique;
        prisma.mailboxForwardJob.update = originalUpdate;
    }
});

void test('forwardingJobService.requeue rejects jobs that are not in a terminal retryable state', async () => {
    const [{ default: prisma }, { forwardingJobService }] = await Promise.all([
        import('../../lib/prisma.js'),
        import('./forwardingJob.service.js'),
    ]);

    const originalFindUnique = prisma.mailboxForwardJob.findUnique.bind(prisma.mailboxForwardJob);
    prisma.mailboxForwardJob.findUnique = (() => toPrismaPromise({
        id: 92n,
        status: 'RUNNING',
    })) as typeof prisma.mailboxForwardJob.findUnique;

    try {
        await assert.rejects(
            () => forwardingJobService.requeue('92'),
            (error: unknown) => {
                assert.equal((error as { code?: string }).code, 'FORWARDING_JOB_REQUEUE_NOT_ALLOWED');
                return true;
            }
        );
    } finally {
        prisma.mailboxForwardJob.findUnique = originalFindUnique;
    }
});
