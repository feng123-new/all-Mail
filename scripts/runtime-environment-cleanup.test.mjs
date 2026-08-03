import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFile(path.join(repoRoot, relativePath), 'utf8');

test('Go runtime uses the canonical environment selector and retires NODE_ENV', async () => {
  const [compose, loader, preflight, retired] = await Promise.all([
    read('docker-compose.yml'),
    read('core/internal/config/business_api.go'),
    read('core/internal/initialize/preflight.go'),
    read('config/retired-env.json').then(JSON.parse),
  ]);

  assert.match(compose, /ALL_MAIL_RUNTIME_ENV: production/);
  assert.doesNotMatch(compose, /NODE_ENV/);
  assert.match(loader, /env\("ALL_MAIL_RUNTIME_ENV", "development"\)/);
  assert.doesNotMatch(loader, /NODE_ENV/);
  assert.match(preflight, /cfg\.Environment\["ALL_MAIL_RUNTIME_ENV"\]/);
  assert.match(preflight, /"NODE_ENV"/);
  assert.ok(retired.variables.includes('NODE_ENV'));
});
