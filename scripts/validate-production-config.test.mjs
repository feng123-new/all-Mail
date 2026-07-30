import assert from 'node:assert/strict';
import test from 'node:test';

import { validateProductionEnvironment } from './validate-production-config.mjs';

function validEnv(overrides = {}) {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://allmail:0123456789abcdef0123456789abcdef@postgres:5432/allmail',
    REDIS_URL: 'redis://redis:6379',
    JWT_SECRET: '',
    ENCRYPTION_KEY: '',
    ...overrides,
  };
}

void test('production validation accepts generated URL-safe database credentials', () => {
  assert.doesNotThrow(() => validateProductionEnvironment(validEnv()));
});

void test('production validation rejects missing, weak, short, or URL-unsafe database passwords', () => {
  for (const databaseUrl of [
    'postgresql://allmail@postgres:5432/allmail',
    'postgresql://allmail:allmail_dev_password@postgres:5432/allmail',
    'postgresql://allmail:short-password@postgres:5432/allmail',
    'postgresql://allmail:0123456789abcdef01234567%40bad@postgres:5432/allmail',
  ]) {
    assert.throws(() => validateProductionEnvironment(validEnv({ DATABASE_URL: databaseUrl })), /PostgreSQL password/);
  }
});

void test('production validation requires Redis and rejects every retired variable', () => {
  assert.throws(() => validateProductionEnvironment(validEnv({ REDIS_URL: '' })), /REDIS_URL/);
  for (const name of [
    'ALLOW_LOCAL_RATE_LIMIT_FALLBACK',
    'POSTGRES_PORT',
    'ALL_MAIL_ENV_FILE',
  ]) {
    assert.throws(() => validateProductionEnvironment(validEnv({ [name]: '' })), /is retired/);
  }
});

void test('development and test environments are not forced through production validation', () => {
  assert.doesNotThrow(() => validateProductionEnvironment({ NODE_ENV: 'development' }));
  assert.doesNotThrow(() => validateProductionEnvironment({ NODE_ENV: 'test' }));
});

void test('initializer validation does not require Redis credentials', () => {
  assert.doesNotThrow(() => validateProductionEnvironment(validEnv({
    ALL_MAIL_RUNTIME_ROLE: 'init',
    REDIS_URL: '',
  })));
});
