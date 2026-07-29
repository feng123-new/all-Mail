import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveEnv } from './config.js';
import type { WorkerEnv } from './types.js';

function validEnv(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
  return {
    INGRESS_URL: 'https://console.example.com/ingress/domain-mail/receive',
    INGRESS_KEY_ID: 'edge-key',
    INGRESS_SIGNING_SECRET: 'edge-signing-secret',
    ...overrides,
  };
}

void test('resolveEnv applies the bounded raw email default', () => {
  assert.equal(resolveEnv(validEnv()).maxRawEmailBytes, 15 * 1024 * 1024);
});

void test('resolveEnv rejects raw email limits outside the Cloudflare envelope', () => {
  for (const value of ['0', 'not-an-integer', String(25 * 1024 * 1024 + 1)]) {
    assert.throws(() => resolveEnv(validEnv({ MAX_RAW_EMAIL_BYTES: value })), /MAX_RAW_EMAIL_BYTES/);
  }
});
