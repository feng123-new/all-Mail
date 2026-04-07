import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import type { IngressReceiveInput } from './ingress.schema.js';

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://tester:tester@127.0.0.1:15433/all_mail_test';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6380/0';
process.env.JWT_SECRET ??= 'test-jwt-secret-1234567890abcdef';
process.env.ENCRYPTION_KEY ??= 'test-encryption-key-1234567890ab';
process.env.ADMIN_PASSWORD ??= 'test-admin-password';

function overrideMethod<T extends object, K extends keyof T>(target: T, key: K, replacement: T[K]) {
    const original = target[key];
    Object.assign(target, { [key]: replacement });
    return () => {
        Object.assign(target, { [key]: original });
    };
}

function buildIngressInput(overrides: Partial<IngressReceiveInput> = {}): IngressReceiveInput {
    return {
        provider: 'cloudflare',
        deliveryKey: 'delivery-key-1',
        receivedAt: '2026-03-29T10:00:00.000Z',
        envelope: {
            from: 'sender@example.net',
            to: 'inbox@example.com',
            ...(overrides.envelope || {}),
        },
        routing: {
            domain: 'example.com',
            localPart: 'inbox',
            matchedAddress: 'inbox@example.com',
            ...(overrides.routing || {}),
        },
        message: {
            messageId: 'message-1',
            subject: 'Hello',
            textPreview: 'Your code is 123456',
            htmlPreview: '<p>Your code is <strong>123456</strong></p>',
            headers: {},
            attachments: [],
            rawObjectKey: null,
            ...(overrides.message || {}),
        },
        ...overrides,
    };
}

async function setupIngressMocks(options?: {
    duplicateDeliveryMessageId?: bigint | null;
    forwardMode?: 'DISABLED' | 'COPY' | 'MOVE';
    forwardTo?: string | null;
}) {
    const [{ default: prisma }, { ingressService, extractVerificationCode }] = await Promise.all([
        import('../../lib/prisma.js'),
        import('./ingress.service.js'),
    ]);

    const captured: {
        inboundCreateData?: unknown;
        forwardJobCreateData?: unknown;
    } = {};
    const restores: Array<() => void> = [];
    let transactionCallCount = 0;

    restores.push(overrideMethod(prisma.domain, 'findUnique', (async ({ where }: { where: { id?: number; name?: string } }) => {
        if (where.name === 'example.com') {
            return {
                id: 1,
                name: 'example.com',
                status: 'ACTIVE',
                canReceive: true,
            };
        }
        if (where.id === 1) {
            return {
                isCatchAllEnabled: false,
                catchAllTargetMailboxId: null,
            };
        }
        return null;
    }) as never));

    restores.push(overrideMethod(prisma.domainMailbox, 'findUnique', (async ({ where }: { where: { address?: string; id?: number } }) => {
        if (where.address === 'inbox@example.com' || where.id === 7) {
            return {
                id: 7,
                domainId: 1,
                address: 'inbox@example.com',
                status: 'ACTIVE',
                forwardMode: options?.forwardMode ?? 'DISABLED',
                forwardTo: options?.forwardTo ?? null,
            };
        }
        return null;
    }) as never));

    restores.push(overrideMethod(prisma.mailboxAlias, 'findUnique', (async () => null) as never));
    restores.push(overrideMethod(prisma.inboundMessage, 'findUnique', (async ({ where }: { where: { domainId_deliveryKey?: { domainId: number; deliveryKey: string } } }) => {
        if (options?.duplicateDeliveryMessageId && where.domainId_deliveryKey?.deliveryKey === 'delivery-key-1') {
            return {
                id: options.duplicateDeliveryMessageId,
                mailboxId: 7,
                routeKind: 'EXACT_MAILBOX',
            };
        }
        return null;
    }) as never));
    restores.push(overrideMethod(prisma, '$transaction', (async (callback: (tx: {
        inboundMessage: { create: (args: { data: unknown; select: { id: true } }) => Promise<{ id: bigint }> };
        mailboxForwardJob: { create: (args: { data: unknown }) => Promise<{ id: bigint }> };
    }) => Promise<{ id: bigint }>) => {
        transactionCallCount += 1;
        if (options?.duplicateDeliveryMessageId) {
            throw new Prisma.PrismaClientKnownRequestError('duplicate delivery key', {
                code: 'P2002',
                clientVersion: 'test',
            });
        }
        return callback({
        inboundMessage: {
            create: async ({ data }) => {
                captured.inboundCreateData = data;
                return { id: 42n };
            },
        },
        mailboxForwardJob: {
            create: async ({ data }) => {
                captured.forwardJobCreateData = data;
                return { id: 100n };
            },
        },
        });
    }) as never));

    return {
        prisma,
        ingressService,
        extractVerificationCode,
        captured,
        restore: () => {
            while (restores.length > 0) {
                restores.pop()?.();
            }
        },
        transactionMock: {
            get callCount() {
                return transactionCallCount;
            },
        },
    };
}

void test('extractVerificationCode returns first 6-digit code from text', async () => {
    const { extractVerificationCode } = await import('./ingress.service.js');
    assert.equal(extractVerificationCode('Your code is 123456, please verify.', null), '123456');
});

void test('extractVerificationCode falls back to html content', async () => {
    const { extractVerificationCode } = await import('./ingress.service.js');
    assert.equal(extractVerificationCode(null, '<p>Use 987654 to continue</p>'), '987654');
});

void test('extractVerificationCode returns null when no code exists', async () => {
    const { extractVerificationCode } = await import('./ingress.service.js');
    assert.equal(extractVerificationCode('hello world', '<p>no verification code</p>'), null);
});

void test('ingress skips forwarding job creation when mailbox forwarding is disabled', async () => {
    const { ingressService, captured, restore } = await setupIngressMocks({
        forwardMode: 'DISABLED',
        forwardTo: null,
    });

    try {
        const result = await ingressService.receive(buildIngressInput(), {
            id: 1,
            domainId: 1,
            keyId: 'endpoint-1',
            name: 'default',
        });

        assert.equal(result.accepted, true);
        assert.equal(result.duplicate, false);
        assert.equal(result.messageId, '42');
        assert.equal((captured.inboundCreateData as { deliveryKey: string }).deliveryKey, 'delivery-key-1');
        assert.equal((captured.inboundCreateData as { finalAddress: string }).finalAddress, 'inbox@example.com');
        assert.equal(captured.forwardJobCreateData, undefined);
    } finally {
        restore();
    }
});

void test('ingress creates a pending COPY forwarding job for new inbound mail', async () => {
    const { ingressService, captured, restore } = await setupIngressMocks({
        forwardMode: 'COPY',
        forwardTo: 'copy-target@example.net',
    });

    try {
        await ingressService.receive(buildIngressInput(), {
            id: 1,
            domainId: 1,
            keyId: 'endpoint-1',
            name: 'default',
        });

        assert.equal((captured.forwardJobCreateData as { inboundMessageId: bigint }).inboundMessageId, 42n);
        assert.equal((captured.forwardJobCreateData as { mailboxId: number }).mailboxId, 7);
        assert.equal((captured.forwardJobCreateData as { mode: string }).mode, 'COPY');
        assert.equal((captured.forwardJobCreateData as { forwardTo: string }).forwardTo, 'copy-target@example.net');
        assert.equal((captured.forwardJobCreateData as { status: string }).status, 'PENDING');
        assert.ok((captured.forwardJobCreateData as { nextAttemptAt: Date }).nextAttemptAt instanceof Date);
    } finally {
        restore();
    }
});

void test('ingress creates a pending MOVE forwarding job for new inbound mail', async () => {
    const { ingressService, captured, restore } = await setupIngressMocks({
        forwardMode: 'MOVE',
        forwardTo: 'move-target@example.net',
    });

    try {
        await ingressService.receive(buildIngressInput(), {
            id: 1,
            domainId: 1,
            keyId: 'endpoint-1',
            name: 'default',
        });

        assert.equal((captured.forwardJobCreateData as { mode: string }).mode, 'MOVE');
        assert.equal((captured.forwardJobCreateData as { forwardTo: string }).forwardTo, 'move-target@example.net');
    } finally {
        restore();
    }
});

void test('duplicate inbound acceptance does not create a second forwarding job', async () => {
    const { ingressService, transactionMock, restore } = await setupIngressMocks({
        duplicateDeliveryMessageId: 77n,
        forwardMode: 'COPY',
        forwardTo: 'copy-target@example.net',
    });

    try {
        const result = await ingressService.receive(buildIngressInput(), {
            id: 1,
            domainId: 1,
            keyId: 'endpoint-1',
            name: 'default',
        });

        assert.equal(result.duplicate, true);
        assert.equal(result.messageId, '77');
        assert.equal(transactionMock.callCount, 1);
    } finally {
        restore();
    }
});

void test('ingress persists an explicit failed raw-storage status from the edge worker payload', async () => {
    const { ingressService, captured, restore } = await setupIngressMocks({
        forwardMode: 'DISABLED',
        forwardTo: null,
    });

    try {
        await ingressService.receive(buildIngressInput({
            message: {
                rawObjectKey: null,
                storageStatus: 'FAILED',
            },
        }), {
            id: 1,
            domainId: 1,
            keyId: 'endpoint-1',
            name: 'default',
        });

        assert.equal((captured.inboundCreateData as { storageStatus: string }).storageStatus, 'FAILED');
    } finally {
        restore();
    }
});
