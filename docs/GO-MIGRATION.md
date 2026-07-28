# Go migration bridge

## Status and scope

The `agent/go-core-rewrite` branch is a runnable migration foundation. It is not a full replacement for the Fastify/Prisma backend yet.

Current request flow:

```text
Browser / automation / Cloudflare Worker
                  |
             Go public API
              /       \
        React SPA    legacy API proxy
                         |
                 existing Fastify modules
```

The Go process owns the public listener, SPA delivery, request IDs, security headers, liveness/readiness endpoints, metrics, the explicit Go migration command, API-log retention, forwarding execution, and the new runtime table contracts. Existing Fastify modules remain the authoritative writers for other current application state.

## Default service layout

```text
app            Go public API and migration bridge
go-jobs        Go API-log retention and forwarding workers
legacy-api     Fastify/Prisma business API
jobs           legacy maintenance runtime and forwarding rollback owner
postgres       shared application database
redis          OAuth state, rate-limit, replay and cache backend
```

`go-jobs` owns API-log retention and forwarding by default and writes one health heartbeat with per-worker state. The legacy `jobs` service remains running for maintenance and rollback. Separate owner switches keep both capabilities single-writer.

## Local workflow

```bash
git fetch origin
git switch agent/go-core-rewrite
cp .env.example .env
docker compose up -d --build --wait --wait-timeout 240
curl --fail http://127.0.0.1:3002/health
curl --fail http://127.0.0.1:3002/readyz
```

The one-shot `go-migrate` service runs automatically after the legacy schema is healthy and before `app` or `go-jobs` starts. It can also be run explicitly:

```bash
docker compose run --rm go-migrate
```

The API and long-running jobs runtimes never mutate the Go schema during startup.

The secondary source-runtime path applies `202607281200_forwarding_claim_lease_v1` through Prisma so the legacy rollback worker has the same claim-token and lease columns even when the Go migration command is not part of that launch path.

## Readiness contract

`GO_API_MODE=bridge` is the default and requires all of the following:

- `DATABASE_URL`
- `REDIS_URL`
- `LEGACY_API_URL`

The Go `/readyz` endpoint performs protocol-level checks:

- PostgreSQL: executes `SELECT current_database()` through `psql`, proving protocol, authentication and target database access.
- Redis: performs RESP `AUTH` when configured, optional `SELECT`, and `PING`, and requires `PONG`.
- Legacy API: calls `/readyz`, requires HTTP 200, `success: true`, and `data.status: ready`.

A missing required dependency returns HTTP 503 with `required-but-not-configured`. A process listening on the PostgreSQL or Redis port without speaking the correct protocol is not accepted.

`GO_API_MODE=static` is an explicit frontend-only mode. It requires a built `index.html` and deliberately returns `GO_ROUTE_NOT_MIGRATED` for backend paths.

## API-log retention ownership

The first real background capability migrated to Go is API-log retention.

- `API_LOG_RETENTION_OWNER=go` enables the Go cleaner and disables the legacy Node cleaner.
- `API_LOG_RETENTION_OWNER=legacy` provides a rollback switch without changing the database.
- the Go cleaner deletes a bounded batch ordered by log ID;
- a PostgreSQL advisory transaction lock prevents concurrent cleaners from processing the same interval;
- heartbeat metadata records the last run, last success, deleted count and last error;
- `allmail doctor jobs` fails when the enabled worker's latest run failed.

Configuration:

```text
API_LOG_RETENTION_OWNER=go
API_LOG_RETENTION_DAYS=30
API_LOG_CLEANUP_INTERVAL_MINUTES=60
API_LOG_CLEANUP_BATCH_SIZE=5000
```

## Forwarding ownership

- `FORWARDING_WORKER_OWNER=go` enables Go claim/send/update and disables the Node writer.
- `FORWARDING_WORKER_OWNER=legacy` rolls claims back to Node.
- `FORWARDING_WORKER_OWNER=disabled` pauses forwarding claims.
- both implementations contend for the same PostgreSQL advisory lock;
- claims carry a random token and lease, and every terminal update compares the token;
- MOVE hides the inbound message in the same transaction that marks the job sent;
- retries preserve `mailbox-forward/{jobId}/{inboundMessageId}` as the provider idempotency key.

The legacy API exports only the bootstrap-managed `ENCRYPTION_KEY` into the isolated Go runtime volume with mode `0600`; the Go process does not mount the legacy bootstrap file containing other credentials.

## Migration guarantees

The Go migration runner:

1. loads migration files in lexical order;
2. rejects transaction control and direct migration-ledger writes inside migration files;
3. computes a SHA-256 checksum for every migration;
4. opens one `psql` session and one transaction;
5. holds a PostgreSQL advisory transaction lock for the complete run;
6. creates or validates `runtime_migrations`;
7. skips a migration only when its stored checksum matches;
8. rejects a previously applied migration whose checksum changed;
9. adopts the old checksum-less ledger only after the migration SQL and schema assertions succeed;
10. records the checksum only after successful validation.

Each migration contains postcondition checks. A malformed pre-existing table, including a partial `runtime_login_attempts`, causes the transaction to fail and does not create a successful ledger entry.

Do not edit an applied migration after checksums have been recorded. Add a new numbered migration instead.

## Validation commands

```bash
cd core
test -z "$(gofmt -l .)"
go test -race ./...
go vet ./...
go build -trimpath -o ./allmail ./cmd/allmail
```

Docker validation:

```bash
docker compose build app
docker compose up -d --build --wait --wait-timeout 240
docker compose exec -T app allmail doctor api
docker compose exec -T go-jobs allmail doctor jobs
curl --fail http://127.0.0.1:3002/readyz
```

GitHub Actions contains a dedicated `go-core` job that also verifies:

- fresh migration execution;
- repeated migration execution;
- adoption of the pre-checksum migration ledger;
- rejection of a deliberately malformed pre-existing schema;
- actual API-log retention against PostgreSQL, including preservation of a recent log.

## Service ownership during migration

| Capability | Current writer |
| --- | --- |
| Existing admin/domain/mailbox records | Fastify/Prisma |
| Forwarding claim/send/update | `go-jobs` by default; `jobs` for rollback |
| API log retention | `go-jobs` |
| Existing OAuth flows and API-key enforcement | Fastify/Redis |
| Go sync cursor and job tables | reserved for future Go handlers |
| Public listener, SPA and health endpoints | Go API |
| Cloudflare Email Worker | existing TypeScript Worker |

Never let Go and TypeScript mutate the same state machine concurrently. Move one capability at a time, add parity and failure-injection tests, then change the single writer in Compose.

## Next ports

Recommended order:

1. Implement outbound delivery jobs and attempt history.
2. Implement Gmail History and Microsoft Graph delta synchronization.
3. Implement IMAP UID/UIDVALIDITY synchronization.
4. Port API-key external allocation/read endpoints.
5. Port ingress replay protection and signed delivery.
6. Port admin and mailbox portal authentication last.

The `mailbox_sync_*`, `outbound_delivery_jobs`, `job_attempts`, `outbox_events`, OAuth-state, replay, rate-limit and login-attempt tables are currently contracts, not proof that those workers are already active.

## Rollback

To move both migrated workers back before a wider rollback:

```text
API_LOG_RETENTION_OWNER=legacy
FORWARDING_WORKER_OWNER=legacy
```

Stop both `go-jobs` and `jobs`, wait for shutdown drain to return, then restart `jobs` before recreating the remaining stack. The shared forwarding lock prevents overlap during the switch.

The Go runtime tables are additive. To roll back the public listener:

1. stop `app` and `go-jobs`;
2. start the legacy image directly;
3. keep the new tables in place until their contents have been reviewed;
4. do not drop runtime tables while any Go worker can still write them.

The existing Fastify/Prisma migration history remains authoritative for legacy business tables until the final database migration cutover is completed.
