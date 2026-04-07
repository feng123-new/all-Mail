import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://tester:tester@127.0.0.1:15433/all_mail_test';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6380/0';
process.env.JWT_SECRET ??= 'test-jwt-secret-1234567890abcdef';
process.env.ENCRYPTION_KEY ??= 'test-encryption-key-1234567890ab';
process.env.ADMIN_PASSWORD ??= 'test-admin-password';

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
