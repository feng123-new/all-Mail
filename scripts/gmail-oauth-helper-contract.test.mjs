import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8');

test('Gmail helper follows cookie-first admin authentication and canonical scopes', async () => {
  const [helper, client, template, readme] = await Promise.all([
    read('gmail_oauth/gmail_oauth_auto.py'),
    read('gmail_oauth/admin_client.py'),
    read('gmail_oauth/gmail_oauth.env.example'),
    read('gmail_oauth/README.md'),
  ]);

  assert.match(helper, /from admin_client import AdminAPIError, AdminSession/);
  assert.match(helper, /AdminSession\(admin_base_url\)/);
  assert.match(helper, /OTP_REQUIRED/);
  assert.match(helper, /getpass\.getpass/);
  assert.match(helper, /mustChangePassword/);
  assert.doesNotMatch(helper, /login\["data"\]\["token"\]/);
  assert.doesNotMatch(helper, /Bearer \{token\}/);
  assert.doesNotMatch(helper, /\?secrets=true/);
  assert.doesNotMatch(helper, /https:\/\/mail\.google\.com\//);

  assert.match(client, /CookieJar\(\)/);
  assert.match(client, /HTTPCookieProcessor/);
  assert.match(client, /data\.get\("admin"\)/);
  assert.match(client, /login succeeded without an administrator session cookie/);

  assert.match(
    template,
    /^SCOPES=openid email profile https:\/\/www\.googleapis\.com\/auth\/gmail\.modify https:\/\/www\.googleapis\.com\/auth\/gmail\.send$/m,
  );
  assert.doesNotMatch(template, /^ADMIN_OTP=/m);
  assert.match(readme, /Cookie/);
  assert.match(readme, /不调用秘密明文揭示接口/);
});
