# Go migration bridge

## Status and scope

The Go runtime is merged into the default branch and is the canonical Docker entrypoint. It is still an incremental migration bridge, not a complete replacement for the Fastify/Prisma business API.

Current request flow:

```text
Browser / automation / Cloudflare Worker
                  |
             Go public API
              /       \
        React SPA    legacy API proxy
                         |
                 Fastify / Prisma
```

Go currently owns:

- the public HTTP listener;
- React SPA delivery;
- request IDs and security headers;
- liveness, readiness and metrics;
- additive Go migrations;
- API-log retention;
- forwarding claim/send/update execution.

Fastify/Prisma currently remains authoritative for:

- admin and mailbox-portal authentication;
- administrators, API keys, domains and mailbox records;
- external mailbox provider and OAuth flows;
- ingress business handlers;
- existing send, portal and automation API routes;
- the legacy Prisma schema and migration history.

## Default service layout

```text
legacy-init    one-shot secret bootstrap, key export and Prisma migrations
go-migrate     one-shot additive Go migrations
app            Go public API and migration bridge
go-jobs        Go API-log retention and forwarding workers
legacy-api     Fastify/Prisma business API
postgres       shared application database
redis          OAuth state, rate-limit, replay and cache backend
```

`legacy-jobs` is not part of the default service set. It is available only through the Compose `rollback` profile while the migrated workers still need an operational fallback.

## Startup ordering

The canonical sequence is:

```text
postgres + redis healthy
          |
          v
legacy-init completes
          |
          v
go-migrate completes
          |
          v
legacy-api healthy
       /       \
      v         v
    app       go-jobs
```

This separates one-shot mutation work from long-running services:

- `legacy-init` generates or reads persisted bootstrap secrets, exports only `ENCRYPTION_KEY` into the isolated Go volume and applies Prisma migrations;
- `go-migrate` applies checksummed Go migrations;
- `legacy-api`, `app` and `go-jobs` do not mutate schema during ordinary process startup.

The legacy `P3005 -> db push` compatibility repair is disabled by default. It can only run when an operator explicitly sets:

```text
ALL_MAIL_ALLOW_LEGACY_DB_PUSH_REPAIR=true
```

Use that switch only for the documented legacy non-empty-database repair path after reviewing the target database.

## Local workflow

```bash
git fetch origin
git switch main
cp .env.example .env
docker compose up -d --build --wait --wait-timeout 240
curl --fail http://127.0.0.1:3002/health
curl --fail http://127.0.0.1:3002/readyz
docker compose exec -T app allmail doctor api
docker compose exec -T go-jobs allmail doctor jobs
```

The one-shot migrations can also be run explicitly:

```bash
docker compose run --rm legacy-init
docker compose run --rm go-migrate
```

Do not rerun `legacy-init` with the P3005 repair switch enabled unless that compatibility repair is intentionally required.

## Readiness contract

`GO_API_MODE=bridge` is the default and requires:

- `DATABASE_URL`;
- `REDIS_URL`;
- `LEGACY_API_URL`.

The Go `/readyz` endpoint performs protocol-level checks:

- PostgreSQL: connects with `pgx` and executes `SELECT current_database()`;
- Redis: performs RESP `AUTH` when configured, optional `SELECT`, and `PING`, requiring `PONG`;
- legacy API: calls `/readyz`, requiring HTTP 200, `success: true`, and `data.status: ready`.

A missing dependency returns HTTP 503 with `required-but-not-configured`. A process that merely accepts TCP connections without speaking the expected protocol is not accepted.

`GO_API_MODE=static` is an explicit frontend-only mode. It requires a built `index.html` and returns `GO_ROUTE_NOT_MIGRATED` for backend paths.

## API-log retention ownership

- `API_LOG_RETENTION_OWNER=go` enables the Go cleaner and disables the Node cleaner;
- `API_LOG_RETENTION_OWNER=legacy` is reserved for an explicit rollback profile;
- the Go cleaner uses `pgx`, a PostgreSQL transaction and an advisory transaction lock;
- deletion is ordered and bounded by `API_LOG_CLEANUP_BATCH_SIZE`;
- failed runs retry after `API_LOG_CLEANUP_RETRY_SECONDS`;
- individual runs are bounded by `API_LOG_CLEANUP_TIMEOUT_SECONDS`.

Configuration:

```text
API_LOG_RETENTION_OWNER=go
API_LOG_RETENTION_DAYS=30
API_LOG_CLEANUP_INTERVAL_MINUTES=60
API_LOG_CLEANUP_RETRY_SECONDS=30
API_LOG_CLEANUP_TIMEOUT_SECONDS=60
API_LOG_CLEANUP_BATCH_SIZE=5000
```

## Forwarding ownership

- `FORWARDING_WORKER_OWNER=go` enables Go claim/send/update;
- `FORWARDING_WORKER_OWNER=legacy` is used only by the rollback profile;
- `FORWARDING_WORKER_OWNER=disabled` pauses claims;
- both implementations use the same PostgreSQL advisory ownership lock;
- claims carry a random token and lease, and terminal updates compare the claim token;
- MOVE hides the inbound message in the same transaction that marks the job sent;
- retries preserve `mailbox-forward/{jobId}/{inboundMessageId}` as the provider idempotency key;
- each Go forwarding run is bounded by `FORWARDING_RUN_TIMEOUT_SECONDS`;
- Resend HTTP errors are classified by status: request timeout, rate limit and 5xx are retryable, ordinary 4xx errors are permanent.

Configuration:

```text
FORWARDING_WORKER_OWNER=go
FORWARDING_WORKER_INTERVAL_SECONDS=30
FORWARDING_WORKER_BATCH_SIZE=10
FORWARDING_RUN_TIMEOUT_SECONDS=120
```

The one-shot legacy initializer exports only the bootstrap-managed `ENCRYPTION_KEY` into the isolated Go runtime volume with mode `0600`. The Go process does not mount the legacy bootstrap file containing the admin password or JWT secret.

## Jobs heartbeat contract

`go-jobs` writes `/var/lib/all-mail/go-jobs-heartbeat.json` atomically. Each worker records:

- whether it is enabled;
- whether a run is active;
- active-run start time;
- last run and completion time;
- last success time;
- consecutive failure count;
- last error;
- retention deletion count where applicable.

`allmail doctor jobs` rejects:

- stale heartbeat files;
- invalid runtime identity;
- missing worker state;
- a running worker without `startedAt`;
- a forwarding or retention run that exceeds its configured limit;
- an enabled worker whose latest completed run failed after its last success.

This prevents a global heartbeat ticker from hiding a worker that is internally stuck.

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
9. adopts the old checksum-less ledger only after migration SQL and schema assertions succeed;
10. records the checksum only after successful validation.

The migration runner intentionally still uses `psql`. Readiness and retention have moved to `pgx`, but the migration command keeps its existing, tested single-session transaction and meta-command control flow in this phase.

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
cp .env.example .env
docker compose config --quiet
docker compose up -d --build --wait --wait-timeout 240
docker compose exec -T app allmail doctor api
docker compose exec -T go-jobs allmail doctor jobs
test "$(docker compose exec -T legacy-api id -u)" = "10001"
curl --fail http://127.0.0.1:3002/readyz
```

GitHub Actions independently runs:

- runtime contract tests;
- Go format, race, vet, build and database tests;
- web lint/test/build;
- server lint/test/build;
- Cloudflare Worker checks;
- production dependency audit;
- Docker Compose smoke and ownership checks;
- a final `release-gate` that requires both audit and Docker smoke success.

## Service ownership during migration

| Capability | Current writer |
| --- | --- |
| Existing admin/domain/mailbox records | Fastify/Prisma |
| Forwarding claim/send/update | `go-jobs`; `legacy-jobs` only under rollback profile |
| API-log retention | `go-jobs`; `legacy-jobs` only under rollback profile |
| Existing OAuth flows and API-key enforcement | Fastify/Redis |
| Go sync cursor and job tables | Reserved for future Go handlers |
| Public listener, SPA and health endpoints | Go `app` |
| Cloudflare Email Worker | Existing TypeScript Worker |

Never let Go and TypeScript mutate the same state machine concurrently. Move one capability at a time, add parity and failure-injection tests, then change the single writer.

## Next ports

Recommended order:

1. outbound delivery jobs and attempt history;
2. Gmail History and Microsoft Graph delta synchronization;
3. IMAP UID/UIDVALIDITY synchronization;
4. API-key external allocation/read endpoints;
5. ingress replay protection and signed delivery;
6. admin and mailbox-portal authentication last.

The `mailbox_sync_*`, `outbound_delivery_jobs`, `job_attempts`, `outbox_events`, OAuth-state, replay, rate-limit and login-attempt tables are contracts, not proof that those workers are active.

## Rollback

To transfer forwarding and retention back to Node:

```bash
docker compose stop go-jobs
docker compose --profile rollback up -d legacy-jobs
docker compose --profile rollback ps
docker compose logs legacy-jobs --tail=200
```

The rollback service forces both owner settings to `legacy`. Do not also leave a separate Go jobs container running.

To return to Go:

```bash
docker compose --profile rollback stop legacy-jobs
docker compose up -d go-jobs
docker compose exec -T go-jobs allmail doctor jobs
```

The Go runtime tables are additive. Do not drop runtime tables while any Go worker can still write them. The existing Prisma migration history remains authoritative for legacy business tables until final database ownership cutover.
