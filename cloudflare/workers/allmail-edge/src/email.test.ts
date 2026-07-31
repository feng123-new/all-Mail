import assert from 'node:assert/strict';
import test from 'node:test';
import { buildIngressPayload } from './email.js';
import type { EmailMessageLike } from './types.js';

function createRawEmailStream(rawEmail: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(rawEmail));
      controller.close();
    },
  });
}

function createMessage(rawEmail: string): EmailMessageLike {
  const rawBytes = new TextEncoder().encode(rawEmail);
  return {
    from: 'sender@invalid.test',
    to: 'inbox@invalid.test',
    headers: new Headers({
      'message-id': '<stable-message-id@invalid.test>',
      subject: 'Worker test',
    }),
    raw: createRawEmailStream(rawEmail),
    rawSize: rawBytes.byteLength,
    setReject() {
      // no-op for tests
    },
  };
}

const env = {
  ingressUrl: new URL('https://console.invalid.test/ingress/domain-mail/receive'),
  ingressKeyId: 'edge-key',
  ingressSigningSecret: 'edge-signing-secret',
  ingressProvider: 'CLOUDFLARE_EMAIL_ROUTING',
  rawEmailObjectPrefix: 'allmail-edge/raw',
  maxRawEmailBytes: 15 * 1024 * 1024,
};

void test('buildIngressPayload uses a stable delivery key when message-id is present', async () => {
  const rawEmailA = [
    'From: Sender <sender@invalid.test>',
    'To: Inbox <inbox@invalid.test>',
    'Subject: Worker test',
    'Message-ID: <stable-message-id@invalid.test>',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'First body variant',
  ].join('\r\n');
  const rawEmailB = rawEmailA.replace('First body variant', 'Second body variant');

  const [payloadA, payloadB] = await Promise.all([
    buildIngressPayload(createMessage(rawEmailA), env),
    buildIngressPayload(createMessage(rawEmailB), env),
  ]);

  assert.equal(payloadA.deliveryKey, payloadB.deliveryKey);
  assert.match(payloadA.deliveryKey, /^[a-f0-9]{64}$/);
});

void test('buildIngressPayload rejects oversized email before reading the raw stream', async () => {
  const message = createMessage('small body');
  message.rawSize = 1024;
  await assert.rejects(
    buildIngressPayload(message, { ...env, maxRawEmailBytes: 100 }),
    /MAX_RAW_EMAIL_BYTES/,
  );
});

void test('raw storage key and metadata contain no mailbox identity', async () => {
  let storedKey = '';
  let storedMetadata: Record<string, string> = {};
  const rawEmail = [
    'From: Sender <sender@invalid.test>',
    'To: Inbox <inbox@invalid.test>',
    'Subject: Worker test',
    'Message-ID: <stable-message-id@invalid.test>',
    '',
    'Body',
  ].join('\r\n');

  const payload = await buildIngressPayload(createMessage(rawEmail), {
    ...env,
    rawEmailBucket: {
      async put(key, _value, options) {
        storedKey = key;
        storedMetadata = options?.customMetadata ?? {};
      },
      async delete() {},
    },
  });

  assert.equal(storedKey, `allmail-edge/raw/${payload.deliveryKey.slice(0, 2)}/${payload.deliveryKey}.eml`);
  assert.deepEqual(Object.keys(storedMetadata).sort(), ['deliveryKey', 'receivedAt']);
  assert.doesNotMatch(JSON.stringify({ storedKey, storedMetadata }), /sender|inbox|invalid\.test|@/i);
});

void test('failed raw storage logs only bounded identifiers', async () => {
  const rawEmail = [
    'From: Sender <sender@invalid.test>',
    'To: Inbox <inbox@invalid.test>',
    'Subject: Worker test',
    'Message-ID: <stable-message-id@invalid.test>',
    '',
    'Body with failed storage',
  ].join('\r\n');

  const originalConsoleError = console.error;
  const loggedErrors: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    loggedErrors.push(args);
  };

  try {
    const payload = await buildIngressPayload(createMessage(rawEmail), {
      ...env,
      rawEmailBucket: {
        async put() {
          throw new Error('storage unavailable');
        },
        async delete() {},
      },
    });

    assert.equal(payload.message.rawObjectKey, null);
    assert.equal(payload.message.storageStatus, 'FAILED');
    assert.equal(loggedErrors.length, 1);
    assert.equal(loggedErrors[0]?.[0], 'Failed to store raw email in R2');
    assert.deepEqual(loggedErrors[0]?.[1], {
      deliveryKey: payload.deliveryKey.slice(0, 12),
      errorCode: 'Error',
    });
    assert.doesNotMatch(JSON.stringify(loggedErrors), /sender|inbox|invalid\.test|storage unavailable/i);
  } finally {
    console.error = originalConsoleError;
  }
});
