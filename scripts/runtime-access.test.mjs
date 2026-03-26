import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveLoginBaseUrl, resolveLoginUrl } from './runtime-access.mjs';

void test('resolveLoginUrl prefers explicit public base URL', () => {
  assert.equal(
    resolveLoginUrl({ PUBLIC_BASE_URL: 'https://mail.example.com/' }),
    'https://mail.example.com/login'
  );
});

void test('resolveLoginBaseUrl falls back to first configured cors origin', () => {
  assert.equal(
    resolveLoginBaseUrl({ CORS_ORIGIN: ' https://mail.example.com , https://mirror.example.com ' }),
    'https://mail.example.com'
  );
});

void test('resolveLoginUrl falls back to app port on local address', () => {
  assert.equal(
    resolveLoginUrl({ APP_PORT: '3200' }),
    'http://127.0.0.1:3200/login'
  );
});

void test('resolveLoginUrl falls back to runtime port when app port is unavailable', () => {
  assert.equal(
    resolveLoginUrl({ PORT: '3300' }),
    'http://127.0.0.1:3300/login'
  );
});
