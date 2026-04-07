import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import type { Prisma } from '@prisma/client';

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://tester:tester@127.0.0.1:15433/all_mail_test';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6380/0';
process.env.JWT_SECRET ??= 'test-jwt-secret-1234567890abcdef';
process.env.ENCRYPTION_KEY ??= 'test-encryption-key-1234567890ab';
process.env.ADMIN_PASSWORD ??= 'test-admin-password';

function toPrismaPromise<T>(value: T): Prisma.PrismaPromise<T> {
    return Promise.resolve(value) as Prisma.PrismaPromise<T>;
}

async function createAdminToken(adminId: number) {
    const { signToken } = await import('../../lib/jwt.js');
    return signToken({
        sub: String(adminId),
        username: 'admin-user',
        role: 'ADMIN',
    }, { audience: 'admin-console' });
}

async function mockAdminAuthContext() {
    const { default: prisma } = await import('../../lib/prisma.js');
    const originalFindUnique = prisma.admin.findUnique.bind(prisma.admin);
    const findUniqueMock: typeof prisma.admin.findUnique = () => toPrismaPromise({
        id: 1,
        username: 'admin-user',
        role: 'ADMIN',
        status: 'ACTIVE',
        mustChangePassword: false,
    });

    prisma.admin.findUnique = findUniqueMock;

    return () => {
        prisma.admin.findUnique = originalFindUnique;
    };
}

void test('forwarding job routes require admin auth', async () => {
    const { buildApp } = await import('../../app.js');
    const app = await buildApp();

    try {
        const listResponse = await app.inject({
            method: 'GET',
            url: '/admin/forwarding-jobs',
        });
        const detailResponse = await app.inject({
            method: 'GET',
            url: '/admin/forwarding-jobs/1',
        });
        const requeueResponse = await app.inject({
            method: 'POST',
            url: '/admin/forwarding-jobs/1/requeue',
        });

        assert.equal(listResponse.statusCode, 401);
        assert.equal(detailResponse.statusCode, 401);
        assert.equal(requeueResponse.statusCode, 401);
        assert.equal(JSON.parse(listResponse.payload).error.code, 'UNAUTHORIZED');
        assert.equal(JSON.parse(detailResponse.payload).error.code, 'UNAUTHORIZED');
        assert.equal(JSON.parse(requeueResponse.payload).error.code, 'UNAUTHORIZED');
    } finally {
        await app.close();
    }
});

void test('forwarding job routes return standard success envelopes for authenticated list and detail reads', async () => {
    const [{ buildApp }, { forwardingJobService }] = await Promise.all([
        import('../../app.js'),
        import('./forwardingJob.service.js'),
    ]);

    const restoreAdminFindUnique = await mockAdminAuthContext();

    let capturedListInput: unknown;
    let capturedDetailId: unknown;
    mock.method(forwardingJobService, 'list', async (input: unknown) => {
        capturedListInput = input;
        return {
            list: [{ id: '42', status: 'FAILED' }],
            total: 1,
            page: 2,
            pageSize: 5,
        };
    });
    mock.method(forwardingJobService, 'getById', async (id: string) => {
        capturedDetailId = id;
        return {
            id: '42',
            inboundMessageId: '101',
            status: 'FAILED',
        };
    });

    const app = await buildApp();
    try {
        const token = await createAdminToken(1);
        const listResponse = await app.inject({
            method: 'GET',
            url: '/admin/forwarding-jobs?page=2&pageSize=5&status=FAILED&mode=MOVE&mailboxId=9&domainId=3&keyword=sender',
            headers: { authorization: `Bearer ${token}` },
        });
        const detailResponse = await app.inject({
            method: 'GET',
            url: '/admin/forwarding-jobs/42',
            headers: { authorization: `Bearer ${token}` },
        });

        assert.equal(listResponse.statusCode, 200);
        assert.equal(detailResponse.statusCode, 200);
        assert.deepEqual(capturedListInput, {
            page: 2,
            pageSize: 5,
            status: 'FAILED',
            mode: 'MOVE',
            mailboxId: 9,
            domainId: 3,
            keyword: 'sender',
        });
        assert.equal(capturedDetailId, '42');
        assert.deepEqual(JSON.parse(listResponse.payload), {
            success: true,
            data: {
                list: [{ id: '42', status: 'FAILED' }],
                total: 1,
                page: 2,
                pageSize: 5,
            },
        });
        assert.deepEqual(JSON.parse(detailResponse.payload), {
            success: true,
            data: {
                id: '42',
                inboundMessageId: '101',
                status: 'FAILED',
            },
        });
    } finally {
        restoreAdminFindUnique();
        mock.restoreAll();
        await app.close();
    }
});

void test('forwarding job routes allow authenticated admins to manually requeue a terminal job', async () => {
    const [{ buildApp }, { forwardingJobService }] = await Promise.all([
        import('../../app.js'),
        import('./forwardingJob.service.js'),
    ]);

    const restoreAdminFindUnique = await mockAdminAuthContext();

    let capturedId: string | undefined;
    mock.method(forwardingJobService, 'requeue', async (id: string) => {
        capturedId = id;
        return {
            id,
            status: 'PENDING',
            attemptCount: 0,
            lastError: null,
            providerMessageId: null,
            nextAttemptAt: new Date('2026-04-02T13:00:00.000Z'),
            processedAt: null,
            updatedAt: new Date('2026-04-02T13:00:00.000Z'),
        };
    });

    const app = await buildApp();
    try {
        const token = await createAdminToken(1);
        const response = await app.inject({
            method: 'POST',
            url: '/admin/forwarding-jobs/42/requeue',
            headers: { authorization: `Bearer ${token}` },
        });

        assert.equal(response.statusCode, 200);
        assert.equal(capturedId, '42');
        assert.deepEqual(JSON.parse(response.payload), {
            success: true,
            data: {
                id: '42',
                status: 'PENDING',
                attemptCount: 0,
                lastError: null,
                providerMessageId: null,
                nextAttemptAt: '2026-04-02T13:00:00.000Z',
                processedAt: null,
                updatedAt: '2026-04-02T13:00:00.000Z',
            },
        });
    } finally {
        restoreAdminFindUnique();
        mock.restoreAll();
        await app.close();
    }
});
