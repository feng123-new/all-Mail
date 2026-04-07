import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildBootstrapAdminPasswordMessages,
  ensureBootstrapSecrets,
  resolveBootstrapAdminPasswordSource,
  shouldPrintBootstrapPassword,
} from './bootstrap-secrets.mjs';

void test('ensureBootstrapSecrets marks first state file creation and resolves login url', async () => {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'all-mail-bootstrap-'));
  const firstRun = await ensureBootstrapSecrets({
    stateDir,
    env: {
      APP_PORT: '3002',
      ADMIN_PASSWORD: 'provided-admin-password',
      PUBLIC_BASE_URL: 'https://mail.example.com/',
    },
  });

  assert.equal(firstRun.createdStateFile, true);
  assert.equal(firstRun.loginUrl, 'https://mail.example.com/login');
  assert.deepEqual(firstRun.createdKeys, ['JWT_SECRET', 'ENCRYPTION_KEY']);

  const secondRun = await ensureBootstrapSecrets({
    stateDir,
    env: {
      APP_PORT: '3002',
      ADMIN_PASSWORD: 'provided-admin-password',
      PUBLIC_BASE_URL: 'https://mail.example.com/',
    },
  });

  assert.equal(secondRun.createdStateFile, false);
  assert.equal(secondRun.loginUrl, 'https://mail.example.com/login');
});

void test('bootstrap password notices default to retrieval instructions instead of stdout secrets', () => {
  const lines = buildBootstrapAdminPasswordMessages({
    password: 'generated-admin-password',
    passwordSource: 'generated',
    secretsFile: '/var/lib/all-mail/bootstrap-secrets.env',
    printPassword: false,
    runtimeKind: 'docker',
  });

  assert.deepEqual(lines, [
    'Bootstrap admin password is stored in /var/lib/all-mail/bootstrap-secrets.env.',
    'Retrieve it from the runtime state file instead of startup logs.',
    `Example: docker compose exec app sh -lc "grep '^ADMIN_PASSWORD=' /var/lib/all-mail/bootstrap-secrets.env | cut -d= -f2-"`,
    'You must log in and change this temporary password immediately before using the rest of the application.',
  ]);
});

void test('bootstrap password notices only print raw secrets when explicitly opted in', () => {
  assert.equal(shouldPrintBootstrapPassword({ ALL_MAIL_PRINT_BOOTSTRAP_PASSWORD: 'true' }), true);
  assert.equal(shouldPrintBootstrapPassword({ ALL_MAIL_PRINT_BOOTSTRAP_PASSWORD: '0' }), false);

  const lines = buildBootstrapAdminPasswordMessages({
    password: 'managed-password',
    passwordSource: 'state-file',
    secretsFile: '/tmp/bootstrap-secrets.env',
    printPassword: true,
  });

  assert.deepEqual(lines, [
    'Bootstrap admin password: managed-password',
    'WARNING: Startup logs may retain this password. Disable ALL_MAIL_PRINT_BOOTSTRAP_PASSWORD after recovery.',
  ]);
});

void test('bootstrap password source distinguishes generated, persisted, and env-managed credentials', () => {
  assert.equal(resolveBootstrapAdminPasswordSource({ password: 'abc', createdKeys: ['ADMIN_PASSWORD'], managedKeys: [] }), 'generated');
  assert.equal(resolveBootstrapAdminPasswordSource({ password: 'abc', createdKeys: [], managedKeys: ['ADMIN_PASSWORD'] }), 'state-file');
  assert.equal(resolveBootstrapAdminPasswordSource({ password: 'abc', createdKeys: [], managedKeys: [] }), 'env');
  assert.equal(resolveBootstrapAdminPasswordSource({ password: '', createdKeys: [], managedKeys: [] }), null);
});
