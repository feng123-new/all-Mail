# Go Migration Phase 1: Forwarding Single Writer

## Goal

Move mailbox forwarding execution from the legacy Node jobs runtime to Go without
changing the public API, queue state model, provider idempotency key, or rollback
path.

## Current context

- Fastify and Prisma remain the control plane for mailbox forwarding settings,
  queue inspection, and manual requeue operations.
- The Go API remains the public listener and proxies routes that have not moved.
- The legacy jobs runtime continues API-log retention after forwarding moves.
- PostgreSQL is the coordination boundary shared by both runtimes.

## Ownership and safety invariants

1. `FORWARDING_WORKER_OWNER` is one of `legacy`, `go`, or `disabled`.
2. Both forwarding implementations use the same PostgreSQL session advisory lock.
3. A runtime that does not own the advisory lock must not claim forwarding jobs.
4. Claims use `FOR UPDATE SKIP LOCKED`, a random claim token, and a lease expiry.
5. Provider calls happen outside database transactions.
6. Every terminal update compares the claim token. A stale worker cannot mutate a
   reclaimed job.
7. MOVE hides the inbound message and marks the forwarding job sent in one
   transaction.
8. Provider retries reuse `mailbox-forward/{jobId}/{inboundMessageId}`.

## Migration ledger

- The Go runner owns `runtime_migrations` and executes migrations through pgx.
- One PostgreSQL advisory lock serializes all Go migration commands.
- Each applied row stores the raw SQL SHA-256 checksum.
- Existing rows without checksums are backfilled only after catalog validation.
- Existing checksummed rows are validated and skipped; checksum mismatches fail.
- A migration and its ledger insert commit in the same transaction.
- Historical migration files are immutable after a checksum has been recorded.

## File map

- Modify `core/internal/config/config.go` and tests for ownership and worker values.
- Modify `core/internal/httpapi/server.go` and tests for protocol readiness.
- Replace `core/internal/migrate/migrate.go` and add focused runner tests.
- Add `core/internal/jobs/forwarding.go` and tests for claim and terminal semantics.
- Add `core/internal/crypto/legacy.go` for the existing AES-256-GCM envelope.
- Add `core/internal/provider/resend.go` for Resend HTTP delivery.
- Add `core/migrations/0003_forwarding_execution_v1.sql`.
- Modify `server/src/config/env.ts`, `server/src/runtime/processes.ts`, and worker
  startup tests for the legacy ownership gate.
- Modify `server/prisma/schema.prisma` so Prisma preserves lease columns.
- Modify `docker-compose.yml`, environment docs, and CI ownership wiring.

## Ordered tasks

### Task 1: Harden dependency readiness

- [ ] Add failing tests for missing and protocol-invalid dependencies.
- [ ] Use pgx `Ping`, Redis `PING`, and the legacy HTTP health contract.
- [ ] Return 503 when any required dependency is absent or unavailable.

### Task 2: Harden migration execution

- [ ] Add tests for checksum matching, mismatch, legacy backfill, and partial schema.
- [ ] Acquire a dedicated migration advisory lock.
- [ ] Execute each unapplied migration and ledger insert in one transaction.
- [ ] Validate catalog postconditions before accepting or backfilling a row.

### Task 3: Add forwarding lease schema

- [ ] Add claim token and lease expiry fields to Prisma and Go migration SQL.
- [ ] Add the due-job claim index used by both runtimes.
- [ ] Preserve all existing forwarding status values and data.

### Task 4: Implement the Go forwarding loop

- [ ] Add tests for COPY, MOVE, skip, retry, terminal failure, and stale-token CAS.
- [ ] Acquire the forwarding owner lock before claiming.
- [ ] Port validation, body formatting, encryption compatibility, and Resend send.
- [ ] Keep provider calls outside transactions and finish with claim-token CAS.

### Task 5: Gate the legacy writer

- [ ] Add Node runtime tests for `legacy`, `go`, and `disabled` ownership.
- [ ] Start the TypeScript forwarding worker only for `legacy`.
- [ ] Keep API-log retention and the legacy jobs process heartbeat active.

### Task 6: Deliver and verify

- [ ] Add Go format, test, race, vet, and build CI checks.
- [ ] Build the Go and legacy images through Compose.
- [ ] Run isolated PostgreSQL, Redis, legacy-health, and Resend stubs.
- [ ] Verify advisory lock exclusion, forwarding transitions, readiness, migration
      serialization, and rollback to `legacy` ownership.

## Configuration boundary

Retain database, Redis, encryption, send-domain, auth, OAuth, ingress, CORS,
rate-limit, bootstrap, API-log retention, forwarding interval, and forwarding
batch settings. Remove only duplicate service-level forwarding entries after the
shared ownership configuration is in place.

## Rollback

Stop or disable Go forwarding, set `FORWARDING_WORKER_OWNER=legacy`, and restart
the legacy jobs service. The advisory lock prevents overlap during the switch.
Lease and checksum columns are additive and remain in place during rollback.
