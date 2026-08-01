import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgresql://tester:tester@127.0.0.1:15433/all_mail_test';
process.env.REDIS_URL = '';
process.env.JWT_SECRET ??= 'test-jwt-secret-1234567890abcdef';
process.env.ENCRYPTION_KEY ??= 'test-encryption-key-1234567890ab';

function overrideMethod(target: object, key: PropertyKey, replacement: unknown) {
    const original = Reflect.get(target, key);
    Reflect.set(target, key, replacement);
    return () => {
        Reflect.set(target, key, original);
    };
}

function nullableString(value: unknown): string | null {
    if (value === null || typeof value === 'string') {
        return value;
    }
    throw new TypeError('Expected a nullable string');
}

void test('login fails closed when 2FA is enabled without a persisted secret', async () => {
    const [{ authService }, { default: prisma }, { hashPassword }] = await Promise.all([
        import('./auth.service.js'),
        import('../../lib/prisma.js'),
        import('../../lib/crypto.js'),
    ]);

    const passwordHash = await hashPassword('correct-password');

    const restoreFindUnique = overrideMethod(prisma.admin, 'findUnique', async () => ({
        id: 7,
        username: 'broken-2fa-admin',
        passwordHash,
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        mustChangePassword: false,
        twoFactorEnabled: true,
        twoFactorSecret: null,
        sessionVersion: 1,
    }));
    try {
        await assert.rejects(
            () => authService.login({
                username: 'broken-2fa-admin',
                password: 'correct-password',
                otp: '123456',
            }, '127.0.0.1'),
            (error: unknown) => {
                const appError = error as { code?: string; statusCode?: number };
                assert.equal(appError.code, 'TWO_FACTOR_CONFIGURATION_INVALID');
                assert.equal(appError.statusCode, 500);
                return true;
            },
        );
    } finally {
        restoreFindUnique();
    }
});

void test('admin login requests a missing OTP without consuming a failure attempt', async () => {
    const [{ authService }, { adminLoginAttempts }, { default: prisma }, { encrypt, hashPassword }] = await Promise.all([
        import('./auth.service.js'),
        import('./login-attempts.js'),
        import('../../lib/prisma.js'),
        import('../../lib/crypto.js'),
    ]);
    const recordFailure = mock.method(adminLoginAttempts, 'recordFailure', async () => 0);
    mock.method(adminLoginAttempts, 'getLockRemainingSeconds', async () => 0);
    const restoreFindUnique = overrideMethod(prisma.admin, 'findUnique', async () => ({
        id: 7,
        username: 'admin',
        passwordHash: await hashPassword('correct-password'),
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        mustChangePassword: false,
        twoFactorEnabled: true,
        twoFactorSecret: encrypt('JBSWY3DPEHPK3PXP'),
        sessionVersion: 1,
    }));

    try {
        await assert.rejects(
            () => authService.login({ username: 'admin', password: 'correct-password' }, '127.0.0.1'),
            (error: unknown) => {
                const appError = error as { code?: string; statusCode?: number };
                assert.equal(appError.code, 'OTP_REQUIRED');
                assert.equal(appError.statusCode, 401);
                return true;
            },
        );
        assert.equal(recordFailure.mock.calls.length, 0);
    } finally {
        restoreFindUnique();
        mock.restoreAll();
    }
});

void test('admin login signs only the version confirmed by its CAS when a later rotation wins', async () => {
    const [
        { authService },
        { adminLoginAttempts },
        { default: prisma },
        { decodeToken },
        { hashPassword },
    ] = await Promise.all([
        import('./auth.service.js'),
        import('./login-attempts.js'),
        import('../../lib/prisma.js'),
        import('../../lib/jwt.js'),
        import('../../lib/crypto.js'),
    ]);
    const admin = {
        id: 7,
        username: 'admin',
        passwordHash: await hashPassword('correct-password'),
        role: 'SUPER_ADMIN' as const,
        status: 'ACTIVE' as const,
        mustChangePassword: false,
        twoFactorEnabled: false,
        twoFactorSecret: null,
        sessionVersion: 4,
    };
    let currentVersion = 4;
    let casVersion: unknown;
    mock.method(adminLoginAttempts, 'getLockRemainingSeconds', async () => 0);
    mock.method(adminLoginAttempts, 'clear', async () => undefined);
    const restores = [
        overrideMethod(prisma.admin, 'findUnique', async () => admin),
        overrideMethod(prisma.admin, 'update', async () => {
            currentVersion = 5;
            return admin;
        }),
        overrideMethod(prisma.admin, 'updateMany', async ({ where }: { where: Record<string, unknown> }) => {
            casVersion = where.sessionVersion;
            currentVersion = 5;
            return { count: 1 };
        }),
        overrideMethod(prisma, '$queryRaw', async () => [{ session_version: currentVersion }]),
    ];

    try {
        const result = await authService.login({
            username: 'admin',
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

void test('admin two-factor mutations CAS the authenticated version and report exact trigger transitions', async () => {
    const [
        { authService },
        { default: prisma },
        { decrypt, hashPassword },
        { generateTotpCodeAt },
    ] = await Promise.all([
        import('./auth.service.js'),
        import('../../lib/prisma.js'),
        import('../../lib/crypto.js'),
        import('./totp.js'),
    ]);
    const state = {
        id: 7,
        username: 'admin',
        passwordHash: await hashPassword('current-password'),
        status: 'ACTIVE' as const,
        twoFactorEnabled: false,
        twoFactorSecret: null as string | null,
        twoFactorTempSecret: null as string | null,
        sessionVersion: 1,
    };
    const casVersions: unknown[] = [];
    const restores = [
        overrideMethod(prisma.admin, 'findFirst', async ({ where }: { where: Record<string, unknown> }) => (
            where.sessionVersion === state.sessionVersion ? { ...state } : null
        )),
        overrideMethod(prisma.admin, 'updateMany', async ({
            where,
            data,
        }: {
            where: Record<string, unknown>;
            data: Record<string, unknown>;
        }) => {
            casVersions.push(where.sessionVersion);
            if (where.sessionVersion !== state.sessionVersion) {
                return { count: 0 };
            }
            const nextEnabled = 'twoFactorEnabled' in data
                ? Boolean(data.twoFactorEnabled)
                : state.twoFactorEnabled;
            const nextSecret = 'twoFactorSecret' in data
                ? nullableString(data.twoFactorSecret)
                : state.twoFactorSecret;
            const bumpsVersion = nextEnabled !== state.twoFactorEnabled
                || nextSecret !== state.twoFactorSecret;
            state.twoFactorEnabled = nextEnabled;
            state.twoFactorSecret = nextSecret;
            if ('twoFactorTempSecret' in data) {
                state.twoFactorTempSecret = nullableString(data.twoFactorTempSecret);
            }
            if (bumpsVersion) {
                state.sessionVersion += 1;
            }
            return { count: 1 };
        }),
    ];

    try {
        const setup = await authService.setupTwoFactor(7, 1);
        assert.equal(setup.sessionVersion, 1);
        assert.ok(state.twoFactorTempSecret);
        assert.equal(decrypt(state.twoFactorTempSecret), setup.secret);
        assert.deepEqual(await authService.getTwoFactorStatus(7, 1), {
            enabled: false,
            pending: true,
        });

        const otp = generateTotpCodeAt(setup.secret, Date.now());
        assert.deepEqual(await authService.enableTwoFactor(7, 1, { otp }), {
            enabled: true,
            sessionVersion: 2,
        });
        assert.deepEqual(await authService.disableTwoFactor(7, 2, {
            password: 'current-password',
            otp,
        }), {
            enabled: false,
            sessionVersion: 3,
        });
        assert.deepEqual(casVersions, [1, 1, 2]);
    } finally {
        while (restores.length > 0) {
            restores.pop()?.();
        }
    }
});
