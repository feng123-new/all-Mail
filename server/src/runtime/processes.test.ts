import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://tester:tester@127.0.0.1:15433/all_mail_test';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6380/0';
process.env.JWT_SECRET ??= 'test-jwt-secret-1234567890abcdef';
process.env.ENCRYPTION_KEY ??= 'test-encryption-key-1234567890ab';
process.env.ADMIN_PASSWORD ??= 'test-admin-password';

void test('api runtime starts HTTP and bootstrap admin without starting background jobs', async () => {
    const { createApiRuntime } = await import('./processes.js');

    let connected = 0;
    let disconnected = 0;
    let listened = 0;
    let closed = 0;
    let ensuredBootstrapAdmin = 0;

    const runtime = createApiRuntime({
        authService: {
            async ensureBootstrapAdmin() {
                ensuredBootstrapAdmin += 1;
                return { username: 'admin' };
            },
        },
        async buildApp() {
            return {
                async listen() {
                    listened += 1;
                },
                async close() {
                    closed += 1;
                },
            };
        },
        logger: {
            info: () => undefined,
            error: () => undefined,
        },
        port: 3100,
        prisma: {
            async $connect() {
                connected += 1;
            },
            async $disconnect() {
                disconnected += 1;
            },
        },
    });

    await runtime.start();
    await runtime.stop();

    assert.equal(connected, 1);
    assert.equal(disconnected, 1);
    assert.equal(ensuredBootstrapAdmin, 1);
    assert.equal(listened, 1);
    assert.equal(closed, 1);
});

void test('jobs runtime starts background loops without creating an HTTP app', async () => {
    const { createJobsRuntime } = await import('./processes.js');

    let connected = 0;
    let disconnected = 0;
    let retentionStarts = 0;
    let forwardingStarts = 0;
    let retentionStops = 0;
    let forwardingStops = 0;

    const runtime = createJobsRuntime({
        logger: {
            info: () => undefined,
            error: () => undefined,
        },
        prisma: {
            async $connect() {
                connected += 1;
            },
            async $disconnect() {
                disconnected += 1;
            },
        },
        startApiLogRetentionJob() {
            retentionStarts += 1;
            return () => {
                retentionStops += 1;
            };
        },
        startForwardingWorker() {
            forwardingStarts += 1;
            return () => {
                forwardingStops += 1;
            };
        },
    });

    await runtime.start();
    await runtime.stop();

    assert.equal(connected, 1);
    assert.equal(disconnected, 1);
    assert.equal(retentionStarts, 1);
    assert.equal(forwardingStarts, 1);
    assert.equal(retentionStops, 1);
    assert.equal(forwardingStops, 1);
});
