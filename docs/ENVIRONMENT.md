# Environment contract

## Boundary

This document is the authoritative variable contract for `all-Mail`.

- Use [`DEPLOY.md`](./DEPLOY.md) for deployment steps.
- Use [`RUNBOOK.md`](./RUNBOOK.md) for recovery.
- Use [`GO-MIGRATION.md`](./GO-MIGRATION.md) for runtime ownership.
- Use [`../CLOUDFLARE-DEPLOY.md`](../CLOUDFLARE-DEPLOY.md) for Worker-specific settings.

## Template ownership

| Surface | Purpose |
| --- | --- |
| `.env.example` | Canonical default Docker template |
| `.env.cloudflare.example` | Same Docker contract with an ingress-secret placeholder |
| `server/.env.example` | Fastify business-API development only |
| `web/.env.example` | Vite frontend development proxy settings |
| `cloudflare/workers/allmail-edge/.dev.vars.example` | Worker-local variables |
| `docker-compose.yml` | Canonical production wiring and internal file paths |
| `core/internal/config/config.go` | Go command-specific validation |
| `server/src/config/env.ts` | Fastify business-API validation |

The root templates have the same key set. `.env.basic.example` and the Node production source-runtime template have been removed.

## Runtime selection

### Production

Docker Compose reads the root `.env` and starts:

- one-shot `legacy-init` and `go-migrate`;
- long-running `app`, `worker-forwarding`, `worker-retention`, `legacy-api`, `postgres`, and `redis`.

### Local development

- `server/.env.example` configures only the Fastify business API.
- `web/.env.example` configures only the Vite frontend.
- The repository CLI may derive `DATABASE_URL` and `REDIS_URL` for development checks, but it does not start a second Node production topology.

## Bootstrap secrets

These may be blank on first Docker boot:

- `JWT_SECRET`;
- `ENCRYPTION_KEY`;
- `ADMIN_PASSWORD`.

`legacy-init` persists generated values at:

```text
/var/lib/all-mail/bootstrap-secrets.env
```

Only `ENCRYPTION_KEY` is exported to the forwarding volume:

```text
/var/lib/all-mail-forwarding/encryption-key
```

The retention worker does not receive it. Retrieve a generated password with:

```bash
docker compose exec legacy-api sh -lc \
  "grep '^ADMIN_PASSWORD=' /var/lib/all-mail/bootstrap-secrets.env | cut -d= -f2-"
```

`ALL_MAIL_PRINT_BOOTSTRAP_PASSWORD=false` is the safe default.

## Core networking

| Variable | Default | Consumers | Notes |
| --- | --- | --- | --- |
| `COMPOSE_PROJECT_NAME` | `all-mail` | Compose | Project namespace |
| `APP_PUBLISH_HOST` | `127.0.0.1` | Compose | Public Go listener bind address |
| `APP_PORT` | `3002` | Compose | Host-facing public port |
| `APP_INTERNAL_PORT` | `3000` | `app` | Container port |
| `LEGACY_API_INTERNAL_PORT` | `3100` | `legacy-api`, `app` | Internal Fastify port |
| `GO_API_MODE` | `bridge` | `app` | `bridge` or frontend-only `static` |
| `READY_TIMEOUT_SECONDS` | `5` | Go API/forwarding | Dependency and ownership probe bound |
| `SHUTDOWN_TIMEOUT_SECONDS` | `15` | Go runtimes | Graceful shutdown bound |
| `PUBLIC_BASE_URL` | blank | bootstrap/OAuth helpers | Externally reachable base URL |
| `CORS_ORIGIN` | blank | Fastify | Comma-separated allowed origins |
| `ALL_MAIL_STATE_DIR` | `/var/lib/all-mail` | wrappers/workers | Runtime state directory inside each service volume |
| `ALL_MAIL_PRINT_BOOTSTRAP_PASSWORD` | `false` | initializer | Short-lived recovery only |

## PostgreSQL and Redis

| Variable | Default | Consumers | Notes |
| --- | --- | --- | --- |
| `POSTGRES_USER` | `allmail` | Compose | Builds Docker `DATABASE_URL` |
| `POSTGRES_PASSWORD` | `allmail_dev_password` | Compose | Replace outside development |
| `POSTGRES_DB` | `allmail` | Compose | Database name |
| `POSTGRES_PUBLISH_HOST` | `127.0.0.1` | Compose | Host bind address |
| `POSTGRES_PORT` | `15433` | Compose/dev tools | Host-facing port |
| `POSTGRES_INTERNAL_PORT` | `5432` | Compose | Container port |
| `DATABASE_URL` | derived | Go/Fastify/init | Required by database-backed runtimes |
| `REDIS_PUBLISH_HOST` | `127.0.0.1` | Compose | Host bind address |
| `REDIS_PORT` | `6380` | Compose/dev tools | Host-facing port |
| `REDIS_INTERNAL_PORT` | `6379` | Compose | Container port |
| `REDIS_URL` | derived | Go API/Fastify | Required by bridge readiness and Fastify state |
| `ALLOW_LOCAL_RATE_LIMIT_FALLBACK` | `false` | Fastify | Keep false for production fail-closed behavior |

## Migration controls

| Variable | Default | Consumers | Notes |
| --- | --- | --- | --- |
| `ALL_MAIL_MIGRATION_DIR` | `/app/migrations` | `go-migrate` | Numbered Go SQL files |
| `ALL_MAIL_ALLOW_LEGACY_DB_PUSH_REPAIR` | `false` | `legacy-init` | Explicit one-run P3005 repair only |
| `ALL_MAIL_EXPORT_ENCRYPTION_KEY_FILE` | internal | `legacy-init` | Compose-owned forwarding-key export path |
| `ENCRYPTION_KEY_FILE` | internal | `worker-forwarding` | Compose-owned isolated key path |

The Go migration runner uses direct `pgx`; no `psql` binary is required in the Go image.

## Authentication and bootstrap

| Variable | Default | Consumers | Notes |
| --- | --- | --- | --- |
| `JWT_SECRET` | generated when blank | Fastify | Minimum 32 characters |
| `JWT_EXPIRES_IN` | `2h` | Fastify | Admin/mailbox token lifetime |
| `ENCRYPTION_KEY` | generated when blank | Fastify/forwarding | Fastify requires exactly 32 characters |
| `ADMIN_USERNAME` | `admin` | Fastify/bootstrap | Initial administrator |
| `ADMIN_PASSWORD` | generated when blank | Fastify/bootstrap | Change after bootstrap when required |
| `ADMIN_LOGIN_MAX_ATTEMPTS` | `5` | Fastify | Login protection |
| `ADMIN_LOGIN_LOCK_MINUTES` | `15` | Fastify | Lock duration |
| `ADMIN_2FA_SECRET` | blank | Fastify | Optional Base32 TOTP secret |
| `ADMIN_2FA_WINDOW` | `1` | Fastify | Accepted TOTP window |

## Worker health

| Variable | Default | Consumers | Notes |
| --- | --- | --- | --- |
| `WORKER_HEARTBEAT_SECONDS` | `15` | both Go workers | Atomic heartbeat cadence |
| `WORKER_HEARTBEAT_MAX_AGE_SECONDS` | `90` | worker doctors | Maximum accepted heartbeat age |

Each worker writes its own file and is diagnosed independently.

## API-log retention

| Variable | Default | Consumers | Notes |
| --- | --- | --- | --- |
| `API_LOG_RETENTION_DAYS` | `30` | `worker-retention` | Expiration threshold |
| `API_LOG_CLEANUP_INTERVAL_MINUTES` | `60` | `worker-retention` | Successful-run interval |
| `API_LOG_CLEANUP_RETRY_SECONDS` | `30` | `worker-retention` | Failure retry delay |
| `API_LOG_CLEANUP_TIMEOUT_SECONDS` | `60` | retention/doctor | Per-run limit |
| `API_LOG_CLEANUP_BATCH_SIZE` | `5000` | `worker-retention` | Maximum rows per transaction |

## Forwarding

| Variable | Default | Consumers | Notes |
| --- | --- | --- | --- |
| `FORWARDING_WORKER_INTERVAL_SECONDS` | `30` | `worker-forwarding` | Claim cadence |
| `FORWARDING_WORKER_BATCH_SIZE` | `10` | `worker-forwarding` | Valid range `1..100` |
| `FORWARDING_RUN_TIMEOUT_SECONDS` | `120` | forwarding/doctor | Maximum duration of one pass |
| `RESEND_API_BASE_URL` | `https://api.resend.com` | `worker-forwarding` | Controlled provider/test override |

The obsolete `API_LOG_RETENTION_OWNER` and `FORWARDING_WORKER_OWNER` variables no longer exist. There is one writer per background capability.

## Domain, ingress and provider OAuth

| Variable | Default | Consumers | Notes |
| --- | --- | --- | --- |
| `DOMAIN_BOOTSTRAP_ADMIN_USERNAME` | blank | Fastify | Optional domain bootstrap helper |
| `DOMAIN_BOOTSTRAP_ADMIN_PASSWORD` | blank | Fastify | Minimum eight characters when set |
| `SEND_ENABLED_DOMAINS` | blank | Fastify | Optional allowlist |
| `INGRESS_SIGNING_SECRET` | blank/placeholder | Fastify/Worker | Must match on both sides |
| `INGRESS_ALLOWED_SKEW_SECONDS` | `300` | Fastify | Minimum `30` |

Optional provider fallbacks:

- `GOOGLE_OAUTH_CLIENT_ID`;
- `GOOGLE_OAUTH_CLIENT_SECRET`;
- `GOOGLE_OAUTH_REDIRECT_URI`;
- `GOOGLE_OAUTH_SCOPES`;
- `MICROSOFT_OAUTH_CLIENT_ID`;
- `MICROSOFT_OAUTH_CLIENT_SECRET`;
- `MICROSOFT_OAUTH_REDIRECT_URI`;
- `MICROSOFT_OAUTH_TENANT`;
- `MICROSOFT_OAUTH_SCOPES`.

Database-managed provider configuration takes precedence where supported. Worker-only values such as `INGRESS_URL`, `INGRESS_KEY_ID`, `RAW_EMAIL_BUCKET_NAME`, and `RAW_EMAIL_OBJECT_PREFIX` remain in the Worker template.

## Coverage rule

Root templates cover production Docker. `server/.env.example`, `web/.env.example`, and Worker `.dev.vars.example` cover development surfaces only. Internal file-path variables are wired by Compose and should not be copied into user-facing templates.
