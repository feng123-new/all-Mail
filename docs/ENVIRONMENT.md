# Environment contract

## Boundary

This document is the authoritative variable contract for `all-Mail`.

- Use [`DEPLOY.md`](./DEPLOY.md) for production startup and rollback.
- Use [`RUNBOOK.md`](./RUNBOOK.md) for recovery.
- Use [`GO-MIGRATION.md`](./GO-MIGRATION.md) for runtime ownership.
- Use [`../CLOUDFLARE-DEPLOY.md`](../CLOUDFLARE-DEPLOY.md) for Worker-specific settings.

## Template ownership

| Surface | Purpose |
| --- | --- |
| `.env.example` | The single canonical production Docker template |
| `docker-compose.yml` | Canonical production topology; PostgreSQL and Redis remain private |
| `docker-compose.dev.yml` | Local-development-only PostgreSQL and Redis host ports |
| `server/.env.example` | Fastify business-API development only |
| `web/.env.example` | Vite frontend development proxy settings |
| `cloudflare/workers/allmail-edge/.dev.vars.example` | Worker-local variables and secrets |
| `core/internal/config/config.go` | Go command-specific validation |
| `server/src/config/env.ts` | Fastify business-API validation |

The copied `.env.cloudflare.example`, `.env.basic.example`, and Node production source-runtime template have been removed. Cloudflare deployments start from `.env.example` and add ingress/tunnel values to that same file.

## Production and local development

Production:

```bash
cp .env.example .env
docker compose up -d --build --wait --wait-timeout 240
```

Production publishes only the Go listener. PostgreSQL and Redis use fixed container ports `5432` and `6379` inside the Compose network.

Local Fastify development explicitly publishes those dependencies:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis
```

Defaults:

```text
PostgreSQL 127.0.0.1:15433
Redis      127.0.0.1:6380
```

Override only in local development with `DEV_POSTGRES_PORT` and `DEV_REDIS_PORT`.

## Public gateway and trusted proxy

| Variable | Default | Consumer | Notes |
| --- | --- | --- | --- |
| `COMPOSE_PROJECT_NAME` | `all-mail` | Compose | Project namespace |
| `APP_PUBLISH_HOST` | `127.0.0.1` | Compose | Go listener bind address |
| `APP_PORT` | `3002` | Compose | Host-facing Go listener port |
| `TRUSTED_PROXY_CIDRS` | blank | Go `app` | Comma-separated direct reverse-proxy/tunnel peer CIDRs |
| `READY_TIMEOUT_SECONDS` | `5` | Go API/forwarding | Readiness/owner-check bound |
| `SHUTDOWN_TIMEOUT_SECONDS` | `15` | Go runtimes | Graceful shutdown bound |
| `PUBLIC_BASE_URL` | blank | bootstrap/OAuth helpers | Externally reachable application base URL |

`TRUSTED_PROXY_CIDRS` must list only the peers that connect directly to the Go listener. The gateway discards external `Forwarded`, `X-Forwarded-*`, `X-Real-IP`, and `CF-Connecting-IP` values unless the socket peer belongs to this list. It then writes one canonical client identity to the internal Fastify API.

The removed `GO_API_MODE` and `ALL_MAIL_ENV` variables are not aliases. The production Go listener always serves the built SPA and proxies business routes that have not yet moved.

## PostgreSQL and Redis

| Variable | Default | Consumers | Notes |
| --- | --- | --- | --- |
| `POSTGRES_USER` | `allmail` | Compose/init/workers/Fastify | Builds internal `DATABASE_URL` values |
| `POSTGRES_PASSWORD` | `allmail_dev_password` | Compose/init/workers/Fastify | Replace outside development |
| `POSTGRES_DB` | `allmail` | Compose/init/workers/Fastify | Database name |
| `DATABASE_URL` | Compose-derived | Internal services/local Fastify | Not supplied to the public Go gateway |
| `REDIS_URL` | Compose-derived | Fastify/local development | Not supplied to `legacy-init` or the Go gateway |
| `ALLOW_LOCAL_RATE_LIMIT_FALLBACK` | `false` | Fastify | Transitional switch; keep false in production |
| `DEV_POSTGRES_PORT` | `15433` | development overlay | Local host port only |
| `DEV_REDIS_PORT` | `6380` | development overlay | Local host port only |

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

Fastify local development still uses `CORS_ORIGIN` in `server/.env`; it is not part of the production root contract because browser traffic is same-origin through Go.

## Bootstrap and runtime secrets

These may be blank on first Docker boot:

- `JWT_SECRET`;
- `ENCRYPTION_KEY`;
- `ADMIN_PASSWORD`.

`legacy-init` persists generated values under the protected legacy runtime volume. Only the forwarding encryption key is exported to:

```text
/var/lib/all-mail-forwarding/encryption-key
```

The forwarding worker accepts only the Compose-owned file path:

```text
ENCRYPTION_KEY_FILE=/var/lib/all-mail/encryption-key
```

It no longer accepts `ENCRYPTION_KEY`, `ALL_MAIL_SECRET_STATE_DIR`, or direct access to `bootstrap-secrets.env`. The retention worker receives no encryption key.

Retrieve the generated bootstrap password with:

```bash
docker compose exec legacy-api sh -lc \
  "grep '^ADMIN_PASSWORD=' /var/lib/all-mail/bootstrap-secrets.env | cut -d= -f2-"
```

`ALL_MAIL_PRINT_BOOTSTRAP_PASSWORD=false` is the safe default.

## Authentication and bootstrap variables

| Variable | Default | Consumer | Notes |
| --- | --- | --- | --- |
| `JWT_SECRET` | generated when blank | Fastify | Minimum 32 characters |
| `JWT_EXPIRES_IN` | `2h` | Fastify | Admin/mailbox token lifetime |
| `ENCRYPTION_KEY` | generated when blank | init/Fastify | Exactly 32 characters; forwarding receives a file copy |
| `ADMIN_USERNAME` | `admin` | init/Fastify compatibility | Initial administrator |
| `ADMIN_PASSWORD` | generated when blank | init/Fastify compatibility | Must be changed when marked temporary |
| `ADMIN_LOGIN_MAX_ATTEMPTS` | `5` | Fastify | Login protection |
| `ADMIN_LOGIN_LOCK_MINUTES` | `15` | Fastify | Lock duration |
| `ADMIN_2FA_SECRET` | blank | Fastify compatibility | Environment-managed legacy TOTP path |
| `ADMIN_2FA_WINDOW` | `1` | Fastify | Accepted TOTP window |

`DOMAIN_BOOTSTRAP_ADMIN_USERNAME`, `DOMAIN_BOOTSTRAP_ADMIN_PASSWORD`, and environment-managed 2FA remain only until the stacked administrator-bootstrap PR lands. They are not new extension points.

## Migration controls

| Variable | Default | Consumer | Notes |
| --- | --- | --- | --- |
| `ALL_MAIL_MIGRATION_DIR` | `/app/migrations` | `go-migrate` | Compose-owned numbered Go SQL path |
| `ALL_MAIL_ALLOW_LEGACY_DB_PUSH_REPAIR` | absent from normal template | explicit `legacy-init` repair | One intentional P3005 recovery only |
| `ALL_MAIL_EXPORT_ENCRYPTION_KEY_FILE` | internal | `legacy-init` | Compose-owned forwarding-key export path |
| `ENCRYPTION_KEY_FILE` | internal | `worker-forwarding` | Required file-secret path |

The repair switch is intentionally not a standing `.env.example` setting. Invoke it only on the explicit one-shot recovery command documented in the runbook.

## Worker health

| Variable | Default | Consumers | Notes |
| --- | --- | --- | --- |
| `WORKER_HEARTBEAT_SECONDS` | `15` | both Go workers | Atomic heartbeat cadence |
| `WORKER_HEARTBEAT_MAX_AGE_SECONDS` | `90` | worker doctors | Maximum accepted heartbeat age |

Removed aliases:

```text
GO_JOBS_HEARTBEAT_SECONDS
GO_JOBS_HEARTBEAT_MAX_AGE_SECONDS
API_LOG_RETENTION_OWNER
FORWARDING_WORKER_OWNER
```

Invalid canonical values fail startup; they are never silently replaced through an old alias.

## API-log retention

| Variable | Default | Consumer |
| --- | --- | --- |
| `API_LOG_RETENTION_DAYS` | `30` | `worker-retention` |
| `API_LOG_CLEANUP_INTERVAL_MINUTES` | `60` | `worker-retention` |
| `API_LOG_CLEANUP_RETRY_SECONDS` | `30` | `worker-retention` |
| `API_LOG_CLEANUP_TIMEOUT_SECONDS` | `60` | retention/doctor |
| `API_LOG_CLEANUP_BATCH_SIZE` | `5000` | `worker-retention` |

## Forwarding

| Variable | Default | Consumer |
| --- | --- | --- |
| `FORWARDING_WORKER_INTERVAL_SECONDS` | `30` | `worker-forwarding` |
| `FORWARDING_WORKER_BATCH_SIZE` | `10` | `worker-forwarding` |
| `FORWARDING_RUN_TIMEOUT_SECONDS` | `120` | forwarding/doctor |
| `RESEND_API_BASE_URL` | `https://api.resend.com` | `worker-forwarding` |

## Domain, ingress and provider OAuth

Still-live compatibility variables:

- `SEND_ENABLED_DOMAINS`;
- `INGRESS_SIGNING_SECRET`;
- `INGRESS_ALLOWED_SKEW_SECONDS`;
- `GOOGLE_OAUTH_CLIENT_ID`;
- `GOOGLE_OAUTH_CLIENT_SECRET`;
- `GOOGLE_OAUTH_REDIRECT_URI`;
- `GOOGLE_OAUTH_SCOPES`;
- `MICROSOFT_OAUTH_CLIENT_ID`;
- `MICROSOFT_OAUTH_CLIENT_SECRET`;
- `MICROSOFT_OAUTH_REDIRECT_URI`;
- `MICROSOFT_OAUTH_TENANT`;
- `MICROSOFT_OAUTH_SCOPES`.

Database-managed OAuth configuration takes precedence. These fallbacks remain until a separate migration copies existing environment configuration into the database.

Worker-only values such as `INGRESS_URL`, `INGRESS_KEY_ID`, `RAW_EMAIL_BUCKET_NAME`, and `RAW_EMAIL_OBJECT_PREFIX` remain in the Worker `.dev.vars` template.

## Coverage rule

Every production variable must have one visible owner. Internal file paths and fixed container ports belong in Compose, not `.env.example`. Compatibility aliases require an explicit deletion date; hidden fallback names are not accepted.
