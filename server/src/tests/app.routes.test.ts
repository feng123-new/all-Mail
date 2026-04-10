import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://tester:tester@127.0.0.1:15433/all_mail_test';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6380/0';
process.env.JWT_SECRET ??= 'test-jwt-secret-1234567890abcdef';
process.env.ENCRYPTION_KEY ??= 'test-encryption-key-1234567890ab';
process.env.ADMIN_PASSWORD ??= 'test-admin-password';
process.env.INGRESS_SIGNING_SECRET ??= 'test-ingress-signing-secret';

async function expectErrorRoute(options: {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    url: string;
    expectedCode: string;
    expectedStatusCode: number;
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

        assert.equal(response.statusCode, options.expectedStatusCode);
        const body = JSON.parse(response.payload) as {
            success: boolean;
            error: { code: string; message?: string };
        };
        assert.equal(body.success, false);
        assert.equal(body.error.code, options.expectedCode);
        assert.equal('message' in body.error, false);
    } finally {
        await app.close();
    }
}

void test('admin domain messages routes are mounted behind auth', async () => {
    await expectErrorRoute({ method: 'GET', url: '/admin/domain-messages', expectedCode: 'UNAUTHORIZED', expectedStatusCode: 401 });
    await expectErrorRoute({ method: 'DELETE', url: '/admin/domain-messages/1', expectedCode: 'UNAUTHORIZED', expectedStatusCode: 401 });
    await expectErrorRoute({ method: 'POST', url: '/admin/domain-messages/batch-delete', payload: { ids: ['1'] }, expectedCode: 'UNAUTHORIZED', expectedStatusCode: 401 });
});

void test('admin sending config routes are mounted behind auth', async () => {
    await expectErrorRoute({ method: 'GET', url: '/admin/send/configs', expectedCode: 'UNAUTHORIZED', expectedStatusCode: 401 });
    await expectErrorRoute({ method: 'DELETE', url: '/admin/send/configs/1', expectedCode: 'UNAUTHORIZED', expectedStatusCode: 401 });
    await expectErrorRoute({ method: 'GET', url: '/admin/send/messages', expectedCode: 'UNAUTHORIZED', expectedStatusCode: 401 });
    await expectErrorRoute({ method: 'DELETE', url: '/admin/send/messages/1', expectedCode: 'UNAUTHORIZED', expectedStatusCode: 401 });
    await expectErrorRoute({ method: 'POST', url: '/admin/send/messages/batch-delete', payload: { ids: ['1'] }, expectedCode: 'UNAUTHORIZED', expectedStatusCode: 401 });
});

void test('domain verification and catch-all routes are mounted behind auth', async () => {
    await expectErrorRoute({ method: 'POST', url: '/admin/domains/1/verify', payload: {}, expectedCode: 'UNAUTHORIZED', expectedStatusCode: 401 });
    await expectErrorRoute({
        method: 'POST',
        url: '/admin/domains/1/catch-all',
        payload: { isCatchAllEnabled: false },
        expectedCode: 'UNAUTHORIZED',
        expectedStatusCode: 401,
    });
});

void test('domain alias routes are mounted behind auth', async () => {
    await expectErrorRoute({ method: 'GET', url: '/admin/domains/1/aliases', expectedCode: 'UNAUTHORIZED', expectedStatusCode: 401 });
    await expectErrorRoute({
        method: 'POST',
        url: '/admin/domains/1/aliases',
        payload: { mailboxId: 1, aliasLocalPart: 'support' },
        expectedCode: 'UNAUTHORIZED',
        expectedStatusCode: 401,
    });
    await expectErrorRoute({
        method: 'PATCH',
        url: '/admin/domains/1/aliases/1',
        payload: { status: 'ACTIVE' },
        expectedCode: 'UNAUTHORIZED',
        expectedStatusCode: 401,
    });
    await expectErrorRoute({ method: 'DELETE', url: '/admin/domains/1/aliases/1', expectedCode: 'UNAUTHORIZED', expectedStatusCode: 401 });
});

void test('mailbox portal routes are mounted behind auth where expected', async () => {
    await expectErrorRoute({ method: 'GET', url: '/mail/api/session', expectedCode: 'UNAUTHORIZED', expectedStatusCode: 401 });
    await expectErrorRoute({ method: 'GET', url: '/mail/api/messages', expectedCode: 'UNAUTHORIZED', expectedStatusCode: 401 });
    await expectErrorRoute({ method: 'GET', url: '/mail/api/forwarding-jobs', expectedCode: 'UNAUTHORIZED', expectedStatusCode: 401 });
    await expectErrorRoute({ method: 'POST', url: '/mail/api/change-password', payload: { oldPassword: 'old-password', newPassword: 'new-password-123' }, expectedCode: 'UNAUTHORIZED', expectedStatusCode: 401 });
    await expectErrorRoute({ method: 'POST', url: '/mail/api/forwarding', payload: { mailboxId: 1, forwardMode: 'DISABLED' }, expectedCode: 'UNAUTHORIZED', expectedStatusCode: 401 });
});

void test('admin forwarding-job mutation routes are mounted behind auth', async () => {
    await expectErrorRoute({ method: 'POST', url: '/admin/forwarding-jobs/1/requeue', expectedCode: 'UNAUTHORIZED', expectedStatusCode: 401 });
});

void test('external mail api routes are mounted behind api key auth', async () => {
    await expectErrorRoute({ method: 'GET', url: '/api/mailboxes', expectedCode: 'UNAUTHORIZED', expectedStatusCode: 401 });
    await expectErrorRoute({ method: 'GET', url: '/api/domain-mail/mailboxes', expectedCode: 'UNAUTHORIZED', expectedStatusCode: 401 });
});

void test('ingress routes require signed headers before request parsing', async () => {
    await expectErrorRoute({ method: 'POST', url: '/ingress/domain-mail/receive', payload: {}, expectedCode: 'INGRESS_SIGNATURE_REQUIRED', expectedStatusCode: 401 });
});
