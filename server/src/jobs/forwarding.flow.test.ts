import assert from 'node:assert/strict';
import test from 'node:test';
import type { IngressReceiveInput } from '../modules/ingress/ingress.schema.js';

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://tester:tester@127.0.0.1:15433/all_mail_test';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6380/0';
process.env.JWT_SECRET ??= 'test-jwt-secret-1234567890abcdef';
process.env.ENCRYPTION_KEY ??= 'test-encryption-key-1234567890ab';
process.env.ADMIN_PASSWORD ??= 'test-admin-password';

type ForwardMode = 'COPY' | 'MOVE';
type PortalState = 'VISIBLE' | 'FORWARDED_HIDDEN';
type ForwardJobStatus = 'PENDING' | 'RUNNING' | 'SENT' | 'FAILED' | 'SKIPPED';

function overrideMethod<T extends object, K extends keyof T>(target: T, key: K, replacement: T[K]) {
    const original = target[key];
    Object.assign(target, { [key]: replacement });
    return () => {
        Object.assign(target, { [key]: original });
    };
}

function buildIngressInput(): IngressReceiveInput {
    return {
        provider: 'cloudflare',
        deliveryKey: 'flow-delivery-1',
        receivedAt: '2026-03-29T12:00:00.000Z',
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
            messageId: 'flow-message-1',
            subject: 'Flow subject',
            textPreview: 'flow body',
            htmlPreview: '<p>flow body</p>',
            headers: {},
            attachments: [],
            rawObjectKey: null,
        },
    };
}

function createFlowState(mode: ForwardMode) {
    return {
        nextInboundId: 1n,
        nextForwardJobId: 1n,
        domain: {
            id: 1,
            name: 'example.com',
            status: 'ACTIVE' as const,
            canReceive: true,
            canSend: true,
        },
        mailbox: {
            id: 7,
            domainId: 1,
            address: 'inbox@example.com',
            status: 'ACTIVE' as const,
            forwardMode: mode,
            forwardTo: 'forward@example.net',
        },
        inboundMessages: [] as Array<{
            id: bigint;
            domainId: number;
            mailboxId: number | null;
            matchedAddress: string;
            finalAddress: string;
            deliveryKey: string;
            messageIdHeader: string | null;
            fromAddress: string;
            toAddress: string;
            subject: string | null;
            textPreview: string | null;
            htmlPreview: string | null;
            verificationCode: string | null;
            routeKind: string | null;
            receivedAt: Date;
            storageStatus: 'PENDING' | 'STORED';
            rawObjectKey: string | null;
            attachmentsMeta: unknown;
            headersJson: unknown;
            isRead: boolean;
            isDeleted: boolean;
            portalState: PortalState;
            createdAt: Date;
            updatedAt: Date;
        }>,
        forwardJobs: [] as Array<{
            id: bigint;
            inboundMessageId: bigint;
            mailboxId: number | null;
            mode: ForwardMode;
            forwardTo: string;
            status: ForwardJobStatus;
            attemptCount: number;
            lastError: string | null;
            providerMessageId: string | null;
            nextAttemptAt: Date | null;
            processedAt: Date | null;
            createdAt: Date;
            updatedAt: Date;
        }>,
    };
}

const forwardingWorkerNow = new Date('2100-01-01T00:00:00.000Z');

function applyInboundWhere<T extends { mailboxId: number | null; domainId: number; isDeleted: boolean; portalState: PortalState; isRead: boolean; id: bigint }>(
    rows: T[],
    where: Record<string, unknown>
) {
    return rows.filter((row) => {
        if (typeof where.domainId === 'number' && row.domainId !== where.domainId) {
            return false;
        }
        if (typeof where.mailboxId === 'number' && row.mailboxId !== where.mailboxId) {
            return false;
        }
        if (where.mailboxId && typeof where.mailboxId === 'object' && 'in' in (where.mailboxId as Record<string, unknown>)) {
            const mailboxIds = (where.mailboxId as { in: number[] }).in;
            if (!mailboxIds.includes(row.mailboxId ?? -1)) {
                return false;
            }
        }
        if (typeof where.isDeleted === 'boolean' && row.isDeleted !== where.isDeleted) {
            return false;
        }
        if (typeof where.portalState === 'string' && row.portalState !== where.portalState) {
            return false;
        }
        if (typeof where.isRead === 'boolean' && row.isRead !== where.isRead) {
            return false;
        }
        if (typeof where.id === 'bigint' && row.id !== where.id) {
            return false;
        }
        return true;
    });
}

async function installFlowMocks(mode: ForwardMode) {
    const state = createFlowState(mode);
    const [{ default: prisma }, { ingressService }, { messageService }, { createForwardingWorker }] = await Promise.all([
        import('../lib/prisma.js'),
        import('../modules/ingress/ingress.service.js'),
        import('../modules/message/message.service.js'),
        import('./forwarding.worker.js'),
    ]);

    const restores: Array<() => void> = [];

    restores.push(overrideMethod(prisma.domain, 'findUnique', (async ({ where }: { where: { name?: string } }) => {
        if (where.name === state.domain.name) {
            return {
                id: state.domain.id,
                name: state.domain.name,
                status: state.domain.status,
                canReceive: state.domain.canReceive,
            };
        }
        return null;
    }) as never));
    restores.push(overrideMethod(prisma.domainMailbox, 'findUnique', (async ({ where }: { where: { address?: string } }) => {
        if (where.address === state.mailbox.address) {
            return {
                id: state.mailbox.id,
                domainId: state.mailbox.domainId,
                address: state.mailbox.address,
                status: state.mailbox.status,
                forwardMode: state.mailbox.forwardMode,
                forwardTo: state.mailbox.forwardTo,
            };
        }
        return null;
    }) as never));
    restores.push(overrideMethod(prisma.mailboxAlias, 'findUnique', (async () => null) as never));
    restores.push(overrideMethod(prisma.inboundMessage, 'findFirst', (async ({ where }: { where: { domainId: number; finalAddress: string; messageIdHeader: string } }) => {
        const existing = state.inboundMessages.find((message) => (
            message.domainId === where.domainId
            && message.finalAddress === where.finalAddress
            && message.messageIdHeader === where.messageIdHeader
        ));
        return existing ? { id: existing.id } : null;
    }) as never));

    const tx = {
        inboundMessage: {
            create: async ({ data }: { data: Omit<(typeof state.inboundMessages)[number], 'id' | 'portalState' | 'isRead' | 'isDeleted' | 'createdAt' | 'updatedAt'> & Partial<(typeof state.inboundMessages)[number]> }) => {
                const id = state.nextInboundId;
                state.nextInboundId += 1n;
                const now = new Date('2026-03-29T12:00:00.000Z');
                const message = {
                    id,
                    domainId: data.domainId,
                    mailboxId: data.mailboxId ?? null,
                    matchedAddress: data.matchedAddress,
                    finalAddress: data.finalAddress,
                    deliveryKey: data.deliveryKey,
                    messageIdHeader: data.messageIdHeader ?? null,
                    fromAddress: data.fromAddress,
                    toAddress: data.toAddress,
                    subject: data.subject ?? null,
                    textPreview: data.textPreview ?? null,
                    htmlPreview: data.htmlPreview ?? null,
                    verificationCode: data.verificationCode ?? null,
                    routeKind: data.routeKind ?? null,
                    receivedAt: data.receivedAt,
                    storageStatus: data.storageStatus,
                    rawObjectKey: data.rawObjectKey ?? null,
                    attachmentsMeta: data.attachmentsMeta ?? null,
                    headersJson: data.headersJson ?? {},
                    isRead: false,
                    isDeleted: false,
                    portalState: 'VISIBLE' as PortalState,
                    createdAt: now,
                    updatedAt: now,
                };
                state.inboundMessages.push(message);
                return { id };
            },
            update: async ({ where, data }: { where: { id: bigint }; data: Partial<(typeof state.inboundMessages)[number]> }) => {
                const message = state.inboundMessages.find((item) => item.id === where.id);
                if (!message) {
                    throw new Error('Inbound message not found');
                }
                Object.assign(message, data);
                return message;
            },
        },
        mailboxForwardJob: {
            create: async ({ data }: { data: Omit<(typeof state.forwardJobs)[number], 'id' | 'attemptCount' | 'lastError' | 'providerMessageId' | 'processedAt' | 'createdAt' | 'updatedAt'> & Partial<(typeof state.forwardJobs)[number]> }) => {
                const id = state.nextForwardJobId;
                state.nextForwardJobId += 1n;
                const now = new Date('2026-03-29T12:00:00.000Z');
                state.forwardJobs.push({
                    id,
                    inboundMessageId: data.inboundMessageId,
                    mailboxId: data.mailboxId ?? null,
                    mode: data.mode,
                    forwardTo: data.forwardTo,
                    status: data.status ?? 'PENDING',
                    attemptCount: data.attemptCount ?? 0,
                    lastError: data.lastError ?? null,
                    providerMessageId: data.providerMessageId ?? null,
                    nextAttemptAt: data.nextAttemptAt ?? now,
                    processedAt: data.processedAt ?? null,
                    createdAt: now,
                    updatedAt: now,
                });
                return { id };
            },
            update: async ({ where, data }: { where: { id: bigint }; data: Partial<(typeof state.forwardJobs)[number]> }) => {
                const job = state.forwardJobs.find((item) => item.id === where.id);
                if (!job) {
                    throw new Error('Forward job not found');
                }
                Object.assign(job, data);
                job.updatedAt = new Date('2026-03-29T12:05:00.000Z');
                return job;
            },
        },
    };

    restores.push(overrideMethod(prisma, '$transaction', (async (callback: (txArg: typeof tx) => Promise<unknown>) => callback(tx)) as never));
    restores.push(overrideMethod(prisma, '$queryRaw', (async () => {
        const claimable = state.forwardJobs.find((job) => (
            (job.status === 'PENDING' || job.status === 'FAILED')
            && job.nextAttemptAt
            && job.nextAttemptAt <= forwardingWorkerNow
        ));
        if (!claimable) {
            return [];
        }
        claimable.status = 'RUNNING';
        return [{ id: claimable.id }];
    }) as never));
    restores.push(overrideMethod(prisma.mailboxForwardJob, 'findUnique', (async ({ where }: { where: { id: bigint } }) => {
        const job = state.forwardJobs.find((item) => item.id === where.id);
        if (!job) {
            return null;
        }
        const inboundMessage = state.inboundMessages.find((item) => item.id === job.inboundMessageId);
        if (!inboundMessage) {
            return null;
        }
        return {
            id: job.id,
            inboundMessageId: job.inboundMessageId,
            mailboxId: job.mailboxId,
            mode: job.mode,
            forwardTo: job.forwardTo,
            attemptCount: job.attemptCount,
            inboundMessage: {
                id: inboundMessage.id,
                domainId: inboundMessage.domainId,
                matchedAddress: inboundMessage.matchedAddress,
                finalAddress: inboundMessage.finalAddress,
                fromAddress: inboundMessage.fromAddress,
                subject: inboundMessage.subject,
                textPreview: inboundMessage.textPreview,
                htmlPreview: inboundMessage.htmlPreview,
                routeKind: inboundMessage.routeKind,
                receivedAt: inboundMessage.receivedAt,
            },
            mailbox: {
                id: state.mailbox.id,
                address: state.mailbox.address,
                status: state.mailbox.status,
                forwardMode: state.mailbox.forwardMode,
                forwardTo: state.mailbox.forwardTo,
                domain: {
                    id: state.domain.id,
                    name: state.domain.name,
                    status: state.domain.status,
                    canSend: state.domain.canSend,
                    sendingConfigs: [{
                        apiKeyEncrypted: 'api-key',
                        fromNameDefault: 'Example Forwarder',
                        replyToDefault: null,
                    }],
                },
            },
        };
    }) as never));
    restores.push(overrideMethod(prisma.mailboxForwardJob, 'update', tx.mailboxForwardJob.update as never));
    restores.push(overrideMethod(prisma.inboundMessage, 'findMany', (async ({ where, skip, take }: { where: Record<string, unknown>; skip: number; take: number }) => {
        const filtered = applyInboundWhere(state.inboundMessages, where)
            .sort((a, b) => Number(b.id - a.id))
            .slice(skip, skip + take);
        return filtered.map((message) => ({
            id: message.id,
            matchedAddress: message.matchedAddress,
            finalAddress: message.finalAddress,
            fromAddress: message.fromAddress,
            toAddress: message.toAddress,
            subject: message.subject,
            textPreview: message.textPreview,
            htmlPreview: message.htmlPreview,
            verificationCode: message.verificationCode,
            routeKind: message.routeKind,
            receivedAt: message.receivedAt,
            storageStatus: message.storageStatus,
            isRead: message.isRead,
            domain: { id: state.domain.id, name: state.domain.name, canSend: state.domain.canSend, canReceive: state.domain.canReceive },
            mailbox: { id: state.mailbox.id, address: state.mailbox.address, provisioningMode: 'MANUAL' as const },
        }));
    }) as never));
    restores.push(overrideMethod(prisma.inboundMessage, 'count', (async ({ where }: { where: Record<string, unknown> }) => applyInboundWhere(state.inboundMessages, where).length) as never));
    restores.push(overrideMethod(prisma.inboundMessage, 'findUnique', (async ({ where }: { where: { id: bigint } }) => {
        const message = state.inboundMessages.find((item) => item.id === where.id);
        if (!message) {
            return null;
        }
        return {
            ...message,
            domain: { id: state.domain.id, name: state.domain.name, canSend: state.domain.canSend, canReceive: state.domain.canReceive },
            mailbox: { id: state.mailbox.id, address: state.mailbox.address, provisioningMode: 'MANUAL' as const },
        };
    }) as never));

    const sentInputs: unknown[] = [];
    const worker = createForwardingWorker({
        prisma,
        logger: {
            info: () => undefined,
            warn: () => undefined,
            error: () => undefined,
        } as never,
        decrypt: (value: string) => value,
        sendWithResend: async (input: unknown) => {
            sentInputs.push(input);
            return { id: `provider-${sentInputs.length}` };
        },
        now: () => forwardingWorkerNow,
    });

    return {
        state,
        prisma,
        ingressService,
        messageService,
        worker,
        sentInputs,
        restore: () => {
            while (restores.length > 0) {
                restores.pop()?.();
            }
        },
    };
}

void test('forwarding flow keeps COPY messages visible in portal results', async () => {
    const { ingressService, messageService, worker, state, sentInputs, restore } = await installFlowMocks('COPY');

    try {
        const ingressResult = await ingressService.receive(buildIngressInput(), {
            id: 1,
            domainId: 1,
            keyId: 'endpoint-1',
            name: 'default',
        });

        assert.equal(ingressResult.duplicate, false);
        assert.equal(state.forwardJobs.length, 1);
        assert.equal(state.forwardJobs[0]?.status, 'PENDING');

        await worker.runOnce();

        const listResult = await messageService.list({
            page: 1,
            pageSize: 20,
            mailboxId: 7,
            unreadOnly: false,
            allowedMailboxIds: [7],
        }, {
            portalVisibleOnly: true,
        });

        assert.equal(sentInputs.length, 1);
        assert.equal(state.forwardJobs[0]?.status, 'SENT');
        assert.equal(listResult.total, 1);
        assert.equal(listResult.list[0]?.id, ingressResult.messageId);
        const detail = await messageService.getById(ingressResult.messageId, { portalVisibleOnly: true });
        assert.equal(detail.id, ingressResult.messageId);
    } finally {
        restore();
    }
});

void test('forwarding flow hides MOVE messages from portal results after successful send only', async () => {
    const { ingressService, messageService, worker, state, sentInputs, restore } = await installFlowMocks('MOVE');

    try {
        const ingressResult = await ingressService.receive(buildIngressInput(), {
            id: 1,
            domainId: 1,
            keyId: 'endpoint-1',
            name: 'default',
        });

        await worker.runOnce();

        const listResult = await messageService.list({
            page: 1,
            pageSize: 20,
            mailboxId: 7,
            unreadOnly: false,
            allowedMailboxIds: [7],
        }, {
            portalVisibleOnly: true,
        });

        assert.equal(sentInputs.length, 1);
        assert.equal(state.forwardJobs[0]?.status, 'SENT');
        assert.equal(state.inboundMessages[0]?.portalState, 'FORWARDED_HIDDEN');
        assert.equal(listResult.total, 0);
        await assert.rejects(
            () => messageService.getById(ingressResult.messageId, { portalVisibleOnly: true }),
            (error: unknown) => {
                assert.equal((error as { code?: string }).code, 'INBOUND_MESSAGE_NOT_FOUND');
                return true;
            }
        );

        const adminDetail = await messageService.getById(ingressResult.messageId);
        assert.equal(adminDetail.id, ingressResult.messageId);
    } finally {
        restore();
    }
});
