import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFile(path.join(repoRoot, relativePath), 'utf8');

function parseEnvKeys(content) {
  return content.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => line.slice(0, line.indexOf('=')).trim())
    .sort();
}

function serviceSection(compose, name, nextName) {
  const start = compose.indexOf(`\n  ${name}:`);
  assert.notEqual(start, -1, `missing Compose service ${name}`);
  const end = nextName ? compose.indexOf(`\n  ${nextName}:`, start + 1) : compose.indexOf('\nnetworks:', start + 1);
  return compose.slice(start, end < 0 ? compose.length : end);
}

test('the production template matches the canonical manifest', async () => {
  const [template, active, retired] = await Promise.all([
    read('.env.example'),
    read('config/runtime-env.json').then(JSON.parse),
    read('config/retired-env.json').then(JSON.parse),
  ]);
  const keys = parseEnvKeys(template);
  assert.deepEqual(keys, active.variables.map(({ name }) => name).sort());
  for (const name of retired.variables) assert.equal(keys.includes(name), false, name);
  assert.match(template, /^POSTGRES_PASSWORD=$/m);
  assert.match(template, /\.\/scripts\/compose-up\.sh/);
});

test('production Compose contains only Go runtimes and private state services', async () => {
  const compose = await read('docker-compose.yml');
  for (const service of ['app', 'go-business-api', 'worker-forwarding', 'worker-retention', 'postgres', 'redis']) {
    assert.match(compose, new RegExp(`\\n[ ]{2}${service.replaceAll('-', '\\-')}:`));
  }
  assert.doesNotMatch(compose, /\n[ ]{2}business-(?:api|init):|Dockerfile\.server|(?<!GO_)BUSINESS_API_URL/);

  const app = serviceSection(compose, 'app', 'go-business-api');
  assert.doesNotMatch(app, /DATABASE_URL|REDIS_URL|JWT_SECRET|ENCRYPTION_KEY/);
  assert.match(app, /GO_BUSINESS_API_URL: http:\/\/go-business-api:3200/);

  const business = serviceSection(compose, 'go-business-api', 'worker-forwarding');
  assert.match(business, /ALL_MAIL_RUNTIME_ENV: production/);
  assert.doesNotMatch(business, /NODE_ENV/);
  assert.match(business, /DATABASE_URL_FILE: \/var\/lib\/all-mail-database\/api-url[\s\S]*REDIS_URL: redis:\/\/redis:6379/);
  assert.doesNotMatch(business, /\n\s+DATABASE_URL:/);
  assert.match(business, /JWT_SECRET_FILE: \/var\/lib\/all-mail-secrets\/jwt-secret/);
  assert.match(business, /ENCRYPTION_KEY_FILE: \/var\/lib\/all-mail-encryption\/encryption-key/);
  assert.doesNotMatch(business, /\n\s+JWT_SECRET:|\n\s+ENCRYPTION_KEY:/);

  assert.match(compose, /runtime_secrets_data:[\s\S]*name: "\$\{COMPOSE_PROJECT_NAME:-all-mail\}_legacy_runtime_data"/);
  assert.doesNotMatch(serviceSection(compose, 'postgres', null), /\n\s+ports:/);
  assert.doesNotMatch(serviceSection(compose, 'redis', 'postgres'), /\n\s+ports:/);
});

test('temporary initialization is outside the declared Compose service graph', async () => {
  const script = await read('scripts/compose-up.sh');
  assert.match(script, /up -d --wait[\s\S]*postgres/);
  assert.match(script, /run --rm --no-deps --user 0:0/);
  assert.match(script, /--cap-add CHOWN[\s\S]*--cap-add DAC_OVERRIDE[\s\S]*--cap-add FOWNER/);
  assert.match(script, /--env-from-file "\$env_file"/);
  assert.match(script, /--env-from-file "\$env_file"[\s\S]*-e DATABASE_URL=/);
  assert.match(script, /ALL_MAIL_RUNTIME_ENV=production/);
  assert.doesNotMatch(script, /NODE_ENV/);
  assert.match(script, /app init/);
  assert.match(script, /ALL_MAIL_EXPORT_ENCRYPTION_KEY_FILE/);
  assert.match(script, /ALL_MAIL_EXPORT_JWT_SECRET_FILE/);
  assert.match(script, /ALL_MAIL_EXPORT_API_DATABASE_URL_FILE/);
  assert.match(script, /ALL_MAIL_EXPORT_FORWARDING_DATABASE_URL_FILE/);
  assert.match(script, /ALL_MAIL_EXPORT_RETENTION_DATABASE_URL_FILE/);
});

test('CI runs every PostgreSQL business API integration suite', async () => {
  const workflow = await read('.github/workflows/ci.yml');
  assert.match(workflow, /go test -run '\^TestPostgres' -count=1 \.\/internal\/businessapi/);
  assert.doesNotMatch(workflow, /go test -run TestPostgresAPIKeyAndExternalRouteIntegration /);
});

test('retired Node and Prisma production runtime files remain absent', async () => {
  for (const relativePath of ['server', 'Dockerfile.server', 'docker/entrypoint.sh']) {
    await assert.rejects(access(path.join(repoRoot, relativePath)), relativePath);
  }
  const [dockerfile, packageJSON] = await Promise.all([
    read('Dockerfile'),
    read('package.json').then(JSON.parse),
  ]);
  assert.doesNotMatch(dockerfile, /COPY server|Dockerfile\.server|prisma|node_modules.*runtime/i);
  for (const scriptName of ['install:server', 'build:server', 'test:server', 'audit:server']) {
    assert.equal(packageJSON.scripts[scriptName], undefined, scriptName);
  }
});

test('the final route manifest has no legacy owner or migration state', async () => {
  const manifest = JSON.parse(await read('config/route-ownership.json'));
  assert.equal(manifest.version, 3);
  for (const route of manifest.routes) {
    assert.ok(['go', 'go-business-api'].includes(route.owner), route.id);
    assert.equal(route.migrationStage, 'complete', route.id);
    assert.equal(route.targetOwner, undefined, route.id);
  }
});