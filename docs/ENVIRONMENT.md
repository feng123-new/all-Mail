# Environment contract

## Boundary

This document is the authoritative variable contract for `all-Mail`.

- Use [`DEPLOY.md`](./DEPLOY.md) for deployment steps.
- Use [`RUNBOOK.md`](./RUNBOOK.md) for recovery procedures.
- Use [`GO-MIGRATION.md`](./GO-MIGRATION.md) for runtime ownership and migration guarantees.
- Use [`../CLOUDFLARE-DEPLOY.md`](../CLOUDFLARE-DEPLOY.md) for Worker-specific deployment details.

## Template ownership

| Surface | Purpose |
| --- | --- |
| `.env.example` | Canonical default Docker-first template |
| `.env.cloudflare.example` | Same Docker contract with an explicit ingress-secret placeholder |
| `server/.env.example` | Advanced compiled Node source-runtime template |
| `web/.env.example` | Frontend-only Vite development proxy settings |
| `cloudflare/workers/allmail-edge/.dev.vars.example` | Worker-local development variables |
| `docker-compose.yml` | Canonical Docker wiring, service defaults and profiles |
| `core/internal/config/config.go` | Go runtime validation |
| `server/src/config/env.ts` | Compatibility Fastify validation |

The duplicated `.env.basic.example` template has been removed. New deployments should copy `.env.example` only.

## Runtime selection

### Canonical Docker runtime

The root `.env` file is read by Docker Compose. The default topology contains:

- one-shot `legacy-init`;
- one-shot `go-migrate`;
- long-running `app`, `go-jobs`, `legacy-api`, `postgres` and `redis`;
- optional `legacy-jobs` under the `rollback` profile.

### Secondary compiled source runtime

`scripts/start-all-mail.mjs` and `bin/all-mail.mjs` resolve env files in this order:

1. `ALL_MAIL_ENV_FILE`;
2. `server/.env`;
3. root `.env`.

The source runtime derives:

- `PORT` from `APP_PORT` when absent;
- `DATABASE_URL` from `POSTGRES_*` when absent;
- `REDIS_URL` from `REDIS_*` when absent.

The source path starts the compiled Fastify API and Node worker directly. It is a compatibility/debug path and is not topology-equivalent to the canonical Go Docker runtime.

## Bootstrap-secret behavior

These values may be blank on first Docker boot:

- `JWT_SECRET`;
- `ENCRYPTION_KEY`;
- `ADMIN_PASSWORD`.

`legacy-init` generates missing values and persists them in:

```text
/var/lib/all-mail/bootstrap-secrets.env
```

Only `ENCRYPTION_KEY` is copied into the isolated Go runtime volume:

```text
/var/lib/all-mail-go/encryption-key
```

The long-running Go runtime never mounts the file containing the admin password and JWT secret.

Retrieve a generated password through the service that mounts the legacy state volume:

```bash
docker compose exec legacy-api sh -lc \
  "grep '^ADMIN_PASSWORD=' /var/lib/all-mail/bootstrap-secrets.env | cut -d= -f2-"
```

`ALL_MAIL_PRINT_BOOTSTRAP_PASSWORD=false` is the safe default.

## Core runtime and networking

| Variable | Default | Main consumers | Notes |
| --- | --- | --- | --- |
| `COMPOSE_PROJECT_NAME` | `all-mail` | Compose | Project namespace |
| `APP_PUBLISH_HOST` | `127.0.0.1` | Compose | Host bind address for the public Go listener |
| `APP_PORT` | `3002` | Compose/source helpers | Host-facing public port |
| `APP_INTERNAL_PORT` | `3000` | `app` | Go listener container port |
| `LEGACY_API_INTERNAL_PORT` | `3100` | `legacy-api`, `app` | Internal Fastify port; not published by default |
| `GO_API_MODE` | `bridge` | Go API | `bridge` or frontend-only `static` |
| `READY_TIMEOUT_SECONDS` | `5` | Go API/jobs | Dependency and ownership probe timeout |
| `SHUTDOWN_TIMEOUT_SECONDS` | `15` | Go API/jobs | Graceful shutdown bound |
| `PUBLIC_BASE_URL` | blank | bootstrap/OAuth helpers | Preferred externally reachable base URL |
| `CORS_ORIGIN` | blank | Fastify | Comma-separated allowed origins |
| `ALL_MAIL_STATE_DIR` | `/var/lib/all-mail` | runtime wrappers | Persisted runtime state path |
| `ALL_MAIL_PRINT_BOOTSTRAP_PASSWORD` | `false` | init/source wrappers | Explicit short-lived recovery flag |

## PostgreSQL and Redis

| Variable | Default | Main consumers | Notes |
| --- | --- | --- | --- |
| `POSTGRES_USER` | `allmail` | Compose | Builds Docker `DATABASE_URL` |
| `POSTGRES_PASSWORD` | `allmail_dev_password` | Compose | Replace for non-development deployments |
| `POSTGRES_DB` | `allmail` | Compose | Database name |
| `POSTGRES_PUBLISH_HOST` | `127.0.0.1` | Compose | Host bind address |
| `POSTGRES_PORT` | `15433` | Compose/source helpers | Host-facing port |
| `POSTGRES_INTERNAL_PORT` | `5432` | Compose | Container port |
| `DATABASE_URL` | derived | Go/Fastify/init | Required by database-backed runtimes |
| `REDIS_PUBLISH_HOST` | `127.0.0.1` | Compose | Host bind address |
| `REDIS_PORT` | `6380` | Compose/source helpers | Host-facing port |
| `REDIS_INTERNAL_PORT` | `6379` | Compose | Container port |
| `REDIS_URL` | derived | Go/Fastify | Required by bridge readiness and Fastify state |
| `ALLOW_LOCAL_RATE_LIMIT_FALLBACK` | `false` | Fastify | Keep false for production fail-closed behavior |

## Migration and compatibility controls

| Variable | Default | Main consumers | Notes |
| --- | --- | --- | --- |
| `ALL_MAIL_MIGRATION_DIR` | `/app/migrations` | Go migrate | Directory containing numbered Go SQL files |
| `ALL_MAIL_ALLOW_LEGACY_DB_PUSH_REPAIR` | `false` | `legacy-init` | Emergency P3005 compatibility repair; never enable casually |
| `ALL_MAIL_EXPORT_ENCRYPTION_KEY_FILE` | internal | `legacy-init` | Internal path for exporting only the Go forwarding key |
| `ENCRYPTION_KEY_FILE` | internal | `go-jobs` | Reads the isolated exported key |

Normal startup fails on Prisma P3005 instead of silently running `db push`. An operator must inspect the database and explicitly enable the compatibility repair for a single intended run.

## Authentication and bootstrap

| Variable | Default | Main consumers | Notes |
| --- | --- | --- | --- |
| `JWT_SECRET` | generated when blank | Fastify | Must satisfy backend minimum length |
| `JWT_EXPIRES_IN` | `2h` | Fastify | Admin/mailbox token lifetime |
| `ENCRYPTION_KEY` | generated when blank | Fastify/Go forwarding | Fastify expects 32 characters |
| `ADMIN_USERNAME` | `admin` | Fastify/bootstrap | Initial administrator username |
| `ADMIN_PASSWORD` | generated when blank | Fastify/bootstrap | Must be changed when bootstrap flow requires it |
| `ADMIN_LOGIN_MAX_ATTEMPTS` | `5` | Fastify | Login protection |
| `ADMIN_LOGIN_LOCK_MINUTES` | `15` | Fastify | Lock duration |
| `ADMIN_2FA_SECRET` | blank | Fastify | Optional Base32 TOTP secret |
| `ADMIN_2FA_WINDOW` | `1` | Fastify | Accepted TOTP window |

## Go jobs health

| Variable | Default | Main consumers | Notes |
| --- | --- | --- | --- |
| `GO_JOBS_HEARTBEAT_SECONDS` | `15` | `go-jobs` | Atomic heartbeat update cadence |
| `GO_JOBS_HEARTBEAT_MAX_AGE_SECONDS` | `90` | `allmail doctor jobs` | Maximum accepted heartbeat age |

Worker heartbeat state includes active-run timing, completion timing, last success, consecutive failures and last error.

## API-log retention

| Variable | Default | Main consumers | Notes |
| --- | --- | --- | --- |
| `API_LOG_RETENTION_OWNER` | `go` in Compose | Go/Node jobs | `legacy` only for explicit rollback |
| `API_LOG_RETENTION_DAYS` | `30` | Go/Node jobs | Expiration threshold |
| `API_LOG_CLEANUP_INTERVAL_MINUTES` | `60` | Go/Node jobs | Successful-run interval |
| `API_LOG_CLEANUP_RETRY_SECONDS` | `30` | Go jobs | Failure retry delay |
| `API_LOG_CLEANUP_TIMEOUT_SECONDS` | `60` | Go jobs/doctor | Per-run execution limit |
| `API_LOG_CLEANUP_BATCH_SIZE` | `5000` | Go jobs | Maximum rows per transaction |

## Forwarding

| Variable | Default | Main consumers | Notes |
| --- | --- | --- | --- |
| `FORWARDING_WORKER_OWNER` | `go` in Compose | Go/Node jobs | `go`, `legacy` or `disabled` |
| `FORWARDING_WORKER_INTERVAL_SECONDS` | `30` | Go/Node jobs | Claim cadence |
| `FORWARDING_WORKER_BATCH_SIZE` | `10` | Go/Node jobs | Claim batch, valid range `1..100` |
| `FORWARDING_RUN_TIMEOUT_SECONDS` | `120` | Go jobs/doctor | Maximum duration of one forwarding pass |
| `RESEND_API_BASE_URL` | `https://api.resend.com` | Go jobs | Controlled provider/test override |

The `legacy-jobs` rollback service forces both owner variables to `legacy` regardless of the normal `.env` defaults.

## Domain and ingress

| Variable | Default | Main consumers | Notes |
| --- | --- | --- | --- |
| `DOMAIN_BOOTSTRAP_ADMIN_USERNAME` | blank | Fastify | Optional domain bootstrap helper |
| `DOMAIN_BOOTSTRAP_ADMIN_PASSWORD` | blank | Fastify | Minimum eight characters when set |
| `SEND_ENABLED_DOMAINS` | blank | Fastify | Optional allowlist-style setting |
| `INGRESS_SIGNING_SECRET` | blank/default template | Fastify/Worker | Shared secret; Cloudflare template contains a required replacement placeholder |
| `INGRESS_ALLOWED_SKEW_SECONDS` | `300` | Fastify | Minimum `30` |

Worker-only settings such as `INGRESS_URL`, `INGRESS_KEY_ID`, `RAW_EMAIL_BUCKET_NAME` and `RAW_EMAIL_OBJECT_PREFIX` remain in the Worker template.

## Provider OAuth

The following optional provider-side fallbacks are accepted by Fastify:

- `GOOGLE_OAUTH_CLIENT_ID`;
- `GOOGLE_OAUTH_CLIENT_SECRET`;
- `GOOGLE_OAUTH_REDIRECT_URI`;
- `GOOGLE_OAUTH_SCOPES`;
- `MICROSOFT_OAUTH_CLIENT_ID`;
- `MICROSOFT_OAUTH_CLIENT_SECRET`;
- `MICROSOFT_OAUTH_REDIRECT_URI`;
- `MICROSOFT_OAUTH_TENANT`;
- `MICROSOFT_OAUTH_SCOPES`.

Database-managed provider configuration takes precedence where supported.

## Template coverage rule

Not every variable belongs in every example file:

- root templates cover the canonical Docker topology;
- `server/.env.example` covers only the compatibility source runtime;
- `web/.env.example` covers Vite development;
- Worker `.dev.vars.example` covers Worker-local development;
- internal file-path variables are wired by Compose rather than intended for operator edits.

Treat `docker-compose.yml` plus this document as the Docker contract. Do not reintroduce copied full-template aliases.
