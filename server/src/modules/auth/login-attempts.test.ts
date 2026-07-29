import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://tester:tester@127.0.0.1:15433/all_mail_test';
process.env.JWT_SECRET ??= 'test-jwt-secret-1234567890abcdef';
process.env.ENCRYPTION_KEY ??= 'test-encryption-key-1234567890ab';

void test('login protection fails closed without Redis in production mode', async () => {
    const { createLoginAttemptController } = await import('./login-attempts.js');
    const controller = createLoginAttemptController({
        allowLocalFallback: false,
        getRedisClient: () => null,
    });
    await assert.rejects(
        () => controller.recordFailure('admin-login:admin:127.0.0.1'),
        (error: unknown) => {
            const appError = error as { code?: string; statusCode?: number };
            assert.equal(appError.code, 'LOGIN_SECURITY_BACKEND_UNAVAILABLE');
            assert.equal(appError.statusCode, 503);
            return true;
        },
    );
});

void test('login protection local fallback remains deterministic for tests', async () => {
    const { createLoginAttemptController } = await import('./login-attempts.js');
    const controller = createLoginAttemptController({
        allowLocalFallback: true,
        getRedisClient: () => null,
        localStore: new Map(),
        maxAttempts: 2,
        lockSeconds: 60,
        now: () => 1_000,
    });
    const key = 'admin-login:admin:127.0.0.1';
    assert.equal(await controller.recordFailure(key), 0);
    assert.equal(await controller.recordFailure(key), 60);
    assert.equal(await controller.getLockRemainingSeconds(key), 60);
    await controller.clear(key);
    assert.equal(await controller.getLockRemainingSeconds(key), 0);
});
