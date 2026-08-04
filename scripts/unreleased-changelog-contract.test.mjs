import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8');
const git = (...args) => execFileSync('git', args, {
  cwd: root,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
}).trim();

function tryGit(...args) {
  try {
    return git(...args);
  } catch {
    return null;
  }
}

function unreleasedSection(changelog) {
  const match = changelog.match(/^## \[Unreleased\]\s*\n([\s\S]*?)(?=^## \[)/m);
  assert.ok(match, 'CHANGELOG.md is missing the Unreleased section');
  return match[1].trim();
}

test('main changes after the stable tag are represented in Unreleased', async (context) => {
  const [versionSource, changelog] = await Promise.all([
    read('VERSION'),
    read('CHANGELOG.md'),
  ]);
  const version = versionSource.trim();
  const stableTag = `v${version}`;
  const stableCommit = tryGit('rev-parse', '--verify', `${stableTag}^{commit}`);
  if (!stableCommit) {
    context.skip(`${stableTag} is unavailable in this checkout or is a not-yet-published release candidate`);
    return;
  }

  const taggedVersion = tryGit('show', `${stableTag}:VERSION`)?.trim();
  assert.equal(taggedVersion, version, `${stableTag} does not match VERSION`);

  const head = git('rev-parse', 'HEAD');
  if (head === stableCommit) return;

  // Compare the two trees directly. A pull-request checkout can contain only the
  // synthetic merge commit plus fetched tag objects, so a three-dot diff may
  // have no locally available merge base even though both trees are valid.
  const changedFiles = git('diff', '--name-only', stableTag, 'HEAD')
    .split(/\r?\n/)
    .filter(Boolean);
  if (changedFiles.length === 0) return;

  const section = unreleasedSection(changelog);
  assert.doesNotMatch(
    section,
    /^No unreleased changes\.?$/i,
    `HEAD differs from ${stableTag}, but CHANGELOG.md claims there are no unreleased changes`,
  );
  assert.match(
    section,
    /^### (?:Added|Changed|Deprecated|Removed|Fixed|Security|Compatibility)/m,
    'Unreleased changes must use a recognized changelog category',
  );
});
