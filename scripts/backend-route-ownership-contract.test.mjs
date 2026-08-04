import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8');
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter((file) => /^core\/internal\/businessapi\/.*\.go$/.test(file) && !file.endsWith('_test.go'));

function normalize(route) {
  return route
    .replace(/\{\$\}/g, '')
    .replace(/\{[^}]+\}/g, ':param')
    .replace(/\/$/, '') || '/';
}

function owned(handler, route) {
  const methods = route.methods ?? [];
  if (methods.length > 0 && !methods.includes(handler.method)) return false;
  const handlerPath = normalize(handler.path);
  const manifestPath = normalize(route.path);
  if (route.match === 'exact') return handlerPath === manifestPath;
  if (route.match === 'prefix') {
    return handlerPath === manifestPath || handlerPath.startsWith(`${manifestPath}/`);
  }
  return false;
}

test('every public Go business handler is covered by method-aware route ownership', async () => {
  const manifest = JSON.parse(await read('config/route-ownership.json'));
  const handlers = [];

  for (const file of tracked) {
    const source = await read(file);
    for (const match of source.matchAll(/\.(?:HandleFunc|Handle)\(\s*["`]([A-Z]+)\s+(\/[^"`]+)["`]/g)) {
      if (!/^\/(?:admin|api|mail\/api|oauth|ingress)(?:\/|$)/.test(match[2])) continue;
      handlers.push({ file, method: match[1], path: match[2] });
    }
  }

  assert.ok(handlers.length >= 100, `unexpectedly small Go business route inventory: ${handlers.length}`);
  const missing = handlers.filter((handler) => !manifest.routes.some(
    (route) => route.owner === 'go-business-api' && owned(handler, route),
  ));
  assert.deepEqual(missing, []);
});
