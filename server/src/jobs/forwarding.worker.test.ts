import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://tester:tester@127.0.0.1:15433/all_mail_test';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6380/0';
process.env.JWT_SECRET ??= 'test-jwt-secret-1234567890abcdef';
process.env.ENCRYPTION_KEY ??= 'test-encryption-key-1234567890ab';
process.env.ADMIN_PASSWORD ??= 'test-admin-password';

type ForwardMode = 'COPY' | 'MOVE';
type ForwardJobStatus = 'PENDING' | 'RUNNING' | 'SENT' | 'FAILED' | 'SKIPPED';
type PortalState = 'VISIBLE' | 'FORWARDED_HIDDEN';

function createWorkerHarness(options?: {
    mode?: ForwardMode;
    currentForwardMode?: 'DISABLED' | ForwardMode;
    currentForwardTo?: string | null;
    jobForwardTo?: string;
    sendError?: string;
    attemptCount?: number;
    jobStatus?: ForwardJobStatus;
    nextAttemptAt?: Date | null;
    updatedAt?: Date;
    includeSendConfig?: boolean;
    mailboxStatus?: 'ACTIVE' | 'DISABLED';
    domainStatus?: 'ACTIVE' | 'DISABLED';
    canSend?: boolean;
}) {
    const now = new Date('2026-03-29T12:00:00.000Z');
    const staleRunningCutoff = new Date(now.getTime() - 10 * 60_000);
    const forwardTo = options?.jobForwardTo ?? 'forward@example.net';
    const state = {
        inboundMessage: {
            id: 10n,
            domainId: 1,
            matchedAddress: 'inbox@example.com',
            finalAddress: 'inbox@example.com',
            fromAddress: 'sender@example.org',
            subject: 'Worker test',
            textPreview: 'hello world',
            htmlPreview: '<p>hello world</p>',
            routeKind: 'EXACT_MAILBOX',
            receivedAt: new Date('2026-03-29T11:59:00.000Z'),
            portalState: 'VISIBLE' as PortalState,
        },
        mailbox: {
            id: 7,
            address: 'inbox@example.com',
            status: options?.mailboxStatus ?? 'ACTIVE',
            forwardMode: options?.currentForwardMode ?? (options?.mode ?? 'COPY'),
            forwardTo: options?.currentForwardTo ?? forwardTo,
            domain: {
                id: 1,
                name: 'example.com',
                status: options?.domainStatus ?? 'ACTIVE',
                canSend: options?.canSend ?? true,
                sendingConfigs: options?.includeSendConfig === false
                    ? []
                    : [{
                        apiKeyEncrypted: 'api-key',
                        fromNameDefault: 'Example Forwarder',
                        replyToDefault: null,
                    }],
            },
        },
        job: {
            id: 1n,
            inboundMessageId: 10n,
            mailboxId: 7,
            mode: options?.mode ?? 'COPY',
            forwardTo,
            status: options?.jobStatus ?? 'PENDING',
            attemptCount: options?.attemptCount ?? 0,
            lastError: null as string | null,
            providerMessageId: null as string | null,
            nextAttemptAt: options?.nextAttemptAt ?? new Date('2026-03-29T11:58:00.000Z'),
            processedAt: null as Date | null,
            createdAt: new Date('2026-03-29T11:57:00.000Z'),
            updatedAt: options?.updatedAt ?? new Date('2026-03-29T11:57:00.000Z'),
        },
    };

    const sentInputs: unknown[] = [];
    let healthMarks = 0;
    const logs = {
        info: [] as unknown[],
        warn: [] as unknown[],
        error: [] as unknown[],
    };

    const fakePrisma = {
        $queryRaw: async () => {
            if (
                (((state.job.status === 'PENDING' || state.job.status === 'FAILED')
                    && state.job.nextAttemptAt
                    && state.job.nextAttemptAt <= now)
                || (state.job.status === 'RUNNING' && state.job.updatedAt <= staleRunningCutoff))
            ) {
                const previousStatus = state.job.status;
                state.job.status = 'RUNNING';
                state.job.updatedAt = now;
                return [{ id: state.job.id, previous_status: previousStatus }];
            }

            return [];
        },
        $transaction: async (callback: (tx: {
            inboundMessage: { update: (args: { where: { id: bigint }; data: Partial<typeof state.inboundMessage> }) => Promise<typeof state.inboundMessage> };
            mailboxForwardJob: { update: (args: { where: { id: bigint }; data: Partial<typeof state.job> }) => Promise<typeof state.job> };
        }) => Promise<unknown>) => callback({
            inboundMessage: {
                update: async ({ data }) => {
                    Object.assign(state.inboundMessage, data);
                    return state.inboundMessage;
                },
            },
            mailboxForwardJob: {
                update: async ({ data }) => {
                    Object.assign(state.job, data);
                    return state.job;
                },
            },
        }),
        mailboxForwardJob: {
            findUnique: async ({ where }: { where: { id: bigint } }) => {
                if (where.id !== state.job.id) {
                    return null;
                }

                return {
                    id: state.job.id,
                    inboundMessageId: state.job.inboundMessageId,
                    mailboxId: state.job.mailboxId,
                    mode: state.job.mode,
                    forwardTo: state.job.forwardTo,
                    attemptCount: state.job.attemptCount,
                    inboundMessage: { ...state.inboundMessage },
                    mailbox: {
                        id: state.mailbox.id,
                        address: state.mailbox.address,
                        status: state.mailbox.status,
                        forwardMode: state.mailbox.forwardMode,
                        forwardTo: state.mailbox.forwardTo,
                        domain: {
                            id: state.mailbox.domain.id,
                            name: state.mailbox.domain.name,
                            status: state.mailbox.domain.status,
                            canSend: state.mailbox.domain.canSend,
                            sendingConfigs: [...state.mailbox.domain.sendingConfigs],
                        },
                    },
                };
            },
            update: async ({ data }: { where: { id: bigint }; data: Partial<typeof state.job> }) => {
                Object.assign(state.job, data);
                return state.job;
            },
        },
        inboundMessage: {
            update: async ({ data }: { where: { id: bigint }; data: Partial<typeof state.inboundMessage> }) => {
                Object.assign(state.inboundMessage, data);
                return state.inboundMessage;
            },
        },
    };

    return {
        now,
        state,
        sentInputs,
        get healthMarks() {
            return healthMarks;
        },
        logs,
        deps: {
            prisma: fakePrisma,
            logger: {
                info: (payload: unknown, message?: string) => {
                    logs.info.push({ payload, message });
                },
                warn: (payload: unknown, message?: string) => {
                    logs.warn.push({ payload, message });
                },
                error: (payload: unknown, message?: string) => {
                    logs.error.push({ payload, message });
                },
            },
            decrypt: (value: string) => value,
            sendWithResend: async (input: unknown) => {
                sentInputs.push(input);
                if (options?.sendError) {
                    throw new Error(options.sendError);
                }
                return { id: 'provider-1' };
            },
            markHealthy: async () => {
                healthMarks += 1;
            },
            now: () => now,
        },
    };
}

void test('forwarding worker marks COPY jobs as sent and keeps inbound mail visible', async () => {
    const { createForwardingWorker } = await import('./forwarding.worker.js');
    const harness = createWorkerHarness({ mode: 'COPY' });

    const worker = createForwardingWorker(harness.deps as never);
    await worker.runOnce();

    assert.equal(harness.state.job.status, 'SENT');
    assert.equal(harness.state.job.attemptCount, 1);
    assert.equal(harness.state.job.providerMessageId, 'provider-1');
    assert.equal(harness.state.job.nextAttemptAt, null);
    assert.equal(harness.state.inboundMessage.portalState, 'VISIBLE');
    assert.equal(harness.sentInputs.length, 1);
    assert.equal((harness.sentInputs[0] as { idempotencyKey?: string }).idempotencyKey, 'mailbox-forward/1/10');
});

void test('forwarding worker marks MOVE jobs as sent and hides inbound mail from the portal', async () => {
    const { createForwardingWorker } = await import('./forwarding.worker.js');
    const harness = createWorkerHarness({ mode: 'MOVE' });

    const worker = createForwardingWorker(harness.deps as never);
    await worker.runOnce();

    assert.equal(harness.state.job.status, 'SENT');
    assert.equal(harness.state.inboundMessage.portalState, 'FORWARDED_HIDDEN');
});

void test('forwarding worker skips jobs whose mailbox forwarding was disabled after creation', async () => {
    const { createForwardingWorker } = await import('./forwarding.worker.js');
    const harness = createWorkerHarness({
        mode: 'COPY',
        currentForwardMode: 'DISABLED',
        currentForwardTo: null,
    });

    const worker = createForwardingWorker(harness.deps as never);
    await worker.runOnce();

    assert.equal(harness.state.job.status, 'SKIPPED');
    assert.equal(harness.state.job.nextAttemptAt, null);
    assert.equal(harness.state.inboundMessage.portalState, 'VISIBLE');
    assert.equal(harness.sentInputs.length, 0);
});

void test('forwarding worker records retryable send failures and keeps inbound mail visible', async () => {
    const { createForwardingWorker } = await import('./forwarding.worker.js');
    const harness = createWorkerHarness({
        mode: 'COPY',
        sendError: 'temporary upstream 503',
    });

    const worker = createForwardingWorker(harness.deps as never);
    await worker.runOnce();

    assert.equal(harness.state.job.status, 'FAILED');
    assert.equal(harness.state.job.attemptCount, 1);
    assert.equal(harness.state.job.lastError, 'temporary upstream 503');
    assert.equal(harness.state.job.nextAttemptAt?.toISOString(), '2026-03-29T12:00:30.000Z');
    assert.equal(harness.state.inboundMessage.portalState, 'VISIBLE');
});

void test('forwarding worker stops scheduling retries after the third failed attempt', async () => {
    const { createForwardingWorker } = await import('./forwarding.worker.js');
    const harness = createWorkerHarness({
        mode: 'COPY',
        jobStatus: 'FAILED',
        attemptCount: 2,
        sendError: 'temporary upstream 503',
    });

    const worker = createForwardingWorker(harness.deps as never);
    await worker.runOnce();

    assert.equal(harness.state.job.status, 'FAILED');
    assert.equal(harness.state.job.attemptCount, 3);
    assert.equal(harness.state.job.nextAttemptAt, null);
});

void test('forwarding worker claim logic prevents double-processing across worker instances', async () => {
    const { createForwardingWorker } = await import('./forwarding.worker.js');
    const harness = createWorkerHarness({ mode: 'COPY' });

    const workerA = createForwardingWorker(harness.deps as never);
    const workerB = createForwardingWorker(harness.deps as never);
    await Promise.all([workerA.runOnce(), workerB.runOnce()]);

    assert.equal(harness.sentInputs.length, 1);
    assert.equal(harness.state.job.status, 'SENT');
});

void test('forwarding worker reclaims stale RUNNING jobs left by crashed workers', async () => {
    const { createForwardingWorker } = await import('./forwarding.worker.js');
    const harness = createWorkerHarness({
        mode: 'COPY',
        jobStatus: 'RUNNING',
        updatedAt: new Date('2026-03-29T11:45:00.000Z'),
    });

    const worker = createForwardingWorker(harness.deps as never);
    await worker.runOnce();

    assert.equal(harness.sentInputs.length, 1);
    assert.equal(harness.state.job.status, 'SENT');
    assert.ok(harness.logs.info.some((entry) => (entry as { message?: string }).message === 'Mailbox forwarding worker claimed jobs'));
    assert.ok(harness.logs.info.some((entry) => {
        const record = entry as { message?: string; payload?: { reclaimedCount?: number } };
        return record.message === 'Mailbox forwarding worker claimed jobs' && record.payload?.reclaimedCount === 1;
    }));
  });

void test('forwarding worker marks invalid forward targets as failed without retry scheduling', async () => {
    const { createForwardingWorker } = await import('./forwarding.worker.js');
    const harness = createWorkerHarness({
        mode: 'COPY',
        jobForwardTo: 'not-an-email',
        currentForwardTo: 'not-an-email',
    });

    const worker = createForwardingWorker(harness.deps as never);
    await worker.runOnce();

    assert.equal(harness.sentInputs.length, 0);
    assert.equal(harness.state.job.status, 'FAILED');
    assert.equal(harness.state.job.attemptCount, 1);
    assert.equal(harness.state.job.nextAttemptAt, null);
    assert.match(harness.state.job.lastError || '', /Forward target email is invalid/);
});

void test('forwarding worker keeps its interval referenced so the dedicated jobs runtime stays alive', async () => {
    const { createForwardingWorker } = await import('./forwarding.worker.js');
    const harness = createWorkerHarness({ mode: 'COPY' });

    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    let unrefCalled = false;

    const fakeTimer = {
        unref: () => {
            unrefCalled = true;
            return fakeTimer;
        },
    };

    globalThis.setInterval = ((callback: TimerHandler, _delay?: number, ...args: unknown[]) => {
        void callback;
        void args;
        return fakeTimer as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval;
    globalThis.clearInterval = ((_timer?: ReturnType<typeof setInterval>) => undefined) as typeof clearInterval;

    try {
        const stop = createForwardingWorker(harness.deps as never).start();
        stop();
    } finally {
        globalThis.setInterval = originalSetInterval;
        globalThis.clearInterval = originalClearInterval;
    }

    assert.equal(unrefCalled, false);
});

void test('forwarding worker emits a heartbeat after each run so Docker can health-check the jobs runtime', async () => {
    const { createForwardingWorker } = await import('./forwarding.worker.js');
    const harness = createWorkerHarness({ mode: 'COPY' });

    const worker = createForwardingWorker(harness.deps as never);
    await worker.runOnce();

    assert.equal(harness.healthMarks, 1);
});
