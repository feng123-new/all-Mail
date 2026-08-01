import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFile(path.join(repoRoot, relativePath), 'utf8');

test('active runtime surfaces use Go-only service names', async () => {
  const files = [
    '.env.example',
    'docker-compose.yml',
    'scripts/compose-up.sh',
    'core/internal/config/config.go',
    'core/internal/httpapi/server.go',
    'core/internal/readiness/probes.go',
  ];
  const combined = (await Promise.all(files.map(read))).join('\n');
  for (const retired of ['business-init', 'Dockerfile.server', 'legacy-api', 'legacy-init']) {
    assert.equal(combined.includes(retired), false, `${retired} remains on an active runtime surface`);
  }
  assert.doesNotMatch(combined, /(?<!GO_)BUSINESS_API_URL/);
  assert.match(combined, /go-business-api/);
});

test('the physical pre-cutover secret volume is retained for in-place upgrades', async () => {
  const compose = await read('docker-compose.yml');
  assert.match(compose, /runtime_secrets_data:[\s\S]*name: "\$\{COMPOSE_PROJECT_NAME:-all-mail\}_legacy_runtime_data"/);
  await assert.rejects(access(path.join(repoRoot, 'Dockerfile.server')));
});
