import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRawObjectKey, parseRoutingAddress } from './routing.js';

void test('parseRoutingAddress normalizes email routing target', () => {
  assert.deepEqual(parseRoutingAddress('Inbox+Verify@example.com '), {
    matchedAddress: 'inbox+verify@example.com',
    localPart: 'inbox+verify',
    domain: 'example.com',
  });
});

void test('buildRawObjectKey uses only a deterministic delivery digest', () => {
  const deliveryKey = 'ab'.repeat(32);
  const key = buildRawObjectKey({
    prefix: 'allmail-edge/raw',
    deliveryKey,
  });

  assert.equal(key, `allmail-edge/raw/ab/${deliveryKey}.eml`);
  assert.doesNotMatch(key, /example\.com|inbox|@/i);
});

void test('buildRawObjectKey rejects non-digest delivery keys', () => {
  assert.throws(
    () => buildRawObjectKey({ prefix: 'allmail-edge/raw', deliveryKey: 'inbox@example.com' }),
    /64-character hexadecimal digest/,
  );
});
