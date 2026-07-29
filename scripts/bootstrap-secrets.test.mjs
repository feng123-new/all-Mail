import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  BOOTSTRAP_ADMIN_FILENAME,
  ensureRuntimeSecrets,
  LEGACY_SECRETS_FILENAME,
  parseEnvText,
  RUNTIME_SECRETS_FILENAME,
} from './bootstrap-secrets.mjs';

const bootstrapScript = fileURLToPath(new URL('./bootstrap-secrets.mjs', import.meta.url));

function runLockedBootstrap(stateDir) {
  const lockFile = path.join(stateDir, '.bootstrap-secrets.lock');
  return new Promise((resolve, reject) => {
    const child = spawn(
      'flock',
      ['-w', '5', lockFile, process.execPath, bootstrapScript, '--state-dir', stateDir],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ADMIN_USERNAME: '', ADMIN_PASSWORD: '' },
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `locked bootstrap exited with code ${code}`));
        return;
      }
      resolve(JSON.parse(stdout));
    });
  });
}

void test('environment parser removes only matching paired quotes', () => {
  assert.deepEqual(parseEnvText([
    'DOUBLE="quoted-value"',
    "SINGLE='single-quoted-value'",
    "LEADING='literal-leading",
    'TRAILING=literal-trailing"',
    '',
  ].join('\n')), {
    DOUBLE: 'quoted-value',
    SINGLE: 'single-quoted-value',
    LEADING: "'literal-leading",
    TRAILING: 'literal-trailing"',
  });
});

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

void test('concurrent clean initialization exports one consistent runtime key set', async () => {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'all-mail-concurrent-runtime-secrets-'));
  const lockFile = path.join(stateDir, '.bootstrap-secrets.lock');
  await writeFile(lockFile, '', { mode: 0o600 });
  const results = await Promise.all(
    Array.from({ length: 8 }, () => runLockedBootstrap(stateDir)),
  );
  const expected = results[0].runtimeSecrets;
  for (const result of results) {
    assert.deepEqual(result.runtimeSecrets, expected);
  }
  const persisted = parseEnvText(await readFile(path.join(stateDir, RUNTIME_SECRETS_FILENAME), 'utf8'));
  assert.deepEqual(persisted, expected);
  await access(lockFile);
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

void test('runtime-only legacy bundle does not persist a consumed environment password', async () => {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'all-mail-runtime-only-legacy-'));
  await writeFile(path.join(stateDir, LEGACY_SECRETS_FILENAME), [
    'JWT_SECRET=legacy-jwt-secret-that-is-at-least-thirty-two-characters',
    'ENCRYPTION_KEY=0123456789abcdef0123456789abcdef',
    '',
  ].join('\n'), { mode: 0o600 });

  await ensureRuntimeSecrets({
    stateDir,
    env: {
      ADMIN_USERNAME: 'existing-admin',
      ADMIN_PASSWORD: 'already-consumed-password',
    },
  });

  await assert.rejects(readFile(path.join(stateDir, BOOTSTRAP_ADMIN_FILENAME), 'utf8'));
  await assert.rejects(readFile(path.join(stateDir, LEGACY_SECRETS_FILENAME), 'utf8'));
});

void test('fresh one-shot environment credentials are left for the locked database bootstrap', async () => {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'all-mail-fresh-bootstrap-admin-'));
  await ensureRuntimeSecrets({
    stateDir,
    env: {
      ADMIN_USERNAME: 'fresh-admin',
      ADMIN_PASSWORD: 'fresh-admin-password',
    },
  });

  await assert.rejects(readFile(path.join(stateDir, BOOTSTRAP_ADMIN_FILENAME), 'utf8'));
});

void test('consumed environment credentials are not rematerialized on later init runs', async () => {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'all-mail-consumed-bootstrap-admin-'));
  await ensureRuntimeSecrets({
    stateDir,
    env: {
      ADMIN_USERNAME: 'existing-admin',
      ADMIN_PASSWORD: 'already-consumed-password',
    },
  });
  await ensureRuntimeSecrets({
    stateDir,
    env: {
      ADMIN_USERNAME: 'existing-admin',
      ADMIN_PASSWORD: 'already-consumed-password',
    },
  });

  await assert.rejects(readFile(path.join(stateDir, BOOTSTRAP_ADMIN_FILENAME), 'utf8'));
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

void test('unreadable runtime secret file fails closed instead of rotating keys', async (t) => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    t.skip('root can read mode 000 files');
    return;
  }
  const stateDir = await mkdtemp(path.join(tmpdir(), 'all-mail-unreadable-runtime-secrets-'));
  const first = await ensureRuntimeSecrets({ stateDir, env: {} });
  const runtimeFile = path.join(stateDir, RUNTIME_SECRETS_FILENAME);
  await chmod(runtimeFile, 0o000);
  try {
    await assert.rejects(
      ensureRuntimeSecrets({ stateDir, env: {} }),
      (error) => error && typeof error === 'object' && error.code === 'EACCES',
    );
  } finally {
    await chmod(runtimeFile, 0o600);
  }
  const persisted = parseEnvText(await readFile(runtimeFile, 'utf8'));
  assert.deepEqual(persisted, first.runtimeSecrets);
});

void test('invalid one-shot admin values fail before any secret is persisted', async () => {
  for (const env of [
    { ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'short' },
    { ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'valid-password\ninjected=value' },
    { ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: '\nvalid-password' },
    { ADMIN_USERNAME: 'admin\ninjected=value', ADMIN_PASSWORD: 'valid-password' },
    { ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: "'valid-password" },
    { ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'valid-password"' },
  ]) {
    const stateDir = await mkdtemp(path.join(tmpdir(), 'all-mail-invalid-bootstrap-admin-'));
    await assert.rejects(
      ensureRuntimeSecrets({ stateDir, env }),
      /ADMIN_(?:USERNAME|PASSWORD)/,
    );
    await assert.rejects(readFile(path.join(stateDir, RUNTIME_SECRETS_FILENAME), 'utf8'));
    await assert.rejects(readFile(path.join(stateDir, BOOTSTRAP_ADMIN_FILENAME), 'utf8'));
  }
});
