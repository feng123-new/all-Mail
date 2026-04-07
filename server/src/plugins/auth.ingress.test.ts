import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import test from 'node:test';

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://tester:tester@127.0.0.1:15433/all_mail_test';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6380/0';
process.env.JWT_SECRET ??= 'test-jwt-secret-1234567890abcdef';
process.env.ENCRYPTION_KEY ??= 'test-encryption-key-1234567890ab';
process.env.ADMIN_PASSWORD ??= 'test-admin-password';
process.env.INGRESS_SIGNING_SECRET ??= 'test-ingress-signing-secret';

function overrideMethod<T extends object, K extends keyof T>(target: T, key: K, replacement: T[K]) {
    const original = target[key];
    Object.assign(target, { [key]: replacement });
    return () => {
        Object.assign(target, { [key]: original });
    };
}

function buildIngressBody(deliveryKey: string) {
    return {
        provider: 'cloudflare',
        deliveryKey,
        receivedAt: new Date().toISOString(),
        envelope: {
            from: 'sender@example.org',
            to: 'inbox@example.com',
        },
        routing: {
            domain: 'example.com',
            localPart: 'inbox',
            matchedAddress: 'inbox@example.com',
        },
        message: {
            messageId: `<${deliveryKey}@example.org>`,
            subject: 'Hello',
            textPreview: 'hello world',
            htmlPreview: '<p>hello world</p>',
            headers: {},
            attachments: [],
            rawObjectKey: null,
        },
    };
}

function buildSignedHeaders(bodyText: string, timestamp: string): Record<string, string> {
    const bodyHash = createHash('sha256').update(bodyText).digest('hex');
    const canonical = `${timestamp}\nPOST\n/ingress/domain-mail/receive\n${bodyHash}`;
    const signature = createHmac('sha256', process.env.INGRESS_SIGNING_SECRET as string)
        .update(canonical)
        .digest('hex');

    return {
        'content-type': 'application/json',
        'x-ingress-key-id': 'edge-key',
        'x-ingress-timestamp': timestamp,
        'x-ingress-signature': signature,
    };
}

async function buildIngressApp(options?: { receiveImpl?: (input: unknown) => Promise<unknown> }) {
    const [{ default: prisma }, ingressModule, appModule] = await Promise.all([
        import('../lib/prisma.js'),
        import('../modules/ingress/ingress.service.js'),
        import('../app.js'),
    ]);

    const restores = [
        overrideMethod(prisma.ingressEndpoint, 'findUnique', (async () => ({
            id: 1,
            domainId: 1,
            keyId: 'edge-key',
            name: 'default',
            status: 'ACTIVE',
            domain: { name: 'example.com' },
        })) as never),
        overrideMethod(ingressModule.ingressService, 'receive', ((input: unknown) => {
            if (options?.receiveImpl) {
                return options.receiveImpl(input);
            }

            return Promise.resolve({
                accepted: true,
                duplicate: false,
                route: 'EXACT_MAILBOX',
                domainId: 1,
                mailboxId: 7,
                messageId: '42',
            });
        }) as never),
    ];

    const app = await appModule.buildApp();

    return {
        app,
        restore: async () => {
            while (restores.length > 0) {
                restores.pop()?.();
            }
            await app.close();
        },
    };
}

void test('ingress signature verification uses the raw JSON body rather than reparsed JSON', async () => {
    const deliveryKey = `raw-body-${Date.now()}`;
    const body = buildIngressBody(deliveryKey);
    const signedBodyText = JSON.stringify(body);
    const sentBodyText = JSON.stringify(body, null, 2);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const { app, restore } = await buildIngressApp();

    try {
        const response = await app.inject({
            method: 'POST',
            url: '/ingress/domain-mail/receive',
            payload: sentBodyText,
            headers: buildSignedHeaders(signedBodyText, timestamp),
        });

        assert.equal(response.statusCode, 401);
        const parsed = JSON.parse(response.payload) as { error: { code: string } };
        assert.equal(parsed.error.code, 'INGRESS_SIGNATURE_INVALID');
    } finally {
        await restore();
    }
});

void test('ingress replay protection rejects a second request with the same delivery key', async () => {
    const deliveryKey = `replay-${Date.now()}`;
    const body = buildIngressBody(deliveryKey);
    const bodyText = JSON.stringify(body);
    const timestamp = String(Math.floor(Date.now() / 1000));
    let receiveCallCount = 0;
    const { app, restore } = await buildIngressApp({
        receiveImpl: async () => {
            receiveCallCount += 1;
            return {
                accepted: true,
                duplicate: false,
                route: 'EXACT_MAILBOX',
                domainId: 1,
                mailboxId: 7,
                messageId: '42',
            };
        },
    });

    try {
        const first = await app.inject({
            method: 'POST',
            url: '/ingress/domain-mail/receive',
            payload: bodyText,
            headers: buildSignedHeaders(bodyText, timestamp),
        });
        assert.equal(first.statusCode, 200);

        const second = await app.inject({
            method: 'POST',
            url: '/ingress/domain-mail/receive',
            payload: bodyText,
            headers: buildSignedHeaders(bodyText, timestamp),
        });
        assert.equal(second.statusCode, 409);
        const parsed = JSON.parse(second.payload) as { error: { code: string } };
        assert.equal(parsed.error.code, 'INGRESS_REPLAY_DETECTED');
        assert.equal(receiveCallCount, 1);
    } finally {
        await restore();
    }
});
