import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  BOOTSTRAP_ADMIN_FILENAME,
  LEGACY_SECRETS_FILENAME,
  RUNTIME_SECRETS_FILENAME,
  ensureRuntimeSecrets,
  parseEnvText,
} from './bootstrap-secrets.mjs';

void test('runtime secrets contain only long-lived application secrets', async () => {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'all-mail-runtime-secrets-'));
  const first = await ensureRuntimeSecrets({
    stateDir,
    env: {
      PUBLIC_BASE_URL: 'https://mail.example.com/',
      ADMIN_USERNAME: 'root-admin',
      ADMIN_PASSWORD: 'provided-admin-password',
    },
  });

  assert.equal(first.loginUrl, 'https://mail.example.com/login');
  assert.deepEqual(first.createdKeys, ['JWT_SECRET', 'ENCRYPTION_KEY']);
  assert.equal(first.runtimeSecrets.ENCRYPTION_KEY.length, 32);
  assert.equal(first.runtimeSecrets.JWT_SECRET.length, 64);

  const runtime = parseEnvText(await readFile(path.join(stateDir, RUNTIME_SECRETS_FILENAME), 'utf8'));
  assert.deepEqual(Object.keys(runtime).sort(), ['ENCRYPTION_KEY', 'JWT_SECRET']);
  assert.equal(runtime.ADMIN_PASSWORD, undefined);

  const second = await ensureRuntimeSecrets({ stateDir, env: {} });
  assert.deepEqual(second.createdKeys, []);
  assert.deepEqual(second.runtimeSecrets, first.runtimeSecrets);
});

void test('legacy combined secret bundle is split and removed atomically', async () => {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'all-mail-legacy-secrets-'));
  await writeFile(path.join(stateDir, LEGACY_SECRETS_FILENAME), [
    'JWT_SECRET=legacy-jwt-secret-that-is-at-least-thirty-two-characters',
    'ENCRYPTION_KEY=0123456789abcdef0123456789abcdef',
    'ADMIN_PASSWORD=legacy-bootstrap-password',
    '',
  ].join('\n'), { mode: 0o600 });

  const result = await ensureRuntimeSecrets({
    stateDir,
    env: { ADMIN_USERNAME: 'legacy-admin' },
  });

  assert.equal(result.migratedLegacyBundle, true);
  const runtime = parseEnvText(await readFile(path.join(stateDir, RUNTIME_SECRETS_FILENAME), 'utf8'));
  assert.equal(runtime.ENCRYPTION_KEY, '0123456789abcdef0123456789abcdef');
  assert.equal(runtime.ADMIN_PASSWORD, undefined);

  const admin = parseEnvText(await readFile(path.join(stateDir, BOOTSTRAP_ADMIN_FILENAME), 'utf8'));
  assert.deepEqual(admin, {
    ADMIN_USERNAME: 'legacy-admin',
    ADMIN_PASSWORD: 'legacy-bootstrap-password',
  });

  await assert.rejects(readFile(path.join(stateDir, LEGACY_SECRETS_FILENAME), 'utf8'));
});

void test('canonical one-shot admin values override a legacy bundle during alias migration', async () => {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'all-mail-legacy-admin-override-'));
  await writeFile(path.join(stateDir, LEGACY_SECRETS_FILENAME), [
    'JWT_SECRET=legacy-jwt-secret-that-is-at-least-thirty-two-characters',
    'ENCRYPTION_KEY=0123456789abcdef0123456789abcdef',
    'ADMIN_PASSWORD=unrelated-generated-admin-password',
    '',
  ].join('\n'), { mode: 0o600 });

  await ensureRuntimeSecrets({
    stateDir,
    env: {
      ADMIN_USERNAME: 'historical-domain-admin',
      ADMIN_PASSWORD: 'historical-domain-admin-password',
    },
  });

  const admin = parseEnvText(await readFile(path.join(stateDir, BOOTSTRAP_ADMIN_FILENAME), 'utf8'));
  assert.deepEqual(admin, {
    ADMIN_USERNAME: 'historical-domain-admin',
    ADMIN_PASSWORD: 'historical-domain-admin-password',
  });
});

void test('explicit runtime environment values are exported but not copied into the volume', async () => {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'all-mail-explicit-secrets-'));
  const result = await ensureRuntimeSecrets({
    stateDir,
    env: {
      JWT_SECRET: 'explicit-jwt-secret-that-is-at-least-thirty-two-characters',
      ENCRYPTION_KEY: 'fedcba9876543210fedcba9876543210',
    },
  });

  assert.equal(result.runtimeSecrets.JWT_SECRET, 'explicit-jwt-secret-that-is-at-least-thirty-two-characters');
  assert.equal(result.runtimeSecrets.ENCRYPTION_KEY, 'fedcba9876543210fedcba9876543210');
  const persisted = parseEnvText(await readFile(path.join(stateDir, RUNTIME_SECRETS_FILENAME), 'utf8'));
  assert.deepEqual(persisted, {});
});
