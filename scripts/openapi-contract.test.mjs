import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  generateOpenAPI,
  loadOpenAPIInputs,
  serializeOpenAPI,
} from './generate-openapi.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8');
const readJSON = async (relativePath) => JSON.parse(await read(relativePath));

const compatibilityAliases = new Set([
  '/api/get-email',
  '/api/list-emails',
  '/api/pool-stats',
  '/api/reset-pool',
  '/api/mail_new',
  '/api/mail_text',
  '/api/mail_all',
  '/api/process-mailbox',
  '/api/domain-mail/get-mailbox',
  '/api/domain-mail/mail_new',
  '/api/domain-mail/mail_all',
  '/api/domain-mail/list-mailboxes',
  '/api/domain-mail/pool-stats',
  '/api/domain-mail/reset-pool',
  '/api/domain-mail/mail_text',
]);

function routeOwnsOperation(routes, operation) {
  return routes.find((route) => {
    if (route.owner !== 'go-business-api' || route.migrationStage !== 'complete') return false;
    if (Array.isArray(route.methods) && !route.methods.includes(operation.method) && !(operation.method === 'GET' && route.methods.includes('HEAD'))) return false;
    if (route.match === 'exact') return route.path === operation.path;
    if (route.match === 'prefix') return operation.path === route.path || operation.path.startsWith(`${route.path}/`);
    return false;
  });
}

async function readBusinessSource() {
  const directory = path.join(root, 'core', 'internal', 'businessapi');
  const files = (await readdir(directory)).filter((name) => name.endsWith('.go') && !name.endsWith('_test.go'));
  const sources = await Promise.all(files.map((name) => readFile(path.join(directory, name), 'utf8')));
  return sources.join('\n');
}

test('OpenAPI inventory is unique, canonical, and owned by the Go business API', async () => {
  const [{ inventory, version }, ownership] = await Promise.all([
    loadOpenAPIInputs(),
    readJSON('config/route-ownership.json'),
  ]);

  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(inventory.version, 1);
  assert.ok(inventory.operations.length >= 40);

  const operationKeys = new Set();
  const operationIds = new Set();
  const tags = new Set();
  for (const operation of inventory.operations) {
    assert.match(operation.method, /^(GET|POST|PUT|PATCH|DELETE)$/);
    assert.match(operation.path, /^\/(api|admin|mail\/api|ingress)\//);
    assert.ok(!compatibilityAliases.has(operation.path), `compatibility alias became a primary path: ${operation.path}`);
    assert.ok(operation.summary && operation.tag && operation.auth && operation.operationId);
    assert.ok(!operationKeys.has(`${operation.method} ${operation.path}`), `duplicate operation: ${operation.method} ${operation.path}`);
    assert.ok(!operationIds.has(operation.operationId), `duplicate operationId: ${operation.operationId}`);
    operationKeys.add(`${operation.method} ${operation.path}`);
    operationIds.add(operation.operationId);
    tags.add(operation.tag);
    assert.ok(routeOwnsOperation(ownership.routes, operation), `route ownership missing: ${operation.method} ${operation.path}`);
  }

  assert.deepEqual([...tags].sort(), ['Administrator', 'Mailbox portal', 'Public automation', 'Signed ingress']);
});

test('OpenAPI operations remain registered in production Go sources', async () => {
  const [{ inventory }, source] = await Promise.all([
    loadOpenAPIInputs(),
    readBusinessSource(),
  ]);

  for (const operation of inventory.operations) {
    if (operation.tag === 'Public automation') {
      assert.ok(source.includes(`"${operation.path}"`), `public path not registered in Go: ${operation.path}`);
      continue;
    }
    assert.ok(
      source.includes(`"${operation.method} ${operation.path}"`),
      `method-aware route not registered in Go: ${operation.method} ${operation.path}`,
    );
  }
});

test('generated OpenAPI 3.1 document matches VERSION and authentication boundaries', async () => {
  const { inventory, version } = await loadOpenAPIInputs();
  const document = generateOpenAPI(inventory, version);
  const reparsed = JSON.parse(serializeOpenAPI(document));

  assert.equal(reparsed.openapi, '3.1.0');
  assert.equal(reparsed.info.version, version);
  assert.equal(Object.keys(reparsed.paths).length, new Set(inventory.operations.map((operation) => operation.path)).size);

  for (const operation of inventory.operations) {
    const generated = reparsed.paths[operation.path][operation.method.toLowerCase()];
    assert.equal(generated.operationId, operation.operationId);
    assert.equal(generated['x-allmail-auth'], operation.auth);
    assert.deepEqual(generated.tags, [operation.tag]);
    assert.ok(generated.responses['200']);
    if (operation.body) assert.ok(generated.requestBody?.required);
  }

  assert.deepEqual(reparsed.paths['/admin/auth/login'].post.security, []);
  assert.deepEqual(reparsed.paths['/mail/api/login'].post.security, []);
  assert.deepEqual(reparsed.paths['/api/mailboxes'].get.security, [{ ApiKey: [] }, { BearerApiKey: [] }]);
  assert.deepEqual(reparsed.paths['/ingress/domain-mail/receive'].post.security, [{ IngressKeyId: [], IngressSignature: [] }]);
});

test('frontend and Docker builds publish the deterministic OpenAPI document', async () => {
  const [packageJSON, dockerfile, gitignore, documentation] = await Promise.all([
    readJSON('web/package.json'),
    read('Dockerfile'),
    read('.gitignore'),
    read('docs/API-CONTRACT.md'),
  ]);

  assert.match(packageJSON.scripts['generate:openapi'], /generate-openapi\.mjs --output public\/openapi\.json/);
  assert.match(packageJSON.scripts.build, /^npm run generate:openapi && /);
  assert.match(packageJSON.scripts.dev, /^npm run generate:openapi && /);
  assert.match(dockerfile, /COPY VERSION \/src\/VERSION/);
  assert.match(dockerfile, /COPY config\/openapi-routes\.json \/src\/config\/openapi-routes\.json/);
  assert.match(dockerfile, /COPY scripts\/generate-openapi\.mjs \/src\/scripts\/generate-openapi\.mjs/);
  assert.match(gitignore, /web\/public\/openapi\.json/);
  assert.match(documentation, /\/openapi\.json/);
});
