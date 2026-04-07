import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

test('sanitize-runtime-env.sh removes env proxy startup flags before launching node', () => {
  const script = path.join(repoRoot, 'scripts', 'sanitize-runtime-env.sh');
  const child = spawnSync(script, [
    'node',
    '-e',
    "console.log(JSON.stringify({ nodeUseEnvProxy: process.env.NODE_USE_ENV_PROXY ?? null, nodeOptions: process.env.NODE_OPTIONS ?? null }))",
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_USE_ENV_PROXY: '1',
      NODE_OPTIONS: '--use-env-proxy --trace-warnings',
    },
  });

  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stderr, '');

  const payload = JSON.parse(child.stdout.trim());
  assert.equal(payload.nodeUseEnvProxy, null);
  assert.equal(payload.nodeOptions, '--trace-warnings');
});
