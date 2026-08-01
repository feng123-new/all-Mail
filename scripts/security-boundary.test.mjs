import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFile(path.join(repoRoot, relativePath), 'utf8');

function serviceSection(compose, name, nextName) {
  const start = compose.indexOf(`\n  ${name}:`);
  assert.notEqual(start, -1, `missing Compose service ${name}`);
  const end = nextName
    ? compose.indexOf(`\n  ${nextName}:`, start + 1)
    : compose.indexOf('\nnetworks:', start + 1);
  return compose.slice(start, end < 0 ? compose.length : end);
}

test('public, provider, database and cache networks enforce least privilege', async () => {
  const compose = await read('docker-compose.yml');
  const app = serviceSection(compose, 'app', 'go-business-api');
  const business = serviceSection(compose, 'go-business-api', 'worker-forwarding');
  const forwarding = serviceSection(compose, 'worker-forwarding', 'worker-retention');
  const retention = serviceSection(compose, 'worker-retention', 'redis');
  const redis = serviceSection(compose, 'redis', 'postgres');
  const postgres = serviceSection(compose, 'postgres', null);

  assert.match(app, /networks:[\s\S]*public-network[\s\S]*app-network/);
  assert.doesNotMatch(app, /database-network|cache-network|provider-network/);

  for (const network of ['app-network', 'provider-network', 'database-network', 'cache-network']) {
    assert.match(business, new RegExp(`(?:^|\\n)\\s+- ${network.replaceAll('-', '\\-')}(?:\\n|$)`));
  }
  assert.doesNotMatch(business, /public-network/);
  assert.match(forwarding, /provider-network[\s\S]*database-network/);
  assert.doesNotMatch(forwarding, /app-network|cache-network|public-network/);
  assert.match(retention, /database-network/);
  assert.doesNotMatch(retention, /app-network|cache-network|provider-network|public-network/);
  assert.match(redis, /cache-network/);
  assert.doesNotMatch(redis, /app-network|database-network|provider-network|public-network/);
  assert.match(postgres, /database-network/);
  assert.doesNotMatch(postgres, /app-network|cache-network|provider-network|public-network/);

  for (const internalNetwork of ['app-network', 'database-network', 'cache-network']) {
    const pattern = new RegExp(`${internalNetwork.replaceAll('-', '\\-')}:[\\s\\S]*?internal: true`);
    assert.match(compose, pattern);
  }
});

test('long-running services receive isolated secret exports only', async () => {
  const compose = await read('docker-compose.yml');
  const business = serviceSection(compose, 'go-business-api', 'worker-forwarding');
  const initializer = await read('scripts/compose-up.sh');

  assert.match(business, /bootstrap_admin_data:\/var\/lib\/all-mail(?:\n|$)/);
  assert.match(business, /go_business_runtime_data:\/var\/lib\/all-mail-secrets:ro/);
  assert.match(business, /forwarding_runtime_data:\/var\/lib\/all-mail-encryption:ro/);
  assert.match(business, /redis_runtime_data:\/var\/lib\/all-mail-redis:ro/);
  assert.doesNotMatch(business, /runtime_secrets_data/);
  assert.match(business, /REDIS_PASSWORD_FILE: \/var\/lib\/all-mail-redis\/redis-password/);

  assert.match(initializer, /ALL_MAIL_STATE_DIR=\/var\/lib\/all-mail-state/);
  assert.match(initializer, /ALL_MAIL_EXPORT_REDIS_PASSWORD_FILE=\/var\/lib\/all-mail-redis\/redis-password/);
  assert.match(initializer, /bootstrap_admin_data/);
  assert.match(initializer, /redis_runtime_data/);
});

test('Redis requires the initializer-managed password file', async () => {
  const compose = await read('docker-compose.yml');
  const redis = serviceSection(compose, 'redis', 'postgres');

  assert.match(redis, /redis_runtime_data:\/run\/all-mail-secrets:ro/);
  assert.match(redis, /cat \/run\/all-mail-secrets\/redis-password/);
  assert.match(redis, /requirepass/);
  assert.match(redis, /REDISCLI_AUTH/);
  assert.doesNotMatch(redis, /--protected-mode no/);
});

test('development Redis is loopback-only and explicitly not the production auth model', async () => {
  const overlay = await read('docker-compose.dev.yml');
  assert.match(overlay, /entrypoint:\s*\[\]/);
  assert.match(overlay, /command:\s*\["redis-server", "--appendonly", "yes", "--port", "6379"\]/);
  assert.match(overlay, /127\.0\.0\.1:\$\{DEV_REDIS_PORT:-6380\}:6379/);
  assert.match(overlay, /not a production topology or security model/i);
});
