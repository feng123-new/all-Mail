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

void test('mailbox login protection uses an independent namespace without changing admin keys', async () => {
    const {
        buildLoginAttemptCacheKey,
        buildMailboxLoginAttemptCacheKey,
        createLoginAttemptController,
    } = await import('./login-attempts.js');
    const calls: string[] = [];
    const redis = {
        async ttl(key: string) {
            calls.push(`ttl:${key}`);
            return 0;
        },
        async del(...keys: string[]) {
            calls.push(`del:${keys.join(',')}`);
            return keys.length;
        },
        async incr(key: string) {
            calls.push(`incr:${key}`);
            return 1;
        },
        async expire(key: string, seconds: number) {
            calls.push(`expire:${key}:${seconds}`);
            return 1;
        },
        async set(key: string, _value: string, _mode: 'EX', seconds: number) {
            calls.push(`set:${key}:${seconds}`);
            return 'OK';
        },
    };

    const adminController = createLoginAttemptController({
        getRedisClient: () => redis,
        maxAttempts: 5,
        lockSeconds: 900,
    });
    const adminCacheKey = buildLoginAttemptCacheKey(' Admin ', '127.0.0.1');
    await adminController.recordFailure(adminCacheKey);
    await adminController.clear(adminCacheKey);

    const mailboxController = createLoginAttemptController({
        namespace: 'mailbox',
        getRedisClient: () => redis,
        maxAttempts: 5,
        lockSeconds: 900,
    });
    const mailboxCacheKey = buildMailboxLoginAttemptCacheKey(' User@Example.com ', '198.51.100.7');
    await mailboxController.getLockRemainingSeconds(mailboxCacheKey);
    await mailboxController.recordFailure(mailboxCacheKey);
    await mailboxController.clear(mailboxCacheKey);

    assert.equal(adminCacheKey, 'admin-login:admin:127.0.0.1');
    assert.equal(mailboxCacheKey, 'mailbox-login:user@example.com:198.51.100.7');
    assert.deepEqual(calls, [
        'incr:auth:admin:login:attempt:admin-login:admin:127.0.0.1',
        'expire:auth:admin:login:attempt:admin-login:admin:127.0.0.1:900',
        'del:auth:admin:login:attempt:admin-login:admin:127.0.0.1,auth:admin:login:lock:admin-login:admin:127.0.0.1',
        'ttl:auth:mailbox:login:lock:mailbox-login:user@example.com:198.51.100.7',
        'incr:auth:mailbox:login:attempt:mailbox-login:user@example.com:198.51.100.7',
        'expire:auth:mailbox:login:attempt:mailbox-login:user@example.com:198.51.100.7:900',
        'del:auth:mailbox:login:attempt:mailbox-login:user@example.com:198.51.100.7,auth:mailbox:login:lock:mailbox-login:user@example.com:198.51.100.7',
    ]);
});
