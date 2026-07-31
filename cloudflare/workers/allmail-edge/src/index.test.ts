import assert from 'node:assert/strict';
import test from 'node:test';
import { handleEmail } from './index.js';
import type { EmailMessageLike, ExecutionContextLike, R2PutOptionsLike, WorkerEnv } from './types.js';

function rawStream(raw: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(raw));
      controller.close();
    },
  });
}

function createFixture() {
  const raw = [
    'From: Sender <sender@invalid.test>',
    'To: Inbox <inbox@invalid.test>',
    'Subject: Worker integration test',
    'Message-ID: <edge-index-test@invalid.test>',
    '',
    'Body',
  ].join('\r\n');
  const puts: Array<{ key: string; options?: R2PutOptionsLike }> = [];
  const deletes: string[] = [];
  const rejects: string[] = [];
  const pending: Promise<unknown>[] = [];
  const env: WorkerEnv = {
    INGRESS_URL: 'https://console.invalid.test/ingress/domain-mail/receive',
    INGRESS_KEY_ID: 'edge-key',
    INGRESS_SIGNING_SECRET: 'edge-signing-secret',
    RAW_EMAIL_BUCKET: {
      async put(key, _value, options) {
        puts.push({ key, options });
      },
      async delete(key) {
        deletes.push(key);
      },
    },
  };
  const message: EmailMessageLike = {
    from: 'sender@invalid.test',
    to: 'inbox@invalid.test',
    headers: new Headers({ 'message-id': '<edge-index-test@invalid.test>' }),
    raw: rawStream(raw),
    rawSize: new TextEncoder().encode(raw).byteLength,
    setReject(reason) {
      rejects.push(reason);
    },
  };
  const ctx: ExecutionContextLike = {
    waitUntil(promise) {
      pending.push(promise);
    },
  };
  return { env, message, ctx, puts, deletes, rejects, pending };
}

void test('permanent ingress rejection compensates R2 without logging PII or response bodies', async () => {
  const fixture = createFixture();
  const originalConsoleError = console.error;
  const logs: unknown[][] = [];
  console.error = (...args: unknown[]) => logs.push(args);
  try {
    await handleEmail(fixture.message, fixture.env, fixture.ctx, async () => ({
      ok: false,
      status: 404,
      requestId: 'request-404',
      errorCode: 'DOMAIN_NOT_FOUND',
    }));
    await Promise.all(fixture.pending);

    assert.equal(fixture.puts.length, 1);
    assert.deepEqual(fixture.deletes, [fixture.puts[0]?.key]);
    assert.deepEqual(fixture.rejects, ['all-Mail ingress returned 404']);
    const serialized = JSON.stringify(logs);
    assert.match(serialized, /DOMAIN_NOT_FOUND/);
    assert.doesNotMatch(serialized, /sender|inbox|invalid\.test|responseText|Body/i);
  } finally {
    console.error = originalConsoleError;
  }
});

void test('replay response is treated as an accepted duplicate and keeps referenced R2 data', async () => {
  const fixture = createFixture();
  await handleEmail(fixture.message, fixture.env, fixture.ctx, async () => ({
    ok: false,
    status: 409,
    requestId: 'request-replay',
    errorCode: 'INGRESS_REPLAY_DETECTED',
  }));
  await Promise.all(fixture.pending);

  assert.equal(fixture.puts.length, 1);
  assert.deepEqual(fixture.deletes, []);
  assert.deepEqual(fixture.rejects, []);
});

void test('retryable upstream failure keeps deterministic R2 data for the next attempt', async () => {
  const fixture = createFixture();
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await handleEmail(fixture.message, fixture.env, fixture.ctx, async () => ({
      ok: false,
      status: 503,
      requestId: 'request-503',
      errorCode: 'INGRESS_REPLAY_BACKEND_UNAVAILABLE',
    }));
    await Promise.all(fixture.pending);

    assert.equal(fixture.puts.length, 1);
    assert.deepEqual(fixture.deletes, []);
    assert.deepEqual(fixture.rejects, ['all-Mail ingress returned 503']);
  } finally {
    console.error = originalConsoleError;
  }
});
