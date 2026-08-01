# Local development runtime guide

## Boundary

Production uses `docker-compose.yml` through `./scripts/compose-up.sh`. This guide covers Go and React source development with PostgreSQL and Redis published by `docker-compose.dev.yml`.

Local source processes are intentionally explicit and do not reproduce the complete production topology.

## Start dependencies

```bash
./bin/all-mail deps up
```

Equivalent Compose command:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis
```

Defaults:

```text
PostgreSQL 127.0.0.1:15433
Redis      127.0.0.1:6380
```

Stop them with:

```bash
./bin/all-mail deps down
```

## Initialize local state

Choose an isolated local state directory and export least-privilege secret files while initializing:

```bash
(cd core && \
  DATABASE_URL='postgresql://allmail:<password>@127.0.0.1:15433/allmail' \
  ALL_MAIL_MIGRATION_DIR="$PWD/migrations" \
  ALL_MAIL_STATE_DIR="$PWD/../.all-mail-runtime" \
  ALL_MAIL_EXPORT_JWT_SECRET_FILE="$PWD/../.all-mail-runtime/jwt-secret" \
  ALL_MAIL_EXPORT_ENCRYPTION_KEY_FILE="$PWD/../.all-mail-runtime/encryption-key" \
  ADMIN_USERNAME=admin \
  ADMIN_PASSWORD=change-me-now \
  go run ./cmd/allmail init)
```

This creates or adopts the schema, writes managed secrets under `.all-mail-runtime/`, imports any supplied one-shot configuration, and creates the first administrator idempotently.

Do not commit `.all-mail-runtime/`, copy its values into source-controlled files, or reuse it across unrelated databases.

### Generated password

Set `ADMIN_PASSWORD=` to generate a temporary credential. Read `.all-mail-runtime/bootstrap-admin.env`, log in, and change the password. Successful rotation removes the file.

### Idempotency

Running `allmail init` again against the same database and state directory must not create a second administrator or change persisted secret values.

### Old combined-file migration

`allmail init` migrates a historical `bootstrap-secrets.env` in the selected state directory into:

```text
runtime-secrets.env
bootstrap-admin.env
```

and removes the combined file after successful export. This is upgrade compatibility only.

## Run the private Go API

```bash
(cd core && \
  NODE_ENV=development \
  PORT=3200 \
  DATABASE_URL='postgresql://allmail:<password>@127.0.0.1:15433/allmail' \
  REDIS_URL='redis://127.0.0.1:6380' \
  JWT_SECRET_FILE="$PWD/../.all-mail-runtime/jwt-secret" \
  ENCRYPTION_KEY_FILE="$PWD/../.all-mail-runtime/encryption-key" \
  BOOTSTRAP_ADMIN_SECRET_FILE="$PWD/../.all-mail-runtime/bootstrap-admin.env" \
  go run ./cmd/allmail business-api)
```

`npm run dev:api` runs the same Go command but expects these environment variables to already be exported.

The process serves JSON business routes only. It does not serve React, run workers, migrate schema, generate secrets, or create administrators.

## Run the public app locally

Build the SPA first:

```bash
npm run build:web
```

With the private API running on port 3200:

```bash
(cd core && \
  PORT=3000 \
  ALL_MAIL_STATIC_DIR="$PWD/../web/dist" \
  ALL_MAIL_ROUTE_OWNERSHIP_FILE="$PWD/../config/route-ownership.json" \
  GO_BUSINESS_API_URL='http://127.0.0.1:3200' \
  go run ./cmd/allmail api)
```

Then use `http://127.0.0.1:3000`.

## React development

```bash
npm --prefix web install
npm run dev:web
```

Configure `web/.env` so Vite targets the local public Go app. Browser traffic should use the public gateway rather than the private API directly.

## Workers

Run workers in separate shells with the local database and exported encryption key:

```bash
(cd core && \
  DATABASE_URL='postgresql://allmail:<password>@127.0.0.1:15433/allmail' \
  ENCRYPTION_KEY_FILE="$PWD/../.all-mail-runtime/encryption-key" \
  ALL_MAIL_STATE_DIR="$PWD/../.all-mail-worker" \
  go run ./cmd/allmail worker forwarding)
```

```bash
(cd core && \
  DATABASE_URL='postgresql://allmail:<password>@127.0.0.1:15433/allmail' \
  ALL_MAIL_STATE_DIR="$PWD/../.all-mail-worker" \
  go run ./cmd/allmail worker retention)
```

Forwarding accepts only `ENCRYPTION_KEY_FILE`; direct raw-key and combined-file fallbacks are unsupported.

## Go verification

```bash
cd core
test -z "$(gofmt -l .)"
go test -race ./...
go vet ./...
go build -trimpath ./cmd/allmail
```

Go runtime commands:

```text
allmail api
allmail business-api
allmail routes
allmail worker forwarding
allmail worker retention
allmail init
allmail migrate
allmail doctor api
allmail doctor business-api
allmail doctor worker forwarding
allmail doctor worker retention
```

## Repository CLI

```text
all-mail install
all-mail build
all-mail doctor [--env-file <path>]
all-mail deps up|down
all-mail check
all-mail setup
```

The repository CLI manages development dependencies and verification. Production startup remains `./scripts/compose-up.sh`.

## Production smoke

```bash
cp .env.example .env
docker compose config --quiet
docker compose -f docker-compose.yml -f docker-compose.dev.yml config --quiet
./scripts/compose-up.sh
docker compose exec -T app allmail doctor api
docker compose exec -T go-business-api allmail doctor business-api
docker compose exec -T worker-forwarding allmail doctor worker forwarding
docker compose exec -T worker-retention allmail doctor worker retention
docker compose down
```

Use disposable credentials and volumes for local smoke work. Do not use `docker compose down -v` against a deployment whose state must be retained.
