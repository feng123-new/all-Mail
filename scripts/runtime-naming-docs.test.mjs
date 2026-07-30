import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFile(path.join(repoRoot, relativePath), 'utf8');

void test('active runtime surfaces use ownership-based names only', async () => {
  const files = [
    '.env.example',
    'docker-compose.yml',
    'Dockerfile.server',
    'docker/entrypoint.sh',
    'core/internal/config/config.go',
    'core/internal/httpapi/server.go',
    'core/internal/readiness/probes.go',
    'server/package.json',
    '.github/workflows/ci.yml',
    '.github/workflows/config-security.yml',
    '.github/workflows/bootstrap-admin-security.yml',
  ];
  const combined = (await Promise.all(files.map(read))).join('\n');

  for (const retired of [
    'legacy-api',
    'legacy-init',
    'LEGACY_API_URL',
    'ALL_MAIL_LEGACY_IMAGE',
    'Dockerfile.legacy',
    'ALL_MAIL_ALLOW_LEGACY_DB_PUSH_REPAIR',
    'db:repair:legacy-p3005',
  ]) {
    assert.equal(combined.includes(retired), false, `${retired} remains on an active runtime surface`);
  }

  assert.match(combined, /business-api/);
  assert.match(combined, /business-init/);
  assert.match(combined, /BUSINESS_API_URL/);
  assert.match(combined, /Dockerfile\.server/);
});

void test('logical secret-volume rename retains the existing physical volume', async () => {
  const compose = await read('docker-compose.yml');
  assert.match(
    compose,
    /runtime_secrets_data:[\s\S]*name: "\$\{COMPOSE_PROJECT_NAME:-all-mail\}_legacy_runtime_data"/,
  );
  await access(path.join(repoRoot, 'Dockerfile.server'));
  await assert.rejects(access(path.join(repoRoot, 'Dockerfile.legacy')));
});

void test('active documentation no longer links to the archived rewrite directory', async () => {
  const activeDocs = [
    'README.md',
    'CONTRIBUTING.md',
    'CLOUDFLARE-DEPLOY.md',
    'docs/README.md',
    'docs/DEPLOY.md',
    'docs/ENVIRONMENT.md',
    'docs/GO-MIGRATION.md',
    'docs/RUNBOOK.md',
    'docs/advanced-runtime.md',
    'docs/open-source-release-checklist.md',
    'docs/internal/README.md',
    'docs/internal/runtime-migration-roadmap.md',
    'docs/UPGRADE-RUNTIME-NAMES.md',
  ];
  const combined = (await Promise.all(activeDocs.map(read))).join('\n');

  assert.doesNotMatch(combined, /(?:docs\/)?internal\/rewrite\//);
  assert.match(combined, /internal\/runtime-migration-roadmap\.md/);
  assert.match(combined, /UPGRADE-RUNTIME-NAMES\.md/);

  await access(path.join(repoRoot, 'docs/internal/runtime-migration-roadmap.md'));
  await access(path.join(repoRoot, 'docs/internal/archive/2026-go-rewrite/README.md'));
  await access(path.join(repoRoot, 'docs/UPGRADE-RUNTIME-NAMES.md'));
});
