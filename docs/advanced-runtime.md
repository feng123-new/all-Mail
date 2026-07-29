# Local development runtime guide

## Boundary

Production uses `docker-compose.yml` by itself. This guide covers only local development surfaces:

- the Fastify compatibility business API;
- the Vite React frontend;
- PostgreSQL and Redis published through `docker-compose.dev.yml`;
- repository verification commands.

There is no Node production jobs runtime, Node SPA server, or source command that reproduces the full production topology. Use [`DEPLOY.md`](./DEPLOY.md) for production.

## Appropriate uses

- develop or debug Fastify business routes;
- iterate on OAuth/provider behavior;
- develop the React UI against a local API;
- inspect PostgreSQL data in a controlled environment;
- run lint, tests and builds before review.

API-only development success is not proof that the Go gateway, forwarding worker, retention worker, proxy trust boundary, or one-shot migration chain is healthy.

## Prerequisites

| Dependency | Required | Notes |
| --- | --- | --- |
| Node.js 20+ | Yes | Fastify and React development |
| Docker Compose | Recommended | Local PostgreSQL/Redis overlay |
| Go 1.23+ | Yes for Go work | Gateway, workers and migration tests |

## Start PostgreSQL and Redis

Production keeps these services private. Local development publishes them explicitly:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis
```

Defaults:

```text
PostgreSQL 127.0.0.1:15433
Redis      127.0.0.1:6380
```

Stop without deleting data:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml stop postgres redis
```

Equivalent helpers:

```bash
./bin/all-mail deps up
./bin/all-mail deps down
```

Override local host ports only with:

```env
DEV_POSTGRES_PORT=15433
DEV_REDIS_PORT=6380
```

## Fastify business-API development

```bash
cp server/.env.example server/.env
npm --prefix server install
npm run dev:api
```

The default API port is `3000`. This process:

- serves JSON business routes only;
- does not serve the React SPA;
- does not run forwarding or retention;
- does not run the canonical `legacy-init -> go-migrate` production sequence;
- receives traffic directly, so local tests should not assume the production one-hop Go proxy unless the Go gateway is also running.

Apply Prisma migrations intentionally when required:

```bash
npm --prefix server run db:migrate
```

P3005 and P3009 remain recovery events. The production repair switch belongs to an explicit Docker `legacy-init` invocation, not a standing local configuration.

## React development

```bash
npm --prefix web install
npm run dev:web
```

Configure `web/.env` from `web/.env.example` so the Vite proxy targets the local Fastify API or the public Go gateway being tested.

## Go development

```bash
cd core
test -z "$(gofmt -l .)"
go test -race ./...
go vet ./...
go build -trimpath ./cmd/allmail
```

Run a component only when its owned dependencies are configured:

```bash
allmail api
allmail worker forwarding
allmail worker retention
allmail migrate
```

The forwarding command requires `ENCRYPTION_KEY_FILE`; direct `ENCRYPTION_KEY` and legacy bootstrap-file fallback are intentionally unsupported.

For proxy tests, set `TRUSTED_PROXY_CIDRS` only when a known reverse proxy connects directly to the listener. Direct local access should normally leave it empty.

## Repository CLI

```bash
all-mail install
all-mail build
all-mail doctor --env-file /path/to/.env
all-mail deps up
all-mail deps down
all-mail check
all-mail setup
```

The CLI intentionally has no `start`, `up`, `deploy`, or jobs-rollback command. This prevents a second production topology from drifting beside Docker Compose.

## Verification

```bash
npm run test:runtime
npm run test:server
npm run test:web
npm run lint
npm run build
./bin/all-mail check
```

Production-equivalent smoke:

```bash
cp .env.example .env
docker compose config --quiet
docker compose -f docker-compose.yml -f docker-compose.dev.yml config --quiet
docker compose up -d --build --wait --wait-timeout 240
docker compose exec -T app allmail doctor api
docker compose exec -T worker-forwarding allmail doctor worker forwarding
docker compose exec -T worker-retention allmail doctor worker retention
docker compose down
```

CI remains authoritative because it also exercises real PostgreSQL forwarding transitions, migrations, proxy-header rejection, and the complete Docker startup chain.
