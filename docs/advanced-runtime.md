# Advanced Runtime Guide

## Boundary

This document covers the **secondary** runtime paths for `all-Mail`.

- Use [`docs/DEPLOY.md`](./DEPLOY.md) for the canonical Docker-first deployment path.
- Use [`docs/ENVIRONMENT.md`](./ENVIRONMENT.md) for variable meaning and template ownership.
- Use [`docs/RUNBOOK.md`](./RUNBOOK.md) for troubleshooting and recovery.
- Use this file only when you intentionally run the compiled app outside the main Docker app container.

## When to use this guide

Use this guide only when you need one of these advanced modes:

- run the app itself outside Docker
- keep PostgreSQL / Redis in Docker but run the app from source
- use the repository-level `all-mail` CLI for source-based startup

If you just want the supported default path, go back to the root `README.md` and use Docker Compose.

## Runtime prerequisites

Direct npm/CLI runtime still expects external infrastructure:

| Dependency | Required | Why |
| --- | --- | --- |
| PostgreSQL | Yes | `DATABASE_URL` is mandatory in `server/src/config/env.ts`, and startup exits if Prisma cannot connect |
| Redis | Recommended | `REDIS_URL` is optional, but degraded Redis affects caching, OAuth state, and rate-limit behavior |

You also need a real env file.

Env resolution order for `scripts/start-all-mail.mjs` and `bin/all-mail.mjs` is:

1. `ALL_MAIL_ENV_FILE`
2. `server/.env`
3. repo-root `.env`

Important derivations:

- `APP_PORT` can populate `PORT` when `PORT` is absent.
- `POSTGRES_*` can be used to derive `DATABASE_URL`.
- `REDIS_*` can be used to derive `REDIS_URL`.
- Login URL output resolves `PUBLIC_BASE_URL` -> `ALL_MAIL_PUBLIC_BASE_URL` -> first `CORS_ORIGIN` entry -> localhost fallback.

## Source-runtime options

### 1. Hybrid mode

Keep PostgreSQL + Redis in Docker, but run the app from source:

```bash
docker compose up -d postgres redis
./bin/all-mail install
./bin/all-mail build
./bin/all-mail start
```

This is the simplest non-default path when you want app logs and source control outside the app container while still using Compose for dependencies.

### 2. Direct source runtime with your own services

If PostgreSQL and Redis already exist outside Docker:

```bash
cp server/.env.example server/.env
./bin/all-mail install
./bin/all-mail build
./bin/all-mail start
```

If you keep the default `PORT=3000`, the callback URI defaults in `server/.env.example` already match that source-runtime port. If you change `PORT`, update the provider OAuth callback URIs in the same file as well.

### 3. Global CLI runtime

You can install the repository as a source-based global CLI from a local clone:

```bash
npm install -g /path/to/all-Mail
```

Common commands:

```bash
all-mail setup
all-mail install
all-mail build
all-mail doctor --env-file /path/to/.env
all-mail deps up
all-mail up --docker-deps --env-file /path/to/.env --port 3102
all-mail start --env-file /path/to/.env --port 3102
all-mail deploy --env-file /path/to/.env --port 3102
all-mail check
```

### 4. Near one-click hybrid startup

If you want the app outside Docker, but still want PostgreSQL + Redis prepared automatically:

```bash
all-mail up --docker-deps --env-file /path/to/.env --port 3102
```

That command:

1. runs `docker compose up -d postgres redis`
2. installs/builds the app only if required artifacts are missing
3. starts `all-Mail` through the same source-runtime path

## Verification and health checks

Source-runtime-specific readiness check:

```bash
all-mail doctor --env-file /path/to/.env
```

Repo-root verification entrypoints remain the canonical release contract when you are working from the repository:

```bash
./bin/all-mail doctor
./bin/all-mail check
```

- `./bin/all-mail doctor` checks env resolution, PostgreSQL reachability, Redis reachability, and required build artifacts.
- `./bin/all-mail check` runs the full local release gate.
- If your shell exports `NODE_USE_ENV_PROXY` or `HTTP[S]_PROXY`, these `./bin/all-mail ...` entrypoints avoid noisy `UNDICI-EHPA` startup warnings by sanitizing the env before Node/npm bootstraps.

Basic HTTP health probe after startup:

```bash
curl http://127.0.0.1:3000/health
```

If you changed `PORT`, replace `3000` accordingly.

## Root scripts reference

- `./bin/all-mail install` → installs nested `server`, `web`, and worker dependencies through the sanitized CLI wrapper
- `./bin/all-mail build` → builds `server`, builds `web`, and copies `web/dist` into repo-root `public/`
- `./bin/all-mail start` → starts the compiled server and reuses the same Prisma migration fallback logic as the Docker entrypoint
- `./bin/all-mail deploy` → convenience wrapper for `build + start`

## Migration and bootstrap notes

- `scripts/start-all-mail.mjs` follows the same Prisma migration/deploy fallback behavior as `docker/entrypoint.sh`.
- Bootstrap-generated secrets default to `.all-mail-runtime/bootstrap-secrets.env` for the source runtime. Export `ALL_MAIL_STATE_DIR` before launch if you need the bootstrap-secret file written elsewhere; setting it only inside the env file affects later child runtimes but not the initial bootstrap-secret write.
- `P3009` is not auto-recovered. Treat it as a manual recovery event and use [`docs/RUNBOOK.md`](./RUNBOOK.md).

## Important caveat

This is still a **source-based runtime**, not a zero-dependency desktop-style package. You are responsible for env configuration and for keeping PostgreSQL / Redis reachable outside the `all-Mail` process.
