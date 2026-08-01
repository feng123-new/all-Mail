import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFile(path.join(repoRoot, relativePath), 'utf8');

test('portal passwords are never persisted in browser storage', async () => {
  const [managementPage, loginPage, cleanupUtility] = await Promise.all([
    read('web/src/pages/mailbox-users/index.tsx'),
    read('web/src/pages/mail-portal/login/index.tsx'),
    read('web/src/utils/portalCredentialStorage.ts'),
  ]);
  const productionSurface = `${managementPage}\n${loginPage}\n${cleanupUtility}`;

  assert.doesNotMatch(productionSurface, /\.setItem\s*\(/, 'portal code writes browser storage');
  assert.doesNotMatch(productionSurface, /\.getItem\s*\(/, 'portal code reads a stored credential');
  assert.doesNotMatch(productionSurface, /savePortalCredentialPrefill|PortalLoginPrefillPayload/);
  assert.match(cleanupUtility, /removeItem\s*\(/, 'legacy credential cleanup is missing');
  assert.match(loginPage, /password:\s*''/, 'password field is not explicitly cleared during username prefill');
});
