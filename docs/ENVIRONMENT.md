# Environment contract

## Boundary

This document is the authoritative variable and secret-ownership contract for `all-Mail`.

- Use [`DEPLOY.md`](./DEPLOY.md) for production startup, restore, and rollback.
- Use [`RUNBOOK.md`](./RUNBOOK.md) for recovery.
- Use [`GO-MIGRATION.md`](./GO-MIGRATION.md) for route and runtime ownership.
- Use [`../CLOUDFLARE-DEPLOY.md`](../CLOUDFLARE-DEPLOY.md) for Worker-specific settings.

## Configuration surfaces

| Surface | Purpose |
| --- | --- |
| `.env.example` | Single production Docker template and temporary initializer inputs |
| `config/runtime-env.json` | Exact operator-visible key set and process scope |
| `config/retired-env.json` | Names rejected by production validation |
| `docker-compose.yml` | Canonical production topology and internal variables |
| `docker-compose.dev.yml` | Local PostgreSQL and Redis host-port overlay |
| `web/.env.example` | Vite frontend development proxy settings |
| Worker `.dev.vars.example` | Worker-local variables and secrets |

Production startup is always:

```bash
cp .env.example .env
./scripts/compose-up.sh
```

## Runtime credential matrix

| Runtime | PostgreSQL | Redis | JWT | Encryption key | Provider/OAuth/Ingress secrets |
| --- | --- | --- | --- | --- | --- |
| `app` | No | No | No | No | No |
| `go-business-api` | Yes | Yes | Read-only file | Read-only file | Database-encrypted values |
| `worker-forwarding` | Yes | No | No | Read-only file | Resend base URL only |
| `worker-retention` | Yes | No | No | No | No |
| Temporary `app init` run | Yes | No | Generates/imports | Generates/imports and verifies ciphertext | One-shot compatibility inputs |

The public Go gateway is credential-free. All database-backed HTTP handlers run in the private `go-business-api` process.

## Production and development networking

Only `app` is published in production. `go-business-api`, PostgreSQL, and Redis remain private.

Development publishes dependencies through the overlay:

```bash
./bin/all-mail deps up
```

Defaults:

```text
PostgreSQL 127.0.0.1:15433
Redis      127.0.0.1:6380
```

## Public gateway and Compose controls

| Variable | Default | Consumer | Meaning |
| --- | --- | --- | --- |
| `COMPOSE_PROJECT_NAME` | `all-mail` | Compose | Project and volume namespace |
| `APP_PUBLISH_HOST` | `127.0.0.1` | Compose | Public bind address |
| `APP_PORT` | `3002` | Compose | Public host port |
| `TRUSTED_PROXY_CIDRS` | blank | `app` | Direct reverse-proxy or tunnel peer CIDRs |
| `READY_TIMEOUT_SECONDS` | `5` | Go runtimes | Readiness protocol-check bound |
| `SHUTDOWN_TIMEOUT_SECONDS` | `15` | Go runtimes | Graceful shutdown bound |
| `MAIL_PROVIDER_TIMEOUT_SECONDS` | `300` | `app`, `go-business-api` | Provider operation bound; the gateway allows response-delivery margin |
| `ALL_MAIL_ENV_FILE` | `.env` | startup helper | Alternate production environment file |
| `ALL_MAIL_WAIT_TIMEOUT` | `300` | startup helper | Compose wait timeout in seconds |
| `ALL_MAIL_GO_IMAGE` | `all-mail-go` | Compose | Shared Go image repository override |
| `ALL_MAIL_IMAGE_TAG` | `local` | Compose | Shared Go image tag override |

The private transport URL is fixed by Compose and is not an ownership switch:

```text
GO_BUSINESS_API_URL=http://go-business-api:3200
```

`config/route-ownership.json` decides which routes are handled directly by `app` and which are proxied. `TRUSTED_PROXY_CIDRS` must list only direct peers; blanket trust is rejected.

## PostgreSQL and Redis

| Variable | Default | Consumers | Notes |
| --- | --- | --- | --- |
| `POSTGRES_USER` | `allmail` | Compose, initializer, workers, private API | Internal database identity |
| `POSTGRES_PASSWORD` | required | Compose, initializer, workers, private API | At least 24 URL-safe characters; no fallback |
| `POSTGRES_DB` | `allmail` | Compose, initializer, workers, private API | Database name |
| `DATABASE_URL` | Compose-derived | Temporary initializer, private API, workers | Never supplied to `app` |
| `REDIS_URL` | `redis://redis:6379` | `go-business-api` | Never supplied to `app` or workers |
| `DEV_POSTGRES_PORT` | `15433` | development overlay | Local only |
| `DEV_REDIS_PORT` | `6380` | development overlay | Local only |

Redis is mandatory for administrator and mailbox login protection, API-key limiting, OAuth state/status, and ingress replay reservation. These paths fail closed in production.

## Long-lived runtime secrets

The first temporary initializer accepts blank values for:

```text
JWT_SECRET
ENCRYPTION_KEY
```

It loads or generates them and persists:

```text
/var/lib/all-mail/runtime-secrets.env
```

on `runtime_secrets_data`. That file contains only `JWT_SECRET` and `ENCRYPTION_KEY`.

The initializer exports least-privilege copies:

```text
go-business-api:
  JWT_SECRET_FILE=/var/lib/all-mail-secrets/jwt-secret
  ENCRYPTION_KEY_FILE=/var/lib/all-mail-encryption/encryption-key

worker-forwarding:
  ENCRYPTION_KEY_FILE=/var/lib/all-mail-secrets/encryption-key
```

The JWT copy is stored on `go_business_runtime_data`. The encryption-key export is stored on `forwarding_runtime_data` and mounted at service-specific read-only paths.

| Variable | Default | Consumer |
| --- | --- | --- |
| `JWT_SECRET` | generated when blank | Temporary initializer only |
| `ENCRYPTION_KEY` | generated when blank | Temporary initializer only |
| `JWT_SECRET_FILE` | fixed internal path | `go-business-api` |
| `ENCRYPTION_KEY_FILE` | fixed internal paths | `go-business-api`, `worker-forwarding` |
| `JWT_EXPIRES_IN` | `2h` | `go-business-api` |

`JWT_EXPIRES_IN` accepts a positive integer number of seconds or a positive integer followed by `s`, `m`, `h`, or `d`. Composite, word-form, zero, negative, and overflowing values are rejected.

The public `app` receives no secret file. No long-running process generates replacement keys.

## One-time administrator bootstrap

The temporary initializer accepts:

| Variable | Default | Notes |
| --- | --- | --- |
| `ADMIN_USERNAME` | `admin` | Initial database administrator |
| `ADMIN_PASSWORD` | generated when blank | Initial temporary password |
| `PUBLIC_BASE_URL` | blank | External first-login URL used by initialization output/contracts |
| `BOOTSTRAP_ADMIN_SECRET_FILE` | fixed internal path | One-time credential file |

The credential is persisted separately at `/var/lib/all-mail/bootstrap-admin.env`. `go-business-api` mounts the containing volume only so it can remove the file after forced password rotation. It receives neither username nor password as environment values; `app` receives neither the file nor the values.

The old combined `/var/lib/all-mail/bootstrap-secrets.env` is split into the two current files and removed during an in-place upgrade. This is file-layout compatibility, not an active legacy runtime.

There is no environment-backed administrator. Administrator and mailbox 2FA are database-managed.

## Authentication settings

| Variable | Default | Consumer |
| --- | --- | --- |
| `ADMIN_LOGIN_MAX_ATTEMPTS` | `5` | `go-business-api` |
| `ADMIN_LOGIN_LOCK_MINUTES` | `15` | `go-business-api` |
| `ADMIN_2FA_WINDOW` | `1` | `go-business-api` |
| `JWT_EXPIRES_IN` | `2h` | `go-business-api` |

Retired administrator aliases include `DOMAIN_BOOTSTRAP_ADMIN_USERNAME`, `DOMAIN_BOOTSTRAP_ADMIN_PASSWORD`, and `ADMIN_2FA_SECRET`.

## Private Go service

These are Compose-internal inputs rather than operator ownership switches:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3200` | Private listener |
| `DATABASE_URL` | Compose-derived | Business data access |
| `REDIS_URL` | `redis://redis:6379` | Fail-closed security state and readiness |
| `NODE_ENV` | `production` | Selects secure cookie behavior; it does not imply a Node runtime |
| `JWT_SECRET_FILE` | fixed read-only path | Session issuance and verification |
| `ENCRYPTION_KEY_FILE` | fixed read-only path | Persisted credential decryption |
| `BOOTSTRAP_ADMIN_SECRET_FILE` | fixed writable path | Deletes the consumed one-time credential |
| `INGRESS_ALLOWED_SKEW_SECONDS` | `300` | Signed ingress timestamp window, 1-3600 seconds |
| `GO_BUSINESS_QUERY_TIMEOUT_SECONDS` | `10` | Per-request database bound |
| `MAIL_PROVIDER_TIMEOUT_SECONDS` | `300` | Provider API, OAuth, IMAP, SMTP, and sending bound |
| `READY_TIMEOUT_SECONDS` | `5` | PostgreSQL/Redis readiness bound |
| `SHUTDOWN_TIMEOUT_SECONDS` | `15` | Graceful shutdown bound |

## Durable configuration import

The temporary initializer accepts these one-shot compatibility values:

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

The importer encrypts OAuth and ingress secrets, creates audited send approvals, accepts repeated identical imports, and rejects conflicting values. Long-running services do not receive these environment values. After one successful startup and database verification, remove populated one-shot values from `.env`.

`INGRESS_ALLOWED_SKEW_SECONDS` remains a long-running policy value; it is not a signing secret.

## Historical schema compatibility

| Variable | Default | Consumer | Notes |
| --- | --- | --- | --- |
| `ALL_MAIL_MIGRATION_DIR` | `/app/migrations` | Temporary initializer, `allmail migrate` | Numbered Go SQL path |
| `ALL_MAIL_EXPORT_ENCRYPTION_KEY_FILE` | helper-defined | Temporary initializer | Forwarding key export |
| `ALL_MAIL_EXPORT_JWT_SECRET_FILE` | helper-defined | Temporary initializer | Private JWT export |

The Go initializer embeds and verifies the immutable former Prisma migration history and can adopt known `_prisma_migrations` state. `allmail_schema_migrations` is authoritative and compatibility tables remain for supported upgrades and rollback. There is no active Prisma package, CLI, schema file, repair switch, or schema-push fallback.

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

## Coverage rule

Every operator-visible production variable must appear in `config/runtime-env.json`. One-shot inputs cannot be injected into long-running services. Internal paths, service URLs, and fixed container ports belong in Compose. Retired aliases and silent fallback parsing are rejected.
