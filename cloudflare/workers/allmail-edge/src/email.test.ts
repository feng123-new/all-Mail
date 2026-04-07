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
  return {
    from: 'sender@example.org',
    to: 'inbox@example.com',
    headers: new Headers({
      'message-id': '<stable-message-id@example.org>',
      subject: 'Worker test',
    }),
    raw: createRawEmailStream(rawEmail),
    setReject() {
      // no-op for tests
    },
  };
}

const env = {
  ingressUrl: new URL('https://console.example.com/ingress/domain-mail/receive'),
  ingressKeyId: 'edge-key',
  ingressSigningSecret: 'edge-signing-secret',
  ingressProvider: 'CLOUDFLARE_EMAIL_ROUTING',
  rawEmailObjectPrefix: 'allmail-edge/raw',
};

void test('buildIngressPayload uses a stable delivery key when message-id is present', async () => {
  const rawEmailA = [
    'From: Sender <sender@example.org>',
    'To: Inbox <inbox@example.com>',
    'Subject: Worker test',
    'Message-ID: <stable-message-id@example.org>',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'First body variant',
  ].join('\r\n');
  const rawEmailB = [
    'From: Sender <sender@example.org>',
    'To: Inbox <inbox@example.com>',
    'Subject: Worker test',
    'Message-ID: <stable-message-id@example.org>',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Second body variant',
  ].join('\r\n');

  const [payloadA, payloadB] = await Promise.all([
    buildIngressPayload(createMessage(rawEmailA), env),
    buildIngressPayload(createMessage(rawEmailB), env),
  ]);

  assert.equal(payloadA.deliveryKey, payloadB.deliveryKey);
  assert.match(payloadA.deliveryKey, /^[a-f0-9]{64}$/);
});

void test('buildIngressPayload marks raw storage as failed when the bucket write throws', async () => {
  const rawEmail = [
    'From: Sender <sender@example.org>',
    'To: Inbox <inbox@example.com>',
    'Subject: Worker test',
    'Message-ID: <stable-message-id@example.org>',
    'Content-Type: text/plain; charset=utf-8',
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
          throw new Error('R2 unavailable');
        },
      },
    });

    assert.equal(payload.message.rawObjectKey, null);
    assert.equal(payload.message.storageStatus, 'FAILED');
    assert.equal(loggedErrors.length, 1);
    assert.equal(loggedErrors[0]?.[0], 'Failed to store raw email in R2');
    assert.deepEqual(loggedErrors[0]?.[1], {
      domain: 'example.com',
      localPart: 'inbox',
      messageId: '<stable-message-id@example.org>',
      error: 'R2 unavailable',
    });
  } finally {
    console.error = originalConsoleError;
  }
});
