import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://tester:tester@127.0.0.1:15433/all_mail_test';
process.env.JWT_SECRET ??= 'test-jwt-secret-1234567890abcdef';
process.env.ENCRYPTION_KEY ??= 'test-encryption-key-1234567890ab';

void test('local security state is limited to development and test', async () => {
    const { allowLocalSecurityState } = await import('./security-state.js');
    assert.equal(allowLocalSecurityState('development'), true);
    assert.equal(allowLocalSecurityState('test'), true);
    assert.equal(allowLocalSecurityState('production'), false);
});
