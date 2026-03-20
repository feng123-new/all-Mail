import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRawObjectKey, parseRoutingAddress, sanitizeStorageToken } from './routing.js';

void test('parseRoutingAddress normalizes email routing target', () => {
  assert.deepEqual(parseRoutingAddress('Inbox+Verify@example.com '), {
    matchedAddress: 'inbox+verify@example.com',
    localPart: 'inbox+verify',
    domain: 'example.com',
  });
});

void test('sanitizeStorageToken removes unsafe path characters', () => {
  assert.equal(sanitizeStorageToken('<Message ID>@Example.COM'), 'message-id-example.com');
});

void test('buildRawObjectKey creates a dated R2 object path', () => {
  const key = buildRawObjectKey({
    prefix: 'allmail-edge/raw',
    receivedAt: new Date('2026-03-17T10:11:12.000Z'),
    domain: 'example.com',
    localPart: 'Inbox+Verify',
    messageId: '<abc-123@example.com>',
  });

  assert.equal(
    key,
    'allmail-edge/raw/2026/03/17/example.com/inbox-verify/2026-03-17T10-11-12-000Z-abc-123-example.com.eml',
  );
});
