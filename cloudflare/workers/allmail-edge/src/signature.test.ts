import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import test from 'node:test';
import { buildCanonicalString, createSignedHeaders, signCanonicalString } from './signature.js';

void test('signCanonicalString matches node hmac sha256 output', async () => {
  const bodyText = JSON.stringify({ hello: 'world', count: 1 });
  const bodyHash = createHash('sha256').update(bodyText).digest('hex');
  const canonical = buildCanonicalString({
    timestamp: '1710672000',
    method: 'POST',
    path: '/ingress/domain-mail/receive',
    bodyHash,
  });
  const expected = createHmac('sha256', 'test-signing-secret').update(canonical).digest('hex');

  assert.equal(await signCanonicalString('test-signing-secret', canonical), expected);
});

void test('createSignedHeaders emits the expected ingress signature headers', async () => {
  const url = new URL('https://console.example.com/ingress/domain-mail/receive');
  const headers = await createSignedHeaders({
    bodyText: JSON.stringify({ provider: 'CLOUDFLARE_EMAIL_ROUTING' }),
    method: 'POST',
    url,
    keyId: 'allmail-edge-main',
    signingSecret: 'another-test-secret',
    timestamp: '1710672000',
  });

  assert.equal(headers.get('content-type'), 'application/json');
  assert.equal(headers.get('x-ingress-key-id'), 'allmail-edge-main');
  assert.equal(headers.get('x-ingress-timestamp'), '1710672000');
  assert.match(headers.get('x-ingress-signature') || '', /^[a-f0-9]{64}$/);
});
