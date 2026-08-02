#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[1]


def read(relative: str) -> str:
    return (root / relative).read_text(encoding="utf-8")


def write(relative: str, content: str) -> None:
    (root / relative).write_text(content, encoding="utf-8")


def replace_once(content: str, old: str, new: str, label: str) -> str:
    count = content.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one occurrence, found {count}")
    return content.replace(old, new, 1)


# PR41 added Redis to the initializer-generated state. The combined change adds
# three database-role passwords, so the fresh and upgrade expectations move
# from 3 -> 6 and 1 -> 4 respectively.
core_path = Path(__file__).with_name("apply-pr42-43-core.py")
content = core_path.read_text(encoding="utf-8")
content = content.replace(
    "'''len(first.CreatedKeys) != 2''',\n    '''len(first.CreatedKeys) != 5'''",
    "'''len(first.CreatedKeys) != 3''',\n    '''len(first.CreatedKeys) != 6'''",
)
marker = '''replace_once(\n    "core/internal/secretstate/secretstate_test.go",\n    ''' + "'''len(first.CreatedKeys) != 3'''" + ''',\n    ''' + "'''len(first.CreatedKeys) != 6'''" + ''',\n)\n'''
addition = marker + '''replace_once(\n    "core/internal/secretstate/secretstate_test.go",\n    ''' + "'''len(state.RedisPassword) != 64 || len(state.CreatedKeys) != 1 || state.CreatedKeys[0] != \"REDIS_PASSWORD\"'''" + ''',\n    ''' + "'''len(state.RedisPassword) != 64 || len(state.CreatedKeys) != 4 || state.CreatedKeys[0] != \"REDIS_PASSWORD\"'''" + ''',\n)\n'''
if marker not in content:
    raise SystemExit("updated secret test marker missing")
core_path.write_text(content.replace(marker, addition, 1), encoding="utf-8")

# PR41's bootstrap smoke does not repeat the Redis file assertion in the second
# secret block. Add the database file checks directly.
smoke_path = root / "scripts/bootstrap-admin-docker-smoke.sh"
smoke = smoke_path.read_text(encoding="utf-8")
needle = '  test -r /var/lib/all-mail-encryption/encryption-key\n  test "${JWT_SECRET_FILE:-}" = "/var/lib/all-mail-secrets/jwt-secret"'
replacement = '  test -r /var/lib/all-mail-encryption/encryption-key\n  test -r /var/lib/all-mail-database/api-url\n  test "${DATABASE_URL_FILE:-}" = "/var/lib/all-mail-database/api-url"\n  test -z "${DATABASE_URL:-}"\n  test "${JWT_SECRET_FILE:-}" = "/var/lib/all-mail-secrets/jwt-secret"'
if smoke.count(needle) != 1:
    raise SystemExit("bootstrap smoke insertion point missing")
smoke_path.write_text(smoke.replace(needle, replacement, 1), encoding="utf-8")

runtime_path = Path(__file__).with_name("apply-pr42-43-runtime.py")
runtime = runtime_path.read_text(encoding="utf-8")

# Remove the old bootstrap-smoke replacement because the current file was
# already updated above using its PR41 layout.
start_marker = 'replace_once(\n    "scripts/bootstrap-admin-docker-smoke.sh",'
end_marker = '\n\n# Keep broad generated checks in CI aligned with file-backed credentials.'
start = runtime.find(start_marker)
end = runtime.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit("bootstrap smoke generator block missing")
runtime = runtime[:start] + runtime[end:]

# PR41 replaced the former table-heavy ENVIRONMENT document with a concise
# ownership document. Remove the obsolete exact-match documentation phase and
# apply current-structure edits directly below.
docs_start = runtime.find("# Documentation: concise authoritative additions and replacements.")
print_marker = 'print("PR42-43 runtime and documentation implementation applied")'
docs_end = runtime.find(print_marker, docs_start)
if docs_start < 0 or docs_end < 0:
    raise SystemExit("runtime documentation generator section missing")
runtime = runtime[:docs_start] + 'print("PR42-43 runtime implementation applied")\n' + runtime[docs_end + len(print_marker):]
runtime_path.write_text(runtime, encoding="utf-8")

# Current environment and secret ownership contract.
environment = read("docs/ENVIRONMENT.md")
environment = replace_once(
    environment,
    "DATABASE_URL=postgresql://...\nREDIS_URL=redis://redis:6379",
    "DATABASE_URL_FILE=/var/lib/all-mail-database/api-url\nREDIS_URL=redis://redis:6379",
    "private API database contract",
)
environment = replace_once(
    environment,
    "The loader injects the file-backed Redis password into the in-memory client URL. Production refuses to start without `REDIS_PASSWORD_FILE`.",
    "The loader reads the generated `allmail_api` URL from `DATABASE_URL_FILE` and injects the file-backed Redis password into the in-memory client URL. Production refuses to start without either file.",
    "private API loader description",
)
environment = replace_once(
    environment,
    "Receives PostgreSQL, provider egress, forwarding policy, and:\n\n```text\nENCRYPTION_KEY_FILE=/var/lib/all-mail-secrets/encryption-key",
    "Receives provider egress, forwarding policy, and read-only files for:\n\n```text\nDATABASE_URL_FILE=/var/lib/all-mail-database/forwarding-url\nENCRYPTION_KEY_FILE=/var/lib/all-mail-secrets/encryption-key",
    "forwarding ownership",
)
environment = replace_once(
    environment,
    "Receives PostgreSQL and retention policy only. It receives no application secret volume.",
    "Receives retention policy and `DATABASE_URL_FILE=/var/lib/all-mail-database/retention-url`. It receives no JWT, encryption, Redis, provider, or database-owner credential.",
    "retention ownership",
)
environment = replace_once(
    environment,
    "- export least-privilege secret files.",
    "- provision and reconcile least-privilege PostgreSQL login roles;\n- export least-privilege secret and database URL files.",
    "initializer responsibilities",
)
environment = replace_once(
    environment,
    "  REDIS_PASSWORD\n```",
    "  REDIS_PASSWORD\n  DATABASE_API_PASSWORD\n  DATABASE_FORWARDING_PASSWORD\n  DATABASE_RETENTION_PASSWORD\n```",
    "master secret list",
)
role_section = '''## Runtime database identities\n\n`POSTGRES_USER` and `POSTGRES_PASSWORD` are schema-owner inputs used only by PostgreSQL and the temporary initializer. After schema migration the initializer idempotently reconciles three non-owner login roles:\n\n- `allmail_api`: application-table CRUD and sequence use, without schema creation;\n- `allmail_forwarding`: forwarding queue and inbound-message state plus the mailbox/domain configuration reads required for delivery;\n- `allmail_retention`: read/delete access to `api_logs` only.\n\nStale runtime grants are revoked before the canonical policy is reapplied. Long-running services receive a read-only `DATABASE_URL_FILE`; they never receive the owner URL or `POSTGRES_PASSWORD`.\n\n'''
if "## Runtime database identities" not in environment:
    environment = replace_once(environment, "## Durable secret volumes\n", role_section + "## Durable secret volumes\n", "database role section")
database_volume = '''### `database_runtime_data`\n\n```text\napi-url\nforwarding-url\nretention-url\n```\n\nEach file contains the matching generated role URL and is mounted read-only only into its intended long-running service.\n\n'''
if "### `database_runtime_data`" not in environment:
    environment = replace_once(environment, "## Network ownership\n", database_volume + "## Network ownership\n", "database URL volume")
write("docs/ENVIRONMENT.md", environment)

# Keep backup/restore inventories aligned. These substitutions are deliberately
# tolerant because the documents use both prose and bullet-list forms.
for relative in [
    "README.md",
    "docs/DEPLOY.md",
    "docs/RUNBOOK.md",
    "docs/open-source-release-checklist.md",
    "docs/UPGRADE-RUNTIME-NAMES.md",
]:
    document = read(relative)
    document = document.replace(
        "runtime_secrets_data`, `forwarding_runtime_data`, and `go_business_runtime_data",
        "runtime_secrets_data`, `forwarding_runtime_data`, `go_business_runtime_data`, and `database_runtime_data`",
    )
    document = document.replace(
        "`runtime_secrets_data`, `bootstrap_admin_data`, `forwarding_runtime_data`, `go_business_runtime_data`, and `redis_runtime_data`",
        "`runtime_secrets_data`, `bootstrap_admin_data`, `forwarding_runtime_data`, `go_business_runtime_data`, `redis_runtime_data`, and `database_runtime_data`",
    )
    document = document.replace(
        "runtime_secrets_data\nforwarding_runtime_data\ngo_business_runtime_data",
        "runtime_secrets_data\nforwarding_runtime_data\ngo_business_runtime_data\ndatabase_runtime_data",
    )
    document = document.replace(
        "- `go_business_runtime_data`.",
        "- `go_business_runtime_data`;\n- `database_runtime_data`.",
    )
    write(relative, document)

# Authoritative operator and security additions.
deploy = read("docs/DEPLOY.md")
if "## Database least privilege" not in deploy:
    deploy += '''\n## Database least privilege\n\n`POSTGRES_USER` is an initializer-only owner. Startup provisions `allmail_api`, `allmail_forwarding`, and `allmail_retention`, writes role-specific URLs to `database_runtime_data`, and mounts only the matching read-only file into each long-running process. `bash scripts/security-boundary-docker-smoke.sh` verifies role attributes and representative allow/deny table privileges.\n'''
write("docs/DEPLOY.md", deploy)

runbook = read("docs/RUNBOOK.md")
if "## Runtime database role recovery" not in runbook:
    runbook += '''\n## Runtime database role recovery\n\nThe owner credential is available only to PostgreSQL and the temporary initializer. Confirm that `database_runtime_data` contains `api-url`, `forwarding-url`, and `retention-url` without printing their contents. If a role or grant drifted, rerun `./scripts/compose-up.sh`; provisioning revokes stale grants before applying the canonical table-level policy. Never copy `POSTGRES_PASSWORD` into a long-running service.\n'''
write("docs/RUNBOOK.md", runbook)

boundaries = read("docs/SECURITY-BOUNDARIES.md")
if "## Database identities" not in boundaries:
    boundaries += '''\n## Database identities\n\nThe PostgreSQL owner is initializer-only. `go-business-api`, forwarding, and retention use independent generated login roles through read-only URL files. The initializer revokes stale runtime grants and reapplies the canonical CRUD, forwarding-table, or retention-table policy after schema migration.\n\n## Browser request integrity\n\nUnsafe browser requests are rejected when `Origin` does not match the gateway-normalized scheme and host or when `Sec-Fetch-Site` reports `cross-site`. The gateway emits `X-Frame-Options: DENY` and CSP `frame-ancestors 'none'`. Non-browser API clients without browser origin headers remain supported.\n\n## OAuth configuration\n\nGoogle client-secret documents are accepted only as uploaded or pasted JSON; the API cannot read administrator-selected server paths. OAuth scopes are canonical `minimal`, `send`, `manage`, or `full` profiles. Fresh configuration defaults to `minimal`; wider profiles require an explicit saved choice.\n'''
write("docs/SECURITY-BOUNDARIES.md", boundaries)

guide = read("docs/external-email-management-guide.md")
guide = guide.replace(
    " https://graph.microsoft.com/Contacts.ReadWrite https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/MailboxSettings.ReadWrite",
    "",
)
if "## OAuth permission profiles" not in guide:
    guide += '''\n## OAuth permission profiles\n\nThe management API accepts four canonical profiles: `minimal` (identity plus read), `send` (read plus send), `manage` (mail modification plus send), and `full` (provider-wide or optional extension permissions). New Gmail and Microsoft configurations default to `minimal`. Pasted Google client-secret JSON is parsed in memory; server filesystem paths are intentionally unsupported.\n'''
write("docs/external-email-management-guide.md", guide)

config_readme = read("config/README.md")
if "DATABASE_URL_FILE" not in config_readme:
    config_readme += '''\nRuntime database ownership is file-backed: the initializer exports independent API, forwarding, and retention URLs to `database_runtime_data`. The owner `POSTGRES_PASSWORD` remains an initializer-only operator input.\n'''
write("config/README.md", config_readme)

changelog = read("CHANGELOG.md")
entry = '''\n- isolated PostgreSQL owner access to the one-shot initializer and provisioned independent table-scoped API, forwarding, and retention roles through read-only database URL files\n- added same-origin browser write enforcement, clickjacking headers, and a shared 72-byte bcrypt input policy for administrator and mailbox credentials\n- replaced arbitrary server-path Google OAuth parsing with JSON-only import and introduced canonical minimal, send, manage, and full permission profiles with least-privilege defaults\n- removed the superseded `oauth-temp` Python helper and made the Go management API plus browser upload the only supported OAuth configuration path\n'''
if "isolated PostgreSQL owner access" not in changelog:
    changelog = replace_once(changelog, "## [Unreleased]\n", "## [Unreleased]\n" + entry, "changelog")
write("CHANGELOG.md", changelog)
