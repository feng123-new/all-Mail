import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://tester:tester@127.0.0.1:15433/all_mail_test';
process.env.JWT_SECRET ??= 'test-jwt-secret-1234567890abcdef';
process.env.ENCRYPTION_KEY ??= 'test-encryption-key-1234567890ab';

interface JWTDurationVectors {
    valid: Array<{ value: string; seconds: number }>;
    invalid: string[];
}

void test('JWT duration parser matches the shared Go and Fastify compatibility vectors', async () => {
    const [{ parseJWTDurationSeconds }, content] = await Promise.all([
        import('./env.js'),
        readFile(new URL('../../../config/jwt-duration-vectors.json', import.meta.url), 'utf8'),
    ]);
    const vectors = JSON.parse(content) as JWTDurationVectors;

    for (const vector of vectors.valid) {
        assert.equal(parseJWTDurationSeconds(vector.value), vector.seconds, vector.value);
    }
    for (const value of vectors.invalid) {
        assert.throws(() => parseJWTDurationSeconds(value), undefined, value);
    }
});

void test('signToken converts numeric JWT durations into relative expiration seconds', async () => {
    const [{ decodeToken, signToken }] = await Promise.all([
        import('../lib/jwt.js'),
    ]);
    const token = await signToken({ sub: 'diagnostic', username: 'diagnostic', role: 'SYSTEM' }, {
        expiresIn: '7200',
    });
    const payload = decodeToken(token);

    assert.ok(payload);
    assert.equal(Number(payload.exp) - Number(payload.iat), 7200);
});
