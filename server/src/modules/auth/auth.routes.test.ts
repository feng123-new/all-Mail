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

void test('admin login writes a cookie and omits the raw token from the JSON response', async () => {
    const [{ buildApp }, { authService }] = await Promise.all([
        import('../../app.js'),
        import('./auth.service.js'),
    ]);

    mock.method(authService, 'login', async () => ({
        token: 'admin-session-token',
        admin: {
            id: 1,
            username: 'admin',
            role: 'SUPER_ADMIN' as const,
            mustChangePassword: false,
            twoFactorEnabled: false,
        },
    }));

    const app = await buildApp();
    try {
        const response = await app.inject({
            method: 'POST',
            url: '/admin/auth/login',
            headers: { 'content-type': 'application/json' },
            payload: {
                username: 'admin',
                password: 'test-password',
            },
        });

        assert.equal(response.statusCode, 200);
        const cookies = response.cookies;
        assert.ok(cookies.some((cookie) => cookie.name === 'token' && cookie.value === 'admin-session-token'));
        assert.deepEqual(JSON.parse(response.payload), {
            success: true,
            data: {
                admin: {
                    id: 1,
                    username: 'admin',
                    role: 'SUPER_ADMIN',
                    mustChangePassword: false,
                    twoFactorEnabled: false,
                },
            },
        });
    } finally {
        mock.restoreAll();
        await app.close();
    }
});

void test('admin security mutation signs its exact returned version instead of a later concurrent version', async () => {
    const [
        { buildApp },
        { authService },
        { default: prisma },
        { decodeToken, signToken },
    ] = await Promise.all([
        import('../../app.js'),
        import('./auth.service.js'),
        import('../../lib/prisma.js'),
        import('../../lib/jwt.js'),
    ]);
    let currentVersion = 1;
    let capturedAuthenticatedVersion: unknown;
    const restores = [
        overrideMethod(prisma, '$queryRaw', async () => [{ session_version: currentVersion }]),
        overrideMethod(prisma.admin, 'findUnique', async () => ({
            id: 1,
            username: 'admin',
            role: 'SUPER_ADMIN',
            status: 'ACTIVE',
            mustChangePassword: false,
        })),
    ];
    mock.method(authService, 'changePassword', async (
        _adminId: number,
        authenticatedVersion: number,
    ) => {
        capturedAuthenticatedVersion = authenticatedVersion;
        currentVersion = 3;
        return { success: true, mustChangePassword: false, sessionVersion: 2 };
    });
    const app = await buildApp();

    try {
        const token = await signToken({
            sub: '1',
            username: 'admin',
            role: 'SUPER_ADMIN',
        }, { audience: 'admin-console' });
        const response = await app.inject({
            method: 'POST',
            url: '/admin/auth/change-password',
            headers: { authorization: `Bearer ${token}` },
            payload: { oldPassword: 'old-password', newPassword: 'new-password-123' },
        });

        assert.equal(response.statusCode, 200);
        assert.equal(capturedAuthenticatedVersion, 1);
        const cookie = response.cookies.find((item) => item.name === 'token');
        assert.ok(cookie);
        assert.equal(decodeToken(cookie.value)?.sessionVersion, 2);
        assert.equal(currentVersion, 3);
    } finally {
        await app.close();
        while (restores.length > 0) {
            restores.pop()?.();
        }
        mock.restoreAll();
    }
});

void test('admin two-factor no-op mutations do not rotate the session cookie', async () => {
    const [{ buildApp }, { authService }, { default: prisma }, { signToken }] = await Promise.all([
        import('../../app.js'),
        import('./auth.service.js'),
        import('../../lib/prisma.js'),
        import('../../lib/jwt.js'),
    ]);
    const restores = [
        overrideMethod(prisma, '$queryRaw', async () => [{ session_version: 1 }]),
        overrideMethod(prisma.admin, 'findUnique', async () => ({
            id: 1,
            username: 'admin',
            role: 'SUPER_ADMIN',
            status: 'ACTIVE',
            mustChangePassword: false,
        })),
    ];
    mock.method(authService, 'enableTwoFactor', async () => ({ enabled: true, sessionVersion: 1 }));
    mock.method(authService, 'disableTwoFactor', async () => ({ enabled: false, sessionVersion: 1 }));
    const app = await buildApp();

    try {
        const token = await signToken({ sub: '1', username: 'admin', role: 'SUPER_ADMIN' }, {
            audience: 'admin-console',
            sessionVersion: 1,
        });
        const headers = { authorization: `Bearer ${token}` };
        const enableResponse = await app.inject({
            method: 'POST',
            url: '/admin/auth/2fa/enable',
            headers,
            payload: { otp: '123456' },
        });
        const disableResponse = await app.inject({
            method: 'POST',
            url: '/admin/auth/2fa/disable',
            headers,
            payload: { password: 'current-password', otp: '123456' },
        });

        assert.equal(enableResponse.statusCode, 200);
        assert.equal(disableResponse.statusCode, 200);
        assert.equal(enableResponse.headers['set-cookie'], undefined);
        assert.equal(disableResponse.headers['set-cookie'], undefined);
    } finally {
        await app.close();
        while (restores.length > 0) {
            restores.pop()?.();
        }
        mock.restoreAll();
    }
});
