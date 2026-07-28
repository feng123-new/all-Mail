import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://tester:tester@127.0.0.1:15433/all_mail_test';
process.env.JWT_SECRET ??= 'test-jwt-secret-1234567890abcdef';
process.env.ENCRYPTION_KEY ??= 'test-encryption-key-1234567890ab';
process.env.ADMIN_PASSWORD ??= 'test-admin-password';

void test('readiness succeeds only after PostgreSQL and Redis protocol probes succeed', async () => {
    const { createReadinessChecker } = await import('./readiness.js');
    const check = createReadinessChecker({
        async checkPostgres() {},
        async checkRedis() {},
        redisRequired: true,
        timeoutMs: 100,
    });

    assert.deepEqual(await check(), {
        ready: true,
        checks: { postgres: 'ok', redis: 'ok' },
    });
});

void test('readiness fails when either dependency probe fails', async () => {
    const { createReadinessChecker } = await import('./readiness.js');
    const check = createReadinessChecker({
        async checkPostgres() {
            throw new Error('authentication failed');
        },
        async checkRedis() {
            throw new Error('wrong protocol');
        },
        redisRequired: true,
        timeoutMs: 100,
    });

    assert.deepEqual(await check(), {
        ready: false,
        checks: { postgres: 'query-failed', redis: 'ping-failed' },
    });
});

void test('readiness treats an unconfigured optional Redis as explicit degraded state', async () => {
    const { createReadinessChecker } = await import('./readiness.js');
    const check = createReadinessChecker({
        async checkPostgres() {},
        async checkRedis() {
            throw new Error('must not run');
        },
        redisRequired: false,
        timeoutMs: 100,
    });

    assert.deepEqual(await check(), {
        ready: true,
        checks: { postgres: 'ok', redis: 'not-configured' },
    });
});
