import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

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

void test('mailbox login enforces enabled TOTP, preserves pending password-only login, and clears exact lockout state', async () => {
    const [
        { default: prisma },
        { mailboxUserService },
        { mailboxLoginAttempts },
        { decodeToken },
        { encrypt, hashPassword },
        { generateTotpCodeAt },
    ] = await Promise.all([
        import('../../lib/prisma.js'),
        import('./mailboxUser.service.js'),
        import('../auth/login-attempts.js'),
        import('../../lib/jwt.js'),
        import('../../lib/crypto.js'),
        import('../auth/totp.js'),
    ]);
    const secret = 'JBSWY3DPEHPK3PXP';
    const passwordHash = await hashPassword('correct-password');
    const user = {
        id: 17,
        username: 'portal-user',
        email: 'portal@example.test',
        passwordHash,
        status: 'ACTIVE' as const,
        mustChangePassword: false,
        sessionVersion: 4,
        twoFactorEnabled: true,
        twoFactorSecret: encrypt(secret),
    };
    const cacheKeys = { lock: '', failure: '', clear: '' };
    mock.method(mailboxLoginAttempts, 'getLockRemainingSeconds', async (key: string) => {
        cacheKeys.lock = key;
        return 0;
    });
    mock.method(mailboxLoginAttempts, 'recordFailure', async (key: string) => {
        cacheKeys.failure = key;
        return 0;
    });
    mock.method(mailboxLoginAttempts, 'clear', async (key: string) => {
        cacheKeys.clear = key;
    });
    const restores = [
        overrideMethod(prisma.mailboxUser, 'findFirst', async () => user),
        overrideMethod(prisma.domainMailbox, 'findMany', async () => [{ id: 11 }]),
        overrideMethod(prisma.mailboxMembership, 'findMany', async () => [{ mailboxId: 12 }]),
        overrideMethod(prisma.mailboxUser, 'updateMany', async () => ({ count: 1 })),
        overrideMethod(prisma, '$queryRaw', async () => [{ session_version: 4 }]),
    ];

    try {
        await assert.rejects(
            () => mailboxUserService.login({ username: 'portal-user', password: 'correct-password' }, '203.0.113.8'),
            (error: unknown) => {
                assert.equal((error as { code?: string }).code, 'OTP_REQUIRED');
                return true;
            },
        );
		assert.equal(cacheKeys.failure, '');
        const otp = generateTotpCodeAt(secret, Date.now());
        const enabledResult = await mailboxUserService.login({
            username: 'portal-user',
            password: 'correct-password',
            otp,
        }, '203.0.113.8');
        assert.deepEqual(enabledResult.mailboxUser.mailboxIds, [11, 12]);
        assert.equal(decodeToken(enabledResult.token)?.sessionVersion, 4);

        user.twoFactorEnabled = false;
        const pendingResult = await mailboxUserService.login({
            username: 'portal-user',
            password: 'correct-password',
        }, '203.0.113.8');
        assert.equal(pendingResult.mailboxUser.id, 17);
        assert.deepEqual(cacheKeys, {
            lock: 'mailbox-login:portal-user:203.0.113.8',
            failure: '',
            clear: 'mailbox-login:portal-user:203.0.113.8',
        });
    } finally {
        while (restores.length > 0) {
            restores.pop()?.();
        }
        mock.restoreAll();
    }
});

void test('mailbox login fails closed before querying credentials when lockout backend is unavailable', async () => {
    const [
        { default: prisma },
        { mailboxUserService },
        { mailboxLoginAttempts },
        { AppError },
    ] = await Promise.all([
        import('../../lib/prisma.js'),
        import('./mailboxUser.service.js'),
        import('../auth/login-attempts.js'),
        import('../../plugins/error.js'),
    ]);
    let findUserCalls = 0;
    const restoreFindUser = overrideMethod(prisma.mailboxUser, 'findFirst', (async () => {
        findUserCalls += 1;
        return null;
    }));
    mock.method(mailboxLoginAttempts, 'getLockRemainingSeconds', async () => {
        throw new AppError(
            'LOGIN_SECURITY_BACKEND_UNAVAILABLE',
            'Login protection backend is unavailable',
            503,
        );
    });

    try {
        await assert.rejects(
            () => mailboxUserService.login({ username: 'portal-user', password: 'password' }, '127.0.0.1'),
            (error: unknown) => {
                const appError = error as { code?: string; statusCode?: number };
                assert.equal(appError.code, 'LOGIN_SECURITY_BACKEND_UNAVAILABLE');
                assert.equal(appError.statusCode, 503);
                return true;
            },
        );
        assert.equal(findUserCalls, 0);
    } finally {
        restoreFindUser();
        mock.restoreAll();
    }
});

void test('mailbox two-factor lifecycle uses encrypted pending secret and trigger-versioned state transitions', async () => {
    const [
        { default: prisma },
        { mailboxUserService },
        { decrypt, hashPassword },
        { generateTotpCodeAt },
    ] = await Promise.all([
        import('../../lib/prisma.js'),
        import('./mailboxUser.service.js'),
        import('../../lib/crypto.js'),
        import('../auth/totp.js'),
    ]);
    const state = {
        id: 17,
        username: 'portal-user',
        passwordHash: await hashPassword('current-password'),
        twoFactorEnabled: false,
        twoFactorSecret: null as string | null,
        sessionVersion: 1,
    };
    const restoreFindUser = overrideMethod(prisma.mailboxUser, 'findFirst', async () => ({ ...state }));
    const restoreUpdateUser = overrideMethod(prisma.mailboxUser, 'updateMany', async ({ data }: { data: Record<string, unknown> }) => {
        if ('twoFactorSecret' in data) {
            state.twoFactorSecret = data.twoFactorSecret as string | null;
        }
        if ('twoFactorEnabled' in data) {
            state.twoFactorEnabled = Boolean(data.twoFactorEnabled);
        }
        state.sessionVersion += 1;
        return { count: 1 };
    });

    try {
        const setup = await mailboxUserService.setupTwoFactor(17, 1);
        assert.equal(setup.secret.length, 32);
        assert.match(setup.otpauthUrl, /^otpauth:\/\/totp\/all-Mail%3Aportal-user\?/);
        assert.ok(state.twoFactorSecret);
        assert.equal(decrypt(state.twoFactorSecret), setup.secret);
        assert.equal(state.sessionVersion, 2);
        assert.deepEqual(await mailboxUserService.getTwoFactorStatus(17, 2), {
            enabled: false,
            pending: true,
        });

        const otp = generateTotpCodeAt(setup.secret, Date.now());
        assert.deepEqual(await mailboxUserService.enableTwoFactor(17, 2, { otp }), {
            enabled: true,
            sessionVersion: 3,
        });
        assert.equal(state.twoFactorEnabled, true);
        assert.equal(state.sessionVersion, 3);

        assert.deepEqual(await mailboxUserService.disableTwoFactor(17, 3, {
            password: 'current-password',
            otp,
        }), { enabled: false, sessionVersion: 4 });
        assert.equal(state.twoFactorEnabled, false);
        assert.equal(state.twoFactorSecret, null);
        assert.equal(state.sessionVersion, 4);
    } finally {
        restoreUpdateUser();
        restoreFindUser();
        mock.restoreAll();
    }
});

void test('mailbox login signs only the version confirmed by its CAS when a later rotation wins', async () => {
    const [
        { default: prisma },
        { mailboxUserService },
        { mailboxLoginAttempts },
        { decodeToken },
        { hashPassword },
    ] = await Promise.all([
        import('../../lib/prisma.js'),
        import('./mailboxUser.service.js'),
        import('../auth/login-attempts.js'),
        import('../../lib/jwt.js'),
        import('../../lib/crypto.js'),
    ]);
    const user = {
        id: 17,
        username: 'portal-user',
        email: null,
        passwordHash: await hashPassword('correct-password'),
        status: 'ACTIVE' as const,
        mustChangePassword: false,
        sessionVersion: 4,
        twoFactorEnabled: false,
        twoFactorSecret: null,
    };
    let currentVersion = 4;
    let casVersion: unknown;
    mock.method(mailboxLoginAttempts, 'getLockRemainingSeconds', async () => 0);
    mock.method(mailboxLoginAttempts, 'clear', async () => undefined);
    const restores = [
        overrideMethod(prisma.mailboxUser, 'findFirst', async () => user),
        overrideMethod(prisma.domainMailbox, 'findMany', async () => [{ id: 11 }]),
        overrideMethod(prisma.mailboxMembership, 'findMany', async () => []),
        overrideMethod(prisma.mailboxUser, 'updateMany', async ({ where }: { where: Record<string, unknown> }) => {
            casVersion = where.sessionVersion;
            currentVersion = 5;
            return { count: 1 };
        }),
        overrideMethod(prisma, '$queryRaw', async () => [{ session_version: currentVersion }]),
    ];

    try {
        const result = await mailboxUserService.login({
            username: 'portal-user',
            password: 'correct-password',
        }, '127.0.0.1');
        assert.equal(casVersion, 4);
        assert.equal(currentVersion, 5);
        assert.equal(decodeToken(result.token)?.sessionVersion, 4);
    } finally {
        while (restores.length > 0) {
            restores.pop()?.();
        }
        mock.restoreAll();
    }
});
