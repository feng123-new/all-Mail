#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    content = read(path)
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one occurrence, found {count}: {old[:120]!r}")
    write(path, content.replace(old, new, 1))


def replace_all(path: str, old: str, new: str, minimum: int = 1) -> None:
    content = read(path)
    count = content.count(old)
    if count < minimum:
        raise RuntimeError(f"{path}: expected at least {minimum} occurrences, found {count}: {old[:120]!r}")
    write(path, content.replace(old, new))


# Production Compose: owner credentials are initializer-only; every long-running
# database client consumes a role-specific URL file.
replace_once(
    "docker-compose.yml",
    '''      DATABASE_URL: "postgresql://${POSTGRES_USER:-allmail}:${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}@postgres:5432/${POSTGRES_DB:-allmail}"\n      REDIS_URL: redis://redis:6379''',
    '''      DATABASE_URL_FILE: /var/lib/all-mail-database/api-url\n      REDIS_URL: redis://redis:6379''',
)
replace_once(
    "docker-compose.yml",
    '''      - redis_runtime_data:/var/lib/all-mail-redis:ro\n    networks:''',
    '''      - redis_runtime_data:/var/lib/all-mail-redis:ro\n      - database_runtime_data:/var/lib/all-mail-database:ro\n    networks:''',
)
replace_once(
    "docker-compose.yml",
    '''      DATABASE_URL: "postgresql://${POSTGRES_USER:-allmail}:${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}@postgres:5432/${POSTGRES_DB:-allmail}"\n      FORWARDING_WORKER_INTERVAL_SECONDS:''',
    '''      DATABASE_URL_FILE: /var/lib/all-mail-database/forwarding-url\n      FORWARDING_WORKER_INTERVAL_SECONDS:''',
)
replace_once(
    "docker-compose.yml",
    '''    volumes:\n      - forwarding_runtime_data:/var/lib/all-mail-secrets:ro\n    networks:\n      - provider-network''',
    '''    volumes:\n      - forwarding_runtime_data:/var/lib/all-mail-secrets:ro\n      - database_runtime_data:/var/lib/all-mail-database:ro\n    networks:\n      - provider-network''',
)
replace_once(
    "docker-compose.yml",
    '''      DATABASE_URL: "postgresql://${POSTGRES_USER:-allmail}:${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}@postgres:5432/${POSTGRES_DB:-allmail}"\n      API_LOG_RETENTION_DAYS:''',
    '''      DATABASE_URL_FILE: /var/lib/all-mail-database/retention-url\n      API_LOG_RETENTION_DAYS:''',
)
replace_once(
    "docker-compose.yml",
    '''    stop_grace_period: 30s\n    networks:\n      - database-network\n    healthcheck:\n      test: ["CMD", "allmail", "doctor", "worker", "retention"]''',
    '''    stop_grace_period: 30s\n    volumes:\n      - database_runtime_data:/var/lib/all-mail-database:ro\n    networks:\n      - database-network\n    healthcheck:\n      test: ["CMD", "allmail", "doctor", "worker", "retention"]''',
)
replace_once(
    "docker-compose.yml",
    '''  redis_runtime_data:\n  redis_data:''',
    '''  redis_runtime_data:\n  database_runtime_data:\n  redis_data:''',
)

# Startup helper resolves and mounts the sixth secret volume and exports three
# role-specific DSNs after schema migration and privilege reconciliation.
replace_once(
    "scripts/compose-up.sh",
    '''    "redis_runtime_data",\n):''',
    '''    "redis_runtime_data",\n    "database_runtime_data",\n):''',
)
replace_once(
    "scripts/compose-up.sh",
    '''if [[ "${#volumes[@]}" -ne 5 ]]; then''',
    '''if [[ "${#volumes[@]}" -ne 6 ]]; then''',
)
replace_once(
    "scripts/compose-up.sh",
    '''  -e ALL_MAIL_EXPORT_REDIS_PASSWORD_FILE=/var/lib/all-mail-redis/redis-password \\\n  -v "${volumes[0]}:/var/lib/all-mail-state"''',
    '''  -e ALL_MAIL_EXPORT_REDIS_PASSWORD_FILE=/var/lib/all-mail-redis/redis-password \\\n  -e ALL_MAIL_EXPORT_API_DATABASE_URL_FILE=/var/lib/all-mail-database/api-url \\\n  -e ALL_MAIL_EXPORT_FORWARDING_DATABASE_URL_FILE=/var/lib/all-mail-database/forwarding-url \\\n  -e ALL_MAIL_EXPORT_RETENTION_DATABASE_URL_FILE=/var/lib/all-mail-database/retention-url \\\n  -v "${volumes[0]}:/var/lib/all-mail-state"''',
)
replace_once(
    "scripts/compose-up.sh",
    '''  -v "${volumes[4]}:/var/lib/all-mail-redis" \\\n  app init''',
    '''  -v "${volumes[4]}:/var/lib/all-mail-redis" \\\n  -v "${volumes[5]}:/var/lib/all-mail-database" \\\n  app init''',
)

# Operator environment defaults are least privilege. The owner credential is
# no longer consumed by long-running services.
replace_once(
    ".env.example",
    '''GOOGLE_OAUTH_SCOPES=openid email profile https://www.googleapis.com/auth/gmail.modify https://mail.google.com/''',
    '''GOOGLE_OAUTH_SCOPES=openid email profile https://www.googleapis.com/auth/gmail.readonly''',
)
replace_once(
    ".env.example",
    '''MICROSOFT_OAUTH_SCOPES=offline_access openid profile email https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Contacts.ReadWrite https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/MailboxSettings.ReadWrite''',
    '''MICROSOFT_OAUTH_SCOPES=offline_access openid profile email https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Read''',
)
replace_once(
    ".env.example",
    '''POSTGRES_DB=allmail\n\n# Comma-separated CIDRs''',
    '''POSTGRES_DB=allmail\n# The owner identity above is used only by PostgreSQL and the one-shot initializer.\n# Long-running services receive generated role-specific database URL files.\n\n# Comma-separated CIDRs''',
)
replace_once(
    "config/runtime-env.json",
    '''{ "name": "POSTGRES_USER", "scope": ["compose", "init", "go-business-api", "workers"], "secret": false },\n    { "name": "POSTGRES_PASSWORD", "scope": ["compose", "init", "go-business-api", "workers"], "secret": true },\n    { "name": "POSTGRES_DB", "scope": ["compose", "init", "go-business-api", "workers"], "secret": false }''',
    '''{ "name": "POSTGRES_USER", "scope": ["compose", "init"], "secret": false },\n    { "name": "POSTGRES_PASSWORD", "scope": ["compose", "init"], "secret": true },\n    { "name": "POSTGRES_DB", "scope": ["compose", "init"], "secret": false }''',
)

# Existing runtime contract tests now assert file-backed identities rather than
# owner credentials in service environments.
replace_once(
    "scripts/env-contract.test.mjs",
    '''  assert.match(business, /DATABASE_URL:[\\s\\S]*REDIS_URL: redis:\\/\\/redis:6379/);''',
    '''  assert.match(business, /DATABASE_URL_FILE: \\/var\\/lib\\/all-mail-database\\/api-url[\\s\\S]*REDIS_URL: redis:\\/\\/redis:6379/);\n  assert.doesNotMatch(business, /\\n\\s+DATABASE_URL:/);''',
)
replace_once(
    "scripts/env-contract.test.mjs",
    '''  assert.match(script, /ALL_MAIL_EXPORT_JWT_SECRET_FILE/);''',
    '''  assert.match(script, /ALL_MAIL_EXPORT_JWT_SECRET_FILE/);\n  assert.match(script, /ALL_MAIL_EXPORT_API_DATABASE_URL_FILE/);\n  assert.match(script, /ALL_MAIL_EXPORT_FORWARDING_DATABASE_URL_FILE/);\n  assert.match(script, /ALL_MAIL_EXPORT_RETENTION_DATABASE_URL_FILE/);''',
)

replace_once(
    "scripts/security-boundary.test.mjs",
    '''  assert.match(business, /redis_runtime_data:\\/var\\/lib\\/all-mail-redis:ro/);''',
    '''  assert.match(business, /redis_runtime_data:\\/var\\/lib\\/all-mail-redis:ro/);\n  assert.match(business, /database_runtime_data:\\/var\\/lib\\/all-mail-database:ro/);\n  assert.match(business, /DATABASE_URL_FILE: \\/var\\/lib\\/all-mail-database\\/api-url/);\n  assert.doesNotMatch(business, /\\n\\s+DATABASE_URL:/);''',
)
replace_once(
    "scripts/security-boundary.test.mjs",
    '''  assert.match(initializer, /redis_runtime_data/);''',
    '''  assert.match(initializer, /redis_runtime_data/);\n  assert.match(initializer, /database_runtime_data/);\n  assert.match(initializer, /ALL_MAIL_EXPORT_API_DATABASE_URL_FILE/);''',
)

# Compose-security workflow assertions.
replace_once(
    ".github/workflows/config-security.yml",
    '''          forwarding_env = services['worker-forwarding'].get('environment', {})\n          assert forwarding_env.get('ENCRYPTION_KEY_FILE') == '/var/lib/all-mail-secrets/encryption-key'\n          assert 'ENCRYPTION_KEY' not in forwarding_env''',
    '''          forwarding_env = services['worker-forwarding'].get('environment', {})\n          assert forwarding_env.get('ENCRYPTION_KEY_FILE') == '/var/lib/all-mail-secrets/encryption-key'\n          assert forwarding_env.get('DATABASE_URL_FILE') == '/var/lib/all-mail-database/forwarding-url'\n          assert 'DATABASE_URL' not in forwarding_env\n          assert 'ENCRYPTION_KEY' not in forwarding_env''',
)
replace_once(
    ".github/workflows/config-security.yml",
    '''          assert go_business_env.get('NODE_ENV') == 'production'\n          assert go_business_env.get('ENCRYPTION_KEY_FILE') == '/var/lib/all-mail-encryption/encryption-key'\n''',
    '''          assert go_business_env.get('NODE_ENV') == 'production'\n          assert go_business_env.get('DATABASE_URL_FILE') == '/var/lib/all-mail-database/api-url'\n          assert 'DATABASE_URL' not in go_business_env\n          assert go_business_env.get('ENCRYPTION_KEY_FILE') == '/var/lib/all-mail-encryption/encryption-key'\n''',
)
replace_once(
    ".github/workflows/config-security.yml",
    '''          assert services['worker-retention'].get('volumes') in (None, []), 'retention heartbeat must stay ephemeral'\n''',
    '''          retention_env = services['worker-retention'].get('environment', {})\n          assert retention_env.get('DATABASE_URL_FILE') == '/var/lib/all-mail-database/retention-url'\n          assert 'DATABASE_URL' not in retention_env\n''',
)

# Live boundary smoke now verifies generated files and table-level role grants.
replace_once(
    "scripts/security-boundary-docker-smoke.sh",
    '''  test -r /var/lib/all-mail-redis/redis-password\n  test ! -e /var/lib/all-mail-state''',
    '''  test -r /var/lib/all-mail-redis/redis-password\n  test -r /var/lib/all-mail-database/api-url\n  test "${DATABASE_URL_FILE:-}" = "/var/lib/all-mail-database/api-url"\n  test -z "${DATABASE_URL:-}"\n  test ! -e /var/lib/all-mail-state''',
)
replace_once(
    "scripts/security-boundary-docker-smoke.sh",
    '''for target in (\n    "/var/lib/all-mail-secrets",\n    "/var/lib/all-mail-encryption",\n    "/var/lib/all-mail-redis",\n):''',
    '''for target in (\n    "/var/lib/all-mail-secrets",\n    "/var/lib/all-mail-encryption",\n    "/var/lib/all-mail-redis",\n    "/var/lib/all-mail-database",\n):''',
)
role_checks = r'''

# Database identities are login-only, non-owner roles with narrowly bounded grants.
"${compose[@]}" exec -T postgres psql -U "${POSTGRES_USER:-allmail}" -d "${POSTGRES_DB:-allmail}" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['allmail_api', 'allmail_forwarding', 'allmail_retention'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_roles
      WHERE rolname = role_name AND rolcanlogin AND NOT rolsuper AND NOT rolcreatedb
        AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls
    ) THEN
      RAISE EXCEPTION 'unsafe or missing runtime role: %', role_name;
    END IF;
  END LOOP;
END $$;

SELECT 1 / CASE WHEN has_table_privilege('allmail_api', 'admins', 'SELECT,INSERT,UPDATE,DELETE') THEN 1 ELSE 0 END;
SELECT 1 / CASE WHEN NOT has_schema_privilege('allmail_api', 'public', 'CREATE') THEN 1 ELSE 0 END;
SELECT 1 / CASE WHEN has_table_privilege('allmail_forwarding', 'mailbox_forward_jobs', 'SELECT,UPDATE') THEN 1 ELSE 0 END;
SELECT 1 / CASE WHEN has_table_privilege('allmail_forwarding', 'inbound_messages', 'SELECT,UPDATE') THEN 1 ELSE 0 END;
SELECT 1 / CASE WHEN NOT has_table_privilege('allmail_forwarding', 'admins', 'SELECT') THEN 1 ELSE 0 END;
SELECT 1 / CASE WHEN has_table_privilege('allmail_retention', 'api_logs', 'SELECT,DELETE') THEN 1 ELSE 0 END;
SELECT 1 / CASE WHEN NOT has_table_privilege('allmail_retention', 'admins', 'SELECT') THEN 1 ELSE 0 END;
SQL
'''
content = read("scripts/security-boundary-docker-smoke.sh")
if "unsafe or missing runtime role" in content:
    raise RuntimeError("database role smoke already present")
write("scripts/security-boundary-docker-smoke.sh", content + role_checks)

replace_once(
    "scripts/bootstrap-admin-docker-smoke.sh",
    '''  test -r /var/lib/all-mail-redis/redis-password\n  test "${JWT_SECRET_FILE:-}" = "/var/lib/all-mail-secrets/jwt-secret"''',
    '''  test -r /var/lib/all-mail-redis/redis-password\n  test -r /var/lib/all-mail-database/api-url\n  test "${DATABASE_URL_FILE:-}" = "/var/lib/all-mail-database/api-url"\n  test -z "${DATABASE_URL:-}"\n  test "${JWT_SECRET_FILE:-}" = "/var/lib/all-mail-secrets/jwt-secret"''',
)

# Keep broad generated checks in CI aligned with file-backed credentials.
ci = read(".github/workflows/ci.yml")
ci = ci.replace(
    '''          docker compose exec -T go-business-api sh -lc '\n            test -r /var/lib/all-mail/runtime-secrets.env\n            test ! -e /var/lib/all-mail/bootstrap-secrets.env\n          '\n''',
    '''          docker compose exec -T go-business-api sh -lc '\n            test -r /var/lib/all-mail/runtime-secrets.env\n            test -r /var/lib/all-mail-database/api-url\n            test "${DATABASE_URL_FILE:-}" = "/var/lib/all-mail-database/api-url"\n            test -z "${DATABASE_URL:-}"\n            test ! -e /var/lib/all-mail/bootstrap-secrets.env\n          '\n''',
)
write(".github/workflows/ci.yml", ci)

# A focused source contract catches future regressions in both halves of this PR.
write(
    "scripts/auth-oauth-config-security.test.mjs",
    r'''import assert from 'node:assert/strict';
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
''',
)

# Remove the superseded Python OAuth helper. Browser upload + the Go API are the
# sole supported configuration path after this PR.
helper_root = ROOT / "oauth-temp"
if helper_root.exists():
    for child in sorted(helper_root.rglob("*"), reverse=True):
        if child.is_file() or child.is_symlink():
            child.unlink()
        elif child.is_dir():
            child.rmdir()
    helper_root.rmdir()

# Documentation: concise authoritative additions and replacements.
replace_once(
    "docs/ENVIRONMENT.md",
    '''| `POSTGRES_USER` | `allmail` | Compose, initializer, workers, private API | Internal database identity |\n| `POSTGRES_PASSWORD` | required | Compose, initializer, workers, private API | At least 24 URL-safe characters; no fallback |\n| `POSTGRES_DB` | `allmail` | Compose, initializer, workers, private API | Database name |\n| `DATABASE_URL` | Compose-derived | Temporary initializer, private API, workers | Never supplied to `app` |''',
    '''| `POSTGRES_USER` | `allmail` | Compose, initializer | Schema owner and migration identity; never injected into a long-running application process |\n| `POSTGRES_PASSWORD` | required | Compose, initializer | At least 24 URL-safe characters; no fallback |\n| `POSTGRES_DB` | `allmail` | Compose, initializer | Database name |\n| `DATABASE_URL` | initializer-derived | Temporary initializer only | Owner connection used for schema and role reconciliation |\n| `DATABASE_URL_FILE` | fixed role-specific paths | Private API and workers | Generated `allmail_api`, `allmail_forwarding`, or `allmail_retention` connection |''',
)
replace_once(
    "docs/ENVIRONMENT.md",
    '''| `DATABASE_URL` | Compose-derived | Business data access |''',
    '''| `DATABASE_URL_FILE` | `/var/lib/all-mail-database/api-url` | Least-privilege `allmail_api` business-data access |''',
)
content = read("docs/ENVIRONMENT.md")
anchor = "## One-time administrator bootstrap"
addition = '''## Runtime database identities\n\nThe initializer owns schema changes and reconciles three non-owner login roles after every migration:\n\n- `allmail_api`: CRUD on application tables and sequence use, without schema creation;\n- `allmail_forwarding`: only the forwarding queue, inbound message state, mailbox/domain reads, and sending configuration reads;\n- `allmail_retention`: only read/delete access to `api_logs`.\n\nTheir random passwords remain in initializer-only master state. Complete URLs are exported to `database_runtime_data` as `api-url`, `forwarding-url`, and `retention-url`, then mounted read-only. Long-running services receive `DATABASE_URL_FILE`, never `POSTGRES_PASSWORD` or the owner URL.\n\n'''
if anchor not in content or "## Runtime database identities" in content:
    raise RuntimeError("unable to add runtime database documentation")
write("docs/ENVIRONMENT.md", content.replace(anchor, addition + anchor, 1))

for path in ["README.md", "docs/DEPLOY.md", "docs/RUNBOOK.md", "docs/open-source-release-checklist.md"]:
    content = read(path)
    content = content.replace(
        "runtime_secrets_data`, `forwarding_runtime_data`, and `go_business_runtime_data",
        "runtime_secrets_data`, `forwarding_runtime_data`, `go_business_runtime_data`, and `database_runtime_data`",
    )
    content = content.replace(
        "runtime_secrets_data;\n- `forwarding_runtime_data`;\n- `go_business_runtime_data`.",
        "runtime_secrets_data;\n- `forwarding_runtime_data`;\n- `go_business_runtime_data`;\n- `database_runtime_data`.",
    )
    write(path, content)

content = read("docs/DEPLOY.md")
content = content.replace(
    "resolve `runtime_secrets_data`, `bootstrap_admin_data`, `forwarding_runtime_data`, `go_business_runtime_data`, and `redis_runtime_data`;",
    "resolve `runtime_secrets_data`, `bootstrap_admin_data`, `forwarding_runtime_data`, `go_business_runtime_data`, `redis_runtime_data`, and `database_runtime_data`;",
)
if "## Database least privilege" not in content:
    content += '''\n## Database least privilege\n\n`POSTGRES_USER` is an initializer-only owner. Startup idempotently provisions `allmail_api`, `allmail_forwarding`, and `allmail_retention`, writes role-specific URLs to `database_runtime_data`, and mounts only the matching read-only file into each long-running process. Verify with `bash scripts/security-boundary-docker-smoke.sh`; it checks role attributes and representative allow/deny table privileges.\n'''
write("docs/DEPLOY.md", content)

content = read("docs/RUNBOOK.md")
if "### Runtime database role failure" not in content:
    marker = "## Public gateway unhealthy"
    section = '''### Runtime database role failure\n\nThe owner credential is available only to PostgreSQL and the temporary initializer. Check that `database_runtime_data` contains `api-url`, `forwarding-url`, and `retention-url` without printing them. If a role or grant drifted, rerun `./scripts/compose-up.sh`; provisioning revokes stale grants before applying the canonical table-level policy. Do not copy `POSTGRES_PASSWORD` into a long-running service.\n\n'''
    if marker not in content:
        raise RuntimeError("RUNBOOK insertion marker missing")
    content = content.replace(marker, section + marker, 1)
write("docs/RUNBOOK.md", content)

content = read("docs/SECURITY-BOUNDARIES.md")
if "## Database identities" not in content:
    content += '''\n## Database identities\n\nThe PostgreSQL owner is initializer-only. `go-business-api`, forwarding, and retention use independent generated login roles through read-only URL files. The initializer revokes stale runtime grants and reapplies the canonical CRUD, forwarding-table, or retention-table policy after schema migration.\n\n## Browser request integrity\n\nUnsafe browser requests are rejected when `Origin` does not match the gateway-normalized scheme and host or when `Sec-Fetch-Site` reports `cross-site`. The gateway also emits `X-Frame-Options: DENY` and CSP `frame-ancestors 'none'`. Non-browser API clients without browser origin headers remain supported.\n\n## OAuth configuration\n\nGoogle client-secret documents are accepted only as uploaded/pasted JSON; the API cannot read administrator-selected server paths. OAuth scopes are canonical `minimal`, `send`, `manage`, or `full` profiles. Fresh configuration defaults to `minimal`; wider profiles require an explicit saved choice.\n'''
write("docs/SECURITY-BOUNDARIES.md", content)

content = read("docs/external-email-management-guide.md")
content = content.replace(
    "https://graph.microsoft.com/Contacts.ReadWrite https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/MailboxSettings.ReadWrite",
    "",
)
if "OAuth permission profiles" not in content:
    content += '''\n## OAuth permission profiles\n\nThe management API accepts four canonical profiles: `minimal` (identity + read), `send` (read + send), `manage` (mail modification + send), and `full` (provider-wide or optional extension permissions). New Gmail and Microsoft configurations default to `minimal`. Pasted Google client-secret JSON is parsed in memory; server filesystem paths are intentionally unsupported.\n'''
write("docs/external-email-management-guide.md", content)

content = read("CHANGELOG.md")
marker = "## [Unreleased]\n"
entry = '''\n- isolated PostgreSQL owner access to the one-shot initializer and provisioned independent table-scoped API, forwarding, and retention roles through read-only database URL files\n- added same-origin browser write enforcement, clickjacking headers, and a shared 72-byte bcrypt input policy for administrator and mailbox credentials\n- replaced arbitrary server-path Google OAuth parsing with JSON-only import and introduced canonical minimal, send, manage, and full permission profiles with least-privilege defaults\n- removed the superseded `oauth-temp` Python helper and made the Go management API plus browser upload the only supported OAuth configuration path\n'''
if entry.strip() not in content:
    content = content.replace(marker, marker + entry, 1)
write("CHANGELOG.md", content)

print("PR42-43 runtime and documentation implementation applied")
