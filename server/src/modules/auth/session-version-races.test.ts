import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://tester:tester@127.0.0.1:15433/all_mail_test';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6380/0';
process.env.JWT_SECRET ??= 'test-jwt-secret-1234567890abcdef';
process.env.ENCRYPTION_KEY ??= 'test-encryption-key-1234567890ab';
process.env.ADMIN_PASSWORD ??= 'test-admin-password';

function overrideMethod(target: object, key: PropertyKey, replacement: unknown) {
    const original = Reflect.get(target, key);
    Reflect.set(target, key, replacement);
    return () => {
        Reflect.set(target, key, original);
    };
}

function createBarrier() {
    let release: () => void = () => undefined;
    const promise = new Promise<void>((resolve) => {
        release = resolve;
    });
    return { promise, release };
}

void test('admin request after concurrent password rotation cannot mutate or receive a bridged cookie', async () => {
    const [
        { buildApp },
        { default: prisma },
        { signToken },
        { hashPassword },
    ] = await Promise.all([
        import('../../app.js'),
        import('../../lib/prisma.js'),
        import('../../lib/jwt.js'),
        import('../../lib/crypto.js'),
    ]);
    const passwordHash = await hashPassword('old-password');
    const identityRead = createBarrier();
    const continueIdentityRead = createBarrier();
    let currentVersion = 1;
    let mutationCalls = 0;
    const admin = {
        id: 1,
        username: 'admin',
        role: 'SUPER_ADMIN' as const,
        status: 'ACTIVE' as const,
        mustChangePassword: false,
        passwordHash,
        sessionVersion: 1,
    };
    const restores = [
        overrideMethod(prisma, '$queryRaw', async () => [{ session_version: currentVersion }]),
        overrideMethod(prisma.admin, 'findUnique', async ({ select }: { select?: Record<string, unknown> }) => {
            if (select?.role && !select.passwordHash) {
                identityRead.release();
                await continueIdentityRead.promise;
                return admin;
            }
            return { ...admin, sessionVersion: currentVersion };
        }),
        overrideMethod(prisma.admin, 'findFirst', async ({ where }: { where: Record<string, unknown> }) => (
            where.sessionVersion === currentVersion
                ? { ...admin, sessionVersion: currentVersion }
                : null
        )),
        overrideMethod(prisma.admin, 'update', async () => {
            mutationCalls += 1;
            currentVersion += 1;
            return admin;
        }),
        overrideMethod(prisma.admin, 'updateMany', async ({ where }: { where: Record<string, unknown> }) => {
            if (where.sessionVersion !== currentVersion) {
                return { count: 0 };
            }
            mutationCalls += 1;
            currentVersion += 1;
            return { count: 1 };
        }),
    ];
    const app = await buildApp();

    try {
        const token = await signToken({
            sub: '1',
            username: 'admin',
            role: 'SUPER_ADMIN',
        }, { audience: 'admin-console' });
        const responsePromise = app.inject({
            method: 'POST',
            url: '/admin/auth/change-password',
            headers: { authorization: `Bearer ${token}` },
            payload: { oldPassword: 'old-password', newPassword: 'new-password-123' },
        });

        await identityRead.promise;
        currentVersion = 2;
        continueIdentityRead.release();
        const response = await responsePromise;

        assert.equal(response.statusCode, 401);
        assert.equal(JSON.parse(response.payload).error.code, 'INVALID_TOKEN');
        assert.equal(mutationCalls, 0);
        assert.equal(response.headers['set-cookie'], undefined);
    } finally {
        continueIdentityRead.release();
        await app.close();
        while (restores.length > 0) {
            restores.pop()?.();
        }
    }
});

void test('mailbox request after concurrent 2FA rotation cannot mutate or receive a bridged cookie', async () => {
    const [
        { buildApp },
        { default: prisma },
        { signToken },
        { hashPassword },
    ] = await Promise.all([
        import('../../app.js'),
        import('../../lib/prisma.js'),
        import('../../lib/jwt.js'),
        import('../../lib/crypto.js'),
    ]);
    const passwordHash = await hashPassword('old-password');
    const identityRead = createBarrier();
    const continueIdentityRead = createBarrier();
    let currentVersion = 1;
    let mutationCalls = 0;
    const mailboxUser = {
        id: 1,
        username: 'portal-user',
        status: 'ACTIVE' as const,
        mustChangePassword: false,
        passwordHash,
        sessionVersion: 1,
    };
    const restores = [
        overrideMethod(prisma, '$queryRaw', async () => [{ session_version: currentVersion }]),
        overrideMethod(prisma.mailboxUser, 'findUnique', async ({ select }: { select?: Record<string, unknown> }) => {
            if (select?.status && !select.passwordHash) {
                identityRead.release();
                await continueIdentityRead.promise;
                return mailboxUser;
            }
            return { ...mailboxUser, sessionVersion: currentVersion };
        }),
        overrideMethod(prisma.mailboxUser, 'findFirst', async ({ where }: { where: Record<string, unknown> }) => (
            where.sessionVersion === currentVersion
                ? { ...mailboxUser, sessionVersion: currentVersion }
                : null
        )),
        overrideMethod(prisma.mailboxUser, 'updateMany', async ({ where }: { where: Record<string, unknown> }) => {
            if (where.sessionVersion !== currentVersion) {
                return { count: 0 };
            }
            mutationCalls += 1;
            currentVersion += 1;
            return { count: 1 };
        }),
        overrideMethod(prisma.domainMailbox, 'findMany', async () => [{ id: 1 }]),
        overrideMethod(prisma.mailboxMembership, 'findMany', async () => []),
    ];
    const app = await buildApp();

    try {
        const token = await signToken({
            sub: '1',
            mailboxUserId: 1,
            username: 'portal-user',
            role: 'MAILBOX_USER',
            mailboxIds: [1],
        }, { audience: 'mailbox-portal' });
        const responsePromise = app.inject({
            method: 'POST',
            url: '/mail/api/change-password',
            headers: { authorization: `Bearer ${token}` },
            payload: { oldPassword: 'old-password', newPassword: 'new-password-123' },
        });

        await identityRead.promise;
        currentVersion = 2;
        continueIdentityRead.release();
        const response = await responsePromise;

        assert.equal(response.statusCode, 401);
        assert.equal(JSON.parse(response.payload).error.code, 'INVALID_MAILBOX_TOKEN');
        assert.equal(mutationCalls, 0);
        assert.equal(response.headers['set-cookie'], undefined);
    } finally {
        continueIdentityRead.release();
        await app.close();
        while (restores.length > 0) {
            restores.pop()?.();
        }
    }
});
