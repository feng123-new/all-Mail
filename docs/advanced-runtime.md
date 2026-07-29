# Local development runtime guide

## Boundary

Production uses `docker-compose.yml`. This guide covers local Fastify/React/Go development with PostgreSQL and Redis published by `docker-compose.dev.yml`.

There is no Node production jobs runtime, Node SPA server, environment administrator, or source command that reproduces the full production topology.

## Start dependencies

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis
```

Defaults:

```text
PostgreSQL 127.0.0.1:15433
Redis      127.0.0.1:6380
```

Equivalent:

```bash
./bin/all-mail deps up
./bin/all-mail deps down
```

## Fastify business-API development

```bash
cp server/.env.example server/.env
npm --prefix server install
npm --prefix server run db:migrate
```

A fresh database needs one explicit one-shot administrator bootstrap:

```bash
ADMIN_USERNAME=admin \
ADMIN_PASSWORD=change-me-now \
BOOTSTRAP_ADMIN_SECRET_FILE=.all-mail-runtime/bootstrap-admin.env \
npm --prefix server run bootstrap:admin
```

Then start the API:

```bash
npm run dev:api
```

The long-running API:

- serves JSON business routes only;
- does not serve React;
- does not run workers or migrations;
- does not create administrators;
- does not receive administrator credentials;
- authenticates database administrators only;
- may remove `BOOTSTRAP_ADMIN_SECRET_FILE` after successful initial rotation.

Do not add `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `DOMAIN_BOOTSTRAP_ADMIN_*`, or `ADMIN_2FA_SECRET` to `server/.env`.

## Bootstrap development scenarios

### Generated password

```bash
ADMIN_USERNAME=admin \
ADMIN_PASSWORD= \
BOOTSTRAP_ADMIN_SECRET_FILE=.all-mail-runtime/bootstrap-admin.env \
npm --prefix server run bootstrap:admin
```

Read the protected file, log in, and change the password. A successful first rotation removes it.

### Idempotency

Running the command again when an administrator exists must not create a second row or modify the existing hash.

### Old combined-file migration

Docker `legacy-init` automatically migrates `bootstrap-secrets.env`. For local testing, run `scripts/bootstrap-secrets.mjs` against an isolated state directory before `bootstrap:admin` and verify:

```text
runtime-secrets.env
bootstrap-admin.env
```

exist and the old combined file is gone.

## React development

```bash
npm --prefix web install
npm run dev:web
```

Configure `web/.env` so Vite targets local Fastify or the Go gateway under test.

## Go development

```bash
cd core
test -z "$(gofmt -l .)"
go test -race ./...
go vet ./...
go build -trimpath ./cmd/allmail
```

Components:

```bash
allmail api
allmail worker forwarding
allmail worker retention
allmail migrate
```

Forwarding requires `ENCRYPTION_KEY_FILE`. Direct key environment and legacy bootstrap-bundle fallback are unsupported.

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

There is intentionally no source production `start`, `up`, `deploy`, or rollback worker command.

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
docker compose up -d --build --wait --wait-timeout 300
docker compose exec -T legacy-api sh -lc \
  'test -z "${ADMIN_USERNAME:-}" && test -z "${ADMIN_PASSWORD:-}"'
docker compose exec -T app allmail doctor api
docker compose exec -T worker-forwarding allmail doctor worker forwarding
docker compose exec -T worker-retention allmail doctor worker retention
docker compose down
```

CI additionally exercises real PostgreSQL bootstrap idempotency and the full Docker login/password-rotation/plaintext-deletion flow.
