import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://tester:tester@127.0.0.1:15433/all_mail_test';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6380/0';
process.env.JWT_SECRET ??= 'test-jwt-secret-1234567890abcdef';
process.env.ENCRYPTION_KEY ??= 'test-encryption-key-1234567890ab';
process.env.ADMIN_PASSWORD ??= 'test-admin-password';

async function expectUnauthorizedRoute(options: {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    url: string;
    payload?: Record<string, unknown>;
}) {
    const { buildApp } = await import('../app.js');
    const app = await buildApp();

    try {
        const response = await new Promise<{ statusCode: number; payload: string }>((resolve, reject) => {
            app.inject({
                method: options.method,
                url: options.url,
                ...(options.payload ? { payload: options.payload } : {}),
            }, (error, injectedResponse) => {
                if (error) {
                    reject(error);
                    return;
                }
                if (!injectedResponse) {
                    reject(new Error(`No inject response returned for ${options.method} ${options.url}`));
                    return;
                }

                resolve({
                    statusCode: injectedResponse.statusCode,
                    payload: injectedResponse.payload,
                });
            });
        });

        assert.equal(response.statusCode, 401);
        const body = JSON.parse(response.payload) as {
            success: boolean;
            error: { code: string };
        };
        assert.equal(body.success, false);
        assert.equal(body.error.code, 'UNAUTHORIZED');
    } finally {
        await app.close();
    }
}

void test('admin domain messages routes are mounted behind auth', async () => {
    await expectUnauthorizedRoute({ method: 'GET', url: '/admin/domain-messages' });
    await expectUnauthorizedRoute({ method: 'DELETE', url: '/admin/domain-messages/1' });
    await expectUnauthorizedRoute({ method: 'POST', url: '/admin/domain-messages/batch-delete', payload: { ids: ['1'] } });
});

void test('admin sending config routes are mounted behind auth', async () => {
    await expectUnauthorizedRoute({ method: 'GET', url: '/admin/send/configs' });
    await expectUnauthorizedRoute({ method: 'DELETE', url: '/admin/send/configs/1' });
    await expectUnauthorizedRoute({ method: 'GET', url: '/admin/send/messages' });
    await expectUnauthorizedRoute({ method: 'DELETE', url: '/admin/send/messages/1' });
    await expectUnauthorizedRoute({ method: 'POST', url: '/admin/send/messages/batch-delete', payload: { ids: ['1'] } });
});

void test('domain verification and catch-all routes are mounted behind auth', async () => {
    await expectUnauthorizedRoute({ method: 'POST', url: '/admin/domains/1/verify', payload: {} });
    await expectUnauthorizedRoute({
        method: 'POST',
        url: '/admin/domains/1/catch-all',
        payload: { isCatchAllEnabled: false },
    });
});

void test('domain alias routes are mounted behind auth', async () => {
    await expectUnauthorizedRoute({ method: 'GET', url: '/admin/domains/1/aliases' });
    await expectUnauthorizedRoute({
        method: 'POST',
        url: '/admin/domains/1/aliases',
        payload: { mailboxId: 1, aliasLocalPart: 'support' },
    });
    await expectUnauthorizedRoute({
        method: 'PATCH',
        url: '/admin/domains/1/aliases/1',
        payload: { status: 'ACTIVE' },
    });
    await expectUnauthorizedRoute({ method: 'DELETE', url: '/admin/domains/1/aliases/1' });
});
