# Runtime consolidation and remaining migration plan

## Purpose

The repository now has one canonical production topology and one implementation for each background state machine. This plan records what is complete and what still blocks final Fastify/Prisma removal.

The target is not maximum Go line count. The target is:

- one authoritative writer per capability;
- explicit route ownership;
- independent failure domains;
- deterministic migrations;
- rollback through known-good releases/images rather than duplicate active implementations.

## Completed runtime consolidation

### Production topology

Completed:

- Go owns the public listener, React SPA, readiness and metrics;
- one-shot `legacy-init` owns bootstrap secrets and Prisma migrations;
- one-shot `go-migrate` owns additive Go migrations;
- `worker-forwarding` and `worker-retention` run as independent Go services;
- long-running services do not mutate schema on startup;
- legacy containers run as UID/GID `10001` with read-only filesystem, dropped capabilities and `no-new-privileges`;
- automatic production `P3005 -> db push` fallback is disabled.

### Legacy runtime retirement

Deleted:

```text
server/src/jobs/forwarding.worker.ts
server/src/jobs/forwarding.worker.test.ts
server/src/jobs/forwarding.flow.test.ts
server/src/jobs/api-log-retention.ts
server/src/jobs/api-log-retention.test.ts
server/src/worker.ts
server/src/runtime/jobsHealth.ts
legacy-jobs / go-jobs / jobs Compose services
jobs role in docker/entrypoint.sh
FORWARDING_WORKER_OWNER
API_LOG_RETENTION_OWNER
```

Rollback for background execution now uses a previous known-good revision or image.

### Worker evidence

Completed:

- per-run forwarding timeout;
- claim-token and lease fencing;
- structured Resend HTTP retry classification;
- independent heartbeat and doctor per worker;
- real PostgreSQL integration coverage for COPY, MOVE, retry, permanent failure, skip, expired lease reclamation, stale claim-token rejection and advisory-lock ownership.

### Migration and configuration cleanup

Completed:

- PostgreSQL readiness and retention use `pgx`;
- Go migrations use one direct `pgx` transaction and advisory lock;
- the Go image no longer installs `psql`;
- command-specific `APIConfig`, `ForwardingConfig`, `RetentionConfig`, and `MigrationConfig` loaders replace the transitional aggregate config.

### Static/source runtime cleanup

Deleted:

```text
Fastify static-file registration
Fastify SPA fallback
server-side static precompression
scripts/prepare-public.mjs
scripts/start-all-mail.mjs
Node production start/up/deploy commands
```

Fastify is API-only. Vite remains available for frontend development.

## Current ownership

| Capability | Current owner |
| --- | --- |
| Public listener and SPA | Go `app` |
| Readiness and metrics | Go `app` |
| API-log retention | `worker-retention` |
| Forwarding execution | `worker-forwarding` |
| Business HTTP APIs | Fastify `legacy-api` |
| Prisma business schema | Prisma migrations in `legacy-init` |
| Additive runtime schema | `go-migrate` |
| Cloudflare Email Worker | TypeScript Worker |

## Remaining Phase 1 — explicit route ownership registry

The Go gateway still proxies broad backend namespaces. Replace this with an explicit registry so every route prefix has one visible owner.

Target shape:

```text
/admin/dashboard/*       -> Go
/api/mailboxes/*         -> Go
/ingress/domain-mail/*   -> Go
all other business paths -> compatibility proxy
```

For every migrated prefix:

- add contract tests against the Fastify behavior;
- add authentication/permission tests;
- add validation and database failure tests;
- move transaction and audit behavior together;
- route the prefix to Go;
- remove the Fastify registration only after a release observation window.

The gateway must never silently route the same write endpoint to two implementations.

## Remaining Phase 2 — port business APIs vertically

Recommended order:

1. read-only dashboard and status queries;
2. external API-key mailbox allocation/read endpoints;
3. ingress replay persistence and signed delivery handling;
4. outbound delivery jobs and attempt history;
5. Gmail History and Microsoft Graph delta synchronization;
6. IMAP UID/UIDVALIDITY synchronization;
7. domain/mailbox/alias administration;
8. mailbox portal flows;
9. OAuth and administrator authentication last.

Each slice must include:

- handlers and route ownership;
- authorization and permission parity;
- request/response validation;
- database transaction boundaries;
- rate-limit/replay/audit behavior;
- failure injection;
- migration and rollback notes.

Do not port only the controller while leaving a hidden write path in Fastify.

## Remaining Phase 3 — converge database migration authority

The same physical PostgreSQL database still has:

- Prisma migration history for business tables;
- Go migration history for additive runtime tables.

Short-term rules:

- Prisma owns existing business schema;
- Go owns only numbered additive runtime migrations;
- no table/column is introduced independently in both systems without a documented compatibility reason;
- `legacy-init` completes before `go-migrate`.

Before final Fastify removal, choose one authority:

### Option A — Go becomes final migration owner

- freeze Prisma schema changes;
- export a validated business-schema baseline/cutover migration;
- verify constraints, indexes, enum values and data transformations;
- archive Prisma history for reference;
- remove Prisma migrate from production images.

### Option B — external migration project/tool

- move both histories into a dedicated migration surface;
- keep application binaries unable to mutate schema;
- run migrations as an explicit release step.

Do not keep dual ledgers after the Fastify business API is gone.

## Remaining Phase 4 — repository structure cleanup

Avoid path-only churn until ownership is stable. Candidates after route migration:

```text
tools/oauth/google/       <- gmail_oauth/
tools/oauth/microsoft/    <- oauth-temp/
core/internal/gateway/
core/internal/workers/
core/internal/platform/
deploy/
```

Move directories only when imports, documentation and ownership boundaries can be updated atomically.

## Final deletion gate for `server/`

Remove `server/`, Prisma and `Dockerfile.legacy` only when all are true:

- no public or internal route is proxied to Fastify;
- authentication and OAuth parity tests pass;
- API-key permissions, rate limits and replay protection pass failure-injection tests;
- provider mailbox operations have a production observation window;
- one migration authority owns the complete schema;
- `legacy-api` and `legacy-init` are absent from Compose and CI;
- the Go image contains all required production behavior;
- rollback uses the previous release/image and matching persisted state.

## Recommended PR sequence

1. explicit route ownership registry plus first read-only Go route;
2. external API-key read/allocation slice;
3. ingress replay/delivery slice;
4. outbound delivery worker and attempt history;
5. provider synchronization slices;
6. domain/mailbox administration;
7. portal authentication;
8. admin OAuth/authentication;
9. migration-authority cutover;
10. final Fastify/Prisma removal;
11. repository path cleanup.

Every PR should state:

- old and new capability owner;
- data written;
- concurrency guard;
- rollback procedure;
- tests and failure injection;
- compatibility files intentionally retained;
- deletion gate for the next slice.
