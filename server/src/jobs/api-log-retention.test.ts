import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://tester:tester@127.0.0.1:15433/all_mail_test';
process.env.JWT_SECRET ??= 'test-jwt-secret-1234567890abcdef';
process.env.ENCRYPTION_KEY ??= 'test-encryption-key-1234567890ab';
process.env.ADMIN_PASSWORD ??= 'test-admin-password';

void test('legacy API log retention ownership is mutually exclusive', async () => {
    const { isLegacyApiLogRetentionOwner } = await import('./api-log-retention.js');
    assert.equal(isLegacyApiLogRetentionOwner('legacy'), true);
    assert.equal(isLegacyApiLogRetentionOwner('go'), false);
});
