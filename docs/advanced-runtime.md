# Local development runtime guide

## Boundary

Production uses Docker Compose. This guide covers only local development surfaces:

- the Fastify compatibility business API;
- the Vite React frontend;
- optional Dockerized PostgreSQL and Redis dependencies;
- repository verification commands.

There is no Node production jobs runtime, no Node SPA server, and no source command that reproduces the full production topology. Use [`DEPLOY.md`](./DEPLOY.md) for production.

## Appropriate uses

- develop or debug Fastify business routes;
- iterate on OAuth/provider behavior;
- develop the React UI against a local API;
- inspect existing PostgreSQL data in a controlled environment;
- run lint, tests and builds before opening a PR.

Do not treat API-only development success as proof that the Go listener, forwarding worker, retention worker or one-shot migration chain is healthy.

## Prerequisites

| Dependency | Required | Notes |
| --- | --- | --- |
| Node.js 20+ | Yes | Fastify and React development |
| PostgreSQL | Yes for API work | `DATABASE_URL` is required |
| Redis | Strongly recommended | OAuth, replay and rate-limit behavior depends on it |
| Go 1.23+ | Yes for Go development | Listener, workers and migration tests |

## Start PostgreSQL and Redis only

```bash
docker compose up -d postgres redis
```

Stop them without deleting data:

```bash
docker compose stop postgres redis
```

The repository CLI exposes equivalent helpers:

```bash
./bin/all-mail deps up
./bin/all-mail deps down
```

## Fastify business-API development

```bash
cp server/.env.example server/.env
npm --prefix server install
npm run dev:api
```

The default development API port is `3000`. This process:

- serves JSON business routes only;
- does not serve the React SPA;
- does not run forwarding or retention;
- does not run the canonical `legacy-init -> go-migrate` production sequence.

Apply Prisma migrations intentionally before API development when required:

```bash
npm --prefix server run db:migrate
```

P3005 and P3009 remain database recovery events. The production one-shot repair switch belongs to Docker `legacy-init`, not to a standing local development command.

## React development

```bash
npm --prefix web install --legacy-peer-deps
npm run dev:web
```

Configure `web/.env` from `web/.env.example` so the Vite proxy targets the local API or the public Go listener you are testing.

## Go development

```bash
cd core
test -z "$(gofmt -l .)"
go test -race ./...
go vet ./...
go build -trimpath ./cmd/allmail
```

Run a single Go component only when its dependencies are configured:

```bash
allmail api
allmail worker forwarding
allmail worker retention
allmail migrate
```

For production-equivalent process ownership and secret mounts, use Docker Compose instead of manually launching all binaries.

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

API/frontend development checks:

```bash
npm run test:runtime
npm run test:server
npm run test:web
npm run lint
npm run build
```

Full repository gate:

```bash
./bin/all-mail check
```

Production-equivalent smoke:

```bash
cp .env.example .env
docker compose up -d --build --wait --wait-timeout 240
docker compose exec -T app allmail doctor api
docker compose exec -T worker-forwarding allmail doctor worker forwarding
docker compose exec -T worker-retention allmail doctor worker retention
docker compose down
```

CI remains the authoritative evidence because it also exercises real PostgreSQL forwarding transitions, migrations and the complete Docker startup chain.
