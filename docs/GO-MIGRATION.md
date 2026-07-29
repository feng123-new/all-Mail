# Go migration bridge

## Status and scope

The Go runtime is the canonical Docker entrypoint. The migration has completed for public HTTP ownership, SPA delivery, API-log retention and mailbox forwarding, but not for the full business API.

```text
Browser / automation / Cloudflare Worker
                  |
             Go public API
              /       \
        React SPA    compatibility API proxy
                         |
                 Fastify / Prisma
```

Go owns:

- the public HTTP listener and React SPA;
- request IDs, security headers, liveness, readiness and metrics;
- additive Go migrations;
- forwarding claim/send/retry/terminal transitions;
- API-log retention.

Fastify/Prisma remains authoritative for:

- admin and mailbox-portal authentication;
- administrators, API keys, domains, aliases and mailboxes;
- provider mailbox and OAuth flows;
- ingress business handlers;
- send, portal and automation API routes not yet ported;
- the existing business-schema migration history.

## Runtime layout

```text
legacy-init         one-shot secret bootstrap and Prisma migrations
go-migrate          one-shot additive Go migrations
app                 Go public API, SPA and compatibility proxy
worker-forwarding   independent Go forwarding runtime
worker-retention    independent Go retention runtime
legacy-api          internal Fastify/Prisma business API
postgres            shared application database
redis               OAuth state, rate-limit, replay and cache backend
```

The TypeScript jobs process, combined `go-jobs` supervisor, rollback profile and runtime-owner switches have been removed. Each background state machine has one implementation in the current revision.

## Startup ordering

```text
postgres + redis healthy
          |
          v
legacy-init completes
          |
          v
go-migrate completes
          |
          +-----------------------------+
          |                             |
          v                             v
legacy-api healthy                  Go workers
          |
          v
         app
```

- `legacy-init` generates or reads persisted bootstrap secrets, exports only `ENCRYPTION_KEY` to the forwarding volume, and applies Prisma business migrations.
- `go-migrate` applies checksummed Go migrations.
- Long-running services never mutate schema during normal startup.

The legacy `P3005 -> db push` compatibility repair is disabled by default. It requires an explicit one-shot invocation with `ALL_MAIL_ALLOW_LEGACY_DB_PUSH_REPAIR=true` after reviewing and backing up the target database.

## Readiness contract

`GO_API_MODE=bridge` requires:

- `DATABASE_URL`;
- `REDIS_URL`;
- `LEGACY_API_URL`.

The Go `/readyz` endpoint verifies:

- PostgreSQL through `pgx` and `SELECT current_database()`;
- Redis through RESP `AUTH`, optional `SELECT`, and `PING` requiring `PONG`;
- the compatibility API through `/readyz`, HTTP 200, `success: true`, and `data.status: ready`.

`GO_API_MODE=static` is an explicit frontend-only mode. It requires a built `index.html` and returns `GO_ROUTE_NOT_MIGRATED` for backend paths.

## Dedicated workers

### Forwarding

Command:

```bash
allmail worker forwarding
```

Doctor:

```bash
allmail doctor worker forwarding
```

Properties:

- one PostgreSQL advisory ownership lock per runtime;
- `FOR UPDATE SKIP LOCKED` claims;
- random claim token and expiring lease;
- claim-token comparison on every terminal update;
- MOVE hides the message in the same transaction that marks the job sent;
- stable `mailbox-forward/{jobId}/{inboundMessageId}` provider idempotency key;
- 408, 429 and 5xx provider responses are retryable; ordinary 4xx responses are permanent;
- every pass is bounded by `FORWARDING_RUN_TIMEOUT_SECONDS`.

Configuration:

```text
FORWARDING_WORKER_INTERVAL_SECONDS=30
FORWARDING_WORKER_BATCH_SIZE=10
FORWARDING_RUN_TIMEOUT_SECONDS=120
```

### API-log retention

Command:

```bash
allmail worker retention
```

Doctor:

```bash
allmail doctor worker retention
```

The cleaner uses a `pgx` transaction, advisory transaction lock, ordered bounded deletion and `FOR UPDATE SKIP LOCKED`.

Configuration:

```text
API_LOG_RETENTION_DAYS=30
API_LOG_CLEANUP_INTERVAL_MINUTES=60
API_LOG_CLEANUP_RETRY_SECONDS=30
API_LOG_CLEANUP_TIMEOUT_SECONDS=60
API_LOG_CLEANUP_BATCH_SIZE=5000
```

### Heartbeat contract

Each worker writes an independent file atomically:

```text
worker-forwarding-heartbeat.json
worker-retention-heartbeat.json
```

The heartbeat records runtime identity, PID, update time, active-run start, last run/completion/success, consecutive failures, last error and retention deletion count where applicable.

Doctors reject stale or future timestamps, dead PIDs, invalid identity, missing active-run start, runs beyond their deadline, and a latest failed run after the last success.

Shared heartbeat controls:

```text
WORKER_HEARTBEAT_SECONDS=15
WORKER_HEARTBEAT_MAX_AGE_SECONDS=90
```

## Migration guarantees

The Go migration runner now uses one direct `pgx` connection and transaction. It:

1. loads numbered SQL files in lexical order;
2. rejects migration-owned transaction control, psql meta-commands and direct ledger writes;
3. computes SHA-256 checksums;
4. holds a PostgreSQL advisory transaction lock for the complete run;
5. creates or validates `runtime_migrations`;
6. skips only exact checksum matches;
7. rejects changed applied migrations;
8. adopts checksum-less legacy ledger rows only after migration SQL and schema assertions succeed;
9. records checksums and commits atomically.

The Go runtime image no longer installs or requires `psql`. Do not edit an applied migration; add a new numbered migration.

## Validation evidence

```bash
cd core
test -z "$(gofmt -l .)"
go test -race ./...
go vet ./...
go build -trimpath ./cmd/allmail
```

Docker validation:

```bash
cp .env.example .env
docker compose config --quiet
docker compose up -d --build --wait --wait-timeout 240
docker compose exec -T app allmail doctor api
docker compose exec -T worker-forwarding allmail doctor worker forwarding
docker compose exec -T worker-retention allmail doctor worker retention
curl --fail http://127.0.0.1:3002/readyz
```

CI also applies the complete Prisma schema and Go migrations to a real PostgreSQL database, then tests COPY, MOVE, retry, permanent failure, skip, lease reclamation, claim-token fencing and advisory-lock ownership through the actual Go forwarding store and provider client.

## Current ownership

| Capability | Current writer |
| --- | --- |
| Public listener, React SPA and health endpoints | Go `app` |
| Forwarding claim/send/update | `worker-forwarding` |
| API-log retention | `worker-retention` |
| Admin/domain/mailbox business records | Fastify/Prisma |
| OAuth and API-key enforcement | Fastify/Redis |
| Cloudflare Email Worker | TypeScript Worker |
| Reserved sync/delivery/outbox contracts | Not yet active |

## Next business ports

Recommended order:

1. read-only dashboard and status queries;
2. external API-key allocation/read endpoints;
3. ingress replay and signed delivery persistence;
4. outbound delivery and attempt history;
5. Gmail History, Microsoft Graph delta and IMAP UID synchronization;
6. domain/mailbox write operations;
7. admin and mailbox-portal authentication last.

Each slice must move authorization, validation, transaction boundaries, parity tests and failure-injection coverage together before its Fastify routes are removed.

## Rollback

The current revision contains no hidden second background writer. Rollback means deploying a previous known-good tag, commit or image:

```bash
docker compose down
git switch <known-good-tag-or-commit>
docker compose up -d --build --wait --wait-timeout 240
```

Back up PostgreSQL and bootstrap-secret state before risky upgrades. Never run worker binaries from two revisions against the same state machine concurrently. Keep additive Go tables until their contents have been reviewed and no Go process can write them.
