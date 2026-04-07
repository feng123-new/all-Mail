import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://tester:tester@127.0.0.1:15433/all_mail_test';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6380/0';
process.env.JWT_SECRET ??= 'test-jwt-secret-1234567890abcdef';
process.env.ENCRYPTION_KEY ??= 'test-encryption-key-1234567890ab';
process.env.ADMIN_PASSWORD ??= 'test-admin-password';

void test('messageService.list scopes results to allowed mailbox ids when mailbox filter is omitted', async () => {
    const [{ default: prisma }, { messageService }] = await Promise.all([
        import('../../lib/prisma.js'),
        import('./message.service.js'),
    ]);

    let capturedWhere: unknown;

    mock.method(prisma.inboundMessage, 'findMany', async ({ where }: { where: unknown }) => {
        capturedWhere = where;
        return [];
    });
    mock.method(prisma.inboundMessage, 'count', async ({ where }: { where: unknown }) => {
        assert.deepEqual(where, capturedWhere);
        return 0;
    });

    try {
        const result = await messageService.list({
            page: 1,
            pageSize: 20,
            unreadOnly: false,
            allowedMailboxIds: [3, 5],
        });

        assert.equal(result.total, 0);
        assert.deepEqual(capturedWhere, {
            mailboxId: { in: [3, 5] },
            isDeleted: false,
        });
    } finally {
        mock.restoreAll();
    }
});

void test('messageService.list returns no rows when mailbox id is outside allowed mailbox scope', async () => {
    const [{ default: prisma }, { messageService }] = await Promise.all([
        import('../../lib/prisma.js'),
        import('./message.service.js'),
    ]);

    const findManyMock = mock.method(prisma.inboundMessage, 'findMany', async () => {
        throw new Error('findMany should not be called when scope already excludes the requested mailbox');
    });
    const countMock = mock.method(prisma.inboundMessage, 'count', async () => {
        throw new Error('count should not be called when scope already excludes the requested mailbox');
    });

    try {
        const result = await messageService.list({
            page: 1,
            pageSize: 20,
            mailboxId: 9,
            unreadOnly: false,
            allowedMailboxIds: [3, 5],
        });

        assert.equal(result.total, 0);
        assert.deepEqual(result.list, []);
        assert.equal(findManyMock.mock.calls.length, 0);
        assert.equal(countMock.mock.calls.length, 0);
    } finally {
        mock.restoreAll();
    }
});

void test('messageService.markRead updates only messages inside the allowed mailbox scope', async () => {
    const [{ default: prisma }, { messageService }] = await Promise.all([
        import('../../lib/prisma.js'),
        import('./message.service.js'),
    ]);

    let capturedWhere: unknown;
    let capturedData: unknown;

    mock.method(prisma.inboundMessage, 'updateMany', async ({ where, data }: { where: unknown; data: unknown }) => {
        capturedWhere = where;
        capturedData = data;
        return { count: 1 };
    });

    try {
        const result = await messageService.markRead('42', [7, 9]);

        assert.deepEqual(result, { updated: true });
        assert.deepEqual(capturedWhere, {
            id: BigInt(42),
            isDeleted: false,
            mailboxId: { in: [7, 9] },
        });
        assert.deepEqual(capturedData, { isRead: true });
    } finally {
        mock.restoreAll();
    }
});

void test('messageService.list excludes forwarded-hidden messages for portal queries', async () => {
    const [{ default: prisma }, { messageService }] = await Promise.all([
        import('../../lib/prisma.js'),
        import('./message.service.js'),
    ]);

    let capturedWhere: unknown;

    mock.method(prisma.inboundMessage, 'findMany', async ({ where }: { where: unknown }) => {
        capturedWhere = where;
        return [];
    });
    mock.method(prisma.inboundMessage, 'count', async () => 0);

    try {
        await messageService.list({
            page: 1,
            pageSize: 20,
            mailboxId: 3,
            unreadOnly: false,
        }, {
            portalVisibleOnly: true,
        });

        assert.deepEqual(capturedWhere, {
            mailboxId: 3,
            portalState: 'VISIBLE',
            isDeleted: false,
        });
    } finally {
        mock.restoreAll();
    }
});

void test('messageService.getById hides forwarded-hidden messages from portal reads', async () => {
    const [{ default: prisma }, { messageService }] = await Promise.all([
        import('../../lib/prisma.js'),
        import('./message.service.js'),
    ]);

    mock.method(prisma.inboundMessage, 'findUnique', async () => ({
        id: 42n,
        domainId: 1,
        mailboxId: 2,
        matchedAddress: 'inbox@example.com',
        finalAddress: 'inbox@example.com',
        messageIdHeader: 'message-1',
        fromAddress: 'sender@example.net',
        toAddress: 'inbox@example.com',
        subject: 'Hidden copy',
        textPreview: 'hello',
        htmlPreview: '<p>hello</p>',
        verificationCode: null,
        routeKind: 'EXACT_MAILBOX',
        receivedAt: new Date('2026-03-29T10:00:00.000Z'),
        storageStatus: 'STORED',
        rawObjectKey: null,
        attachmentsMeta: null,
        headersJson: {},
        isRead: false,
        isDeleted: false,
        portalState: 'FORWARDED_HIDDEN',
        createdAt: new Date('2026-03-29T10:00:00.000Z'),
        updatedAt: new Date('2026-03-29T10:00:00.000Z'),
        domain: { id: 1, name: 'example.com', canSend: true, canReceive: true },
        mailbox: { id: 2, address: 'inbox@example.com', provisioningMode: 'MANUAL' },
    }));

    try {
        await assert.rejects(
            () => messageService.getById('42', { portalVisibleOnly: true }),
            (error: unknown) => {
                assert.equal((error as { code?: string }).code, 'INBOUND_MESSAGE_NOT_FOUND');
                return true;
            }
        );
    } finally {
        mock.restoreAll();
    }
});

void test('messageService.getById keeps forwarded-hidden messages visible for admin reads', async () => {
    const [{ default: prisma }, { messageService }] = await Promise.all([
        import('../../lib/prisma.js'),
        import('./message.service.js'),
    ]);

    mock.method(prisma.inboundMessage, 'findUnique', async () => ({
        id: 84n,
        domainId: 1,
        mailboxId: 2,
        matchedAddress: 'inbox@example.com',
        finalAddress: 'inbox@example.com',
        messageIdHeader: 'message-2',
        fromAddress: 'sender@example.net',
        toAddress: 'inbox@example.com',
        subject: 'Admin visible',
        textPreview: 'hello',
        htmlPreview: '<p>hello</p>',
        verificationCode: null,
        routeKind: 'EXACT_MAILBOX',
        receivedAt: new Date('2026-03-29T11:00:00.000Z'),
        storageStatus: 'STORED',
        rawObjectKey: null,
        attachmentsMeta: null,
        headersJson: {},
        isRead: false,
        isDeleted: false,
        portalState: 'FORWARDED_HIDDEN',
        createdAt: new Date('2026-03-29T11:00:00.000Z'),
        updatedAt: new Date('2026-03-29T11:00:00.000Z'),
        domain: { id: 1, name: 'example.com', canSend: true, canReceive: true },
        mailbox: { id: 2, address: 'inbox@example.com', provisioningMode: 'MANUAL' },
    }));

    try {
        const result = await messageService.getById('84');
        assert.equal(result.id, '84');
        assert.equal(result.subject, 'Admin visible');
    } finally {
        mock.restoreAll();
    }
});
