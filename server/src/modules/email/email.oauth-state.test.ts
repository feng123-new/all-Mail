import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://tester:tester@127.0.0.1:15433/all_mail_test';
process.env.REDIS_URL = '';
process.env.JWT_SECRET ??= 'test-jwt-secret-1234567890abcdef';
process.env.ENCRYPTION_KEY ??= 'test-encryption-key-1234567890ab';

void test('OAuth state is consumed with one atomic GETDEL operation', async () => {
    const { consumeOAuthStateFromRedis } = await import('./email.oauth.service.js');
    const values = new Map<string, string>([[
        'admin:oauth:state:state-1',
        JSON.stringify({
            adminId: 7,
            provider: 'GMAIL',
            createdAt: 1_000,
        }),
    ]]);
    const calls: string[] = [];
    const redis = {
        async getdel(key: string): Promise<string | null> {
            calls.push(key);
            const value = values.get(key) ?? null;
            values.delete(key);
            return value;
        },
    };

    assert.deepEqual(await consumeOAuthStateFromRedis(redis, 'state-1'), {
        adminId: 7,
        provider: 'GMAIL',
        createdAt: 1_000,
    });
    assert.equal(await consumeOAuthStateFromRedis(redis, 'state-1'), null);
    assert.deepEqual(calls, [
        'admin:oauth:state:state-1',
        'admin:oauth:state:state-1',
    ]);
});
