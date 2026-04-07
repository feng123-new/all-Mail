import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function parseEnvKeys(content) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => line.slice(0, line.indexOf('=')).trim())
    .sort();
}

test('default docker env templates stay aligned', async () => {
  const [defaultTemplate, basicTemplate] = await Promise.all([
    readFile(path.join(repoRoot, '.env.example'), 'utf8'),
    readFile(path.join(repoRoot, '.env.basic.example'), 'utf8'),
  ]);

  assert.deepEqual(parseEnvKeys(defaultTemplate), parseEnvKeys(basicTemplate));
});

test('docker compose binds published ports to configurable hosts', async () => {
  const compose = await readFile(path.join(repoRoot, 'docker-compose.yml'), 'utf8');

  assert.match(compose, /\$\{APP_PUBLISH_HOST:-127\.0\.0\.1\}/);
  assert.match(compose, /\$\{POSTGRES_PUBLISH_HOST:-127\.0\.0\.1\}/);
  assert.match(compose, /\$\{REDIS_PUBLISH_HOST:-127\.0\.0\.1\}/);
});

test('root release scripts include worker install and production audits', async () => {
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));

  assert.match(packageJson.scripts['install:all'], /cloudflare\/workers\/allmail-edge install/);
  assert.match(packageJson.scripts['verify:release'], /npm run audit:prod/);
  assert.match(packageJson.scripts.check, /npm run verify:release/);
});

test('bootstrap password output stays opt-in and points operators at persisted state', async () => {
  const [startScript, entrypoint] = await Promise.all([
    readFile(path.join(repoRoot, 'scripts/start-all-mail.mjs'), 'utf8'),
    readFile(path.join(repoRoot, 'docker/entrypoint.sh'), 'utf8'),
  ]);

  assert.match(startScript, /buildBootstrapAdminPasswordMessages/);
  assert.match(entrypoint, /ALL_MAIL_PRINT_BOOTSTRAP_PASSWORD/);
  assert.match(entrypoint, /Retrieve it from the runtime state file instead of startup logs\./);
});
