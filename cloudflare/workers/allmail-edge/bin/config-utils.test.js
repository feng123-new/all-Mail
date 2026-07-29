import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDeployConfig,
  parseEnvFile,
  requireWorkerDeployVars,
  resolveWorkerHealthUrl,
} from './config-utils.js';

const template = `{
  "vars": {
    "INGRESS_URL": "https://edge.example.com/ingress/domain-mail/receive",
    "INGRESS_KEY_ID": "allmail-edge-main",
    "INGRESS_PROVIDER": "CLOUDFLARE_EMAIL_ROUTING",
    "RAW_EMAIL_OBJECT_PREFIX": "allmail-edge/raw",
    "MAX_RAW_EMAIL_BYTES": "15728640"
  },
  "r2_buckets": [{ "bucket_name": "mail-eml" }]
}`;

function validEntries(overrides = {}) {
  return new Map(Object.entries({
    INGRESS_URL: 'https://mail.example.com/ingress/domain-mail/receive',
    INGRESS_KEY_ID: 'edge-primary',
    INGRESS_PROVIDER: 'CLOUDFLARE_EMAIL_ROUTING',
    RAW_EMAIL_OBJECT_PREFIX: 'mail/raw',
    RAW_EMAIL_BUCKET_NAME: 'mail-archive',
    MAX_RAW_EMAIL_BYTES: '10485760',
    ...overrides,
  }));
}

test('env parsing removes only paired quotes so shared secrets stay byte-identical', () => {
  const parsed = parseEnvFile([
    'INGRESS_SIGNING_SECRET="quoted-secret"',
    "SINGLE='single-secret'",
    "LEADING='literal-leading",
    'TRAILING=literal-trailing"',
  ].join('\n'));

  assert.equal(parsed.get('INGRESS_SIGNING_SECRET'), 'quoted-secret');
  assert.equal(parsed.get('SINGLE'), 'single-secret');
  assert.equal(parsed.get('LEADING'), "'literal-leading");
  assert.equal(parsed.get('TRAILING'), 'literal-trailing"');
});

test('deploy config carries the explicit raw-email limit and R2 binding', () => {
  const result = buildDeployConfig(template, validEntries());
  assert.match(result, /"MAX_RAW_EMAIL_BYTES": "10485760"/);
  assert.match(result, /"bucket_name": "mail-archive"/);
  assert.match(result, /https:\/\/mail\.example\.com\/ingress\/domain-mail\/receive/);
});

test('worker deployment rejects missing or oversized raw-email limits', () => {
  assert.throws(
    () => requireWorkerDeployVars(validEntries({ MAX_RAW_EMAIL_BYTES: '' })),
    /MAX_RAW_EMAIL_BYTES/,
  );
  assert.throws(
    () => buildDeployConfig(template, validEntries({ MAX_RAW_EMAIL_BYTES: String(25 * 1024 * 1024 + 1) })),
    /MAX_RAW_EMAIL_BYTES/,
  );
});

test('post-deploy health uses only an explicit HTTPS route', () => {
  assert.equal(resolveWorkerHealthUrl(validEntries()), null);
  assert.equal(
    resolveWorkerHealthUrl(validEntries({ WORKER_HEALTH_URL: 'https://edge.example.com/health' })),
    'https://edge.example.com/health',
  );
  assert.throws(
    () => resolveWorkerHealthUrl(validEntries({ WORKER_HEALTH_URL: 'http://edge.example.com/health' })),
    /must use https/,
  );
});
