import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8');

function stableMinor(version) {
  const match = /^(\d+)\.(\d+)\.\d+$/.exec(version.trim());
  assert.ok(match, `invalid stable version: ${version}`);
  return `${match[1]}.${match[2]}.x`;
}

test('security and support target the canonical stable minor line', async () => {
  const [version, security, support] = await Promise.all([
    read('VERSION'),
    read('SECURITY.md'),
    read('SUPPORT.md'),
  ]);
  const line = stableMinor(version);
  assert.ok(
    security.includes(`| \`${line}\` | Supported stable line |`),
    `SECURITY.md does not support ${line}`,
  );
  assert.ok(
    support.includes(`latest stable \`${line}\` release`),
    `SUPPORT.md does not target ${line}`,
  );
  assert.doesNotMatch(security, /\| `2\.0\.x` \| Supported \|/);
});

test('post-v2.1 changes and the approved closeout sequence remain documented', async () => {
  const [changelog, plan] = await Promise.all([
    read('CHANGELOG.md'),
    read('docs/PR64-69-CLOSEOUT-PLAN.md'),
  ]);

  for (const phrase of [
    'React Router 8',
    'allocation cache invalidation',
    'compact operator overview',
    'browser height budgets',
  ]) {
    assert.ok(changelog.toLowerCase().includes(phrase.toLowerCase()), `missing changelog phrase: ${phrase}`);
  }

  for (let pr = 64; pr <= 69; pr += 1) {
    assert.match(plan, new RegExp(`### PR #${pr} `));
  }
  assert.match(plan, /v2\.1\.1/);
  assert.match(plan, /no database migration/i);
  assert.match(plan, /squash merge/i);
});
