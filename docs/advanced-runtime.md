# Advanced source runtime guide

## Boundary

This document covers the secondary Node source-runtime path.

It starts:

- the compiled Fastify API;
- the compiled Node jobs process;
- optional Dockerized PostgreSQL and Redis dependencies.

It does **not** start or validate:

- the Go public listener;
- Go readiness;
- Go forwarding;
- Go API-log retention;
- the canonical one-shot `legacy-init -> go-migrate` sequence.

Use [`DEPLOY.md`](./DEPLOY.md) for the supported production topology.

## Appropriate uses

Use this path for:

- Fastify business API development;
- debugging legacy provider/OAuth behavior;
- compatibility testing against an existing PostgreSQL database;
- running the API outside Docker while iterating locally.

Do not use source-runtime success as release evidence for the Go migration bridge.

## Prerequisites

| Dependency | Required | Notes |
| --- | --- | --- |
| Node.js 20+ | Yes | Builds/runs Fastify, React and compatibility jobs |
| PostgreSQL | Yes | `DATABASE_URL` is required |
| Redis | Strongly recommended | Missing/degraded Redis changes OAuth, replay and rate-limit behavior |
| Env file | Yes | `server/.env` or root `.env` |

Env resolution order:

1. `ALL_MAIL_ENV_FILE`;
2. `server/.env`;
3. root `.env`.

Derivations:

- `APP_PORT` can populate `PORT`;
- `POSTGRES_*` can populate `DATABASE_URL`;
- `REDIS_*` can populate `REDIS_URL`;
- login output resolves `PUBLIC_BASE_URL`, then `ALL_MAIL_PUBLIC_BASE_URL`, then the first `CORS_ORIGIN`, then localhost.

`ALL_MAIL_STATE_DIR` may be set in the selected env file or parent environment. It controls the initial bootstrap-secret path as well as child runtime state.

## Hybrid mode

Keep PostgreSQL and Redis in Docker while running the Node application from source:

```bash
docker compose up -d postgres redis
./bin/all-mail install
./bin/all-mail build
./bin/all-mail start
```

The startup script prints an explicit warning that this is not the canonical Go topology.

## External infrastructure mode

```bash
cp server/.env.example server/.env
./bin/all-mail install
./bin/all-mail build
./bin/all-mail start
```

Update OAuth callback URIs when changing `PORT`.

## CLI commands

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

`all-mail up --docker-deps` starts only PostgreSQL and Redis through Compose, then runs the Node source topology.

## Source-runtime verification

```bash
all-mail doctor --env-file /path/to/.env
curl http://127.0.0.1:3000/health
```

This doctor checks source env resolution, TCP reachability and build artifacts. It does not call the Go `allmail doctor api|jobs` commands.

For full repository verification:

```bash
./bin/all-mail check
```

CI remains the preferred proof for the canonical Docker stack.

## Migration safety

The source runtime runs Prisma migrations before starting Fastify and Node jobs.

Prisma P3005 no longer automatically triggers `db push`. After reviewing and backing up the database, enable the compatibility path for one intentional run only:

```bash
ALL_MAIL_ALLOW_LEGACY_DB_PUSH_REPAIR=true ./bin/all-mail start
```

Do not persist that flag as a normal production setting.

P3009 requires manual recovery.

## Bootstrap secrets

Source-generated secrets default to:

```text
.all-mail-runtime/bootstrap-secrets.env
```

Override with `ALL_MAIL_STATE_DIR` in the active env file or parent environment.

The password stays out of stdout unless `ALL_MAIL_PRINT_BOOTSTRAP_PASSWORD=true` is explicitly set.

## Deprecation direction

The source runtime exists because Fastify business routes are not yet ported. After business API migration and Node jobs deletion, this path should be reduced to development-only Fastify execution or removed entirely. The deletion gates are documented in [`internal/rewrite/runtime-consolidation-plan.md`](./internal/rewrite/runtime-consolidation-plan.md).
