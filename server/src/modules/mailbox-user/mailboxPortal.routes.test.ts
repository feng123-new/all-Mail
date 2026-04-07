import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://tester:tester@127.0.0.1:15433/all_mail_test';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6380/0';
process.env.JWT_SECRET ??= 'test-jwt-secret-1234567890abcdef';
process.env.ENCRYPTION_KEY ??= 'test-encryption-key-1234567890ab';
process.env.ADMIN_PASSWORD ??= 'test-admin-password';

async function createMailboxToken(mailboxUserId: number) {
    const { signToken } = await import('../../lib/jwt.js');
    return signToken({
        sub: String(mailboxUserId),
        mailboxUserId,
        username: 'portal-user',
        role: 'MAILBOX_USER',
        mailboxIds: [1],
    }, { audience: 'mailbox-portal' });
}

async function mockMailboxAuthContext(options?: { mustChangePassword?: boolean; mailboxIds?: number[] }) {
    const { default: prisma } = await import('../../lib/prisma.js');
    const mailboxIds = options?.mailboxIds ?? [1];

    const originalMailboxUserFindUnique = prisma.mailboxUser.findUnique.bind(prisma.mailboxUser);
    const originalDomainMailboxFindMany = prisma.domainMailbox.findMany.bind(prisma.domainMailbox);
    const originalMailboxMembershipFindMany = prisma.mailboxMembership.findMany.bind(prisma.mailboxMembership);

    prisma.mailboxUser.findUnique = (async () => ({
        id: 1,
        username: 'portal-user',
        status: 'ACTIVE',
        mustChangePassword: options?.mustChangePassword ?? false,
    })) as typeof prisma.mailboxUser.findUnique;
    prisma.domainMailbox.findMany = (async () => mailboxIds.map((id) => ({ id }))) as typeof prisma.domainMailbox.findMany;
    prisma.mailboxMembership.findMany = (async () => []) as typeof prisma.mailboxMembership.findMany;

    return () => {
        prisma.mailboxUser.findUnique = originalMailboxUserFindUnique;
        prisma.domainMailbox.findMany = originalDomainMailboxFindMany;
        prisma.mailboxMembership.findMany = originalMailboxMembershipFindMany;
    };
}

void test('portal messages forward accessible mailbox ids to messageService when mailboxId is omitted', async () => {
    const [{ buildApp }, { messageService }] = await Promise.all([
        import('../../app.js'),
        import('../message/message.service.js'),
    ]);

    const restoreAuthContext = await mockMailboxAuthContext({ mailboxIds: [1, 2] });

    let capturedInput: unknown;
    let capturedOptions: unknown;
    mock.method(messageService, 'list', async (input: unknown, options?: unknown) => {
        capturedInput = input;
        capturedOptions = options;
        return { list: [], total: 0, page: 1, pageSize: 20 };
    });

    const app = await buildApp();
    try {
        const token = await createMailboxToken(1);
        const response = await app.inject({
            method: 'GET',
            url: '/mail/api/messages?unreadOnly=true&page=1&pageSize=20',
            headers: { authorization: `Bearer ${token}` },
        });

        assert.equal(response.statusCode, 200);
        assert.deepEqual(capturedInput, {
            page: 1,
            pageSize: 20,
            unreadOnly: true,
            mailboxId: undefined,
            allowedMailboxIds: [1, 2],
        });
        assert.deepEqual(capturedOptions, { portalVisibleOnly: true });
    } finally {
        restoreAuthContext();
        mock.restoreAll();
        await app.close();
    }
});

void test('portal messages reject an explicit mailbox outside the user scope', async () => {
    const [{ buildApp }, { messageService }] = await Promise.all([
        import('../../app.js'),
        import('../message/message.service.js'),
    ]);

    const restoreAuthContext = await mockMailboxAuthContext({ mailboxIds: [1] });
    const listMock = mock.method(messageService, 'list', async () => ({
        list: [],
        total: 0,
        page: 1,
        pageSize: 20,
    }));

    const app = await buildApp();
    try {
        const token = await createMailboxToken(1);
        const response = await app.inject({
            method: 'GET',
            url: '/mail/api/messages?mailboxId=2',
            headers: { authorization: `Bearer ${token}` },
        });

        assert.equal(response.statusCode, 403);
        const body = JSON.parse(response.payload) as { error: { code: string } };
        assert.equal(body.error.code, 'FORBIDDEN_MAILBOX');
        assert.equal(listMock.mock.calls.length, 0);
    } finally {
        restoreAuthContext();
        mock.restoreAll();
        await app.close();
    }
});

void test('portal forwarding jobs forward accessible mailbox ids to mailboxUserService when mailboxId is omitted', async () => {
    const [{ buildApp }, { mailboxUserService }] = await Promise.all([
        import('../../app.js'),
        import('./mailboxUser.service.js'),
    ]);

    const restoreAuthContext = await mockMailboxAuthContext({ mailboxIds: [1, 2] });

    let capturedUserId: unknown;
    let capturedInput: unknown;
    mock.method(mailboxUserService, 'listForwardingJobs', async (userId: number, input: unknown) => {
        capturedUserId = userId;
        capturedInput = input;
        return { list: [], total: 0, page: 1, pageSize: 10 };
    });

    const app = await buildApp();
    try {
        const token = await createMailboxToken(1);
        const response = await app.inject({
            method: 'GET',
            url: '/mail/api/forwarding-jobs?page=1&pageSize=10',
            headers: { authorization: `Bearer ${token}` },
        });

        assert.equal(response.statusCode, 200);
        assert.equal(capturedUserId, 1);
        assert.deepEqual(capturedInput, {
            page: 1,
            pageSize: 10,
        });
    } finally {
        restoreAuthContext();
        mock.restoreAll();
        await app.close();
    }
});

void test('portal forwarding jobs reject an explicit mailbox outside the user scope', async () => {
    const [{ buildApp }, { mailboxUserService }] = await Promise.all([
        import('../../app.js'),
        import('./mailboxUser.service.js'),
    ]);

    const restoreAuthContext = await mockMailboxAuthContext({ mailboxIds: [1] });
    const listMock = mock.method(mailboxUserService, 'listForwardingJobs', async () => ({
        list: [],
        total: 0,
        page: 1,
        pageSize: 10,
    }));

    const app = await buildApp();
    try {
        const token = await createMailboxToken(1);
        const response = await app.inject({
            method: 'GET',
            url: '/mail/api/forwarding-jobs?mailboxId=2',
            headers: { authorization: `Bearer ${token}` },
        });

        assert.equal(response.statusCode, 403);
        assert.equal(JSON.parse(response.payload).error.code, 'FORBIDDEN_MAILBOX');
        assert.equal(listMock.mock.calls.length, 0);
    } finally {
        restoreAuthContext();
        mock.restoreAll();
        await app.close();
    }
});

void test('mailbox must-change-password blocks portal message access but still allows session and password change', async () => {
    const [{ buildApp }, { mailboxUserService }, { messageService }] = await Promise.all([
        import('../../app.js'),
        import('./mailboxUser.service.js'),
        import('../message/message.service.js'),
    ]);

    const restoreAuthContext = await mockMailboxAuthContext({ mustChangePassword: true, mailboxIds: [1] });

    const listMock = mock.method(messageService, 'list', async () => ({
        list: [],
        total: 0,
        page: 1,
        pageSize: 20,
    }));
    const sessionMock = mock.method(mailboxUserService, 'getSession', async () => ({
        authenticated: true,
        mailboxUser: {
            id: 1,
            username: 'portal-user',
            mustChangePassword: true,
            mailboxIds: [1],
        },
    }));
    const changePasswordMock = mock.method(mailboxUserService, 'changePassword', async () => ({ success: true }));

    const app = await buildApp();
    try {
        const token = await createMailboxToken(1);

        const blockedResponse = await app.inject({
            method: 'GET',
            url: '/mail/api/messages',
            headers: { authorization: `Bearer ${token}` },
        });
        assert.equal(blockedResponse.statusCode, 403);
        assert.equal(JSON.parse(blockedResponse.payload).error.code, 'PASSWORD_CHANGE_REQUIRED');
        assert.equal(listMock.mock.calls.length, 0);

        const sessionResponse = await app.inject({
            method: 'GET',
            url: '/mail/api/session',
            headers: { authorization: `Bearer ${token}` },
        });
        assert.equal(sessionResponse.statusCode, 200);
        assert.equal(sessionMock.mock.calls.length, 1);

        const changePasswordResponse = await app.inject({
            method: 'POST',
            url: '/mail/api/change-password',
            headers: { authorization: `Bearer ${token}` },
            payload: { oldPassword: 'old-password', newPassword: 'new-password-123' },
        });
        assert.equal(changePasswordResponse.statusCode, 200);
        assert.equal(changePasswordMock.mock.calls.length, 1);
    } finally {
        restoreAuthContext();
        mock.restoreAll();
        await app.close();
    }
});

void test('portal message detail marks the message as read inside the user mailbox scope', async () => {
    const [{ buildApp }, { messageService }] = await Promise.all([
        import('../../app.js'),
        import('../message/message.service.js'),
    ]);

    const restoreAuthContext = await mockMailboxAuthContext({ mailboxIds: [1] });

    let getByIdOptions: unknown;
    mock.method(messageService, 'getById', async (_id: string, options?: unknown) => {
        getByIdOptions = options;
        return {
        id: '42',
        fromAddress: 'sender@example.com',
        toAddress: 'mailbox@example.com',
        subject: 'Test',
        textPreview: 'hello',
        htmlPreview: '<p>hello</p>',
        verificationCode: null,
        routeKind: 'DIRECT',
        receivedAt: new Date().toISOString(),
        storageStatus: 'READY',
        isRead: false,
        isDeleted: false,
        mailbox: { id: 1, address: 'mailbox@example.com', provisioningMode: 'API_POOL' },
        domain: { id: 1, name: 'example.com', canSend: true, canReceive: true },
    };
    });
    let marked: unknown;
    mock.method(messageService, 'markRead', async (id: string, mailboxIds?: number[]) => {
        marked = { id, mailboxIds };
        return { updated: true };
    });

    const app = await buildApp();
    try {
        const token = await createMailboxToken(1);
        const response = await app.inject({
            method: 'GET',
            url: '/mail/api/messages/42',
            headers: { authorization: `Bearer ${token}` },
        });

        assert.equal(response.statusCode, 200);
        assert.deepEqual(marked, { id: '42', mailboxIds: [1] });
        assert.deepEqual(getByIdOptions, { portalVisibleOnly: true });
        assert.equal(JSON.parse(response.payload).data.isRead, true);
    } finally {
        restoreAuthContext();
        mock.restoreAll();
        await app.close();
    }
});

void test('portal message detail returns not found for a hidden forwarded MOVE message', async () => {
    const [{ buildApp }, { messageService }, { AppError }] = await Promise.all([
        import('../../app.js'),
        import('../message/message.service.js'),
        import('../../plugins/error.js'),
    ]);

    const restoreAuthContext = await mockMailboxAuthContext({ mailboxIds: [1] });

    mock.method(messageService, 'getById', async () => {
        throw new AppError('INBOUND_MESSAGE_NOT_FOUND', 'Inbound message not found', 404);
    });
    const markReadMock = mock.method(messageService, 'markRead', async () => ({ updated: true }));

    const app = await buildApp();
    try {
        const token = await createMailboxToken(1);
        const response = await app.inject({
            method: 'GET',
            url: '/mail/api/messages/99',
            headers: { authorization: `Bearer ${token}` },
        });

        assert.equal(response.statusCode, 404);
        assert.equal(JSON.parse(response.payload).error.code, 'INBOUND_MESSAGE_NOT_FOUND');
        assert.equal(markReadMock.mock.calls.length, 0);
    } finally {
        restoreAuthContext();
        mock.restoreAll();
        await app.close();
    }
});
