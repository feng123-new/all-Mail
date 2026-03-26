import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ensureBootstrapSecrets } from './bootstrap-secrets.mjs';

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
