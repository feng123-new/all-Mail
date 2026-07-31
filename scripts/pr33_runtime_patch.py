#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    content = target.read_text(encoding='utf-8')
    if new in content:
        return
    if old not in content:
        raise SystemExit(f'missing expected fragment in {path}: {old[:180]!r}')
    target.write_text(content.replace(old, new, 1), encoding='utf-8')


def insert_after(path: str, marker: str, addition: str) -> None:
    target = ROOT / path
    content = target.read_text(encoding='utf-8')
    if addition in content:
        return
    if marker not in content:
        raise SystemExit(f'missing insertion marker in {path}: {marker[:180]!r}')
    target.write_text(content.replace(marker, marker + addition, 1), encoding='utf-8')


replace_once(
    'core/internal/config/config.go',
    'return "", errors.New("ENCRYPTION_KEY_FILE is required for forwarding")',
    'return "", errors.New("ENCRYPTION_KEY_FILE is required")',
)

replace_once(
    'docker-compose.yml',
    '''      JWT_SECRET_FILE: /var/lib/all-mail-secrets/jwt-secret
      GO_BUSINESS_QUERY_TIMEOUT_SECONDS: 10
      READY_TIMEOUT_SECONDS: ${READY_TIMEOUT_SECONDS:-5}
      SHUTDOWN_TIMEOUT_SECONDS: ${SHUTDOWN_TIMEOUT_SECONDS:-15}''',
    '''      JWT_SECRET_FILE: /var/lib/all-mail-secrets/jwt-secret
      ENCRYPTION_KEY_FILE: /var/lib/all-mail-encryption/encryption-key
      INGRESS_ALLOWED_SKEW_SECONDS: ${INGRESS_ALLOWED_SKEW_SECONDS:-300}
      GO_BUSINESS_QUERY_TIMEOUT_SECONDS: 10
      READY_TIMEOUT_SECONDS: ${READY_TIMEOUT_SECONDS:-5}
      SHUTDOWN_TIMEOUT_SECONDS: ${SHUTDOWN_TIMEOUT_SECONDS:-15}''',
)
replace_once(
    'docker-compose.yml',
    '''    volumes:
      - go_business_runtime_data:/var/lib/all-mail-secrets:ro
    networks:
      - app-network
    healthcheck:
      test: ["CMD", "allmail", "doctor", "business-api"]''',
    '''    volumes:
      - go_business_runtime_data:/var/lib/all-mail-secrets:ro
      - forwarding_runtime_data:/var/lib/all-mail-encryption:ro
    networks:
      - app-network
    healthcheck:
      test: ["CMD", "allmail", "doctor", "business-api"]''',
)

replace_once(
    'scripts/env-contract.test.mjs',
    '''\tassert.match(goBusiness, /JWT_SECRET_FILE: \\/var\\/lib\\/all-mail-secrets\\/jwt-secret/);
\tassert.match(goBusiness, /REDIS_URL: redis:\\/\\/redis:6379/);
\tassert.doesNotMatch(goBusiness, /ENCRYPTION_KEY|INGRESS_SIGNING_SECRET|ports:/);''',
    '''\tassert.match(goBusiness, /JWT_SECRET_FILE: \\/var\\/lib\\/all-mail-secrets\\/jwt-secret/);
\tassert.match(goBusiness, /ENCRYPTION_KEY_FILE: \\/var\\/lib\\/all-mail-encryption\\/encryption-key/);
\tassert.match(goBusiness, /forwarding_runtime_data:\\/var\\/lib\\/all-mail-encryption:ro/);
\tassert.match(goBusiness, /INGRESS_ALLOWED_SKEW_SECONDS:/);
\tassert.match(goBusiness, /REDIS_URL: redis:\\/\\/redis:6379/);
\tassert.doesNotMatch(goBusiness, /\\n\\s+ENCRYPTION_KEY:|INGRESS_SIGNING_SECRET|ports:/);''',
)

insert_after(
    'scripts/bootstrap-admin-docker-smoke.sh',
    """  test -r /var/lib/all-mail-secrets/jwt-secret
""",
    """  test -r /var/lib/all-mail-encryption/encryption-key
  test "${JWT_SECRET_FILE:-}" = "/var/lib/all-mail-secrets/jwt-secret"
  test "${ENCRYPTION_KEY_FILE:-}" = "/var/lib/all-mail-encryption/encryption-key"
""",
)
insert_after(
    'scripts/bootstrap-admin-docker-smoke.sh',
    '''grep -qi '^X-All-Mail-Route-Owner: go-business-api' "$write_headers"
''',
    '''
ingress_headers="$RUNNER_TEMP/ingress-headers.txt"
ingress_body="$RUNNER_TEMP/ingress-body.json"
ingress_status=$(curl --silent --show-error \\
  -D "$ingress_headers" -o "$ingress_body" -w '%{http_code}' \\
  -H 'Content-Type: application/json' --data '{}' \\
  http://127.0.0.1:3002/ingress/domain-mail/receive)
test "$ingress_status" = "401"
grep -qi '^X-All-Mail-Route-Owner: go-business-api' "$ingress_headers"
grep -q 'INGRESS_SIGNATURE_REQUIRED' "$ingress_body"
''',
)

insert_after(
    '.github/workflows/config-security.yml',
    "          assert 'ENCRYPTION_KEY' not in forwarding_env\n",
    """

          go_business_env = services['go-business-api'].get('environment', {})
          assert go_business_env.get('ENCRYPTION_KEY_FILE') == '/var/lib/all-mail-encryption/encryption-key'
          assert go_business_env.get('INGRESS_ALLOWED_SKEW_SECONDS') == '300'
          assert 'ENCRYPTION_KEY' not in go_business_env
""",
)

replace_once(
    'docs/GO-MIGRATION.md',
    'Migration is complete for public HTTP ownership, SPA delivery, route governance, forwarding, API-log retention, Dashboard reads and log-deletion writes, API-key administration/security, and the database-only external mailbox/domain-mail slice.',
    'Migration is complete for public HTTP ownership, SPA delivery, route governance, forwarding, API-log retention, Dashboard reads and log-deletion writes, API-key administration/security, signed domain-mail ingress, and the database-only external mailbox/domain-mail slice.',
)
replace_once(
    'docs/GO-MIGRATION.md',
    '- database-backed external mailbox/domain-mail allocation, listing, statistics, reset, and persisted message reads;\n- checksummed additive migrations;',
    '- database-backed external mailbox/domain-mail allocation, listing, statistics, reset, and persisted message reads;\n- signed ingress authentication, encrypted endpoint-secret reads, Redis replay protection, mailbox resolution, inbound persistence, and forwarding-job creation;\n- checksummed additive migrations;',
)
replace_once(
    'docs/GO-MIGRATION.md',
    'Fastify/Prisma still owns administrator and mailbox-portal authentication, OAuth, provider-dependent mailbox operations, domain/mailbox/alias/user writes, ingress, sending, JavaScript regex text extraction compatibility, durable business configuration import, initial administrator bootstrap, and complete business-schema migrations.',
    'Fastify/Prisma still owns administrator and mailbox-portal authentication, OAuth, provider-dependent mailbox operations, domain/mailbox/alias/user writes, sending, JavaScript regex text extraction compatibility, durable business configuration import, initial administrator bootstrap, and complete business-schema migrations.',
)
replace_once(
    'docs/GO-MIGRATION.md',
    '''go-business-api:
  JWT_SECRET_FILE=/var/lib/all-mail-secrets/jwt-secret
```''',
    '''go-business-api:
  JWT_SECRET_FILE=/var/lib/all-mail-secrets/jwt-secret
  ENCRYPTION_KEY_FILE=/var/lib/all-mail-encryption/encryption-key
```''',
)
replace_once(
    'docs/GO-MIGRATION.md',
    'The public `app` receives neither file. `go-business-api` receives PostgreSQL, Redis, and the read-only JWT file, but no encryption, ingress, OAuth, or provider credential.',
    'The public `app` receives neither file. `go-business-api` receives PostgreSQL, Redis, the read-only JWT file, and a read-only encryption-key copy used only to decrypt persisted ingress endpoint secrets; it receives no raw ingress secret, OAuth credential, or provider credential.',
)
insert_after(
    'docs/GO-MIGRATION.md',
    '''provider and regex compatibility routes    -> business-api
```''',
    '''

```text
POST /ingress/domain-mail/receive              -> go-business-api
other /ingress compatibility paths             -> business-api
```''',
)
replace_once(
    'docs/GO-MIGRATION.md',
    '''1. ingress validation, encrypted endpoint secrets, replay protection, persistence, forwarding-job creation, raw-message lifecycle, and outbound history;
2. domain, mailbox, alias, user, and administrator writes;
3. provider-dependent reads, synchronization, OAuth configuration, token refresh, and sending;
4. mailbox-portal and administrator authentication;
5. complete business-schema authority and encrypted-data cutover;
6. zero-traffic observation and final Node/Prisma deletion.''',
    '''1. domain, mailbox, alias, user, and administrator writes;
2. provider-dependent reads, synchronization, OAuth configuration, token refresh, sending, and outbound history;
3. mailbox-portal and administrator authentication;
4. complete business-schema authority and encrypted-data cutover;
5. zero-traffic observation and final Node/Prisma deletion.''',
)

replace_once(
    'docs/ENVIRONMENT.md',
    '| `go-business-api` | Yes | Yes | Read-only file | No | No |',
    '| `go-business-api` | Yes | Yes | Read-only file | Read-only file | Database-encrypted ingress endpoint secrets only |',
)
replace_once(
    'docs/ENVIRONMENT.md',
    '''go-business-api:
  JWT_SECRET_FILE=/var/lib/all-mail-secrets/jwt-secret
```''',
    '''go-business-api:
  JWT_SECRET_FILE=/var/lib/all-mail-secrets/jwt-secret
  ENCRYPTION_KEY_FILE=/var/lib/all-mail-encryption/encryption-key
```''',
)
replace_once(
    'docs/ENVIRONMENT.md',
    '| `ENCRYPTION_KEY_FILE` | internal fixed path | forwarding worker only |',
    '| `ENCRYPTION_KEY_FILE` | internal fixed paths | forwarding worker and private `go-business-api` only |',
)
replace_once(
    'docs/ENVIRONMENT.md',
    'The public `app` receives neither secret. The private Go business service receives no encryption key. The forwarding worker receives no JWT secret.',
    'The public `app` receives neither secret. The private Go business service receives a read-only encryption-key copy solely for persisted ingress endpoint secrets. The forwarding worker receives no JWT secret.',
)
replace_once(
    'docs/ENVIRONMENT.md',
    '''| `JWT_SECRET_FILE` | fixed read-only path | Existing administrator JWT verification |
| `GO_BUSINESS_QUERY_TIMEOUT_SECONDS` | `10` | Per-request database bound |''',
    '''| `JWT_SECRET_FILE` | fixed read-only path | Existing administrator JWT verification |
| `ENCRYPTION_KEY_FILE` | fixed read-only path | Decrypt persisted ingress endpoint signing secrets |
| `INGRESS_ALLOWED_SKEW_SECONDS` | `300` | Signed ingress timestamp window, limited to 1–3600 seconds |
| `GO_BUSINESS_QUERY_TIMEOUT_SECONDS` | `10` | Per-request database bound |''',
)

insert_after(
    'docs/internal/runtime-migration-roadmap.md',
    '''### Session-security foundation

Administrator and mailbox JWTs carry issuer, audience, algorithm, and durable session-version state. Password, role, status, mandatory-rotation, and 2FA changes increment the stored version and revoke older tokens. Browser cookies rotate after security changes.
''',
    '''
### Signed ingress and raw-message lifecycle

`POST /ingress/domain-mail/receive` is owned by `go-business-api`. The Go handler verifies the existing HMAC canonical form, enforces a bounded timestamp window, decrypts the endpoint-scoped persisted signing secret, reserves delivery keys atomically in Redis, resolves exact mailboxes, aliases, and catch-all targets, and commits inbound messages, forwarding jobs, and endpoint usage in one PostgreSQL transaction. Database delivery keys remain the durable idempotency authority.

The Cloudflare Email Worker now stores raw messages under deterministic SHA-256 object keys without domain, mailbox, sender, or recipient data in the path or R2 metadata. Permanent application-level rejection schedules compensating deletion with `ctx.waitUntil`; replay and retryable failures retain the deterministic object for idempotent retry. Logs contain only bounded request/error codes and truncated delivery hashes.
''',
)
replace_once(
    'docs/internal/runtime-migration-roadmap.md',
    '''1. Move ingress signature validation, encrypted endpoint secrets, replay protection, persistence, forwarding-job creation, raw-message lifecycle, and outbound history.
2. Move domain, mailbox, alias, mailbox-user, and administrator write operations that do not require provider access.
3. Move provider-dependent reads, synchronization, OAuth configuration, token refresh, and sending operations.
4. Move mailbox-portal and administrator authentication, including login lockout, 2FA, password rotation, OAuth state, and JWT issuance.
5. Transfer complete business-schema migration authority from Prisma to Go.
6. Rewrap or formally preserve every encrypted historical field before removing the compatibility crypto reader.
7. Observe zero Fastify proxy traffic, then remove the Node/Prisma runtime in a separate revision.''',
    '''1. Move domain, mailbox, alias, mailbox-user, and administrator write operations that do not require provider access.
2. Move provider-dependent reads, synchronization, OAuth configuration, token refresh, sending operations, and outbound history.
3. Move mailbox-portal and administrator authentication, including login lockout, 2FA, password rotation, OAuth state, and JWT issuance.
4. Transfer complete business-schema migration authority from Prisma to Go.
5. Rewrap or formally preserve every encrypted historical field before removing the compatibility crypto reader.
6. Observe zero Fastify proxy traffic, then remove the Node/Prisma runtime in a separate revision.''',
)

insert_after(
    'CHANGELOG.md',
    '## [Unreleased]\n\n',
    '- moved signed domain-mail ingress to the private Go business service with endpoint-scoped encrypted secrets, Redis replay protection, transactional mailbox routing and persistence, and PII-free compensating R2 lifecycle handling\n',
)
