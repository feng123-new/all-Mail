# Environment Contract

## Boundary

This document is the authoritative variable contract for `all-Mail`.

- Use this file to understand which variables exist, which runtime surfaces consume them, and which template owns them.
- Use [`docs/DEPLOY.md`](./DEPLOY.md) for deployment steps.
- Use [`docs/RUNBOOK.md`](./RUNBOOK.md) for recovery procedures.
- Use [`CLOUDFLARE-DEPLOY.md`](../CLOUDFLARE-DEPLOY.md) for worker-specific deployment details beyond the worker variable list below.

## Template ownership

| Surface | Purpose |
| --- | --- |
| `.env.example` | Canonical default Docker-first template |
| `.env.basic.example` | Compatibility alias for the default Docker-first template |
| `.env.cloudflare.example` | Docker template for Cloudflare ingress-oriented setups |
| `server/.env.example` | Advanced compiled source-runtime template |
| `web/.env.example` | Local Vite development template for frontend-only dev proxy settings |
| `cloudflare/workers/allmail-edge/.dev.vars.example` | Local/dev worker-only template |
| `docker-compose.yml` | Real Docker runtime wiring and defaults |
| `server/src/config/env.ts` | Backend validation schema |

## Runtime selection and env resolution

### Docker runtime

The default Docker path reads a repo-root `.env` file and passes values into `docker-compose.yml`.

### Compiled source runtime

`scripts/start-all-mail.mjs` and `bin/all-mail.mjs` resolve env files in this order:

1. `ALL_MAIL_ENV_FILE`
2. `server/.env`
3. repo-root `.env`

The source runtime also applies two important derivations:

- `APP_PORT` can populate `PORT` when `PORT` is absent.
- `DATABASE_URL` can be derived from `POSTGRES_*`.
- `REDIS_URL` can be derived from `REDIS_*`.

Additional runtime helpers consume a few advanced inputs outside the main backend schema:

- `POSTGRES_HOST` and `REDIS_HOST` can override the host used for source-runtime URL derivation.
- `ALL_MAIL_PUBLIC_BASE_URL` is a legacy fallback alias for login URL output when `PUBLIC_BASE_URL` is unset.
- Login URL output resolves in this order: `PUBLIC_BASE_URL` -> `ALL_MAIL_PUBLIC_BASE_URL` -> first `CORS_ORIGIN` entry -> localhost fallback.
- `ALL_MAIL_STATE_DIR` controls where bootstrap/runtime state files are persisted when supported by the calling runtime wrapper.

## Bootstrap-secret behavior

These values may be blank on first boot and then auto-generated:

- `JWT_SECRET`
- `ENCRYPTION_KEY`
- `ADMIN_PASSWORD`

Persistence location depends on runtime:

- Docker: `/var/lib/all-mail/bootstrap-secrets.env`
- Source runtime: defaults to `.all-mail-runtime/bootstrap-secrets.env`; export `ALL_MAIL_STATE_DIR` in the parent shell before launch if you need the bootstrap-secret file written elsewhere.

Source-runtime caveat: `scripts/start-all-mail.mjs` reads `process.env.ALL_MAIL_STATE_DIR` before env-file values are merged. Setting `ALL_MAIL_STATE_DIR` only inside `server/.env` or repo-root `.env` can leave the bootstrap-secret file in the default `.all-mail-runtime` path while child runtimes later honor the merged override.

This repo documents bootstrap generation and persistence. It does not provide a full secret-rotation automation layer.

## Variable groups

### Core runtime and networking

| Variable | Class | Main surfaces | Notes |
| --- | --- | --- | --- |
| `APP_PORT` | optional | `.env.example`, `.env.cloudflare.example`, `docker-compose.yml` | Host port for the main app; source runtime can map it into `PORT` |
| `APP_PUBLISH_HOST` | optional | root templates, `docker-compose.yml` | Docker host bind address for the main app; defaults to `127.0.0.1` so the stack is local-only by default |
| `APP_INTERNAL_PORT` | optional | `.env.example`, `.env.cloudflare.example`, `docker-compose.yml` | Container-internal app port |
| `PORT` | optional | `server/.env.example`, `server/src/config/env.ts` | Backend listen port; defaults to `3000`, Docker sets it from `APP_INTERNAL_PORT`, and the source runtime can also derive it from `APP_PORT` |
| `PUBLIC_BASE_URL` | optional | root templates, `server/.env.example`, `docker-compose.yml`, `scripts/runtime-access.mjs` | Used in first-login output and remote-friendly links; login URL resolution falls back to `ALL_MAIL_PUBLIC_BASE_URL`, then first `CORS_ORIGIN`, then localhost |
| `ALL_MAIL_PUBLIC_BASE_URL` | legacy fallback | runtime helper only | Consumed by `scripts/runtime-access.mjs` when `PUBLIC_BASE_URL` is unset; prefer `PUBLIC_BASE_URL` for new setups |
| `CORS_ORIGIN` | optional | `.env.example`, `.env.basic.example`, `.env.cloudflare.example`, `server/.env.example`, `docker-compose.yml`, `server/src/config/env.ts` | Cross-origin allowance; when `PUBLIC_BASE_URL` and `ALL_MAIL_PUBLIC_BASE_URL` are unset, `scripts/runtime-access.mjs` uses the first listed origin as the login/base URL fallback |
| `ALL_MAIL_STATE_DIR` | advanced runtime override | `docker-compose.yml`, `docker/entrypoint.sh`, `scripts/start-all-mail.mjs`, `server/src/runtime/jobsHealth.ts` | Controls the persisted runtime state directory; Docker defaults to `/var/lib/all-mail`; source-runtime child processes honor the merged env, but bootstrap-secret creation only sees the parent-shell value |

### Database and Redis

| Variable | Class | Main surfaces | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | required for backend runtime | `server/.env.example`, `docker-compose.yml`, `server/src/config/env.ts` | Source runtime may derive it from `POSTGRES_*` |
| `POSTGRES_USER` | optional (Docker path) | `.env.example`, `.env.cloudflare.example`, `docker-compose.yml` | Used to build Docker `DATABASE_URL` |
| `POSTGRES_PASSWORD` | optional (Docker path) | `.env.example`, `.env.cloudflare.example`, `docker-compose.yml` | Used to build Docker `DATABASE_URL` |
| `POSTGRES_DB` | optional (Docker path) | `.env.example`, `.env.cloudflare.example`, `docker-compose.yml` | Used to build Docker `DATABASE_URL` |
| `POSTGRES_PUBLISH_HOST` | optional | root templates, `docker-compose.yml` | Docker host bind address for PostgreSQL; defaults to `127.0.0.1` |
| `POSTGRES_PORT` | optional | `.env.example`, `.env.cloudflare.example`, `scripts/start-all-mail.mjs` | Host-facing PostgreSQL port; source runtime may use it for derivation |
| `POSTGRES_INTERNAL_PORT` | optional | `.env.example`, `.env.cloudflare.example`, `docker-compose.yml`, `scripts/start-all-mail.mjs` | Internal PostgreSQL port |
| `POSTGRES_HOST` | advanced source-runtime override | `scripts/start-all-mail.mjs`, `bin/all-mail.mjs` | Overrides the host used when deriving `DATABASE_URL` from `POSTGRES_*`; defaults to `127.0.0.1` |
| `REDIS_URL` | optional | `server/.env.example`, `docker-compose.yml`, `server/src/config/env.ts` | Source runtime may derive it from `REDIS_*` |
| `REDIS_PUBLISH_HOST` | optional | root templates, `docker-compose.yml` | Docker host bind address for Redis; defaults to `127.0.0.1` |
| `REDIS_PORT` | optional | `.env.example`, `.env.cloudflare.example`, `scripts/start-all-mail.mjs` | Host-facing Redis port |
| `REDIS_INTERNAL_PORT` | optional | `.env.example`, `.env.cloudflare.example`, `docker-compose.yml`, `scripts/start-all-mail.mjs` | Internal Redis port |
| `REDIS_HOST` | advanced source-runtime override | `scripts/start-all-mail.mjs`, `bin/all-mail.mjs` | Overrides the host used when deriving `REDIS_URL` from `REDIS_*`; defaults to `127.0.0.1` |
| `ALLOW_LOCAL_RATE_LIMIT_FALLBACK` | feature-gated | root templates, `server/.env.example`, `docker-compose.yml`, `server/src/config/env.ts` | Defaults to `false`; affects degraded Redis behavior |

### Security and bootstrap

| Variable | Class | Main surfaces | Notes |
| --- | --- | --- | --- |
| `JWT_SECRET` | required at runtime, bootstrap-auto-generated if blank | root templates, `server/.env.example`, `docker-compose.yml`, `server/src/config/env.ts` | Must satisfy backend length validation after generation |
| `JWT_EXPIRES_IN` | optional | `server/.env.example`, `docker-compose.yml`, `server/src/config/env.ts` | Defaults to `2h` |
| `ENCRYPTION_KEY` | required at runtime, bootstrap-auto-generated if blank | root templates, `server/.env.example`, `docker-compose.yml`, `server/src/config/env.ts` | Backend expects length 32 |
| `ADMIN_USERNAME` | optional | root templates, `server/.env.example`, `docker-compose.yml`, `server/src/config/env.ts` | Defaults to `admin` |
| `ADMIN_PASSWORD` | required at runtime, bootstrap-auto-generated if blank | root templates, `server/.env.example`, `docker-compose.yml`, `server/src/config/env.ts` | Production cannot use the backend default value |
| `ADMIN_LOGIN_MAX_ATTEMPTS` | optional | root templates, `server/.env.example`, `docker-compose.yml`, `server/src/config/env.ts` | Default `5` |
| `ADMIN_LOGIN_LOCK_MINUTES` | optional | root templates, `server/.env.example`, `docker-compose.yml`, `server/src/config/env.ts` | Default `15` |
| `ADMIN_2FA_SECRET` | feature-gated | `server/.env.example`, `docker-compose.yml`, `server/src/config/env.ts` | Optional Base32 TOTP secret, minimum length 16 |
| `ADMIN_2FA_WINDOW` | feature-gated | `server/.env.example`, `docker-compose.yml`, `server/src/config/env.ts` | Default `1`, valid range `0..5` |

### Domain/send/logging/worker behavior

| Variable | Class | Main surfaces | Notes |
| --- | --- | --- | --- |
| `DOMAIN_BOOTSTRAP_ADMIN_USERNAME` | feature-gated | `.env.cloudflare.example`, `server/.env.example`, `docker-compose.yml`, `server/src/config/env.ts` | Optional bootstrap helper for domain flows |
| `DOMAIN_BOOTSTRAP_ADMIN_PASSWORD` | feature-gated | `.env.cloudflare.example`, `server/.env.example`, `docker-compose.yml`, `server/src/config/env.ts` | Optional, minimum length 8 |
| `SEND_ENABLED_DOMAINS` | feature-gated | `.env.cloudflare.example`, `server/.env.example`, `docker-compose.yml`, `server/src/config/env.ts` | Optional allowlist-style setting |
| `API_LOG_RETENTION_DAYS` | optional | root templates, `server/.env.example`, `docker-compose.yml`, `server/src/config/env.ts` | Default `30` |
| `API_LOG_CLEANUP_INTERVAL_MINUTES` | optional | root templates, `server/.env.example`, `docker-compose.yml`, `server/src/config/env.ts` | Default `60` |
| `FORWARDING_WORKER_INTERVAL_SECONDS` | optional | root templates, `server/.env.example`, `docker-compose.yml`, `server/src/config/env.ts` | Default `30` |
| `FORWARDING_WORKER_BATCH_SIZE` | optional | root templates, `server/.env.example`, `docker-compose.yml`, `server/src/config/env.ts` | Default `10` |

### Ingress and Cloudflare-related settings

| Variable | Class | Main surfaces | Notes |
| --- | --- | --- | --- |
| `INGRESS_SIGNING_SECRET` | feature-gated | `.env.example`, `.env.basic.example`, `.env.cloudflare.example`, `server/.env.example`, worker `.dev.vars.example`, `docker-compose.yml`, `server/src/config/env.ts` | Shared secret between backend and worker ingress signer; replace the shipped placeholder with a real value on both sides because it is not bootstrap-managed, and startup now fails fast if a placeholder is left in place |
| `INGRESS_ALLOWED_SKEW_SECONDS` | feature-gated | `.env.cloudflare.example`, `server/.env.example`, `docker-compose.yml`, `server/src/config/env.ts` | Default `300`, minimum `30` |
| `INGRESS_URL` | feature-gated | worker `.dev.vars.example` | Worker target URL for signed delivery |
| `INGRESS_KEY_ID` | feature-gated | worker `.dev.vars.example` | Worker signing key identifier |
| `INGRESS_PROVIDER` | feature-gated | worker `.dev.vars.example` | Worker ingress provider label |
| `RAW_EMAIL_OBJECT_PREFIX` | feature-gated | worker `.dev.vars.example` | Worker-side raw email object prefix |
| `RAW_EMAIL_BUCKET_NAME` | feature-gated | worker `.dev.vars.example` | Worker-side R2 bucket name |

### Provider OAuth settings

| Variable | Class | Main surfaces | Notes |
| --- | --- | --- | --- |
| `GOOGLE_OAUTH_CLIENT_ID` | feature-gated | root templates, `server/.env.example`, `docker-compose.yml`, `server/src/config/env.ts` | Optional provider-side credential |
| `GOOGLE_OAUTH_CLIENT_SECRET` | feature-gated | root templates, `server/.env.example`, `docker-compose.yml`, `server/src/config/env.ts` | Optional provider-side credential |
| `GOOGLE_OAUTH_REDIRECT_URI` | feature-gated | root templates, `server/.env.example`, `docker-compose.yml`, `server/src/config/env.ts` | Must be a URL when set |
| `GOOGLE_OAUTH_SCOPES` | feature-gated | root templates, `server/.env.example`, `docker-compose.yml`, `server/src/config/env.ts` | Optional scope override |
| `MICROSOFT_OAUTH_CLIENT_ID` | feature-gated | root templates, `server/.env.example`, `docker-compose.yml`, `server/src/config/env.ts` | Optional provider-side credential |
| `MICROSOFT_OAUTH_CLIENT_SECRET` | feature-gated | root templates, `server/.env.example`, `docker-compose.yml`, `server/src/config/env.ts` | Optional provider-side credential |
| `MICROSOFT_OAUTH_REDIRECT_URI` | feature-gated | root templates, `server/.env.example`, `docker-compose.yml`, `server/src/config/env.ts` | Must be a URL when set |
| `MICROSOFT_OAUTH_TENANT` | feature-gated | root templates, `server/.env.example`, `docker-compose.yml`, `server/src/config/env.ts` | Optional tenant override |
| `MICROSOFT_OAUTH_SCOPES` | feature-gated | root templates, `server/.env.example`, `docker-compose.yml`, `server/src/config/env.ts` | Optional scope override |

## Notes on template coverage

Not every runtime variable appears in every example file.

- Root templates focus on Docker-first onboarding and now include the localhost-only Docker publish-host defaults.
- `.env.basic.example` is a compatibility alias, not a separate runtime contract.
- `server/.env.example` focuses on the advanced compiled source runtime.
- `web/.env.example` only configures local frontend dev proxy behavior.
- The worker `.dev.vars.example` only covers worker-local variables.
- `docker-compose.yml` is currently the most complete Docker runtime truth surface for several feature-gated variables.

Use this guide together with the owning template instead of assuming one example file covers every deployment mode.
