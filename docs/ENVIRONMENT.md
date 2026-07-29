# Environment contract

## Boundary

This document is the authoritative variable and secret-ownership contract for `all-Mail`.

- Use [`DEPLOY.md`](./DEPLOY.md) for production startup and rollback.
- Use [`RUNBOOK.md`](./RUNBOOK.md) for recovery.
- Use [`GO-MIGRATION.md`](./GO-MIGRATION.md) for runtime ownership.
- Use [`../CLOUDFLARE-DEPLOY.md`](../CLOUDFLARE-DEPLOY.md) for Worker-specific settings.

## Template ownership

| Surface | Purpose |
| --- | --- |
| `.env.example` | Single production Docker template |
| `docker-compose.yml` | Canonical production topology |
| `docker-compose.dev.yml` | Local PostgreSQL/Redis host-port overlay |
| `server/.env.example` | Long-running Fastify development settings only |
| `web/.env.example` | Vite frontend development proxy settings |
| Worker `.dev.vars.example` | Worker-local variables and secrets |
| Go/Fastify config loaders | Command/process-specific validation |

The copied Cloudflare backend template, `.env.basic.example`, and Node production source runtime are removed.

## Production and development networking

Production:

```bash
cp .env.example .env
docker compose up -d --build --wait --wait-timeout 300
```

Only the Go listener is published. PostgreSQL and Redis remain private on container ports `5432` and `6379`.

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
| `TRUSTED_PROXY_CIDRS` | blank | Go `app` | Direct reverse-proxy/tunnel peer CIDRs |
| `READY_TIMEOUT_SECONDS` | `5` | Go API/forwarding | Readiness/owner-check bound |
| `SHUTDOWN_TIMEOUT_SECONDS` | `15` | Go runtimes | Graceful shutdown bound |
| `PUBLIC_BASE_URL` | blank | `legacy-init`/OAuth helpers | External application base URL |

`TRUSTED_PROXY_CIDRS` must list only direct peers. The Go gateway discards forwarded identity from every other peer and writes one canonical client identity to Fastify.

Removed gateway aliases include `GO_API_MODE`, `ALL_MAIL_ENV`, and `ALL_MAIL_PUBLIC_BASE_URL`.

## PostgreSQL and Redis

| Variable | Default | Consumers | Notes |
| --- | --- | --- | --- |
| `POSTGRES_USER` | `allmail` | Compose/init/workers/Fastify | Internal database URL |
| `POSTGRES_PASSWORD` | required | Compose/init/workers/Fastify | At least 24 URL-safe characters; no production fallback |
| `POSTGRES_DB` | `allmail` | Compose/init/workers/Fastify | Database name |
| `DATABASE_URL` | Compose-derived | Internal services/local Fastify | Never supplied to public Go `app` |
| `REDIS_URL` | Compose-derived | Fastify/local development | Never supplied to `legacy-init` or `app` |
| `DEV_POSTGRES_PORT` | `15433` | development overlay | Local only |
| `DEV_REDIS_PORT` | `6380` | development overlay | Local only |

Removed production variables:

```text
APP_INTERNAL_PORT
LEGACY_API_INTERNAL_PORT
POSTGRES_PUBLISH_HOST
POSTGRES_PORT
POSTGRES_INTERNAL_PORT
REDIS_PUBLISH_HOST
REDIS_PORT
REDIS_INTERNAL_PORT
CORS_ORIGIN
ALL_MAIL_STATE_DIR
```

`CORS_ORIGIN` remains a local Fastify-development setting only.

Production security state is fail-closed. Redis is mandatory for administrator login protection, API-key rate limiting, OAuth state/status, and ingress replay reservation. Local in-memory maps are development/test-only.

The initializer may create or migrate `runtime-secrets.env`. Long-running Fastify uses `require-existing` mode and exits instead of generating replacement JWT or encryption keys.

## Long-lived runtime secrets

These may be blank on first Docker boot:

```text
JWT_SECRET
ENCRYPTION_KEY
```

`legacy-init` loads or generates them and persists managed values in:

```text
/var/lib/all-mail/runtime-secrets.env
```

That file contains only:

```text
JWT_SECRET
ENCRYPTION_KEY
```

The forwarding worker receives only a copied key file:

```text
ENCRYPTION_KEY_FILE=/var/lib/all-mail-secrets/encryption-key
```

It does not receive the raw key environment variable or access the legacy runtime secret bundle.

| Variable | Default | Consumer |
| --- | --- | --- |
| `JWT_SECRET` | generated when blank | init/Fastify |
| `JWT_EXPIRES_IN` | `2h` | Fastify |
| `ENCRYPTION_KEY` | generated when blank | init/Fastify |
| `ENCRYPTION_KEY_FILE` | internal fixed path | forwarding worker |

## One-time administrator bootstrap

The initializer alone accepts:

| Variable | Default | Consumer | Notes |
| --- | --- | --- | --- |
| `ADMIN_USERNAME` | `admin` | `legacy-init` | Initial DB administrator username |
| `ADMIN_PASSWORD` | generated when blank | `legacy-init` | Initial temporary password |
| `ALL_MAIL_PRINT_BOOTSTRAP_PASSWORD` | `false` | `legacy-init` | Opt-in startup log output |
| `BOOTSTRAP_ADMIN_SECRET_FILE` | internal fixed path | init/Fastify cleanup | One-time file path |

The credential is persisted separately:

```text
/var/lib/all-mail/bootstrap-admin.env
```

The long-running API receives the **path only**, so it can remove the file after the initial password is changed. It does not receive `ADMIN_USERNAME` or `ADMIN_PASSWORD`.

Retrieve the protected credential:

```bash
docker compose exec legacy-api sh -lc \
  "grep '^ADMIN_USERNAME=' /var/lib/all-mail/bootstrap-admin.env && \
   grep '^ADMIN_PASSWORD=' /var/lib/all-mail/bootstrap-admin.env"
```

After successful first password rotation, `bootstrap-admin.env` is deleted. Re-running `legacy-init` does not recreate it when an administrator already exists and no matching pending bootstrap credential remains.

### Legacy secret-file migration

The old combined file:

```text
/var/lib/all-mail/bootstrap-secrets.env
```

is automatically split into `runtime-secrets.env` and `bootstrap-admin.env`, then removed. For historical custom usernames, the initializer compares the preserved password against pending administrator hashes and rewrites the correct username before retaining the file.

Removed administrator aliases:

```text
DOMAIN_BOOTSTRAP_ADMIN_USERNAME
DOMAIN_BOOTSTRAP_ADMIN_PASSWORD
ADMIN_2FA_SECRET
```

There is no environment-backed or virtual `adminId=0` administrator. Administrator 2FA is database-managed; `ADMIN_2FA_WINDOW` remains the TOTP tolerance setting.

## Administrator runtime settings

| Variable | Default | Consumer |
| --- | --- | --- |
| `ADMIN_LOGIN_MAX_ATTEMPTS` | `5` | Fastify |
| `ADMIN_LOGIN_LOCK_MINUTES` | `15` | Fastify |
| `ADMIN_2FA_WINDOW` | `1` | Fastify database-managed 2FA |

## Migration controls

| Variable | Default | Consumer | Notes |
| --- | --- | --- | --- |
| `ALL_MAIL_MIGRATION_DIR` | `/app/migrations` | `go-migrate` | Numbered Go SQL path |
| `ALL_MAIL_ALLOW_LEGACY_DB_PUSH_REPAIR` | absent | explicit repair run | One reviewed P3005 recovery |
| `ALL_MAIL_EXPORT_ENCRYPTION_KEY_FILE` | internal | `legacy-init` | Forwarding-key export |

The P3005 repair switch is deliberately absent from `.env.example`.

## Worker settings

Canonical shared health controls:

```text
WORKER_HEARTBEAT_SECONDS=15
WORKER_HEARTBEAT_MAX_AGE_SECONDS=90
```

Removed aliases:

```text
GO_JOBS_HEARTBEAT_SECONDS
GO_JOBS_HEARTBEAT_MAX_AGE_SECONDS
API_LOG_RETENTION_OWNER
FORWARDING_WORKER_OWNER
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

## Domain, ingress and OAuth compatibility

Still-live compatibility variables:

- `SEND_ENABLED_DOMAINS`;
- `INGRESS_SIGNING_SECRET`;
- `INGRESS_ALLOWED_SKEW_SECONDS`;
- Google/Microsoft OAuth client, redirect, scope, tenant fallbacks.

Database OAuth configuration takes precedence. These remain until a separate importer migrates existing environment-only deployments.

Worker-only values such as `INGRESS_URL`, `INGRESS_KEY_ID`, `RAW_EMAIL_BUCKET_NAME`, `RAW_EMAIL_OBJECT_PREFIX`, and `MAX_RAW_EMAIL_BYTES` remain in the Worker template. The default raw-message parsing limit is 15 MiB.

## Coverage rule

Every production variable must have one visible owner. One-time inputs cannot be injected into long-running services. Internal paths and fixed container ports belong in Compose. Hidden aliases and silent fallback parsing are not accepted.
