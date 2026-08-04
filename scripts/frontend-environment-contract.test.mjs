import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8');

function envKeys(source) {
  return source
    .split(/\r?\n/)
    .map((line) => line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1])
    .filter(Boolean)
    .sort();
}

test('frontend build-time variables are fully documented and development-only', async () => {
  const [template, viteConfig, apiCore] = await Promise.all([
    read('web/.env.example'),
    read('web/vite.config.ts'),
    read('web/src/api/core.ts'),
  ]);

  assert.deepEqual(envKeys(template), ['VITE_DEV_PROXY_TARGET']);
  assert.match(viteConfig, /process\.env\.VITE_DEV_PROXY_TARGET\s*\|\|\s*['"]http:\/\/localhost:3002['"]/);
  assert.doesNotMatch(apiCore, /VITE_API_BASE_URL|import\.meta\.env/);
  assert.match(apiCore, /baseURL:\s*['"]{2}/);
  assert.match(apiCore, /withCredentials:\s*true/);
});
