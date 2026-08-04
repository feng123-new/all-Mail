import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8');

test('frontend GET lifecycle coalesces callers and isolates session caches', async () => {
  const source = await read('web/src/api/core.ts');
  assert.match(source, /const pendingGetRequests = new Map/);
  assert.match(source, /return pending as ApiResult<T>/);
  assert.match(source, /requestEpoch === requestRuntimeEpoch/);
  assert.match(source, /export const resetApiRuntimeState/);
  assert.match(source, /useAuthStore\.subscribe/);
  assert.match(source, /useMailboxAuthStore\.subscribe/);
  assert.doesNotMatch(source, /pendingGetControllers|previousController\.abort\(\)/);
});

test('unknown routes have scoped recovery surfaces', async () => {
  const [app, page] = await Promise.all([
    read('web/src/App.tsx'),
    read('web/src/pages/not-found/index.tsx'),
  ]);
  assert.match(app, /NotFoundPage surface="admin"/);
  assert.match(app, /NotFoundPage surface="portal"/);
  assert.match(app, /NotFoundPage surface="public"/);
  assert.doesNotMatch(app, /Route path="\*" element={<Navigate to="\/dashboard"/);
  assert.match(page, /\/mail\/inbox/);
  assert.match(page, /\/dashboard/);
  assert.match(page, /\/login/);
});

test('Dashboard loading fallbacks live in a separate model module', async () => {
  const [page, model] = await Promise.all([
    read('web/src/pages/dashboard/index.tsx'),
    read('web/src/pages/dashboard/model.ts'),
  ]);
  assert.match(page, /from '\.\/model'/);
  assert.match(page, /resolveDashboardStats\(stats\)/);
  assert.match(page, /resolveEmailStats\(emailStats\)/);
  assert.match(model, /EMPTY_DASHBOARD_STATS/);
  assert.match(model, /EMPTY_EMAIL_STATS/);
});
