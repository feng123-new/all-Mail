import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://tester:tester@127.0.0.1:15433/all_mail_test';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6380/0';
process.env.JWT_SECRET ??= 'test-jwt-secret-1234567890abcdef';
process.env.ENCRYPTION_KEY ??= 'test-encryption-key-1234567890ab';
process.env.ADMIN_PASSWORD ??= 'test-admin-password';

void test('api key rate limiting fails closed when Redis is unavailable and local fallback is disabled', async () => {
    const { createApiKeyRateLimitEnforcer } = await import('./auth.js');

    const enforceRateLimit = createApiKeyRateLimitEnforcer({
        allowLocalFallback: false,
        getRedisClient: () => null,
    });

    await assert.rejects(
        () => enforceRateLimit(1, 10),
        (error: unknown) => {
            assert.equal(typeof error, 'object');
            assert.notEqual(error, null);
            const appError = error as { code?: string; statusCode?: number };
            assert.equal(appError.code, 'RATE_LIMIT_BACKEND_UNAVAILABLE');
            assert.equal(appError.statusCode, 503);
            return true;
        }
    );
});

void test('api key rate limiting can use local fallback when explicitly allowed', async () => {
    const { createApiKeyRateLimitEnforcer } = await import('./auth.js');

    const enforceRateLimit = createApiKeyRateLimitEnforcer({
        allowLocalFallback: true,
        getRedisClient: () => null,
        localStore: new Map(),
        now: () => 1_000,
    });

    await enforceRateLimit(1, 1);
    await assert.rejects(
        () => enforceRateLimit(1, 1),
        (error: unknown) => {
            assert.equal(typeof error, 'object');
            assert.notEqual(error, null);
            const appError = error as { code?: string; statusCode?: number };
            assert.equal(appError.code, 'RATE_LIMIT_EXCEEDED');
            assert.equal(appError.statusCode, 429);
            return true;
        }
    );
});
