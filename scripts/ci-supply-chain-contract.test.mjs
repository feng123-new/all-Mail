import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8');

test('third-party GitHub Actions are pinned to immutable commit SHAs', async () => {
  const workflowDir = path.join(root, '.github', 'workflows');
  const files = (await readdir(workflowDir)).filter((name) => /\.ya?ml$/.test(name));
  let references = 0;

  for (const file of files) {
    const content = await readFile(path.join(workflowDir, file), 'utf8');
    for (const match of content.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)(?:\s+#\s*(.+))?$/gm)) {
      references += 1;
      const reference = match[1];
      const annotation = match[2] || '';
      const separator = reference.lastIndexOf('@');
      assert.ok(separator > 0, `${file}: malformed action reference ${reference}`);
      const revision = reference.slice(separator + 1);
      assert.match(revision, /^[0-9a-f]{40}$/, `${file}: ${reference} is not pinned to a full SHA`);
      assert.match(annotation, /\bv\d+(?:\.\d+){0,2}\b/, `${file}: ${reference} lacks a readable version comment`);
    }
  }

  assert.ok(references >= 10, `expected at least 10 action references, found ${references}`);
});

test('production host preflight is documented and secret-safe', async () => {
  const [script, deploy] = await Promise.all([
    read('scripts/host-preflight.sh'),
    read('docs/DEPLOY.md'),
  ]);

  for (const command of ['uname', 'git', 'python3', 'openssl', 'awk', 'df', 'docker']) {
    assert.match(script, new RegExp(`require_command ${command}`));
  }
  assert.match(script, /docker compose version/);
  assert.match(script, /BASH_VERSINFO/);
  assert.match(script, /ALL_MAIL_PREFLIGHT_SKIP_DAEMON/);
  assert.match(script, /ALL_MAIL_PREFLIGHT_SKIP_KERNEL/);
  assert.match(script, /ALL_MAIL_PREFLIGHT_SKIP_PORT/);
  assert.match(script, /vm\.overcommit_memory must be 1/);
  assert.match(script, /MemAvailable/);
  assert.match(script, /disk-available-mib/);
  assert.match(script, /inodes-available/);
  assert.match(script, /socket\.getaddrinfo/);
  assert.match(script, /docker-storage-driver/);
  assert.doesNotMatch(script, /cat\s+.*\.env|source\s+.*\.env|POSTGRES_PASSWORD|JWT_SECRET|ENCRYPTION_KEY/);

  assert.match(deploy, /bash scripts\/host-preflight\.sh/);
  assert.match(deploy, /vm\.overcommit_memory/);
  assert.match(deploy, /1 GiB/);
  assert.match(deploy, /4 GiB/);
  assert.match(deploy, /10,000/);
  for (const requirement of ['Bash 4', 'Python 3.9', 'OpenSSL', 'Docker Compose v2']) {
    assert.match(deploy, new RegExp(requirement.replaceAll('.', '\\.')));
  }
});
