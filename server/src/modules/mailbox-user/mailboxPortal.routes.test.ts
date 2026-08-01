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

function headerValue(value: string | string[] | undefined): string {
    return Array.isArray(value) ? value.join('; ') : (value ?? '');
}

async function mockMailboxAuthContext(options?: { mustChangePassword?: boolean; mailboxIds?: number[] }) {
    const { default: prisma } = await import('../../lib/prisma.js');
    const mailboxIds = options?.mailboxIds ?? [1];

    const originalMailboxUserFindUnique = prisma.mailboxUser.findUnique.bind(prisma.mailboxUser);
    const originalDomainMailboxFindMany = prisma.domainMailbox.findMany.bind(prisma.domainMailbox);
    const originalMailboxMembershipFindMany = prisma.mailboxMembership.findMany.bind(prisma.mailboxMembership);

    Reflect.set(prisma.mailboxUser, 'findUnique', async () => ({
        id: 1,
        username: 'portal-user',
        status: 'ACTIVE',
        mustChangePassword: options?.mustChangePassword ?? false,
    }));
    Reflect.set(prisma.domainMailbox, 'findMany', async () => mailboxIds.map((id) => ({ id })));
    Reflect.set(prisma.mailboxMembership, 'findMany', async () => []);

    return () => {
        Reflect.set(prisma.mailboxUser, 'findUnique', originalMailboxUserFindUnique);
        Reflect.set(prisma.domainMailbox, 'findMany', originalDomainMailboxFindMany);
        Reflect.set(prisma.mailboxMembership, 'findMany', originalMailboxMembershipFindMany);
    };
}

void test('portal messages pass the authenticated user id to the current-state scoped service', async () => {
    const [{ buildApp }, { messageService }] = await Promise.all([
        import('../../app.js'),
        import('../message/message.service.js'),
    ]);

    const restoreAuthContext = await mockMailboxAuthContext({ mailboxIds: [1, 2] });

    let capturedInput: unknown;
    let capturedUserId: unknown;
    mock.method(messageService, 'listForMailboxUser', async (userId: number, input: unknown) => {
        capturedUserId = userId;
        capturedInput = input;
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
		assert.equal(capturedUserId, 1);
        assert.deepEqual(capturedInput, {
            page: 1,
            pageSize: 20,
            unreadOnly: true,
            mailboxId: undefined,
        });
    } finally {
        restoreAuthContext();
        mock.restoreAll();
        await app.close();
    }
});

void test('portal messages defer explicit mailbox authorization to the current-state scoped service', async () => {
    const [{ buildApp }, { messageService }] = await Promise.all([
        import('../../app.js'),
        import('../message/message.service.js'),
    ]);

    const restoreAuthContext = await mockMailboxAuthContext({ mailboxIds: [1] });
    let capturedUserId: unknown;
    let capturedInput: unknown;
    const listMock = mock.method(messageService, 'listForMailboxUser', async (userId: number, input: unknown) => {
		capturedUserId = userId;
		capturedInput = input;
		return {
        list: [],
        total: 0,
        page: 1,
        pageSize: 20,
		};
	});

    const app = await buildApp();
    try {
        const token = await createMailboxToken(1);
        const response = await app.inject({
            method: 'GET',
            url: '/mail/api/messages?mailboxId=2',
            headers: { authorization: `Bearer ${token}` },
        });

        assert.equal(response.statusCode, 200);
		assert.equal(capturedUserId, 1);
		assert.deepEqual(capturedInput, { page: 1, pageSize: 20, unreadOnly: false, mailboxId: 2 });
        assert.equal(listMock.mock.calls.length, 1);
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

    const listMock = mock.method(messageService, 'listForMailboxUser', async () => ({
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
    const changePasswordMock = mock.method(mailboxUserService, 'changePassword', async () => ({
        success: true,
        sessionVersion: 2,
    }));

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

        const twoFactorResponse = await app.inject({
            method: 'GET',
            url: '/mail/api/2fa/status',
            headers: { authorization: `Bearer ${token}` },
        });
        assert.equal(twoFactorResponse.statusCode, 403);
        assert.equal(JSON.parse(twoFactorResponse.payload).error.code, 'PASSWORD_CHANGE_REQUIRED');

        const changePasswordResponse = await app.inject({
            method: 'POST',
            url: '/mail/api/change-password',
            headers: { authorization: `Bearer ${token}` },
            payload: { oldPassword: 'old-password', newPassword: 'new-password-123' },
        });
        assert.equal(changePasswordResponse.statusCode, 200);
        assert.equal(changePasswordMock.mock.calls.length, 1);
        assert.match(headerValue(changePasswordResponse.headers['set-cookie']), /mailbox_token=/);
    } finally {
        restoreAuthContext();
        mock.restoreAll();
        await app.close();
    }
});

void test('portal message detail uses one current-state scoped read-and-mark operation', async () => {
    const [{ buildApp }, { messageService }] = await Promise.all([
        import('../../app.js'),
        import('../message/message.service.js'),
    ]);

    const restoreAuthContext = await mockMailboxAuthContext({ mailboxIds: [1] });

    let captured: unknown;
    mock.method(messageService, 'getForMailboxUser', async (userId: number, id: string) => {
		captured = { userId, id };
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
        isRead: true,
        isDeleted: false,
        mailbox: { id: 1, address: 'mailbox@example.com', provisioningMode: 'API_POOL' },
        domain: { id: 1, name: 'example.com', canSend: true, canReceive: true },
    };
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
		assert.deepEqual(captured, { userId: 1, id: '42' });
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

    mock.method(messageService, 'getForMailboxUser', async () => {
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

void test('mailbox login schema forwards an optional OTP to the fallback service', async () => {
    const [{ buildApp }, { mailboxUserService }] = await Promise.all([
        import('../../app.js'),
        import('./mailboxUser.service.js'),
    ]);
    let capturedInput: unknown;
    mock.method(mailboxUserService, 'login', async (input: unknown) => {
        capturedInput = input;
        return {
            token: 'mailbox-token',
            mailboxUser: {
                id: 1,
                username: 'portal-user',
                email: null,
                mustChangePassword: false,
                mailboxIds: [1],
            },
        };
    });
    const app = await buildApp();
    try {
        const response = await app.inject({
            method: 'POST',
            url: '/mail/api/login',
            payload: { username: ' portal-user ', password: 'password', otp: '123456' },
        });
        assert.equal(response.statusCode, 200);
        assert.deepEqual(capturedInput, {
            username: 'portal-user',
            password: 'password',
            otp: '123456',
        });
        assert.match(headerValue(response.headers['set-cookie']), /mailbox_token=mailbox-token/);
    } finally {
        mock.restoreAll();
        await app.close();
    }
});

void test('mailbox two-factor routes expose shared state and rotate compatible cookies after mutations', async () => {
    const [{ buildApp }, { mailboxUserService }, { decodeToken }] = await Promise.all([
        import('../../app.js'),
        import('./mailboxUser.service.js'),
        import('../../lib/jwt.js'),
    ]);
    const restoreAuthContext = await mockMailboxAuthContext({ mailboxIds: [1] });
    mock.method(mailboxUserService, 'getTwoFactorStatus', async () => ({ enabled: false, pending: true }));
    mock.method(mailboxUserService, 'setupTwoFactor', async () => ({
        secret: 'JBSWY3DPEHPK3PXP',
        otpauthUrl: 'otpauth://totp/all-Mail%3Aportal-user?secret=JBSWY3DPEHPK3PXP',
        sessionVersion: 2,
    }));
    mock.method(mailboxUserService, 'enableTwoFactor', async () => ({ enabled: true, sessionVersion: 2 }));
    mock.method(mailboxUserService, 'disableTwoFactor', async () => ({ enabled: false, sessionVersion: 2 }));
    const app = await buildApp();
    try {
        const token = await createMailboxToken(1);
        const headers = { authorization: `Bearer ${token}` };

        const statusResponse = await app.inject({ method: 'GET', url: '/mail/api/2fa/status', headers });
        assert.equal(statusResponse.statusCode, 200);
        assert.deepEqual(JSON.parse(statusResponse.payload).data, { enabled: false, pending: true });
        assert.equal(statusResponse.headers['set-cookie'], undefined);

        const setupResponse = await app.inject({ method: 'POST', url: '/mail/api/2fa/setup', headers });
        assert.equal(setupResponse.statusCode, 200);

        const enableResponse = await app.inject({
            method: 'POST',
            url: '/mail/api/2fa/enable',
            headers,
            payload: { otp: '123456' },
        });
        assert.equal(enableResponse.statusCode, 200);

        const disableResponse = await app.inject({
            method: 'POST',
            url: '/mail/api/2fa/disable',
            headers,
            payload: { password: 'current-password', otp: '123456' },
        });
        assert.equal(disableResponse.statusCode, 200);

        for (const response of [setupResponse, enableResponse, disableResponse]) {
            const cookie = headerValue(response.headers['set-cookie']);
            assert.match(cookie, /mailbox_token=/);
            assert.match(cookie, /Max-Age=7200/);
            assert.match(cookie, /Path=\//);
            assert.match(cookie, /HttpOnly/);
            assert.match(cookie, /SameSite=Lax/);
            const token = response.cookies.find((item) => item.name === 'mailbox_token');
            assert.ok(token);
            assert.equal(decodeToken(token.value)?.sessionVersion, 2);
        }
    } finally {
        restoreAuthContext();
        mock.restoreAll();
        await app.close();
    }
});

void test('mailbox two-factor no-op mutations do not rotate the session cookie', async () => {
    const [{ buildApp }, { mailboxUserService }] = await Promise.all([
        import('../../app.js'),
        import('./mailboxUser.service.js'),
    ]);
    const restoreAuthContext = await mockMailboxAuthContext({ mailboxIds: [1] });
    mock.method(mailboxUserService, 'enableTwoFactor', async () => ({ enabled: true, sessionVersion: 1 }));
    mock.method(mailboxUserService, 'disableTwoFactor', async () => ({ enabled: false, sessionVersion: 1 }));
    const app = await buildApp();

    try {
        const token = await createMailboxToken(1);
        const headers = { authorization: `Bearer ${token}` };
        const enableResponse = await app.inject({
            method: 'POST',
            url: '/mail/api/2fa/enable',
            headers,
            payload: { otp: '123456' },
        });
        const disableResponse = await app.inject({
            method: 'POST',
            url: '/mail/api/2fa/disable',
            headers,
            payload: { password: 'current-password', otp: '123456' },
        });

        assert.equal(enableResponse.statusCode, 200);
        assert.equal(disableResponse.statusCode, 200);
        assert.equal(enableResponse.headers['set-cookie'], undefined);
        assert.equal(disableResponse.headers['set-cookie'], undefined);
    } finally {
        restoreAuthContext();
        mock.restoreAll();
        await app.close();
    }
});
