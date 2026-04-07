import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

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

void test('sendService.send persists the provider failure message for failed outbound mail', async () => {
    const [{ default: prisma }, sendModule, cryptoModule] = await Promise.all([
        import('../../lib/prisma.js'),
        import('./send.service.js'),
        import('../../lib/crypto.js'),
    ]);
    const sendService = sendModule.createSendService({
        prisma,
        decrypt: cryptoModule.decrypt,
        sendWithResend: async () => {
            throw new Error('provider rejected the message payload');
        },
    });

    const updateCalls: unknown[] = [];
    const restores: Array<() => void> = [];
    restores.push(overrideMethod(prisma.domain, 'findUnique', (async () => ({
        id: 1,
        name: 'example.com',
        canSend: true,
        status: 'ACTIVE',
        sendingConfigs: [{
            id: 5,
            apiKeyEncrypted: cryptoModule.encrypt('resend-api-key'),
            fromNameDefault: 'Ops Team',
            replyToDefault: null,
        }],
    })) as typeof prisma.domain.findUnique));
    restores.push(overrideMethod(prisma.domainMailbox, 'findUnique', (async () => ({
        id: 7,
        domainId: 1,
        address: 'ops@example.com',
        status: 'ACTIVE',
    })) as typeof prisma.domainMailbox.findUnique));
    restores.push(overrideMethod(prisma.outboundMessage, 'create', (async () => ({ id: 88n })) as typeof prisma.outboundMessage.create));
    restores.push(overrideMethod(prisma.outboundMessage, 'update', (async (args) => {
        updateCalls.push(args);
        return {
            id: 88n,
            providerMessageId: null,
            status: 'FAILED',
            lastError: 'provider rejected the message payload',
            createdAt: new Date('2026-04-02T13:00:00.000Z'),
            updatedAt: new Date('2026-04-02T13:00:01.000Z'),
        };
    }) as typeof prisma.outboundMessage.update));

    try {
        await assert.rejects(
            () => sendService.send({
                domainId: 1,
                mailboxId: 7,
                from: 'ops@example.com',
                to: ['user@example.net'],
                subject: 'Hello',
                text: 'hello',
            }),
            (error: unknown) => {
                assert.equal((error as { code?: string }).code, 'SEND_FAILED');
                assert.equal((error as { message?: string }).message, 'provider rejected the message payload');
                return true;
            }
        );

        assert.equal(updateCalls.length, 1);
        assert.deepEqual(updateCalls[0], {
            where: { id: 88n },
            data: {
                status: 'FAILED',
                lastError: 'provider rejected the message payload',
            },
        });
    } finally {
        while (restores.length > 0) {
            restores.pop()?.();
        }
        mock.restoreAll();
    }
});
