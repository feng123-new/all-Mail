# Environment contract

## Boundary

This document is the authoritative variable and secret-ownership contract for `all-Mail`.

- Use [`DEPLOY.md`](./DEPLOY.md) for production startup and rollback.
- Use [`RUNBOOK.md`](./RUNBOOK.md) for recovery.
- Use [`GO-MIGRATION.md`](./GO-MIGRATION.md) for route and runtime ownership.
- Use [`../CLOUDFLARE-DEPLOY.md`](../CLOUDFLARE-DEPLOY.md) for Worker-specific settings.

## Template ownership

| Surface | Purpose |
| --- | --- |
| `.env.example` | Single production Docker template and one-shot compatibility import inputs |
| `config/runtime-env.json` | Exact operator-visible key set and process scope |
| `config/retired-env.json` | Names rejected by production validation |
| `docker-compose.yml` | Canonical production topology and internal variables |
| `docker-compose.dev.yml` | Local PostgreSQL and Redis host-port overlay |
| `server/.env.example` | Remaining Fastify development settings only |
| `web/.env.example` | Vite frontend development proxy settings |
| Worker `.dev.vars.example` | Worker-local variables and secrets |

## Runtime credential matrix

| Runtime | PostgreSQL | Redis | JWT | Encryption key | Provider/OAuth/Ingress secrets |
| --- | --- | --- | --- | --- | --- |
| `app` | No | No | No | No | No |
| `go-business-api` | Yes | Yes | Read-only file | Read-only file | Database-encrypted provider, OAuth, sending, and ingress secrets |
| `business-api` | Yes | Yes | Runtime secret file | Runtime secret file | Database-encrypted state for remaining routes |
| `worker-forwarding` | Yes | No | No | Read-only file | Resend API base URL only |
| `worker-retention` | Yes | No | No | No | No |
| `business-init` | Yes | No | Generates/imports | Generates/imports | One-shot compatibility inputs |
| `go-migrate` | Yes | No | No | No | No |

The public Go gateway is intentionally credential-free. Migrated database-backed handlers run in the separate private `go-business-api` process.

## Production and development networking

Production:

```bash
cp .env.example .env
docker compose up -d --build --wait --wait-timeout 300
```

Only `app` is published. Both business APIs, PostgreSQL, and Redis remain private on the Compose network.

Development:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis
```

Defaults:

```text
PostgreSQL 127.0.0.1:15433
Redis      127.0.0.1:6380
```

## Public gateway

| Variable | Default | Consumer | Meaning |
| --- | --- | --- | --- |
| `COMPOSE_PROJECT_NAME` | `all-mail` | Compose | Project namespace |
| `APP_PUBLISH_HOST` | `127.0.0.1` | Compose | Public bind address |
| `APP_PORT` | `3002` | Compose | Public Go port |
| `TRUSTED_PROXY_CIDRS` | blank | Go `app` | Direct reverse-proxy or tunnel peer CIDRs |
| `READY_TIMEOUT_SECONDS` | `5` | Go runtimes | Readiness protocol-check bound |
| `SHUTDOWN_TIMEOUT_SECONDS` | `15` | Go runtimes | Graceful shutdown bound |
| `MAIL_PROVIDER_TIMEOUT_SECONDS` | `300` | gateway and private `go-business-api` | Provider API, OAuth, IMAP, SMTP, and Resend operation bound; the gateway adds 30 seconds for response delivery |
| `PUBLIC_BASE_URL` | blank | initializer | External first-login URL |

Internal transport URLs are fixed by Compose and are not operator-controlled route switches:

```text
BUSINESS_API_URL=http://business-api:3100
GO_BUSINESS_API_URL=http://go-business-api:3200
```

`config/route-ownership.json`, not an environment flag, decides which private upstream owns each route and HTTP method.

`TRUSTED_PROXY_CIDRS` must list only direct peers. The Go gateway discards forwarded identity from every other peer and writes one canonical client identity downstream.

Removed gateway aliases include `GO_API_MODE`, `ALL_MAIL_ENV`, and `ALL_MAIL_PUBLIC_BASE_URL`.

## PostgreSQL and Redis

| Variable | Default | Consumers | Notes |
| --- | --- | --- | --- |
| `POSTGRES_USER` | `allmail` | Compose, init, migrations, workers, business APIs | Internal database identity |
| `POSTGRES_PASSWORD` | required | Compose, init, migrations, workers, business APIs | At least 24 URL-safe characters; no fallback |
| `POSTGRES_DB` | `allmail` | Compose, init, migrations, workers, business APIs | Database name |
| `DATABASE_URL` | Compose-derived | `business-init`, `go-migrate`, both business APIs, both Go workers | Never supplied to public `app` |
| `REDIS_URL` | Compose-derived | `business-api`, `go-business-api`, local development | Never supplied to `business-init`, workers, or public `app` |
| `DEV_POSTGRES_PORT` | `15433` | development overlay | Local only |
| `DEV_REDIS_PORT` | `6380` | development overlay | Local only |

Production security state is fail-closed. Redis is mandatory for administrator login protection, API-key limiting, OAuth state and status, and ingress replay reservation. Local in-memory maps are development and test only.

## Long-lived runtime secrets

These may be blank on the first Docker boot:

```text
JWT_SECRET
ENCRYPTION_KEY
```

`business-init` loads or generates them and persists managed values in:

```text
/var/lib/all-mail/runtime-secrets.env
```

That file contains only:

```text
JWT_SECRET
ENCRYPTION_KEY
```

The initializer exports least-privilege copies into separate volumes:

```text
worker-forwarding:
  ENCRYPTION_KEY_FILE=/var/lib/all-mail-secrets/encryption-key

go-business-api:
  JWT_SECRET_FILE=/var/lib/all-mail-secrets/jwt-secret
  ENCRYPTION_KEY_FILE=/var/lib/all-mail-encryption/encryption-key
```

| Variable | Default | Consumer |
| --- | --- | --- |
| `JWT_SECRET` | generated when blank | initializer and Fastify only |
| `JWT_EXPIRES_IN` | `2h` | Fastify token issuance |
| `JWT_SECRET_FILE` | internal fixed path | private `go-business-api` verification only |
| `ENCRYPTION_KEY` | generated when blank | initializer and Fastify only |
| `ENCRYPTION_KEY_FILE` | internal fixed paths | forwarding worker and private `go-business-api` only |

The public `app` receives neither secret. The private Go business service receives a read-only encryption-key copy for persisted provider, OAuth, sending, and ingress secrets. The forwarding worker receives no JWT secret.

Long-running Fastify uses `require-existing` mode and exits instead of generating replacement secrets.

## One-time administrator bootstrap

The initializer alone accepts:

| Variable | Default | Notes |
| --- | --- | --- |
| `ADMIN_USERNAME` | `admin` | Initial database administrator |
| `ADMIN_PASSWORD` | generated when blank | Initial temporary password |
| `ALL_MAIL_PRINT_BOOTSTRAP_PASSWORD` | `false` | Opt-in startup log output |
| `BOOTSTRAP_ADMIN_SECRET_FILE` | internal path | One-time credential file |

The credential is persisted separately at `/var/lib/all-mail/bootstrap-admin.env`. The long-running Fastify API receives only the cleanup path so it can remove the file after password rotation; it does not receive the username or password. The private Go service and public gateway receive neither the file nor the credential.

After successful first password rotation, `bootstrap-admin.env` is deleted. Re-running the initializer does not recreate it when an administrator already exists.

The old combined `/var/lib/all-mail/bootstrap-secrets.env` is automatically split into `runtime-secrets.env` and `bootstrap-admin.env`, then removed.

Removed administrator aliases:

```text
DOMAIN_BOOTSTRAP_ADMIN_USERNAME
DOMAIN_BOOTSTRAP_ADMIN_PASSWORD
ADMIN_2FA_SECRET
```

There is no environment-backed or virtual administrator. Administrator 2FA is database-managed; `ADMIN_2FA_WINDOW` controls only TOTP tolerance.

## Administrator runtime settings

| Variable | Default | Consumer |
| --- | --- | --- |
| `ADMIN_LOGIN_MAX_ATTEMPTS` | `5` | Fastify while administrator auth remains there |
| `ADMIN_LOGIN_LOCK_MINUTES` | `15` | Fastify while administrator auth remains there |
| `ADMIN_2FA_WINDOW` | `1` | Fastify database-managed 2FA |

## Private Go business service

These are Compose-internal inputs, not root `.env.example` ownership switches:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3200` | Private listener |
| `DATABASE_URL` | Compose-derived | Migrated business data access |
| `REDIS_URL` | `redis://redis:6379` | Fail-closed API-key limiting and readiness |
| `JWT_SECRET_FILE` | fixed read-only path | Existing administrator JWT verification |
| `ENCRYPTION_KEY_FILE` | fixed read-only path | Decrypt persisted ingress endpoint signing secrets |
| `INGRESS_ALLOWED_SKEW_SECONDS` | `300` | Signed ingress timestamp window, limited to 1–3600 seconds |
| `GO_BUSINESS_QUERY_TIMEOUT_SECONDS` | `10` | Per-request database bound |
| `MAIL_PROVIDER_TIMEOUT_SECONDS` | `300` | Provider API, OAuth refresh, IMAP, SMTP, and Resend bound; separate from database queries |
| `READY_TIMEOUT_SECONDS` | `5` | Protocol-check bound |
| `SHUTDOWN_TIMEOUT_SECONDS` | `15` | Graceful shutdown bound |

## Durable business configuration import

The following values are accepted only by `business-init`:

```text
SEND_ENABLED_DOMAINS
INGRESS_SIGNING_SECRET
INGRESS_IMPORT_KEY_ID
GOOGLE_OAUTH_CLIENT_ID
GOOGLE_OAUTH_CLIENT_SECRET
GOOGLE_OAUTH_REDIRECT_URI
GOOGLE_OAUTH_SCOPES
MICROSOFT_OAUTH_CLIENT_ID
MICROSOFT_OAUTH_CLIENT_SECRET
MICROSOFT_OAUTH_REDIRECT_URI
MICROSOFT_OAUTH_TENANT
MICROSOFT_OAUTH_SCOPES
```

Startup order:

```text
Prisma migrations
→ idempotent durable configuration import
→ administrator bootstrap
→ Go additive migrations
→ private business APIs and workers
→ public gateway
```

The importer:

- encrypts OAuth client secrets in `provider_oauth_configs`;
- converts `SEND_ENABLED_DOMAINS` into audited domain send approvals;
- encrypts the ingress signing secret on the selected endpoint;
- accepts a repeated import only when database and environment values match;
- refuses conflicting OAuth or ingress values and unknown send-enabled domains.

Neither long-running business API receives these compatibility values. After one successful deployment, verify database state, then remove populated import values from `.env`.

`INGRESS_ALLOWED_SKEW_SECONDS` remains a long-running replay and clock policy while ingress is Fastify-owned. It is not a signing secret.

## Ingress secret operation

Ingress authentication resolves the active endpoint by `x-ingress-key-id` and decrypts that endpoint's stored signing secret. A hash-only endpoint is treated as unconfigured.

Creating or rotating an ingress endpoint requires both:

```text
INGRESS_SIGNING_SECRET
ENCRYPTION_KEY
```

The Cloudflare Worker keeps its matching secret through Wrangler secret storage.

## Migration controls

| Variable | Default | Consumer | Notes |
| --- | --- | --- | --- |
| `ALL_MAIL_MIGRATION_DIR` | `/app/migrations` | `go-migrate` | Numbered Go SQL path |
| `ALL_MAIL_ALLOW_PRISMA_P3005_REPAIR` | absent | explicit initializer repair | Reviewed recovery only |
| `ALL_MAIL_EXPORT_ENCRYPTION_KEY_FILE` | internal | initializer | Forwarding key export |
| `ALL_MAIL_EXPORT_JWT_SECRET_FILE` | internal | initializer | Go-business JWT export |

The repair switch is deliberately absent from `.env.example`.

## Worker settings

Shared health controls:

```text
WORKER_HEARTBEAT_SECONDS=15
WORKER_HEARTBEAT_MAX_AGE_SECONDS=90
```

Retention:

```text
API_LOG_RETENTION_DAYS=30
API_LOG_CLEANUP_INTERVAL_MINUTES=60
API_LOG_CLEANUP_RETRY_SECONDS=30
API_LOG_CLEANUP_TIMEOUT_SECONDS=60
API_LOG_CLEANUP_BATCH_SIZE=5000
API_LOG_CLEANUP_MAX_BATCHES=10
```

Forwarding:

```text
FORWARDING_WORKER_INTERVAL_SECONDS=30
FORWARDING_WORKER_BATCH_SIZE=10
FORWARDING_RUN_TIMEOUT_SECONDS=120
FORWARDING_LEASE_SECONDS=180
RESEND_API_BASE_URL=https://api.resend.com
```

Removed worker aliases include `GO_JOBS_HEARTBEAT_SECONDS`, `GO_JOBS_HEARTBEAT_MAX_AGE_SECONDS`, `API_LOG_RETENTION_OWNER`, and `FORWARDING_WORKER_OWNER`.

## Worker-only Cloudflare values

Worker-local values remain in `.dev.vars.example`:

```text
INGRESS_URL
INGRESS_KEY_ID
INGRESS_PROVIDER
RAW_EMAIL_BUCKET_NAME
RAW_EMAIL_OBJECT_PREFIX
MAX_RAW_EMAIL_BYTES
WORKER_HEALTH_URL
INGRESS_SIGNING_SECRET
```

The default raw-message parsing limit is 15 MiB.

## Coverage rule

Every operator-visible production variable must appear in `config/runtime-env.json`. One-time inputs cannot be injected into long-running services. Internal paths, service URLs, and fixed container ports belong in Compose. Retired aliases and silent fallback parsing are rejected.
