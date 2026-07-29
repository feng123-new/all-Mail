# Go migration boundary

## Status and scope

The Go runtime is the canonical Docker entrypoint. Migration is complete for public HTTP ownership, SPA delivery, API-log retention, and mailbox forwarding, but not for the full business API.

```text
Browser / automation / Cloudflare Worker
                  |
             Go public gateway
              /       \
        React SPA    compatibility API proxy
                         |
                 Fastify / Prisma
```

Go owns:

- the public listener, trusted-proxy normalization, React SPA, request IDs, security headers, liveness, readiness, and metrics;
- additive Go migrations;
- forwarding claim/send/retry/terminal transitions;
- API-log retention.

Fastify/Prisma remains authoritative for authentication, OAuth, API keys, domain/mailbox administration, provider mailbox operations, ingress business handling, and the existing business-schema migration history.

## Runtime layout

```text
legacy-init         one-shot secret bootstrap and Prisma migrations
go-migrate          one-shot additive Go migrations
app                 Go public gateway, SPA and compatibility proxy
worker-forwarding   independent Go forwarding runtime
worker-retention    independent Go retention runtime
legacy-api          internal Fastify/Prisma business API
postgres            private application database
redis               private OAuth/rate-limit/replay/cache backend
```

The TypeScript jobs process, combined `go-jobs` supervisor, rollback profile, and runtime-owner switches have been removed.

## Startup ordering

```text
postgres healthy
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
legacy-api healthy               Go workers
      |
      v
     app
```

`legacy-init` no longer waits for or receives Redis. It generates/reads bootstrap secrets, exports only the forwarding encryption key, and applies Prisma migrations. `legacy-api` then performs the PostgreSQL and Redis readiness checks required by business routes.

Long-running services do not mutate schema during ordinary startup.

## Public gateway least privilege

The Go gateway currently owns no native business route, so it does not receive `DATABASE_URL` or `REDIS_URL`.

Its `/readyz` checks:

1. the built React `index.html`;
2. the internal Fastify `/readyz` protocol and payload.

Fastify `/readyz` verifies PostgreSQL and Redis. This preserves end-to-end readiness while removing shared-state credentials from the public container.

The removed `GO_API_MODE=static|bridge` switch is not a compatibility alias. The production gateway always serves the SPA and requires `LEGACY_API_URL` until the remaining business routes are ported.

## Trusted proxy contract

`TRUSTED_PROXY_CIDRS` lists only reverse-proxy/tunnel peers that connect directly to Go.

The gateway:

- ignores forwarded identity from untrusted socket peers;
- accepts `CF-Connecting-IP`, `X-Real-IP`, or the first valid `X-Forwarded-For` only from a trusted peer;
- strips all inbound forwarding headers;
- writes one canonical client IP, protocol, and host to Fastify.

Fastify trusts exactly one proxy hop. The internal Fastify service remains unpublished. A blanket CIDR or `trustProxy: true` is outside the supported security model.

## Dedicated workers

### Forwarding

```bash
allmail worker forwarding
allmail doctor worker forwarding
```

Properties:

- one PostgreSQL advisory ownership lock;
- `FOR UPDATE SKIP LOCKED` claims;
- random claim token and expiring lease;
- claim-token comparison on terminal updates;
- MOVE hides the message in the same transaction that marks the job sent;
- stable `mailbox-forward/{jobId}/{inboundMessageId}` idempotency key;
- 408, 429, and 5xx provider responses retry; ordinary 4xx responses are permanent;
- every pass is bounded by `FORWARDING_RUN_TIMEOUT_SECONDS`.

The worker accepts only:

```text
ENCRYPTION_KEY_FILE=/var/lib/all-mail/encryption-key
```

Direct `ENCRYPTION_KEY`, `ALL_MAIL_SECRET_STATE_DIR`, and bootstrap-file parsing are removed.

### API-log retention

```bash
allmail worker retention
allmail doctor worker retention
```

The cleaner uses a `pgx` transaction, advisory transaction lock, bounded ordered deletion, and `FOR UPDATE SKIP LOCKED`.

### Heartbeat contract

Each worker writes its own atomic file:

```text
worker-forwarding-heartbeat.json
worker-retention-heartbeat.json
```

Doctors reject invalid identity, dead PIDs, stale/future timestamps, missing active-run start time, runs beyond their deadline, and a latest failed run after the last success.

Canonical controls:

```text
WORKER_HEARTBEAT_SECONDS=15
WORKER_HEARTBEAT_MAX_AGE_SECONDS=90
```

The old `GO_JOBS_HEARTBEAT_*` aliases are hard-deleted.

## Migration guarantees

The Go migration runner uses one direct `pgx` connection and transaction. It:

1. loads numbered SQL files in lexical order;
2. rejects transaction control, psql meta-commands, and direct ledger writes;
3. computes SHA-256 checksums;
4. holds a PostgreSQL advisory transaction lock;
5. validates `runtime_migrations`;
6. skips only exact checksum matches;
7. rejects changed applied migrations;
8. adopts checksum-less legacy rows only after SQL/schema validation;
9. records checksums and commits atomically.

The Go image does not include `psql`. Never edit an applied numbered migration.

## Production networking

`docker-compose.yml` publishes only `app`. PostgreSQL and Redis remain private. Local development ports belong to `docker-compose.dev.yml`:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis
```

This separation is part of the runtime contract, not documentation-only guidance.

## Validation evidence

```bash
cd core
test -z "$(gofmt -l .)"
go test -race ./...
go vet ./...
go build -trimpath ./cmd/allmail
```

```bash
cp .env.example .env
docker compose config --quiet
docker compose -f docker-compose.yml -f docker-compose.dev.yml config --quiet
docker compose up -d --build --wait --wait-timeout 240
docker compose exec -T app allmail doctor api
docker compose exec -T worker-forwarding allmail doctor worker forwarding
docker compose exec -T worker-retention allmail doctor worker retention
```

CI also tests real PostgreSQL migrations and forwarding COPY, MOVE, retry, permanent failure, skip, lease reclamation, claim fencing, owner-lock behavior, proxy-header spoofing, and Compose credential/exposure boundaries.

## Current ownership

| Capability | Current owner |
| --- | --- |
| Public gateway, SPA, request/proxy identity | Go `app` |
| Forwarding | `worker-forwarding` |
| API-log retention | `worker-retention` |
| Business API and authentication | Fastify/Prisma |
| Business schema migrations | Prisma in `legacy-init` |
| Additive runtime migrations | `go-migrate` |
| Cloudflare Email Worker | TypeScript Worker |

## Next ports

Recommended order:

1. read-only dashboard/status routes;
2. external API-key allocation/read routes;
3. ingress replay and delivery persistence;
4. outbound delivery/attempt history;
5. provider synchronization;
6. domain/mailbox write operations;
7. portal and administrator authentication last.

Every slice must move authorization, validation, transaction boundaries, parity tests, and failure injection together.

## Rollback

Rollback is revision based:

```bash
docker compose down
git switch <known-good-tag-or-commit>
docker compose up -d --build --wait --wait-timeout 240
```

Use the target revision's environment contract. Never run worker binaries from two revisions against the same state machine concurrently.
