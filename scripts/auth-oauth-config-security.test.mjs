import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFile(path.join(root, name), 'utf8');

test('runtime database owner credentials stay initializer-only', async () => {
  const [compose, helper] = await Promise.all([read('docker-compose.yml'), read('scripts/compose-up.sh')]);
  for (const file of ['api-url', 'forwarding-url', 'retention-url']) assert.match(compose, new RegExp(`DATABASE_URL_FILE: /var/lib/all-mail-database/${file}`));
  const runtime = compose.slice(compose.indexOf('\n  app:'), compose.indexOf('\n  postgres:'));
  assert.doesNotMatch(runtime, /\n\s+DATABASE_URL:/);
  assert.match(helper, /ALL_MAIL_EXPORT_API_DATABASE_URL_FILE/);
  assert.match(helper, /ALL_MAIL_EXPORT_FORWARDING_DATABASE_URL_FILE/);
  assert.match(helper, /ALL_MAIL_EXPORT_RETENTION_DATABASE_URL_FILE/);
});

test('browser writes and framing use explicit same-origin boundaries', async () => {
  const [gateway, business] = await Promise.all([read('core/internal/httpapi/server.go'), read('core/internal/businessapi/browser_origin.go')]);
  assert.match(gateway, /frame-ancestors 'none'/);
  assert.match(gateway, /X-Frame-Options", "DENY/);
  assert.match(business, /Sec-Fetch-Site/);
  assert.match(business, /CSRF_ORIGIN_INVALID/);
});

test('OAuth inputs are JSON-only and defaults are least privilege', async () => {
  const [handler, template, web] = await Promise.all([
    read('core/internal/businessapi/mail_oauth_handlers.go'),
    read('.env.example'),
    read('web/src/pages/emails/index.tsx'),
  ]);
  assert.doesNotMatch(handler, /json:"filePath"|os\.Open\(/);
  for (const content of [template, web]) {
    assert.match(content, /gmail\.readonly/);
    assert.doesNotMatch(content, /GOOGLE_OAUTH_SCOPES=.*gmail\.modify.*mail\.google\.com/);
  }
  assert.match(template, /MICROSOFT_OAUTH_SCOPES=.*Mail\.Read(?:\s|$)/);
  assert.doesNotMatch(template, /MICROSOFT_OAUTH_SCOPES=.*(?:Contacts|Calendars|MailboxSettings)\.ReadWrite/);
});

test('retired local OAuth helper is absent', async () => {
  await assert.rejects(access(path.join(root, 'oauth-temp')));
});
