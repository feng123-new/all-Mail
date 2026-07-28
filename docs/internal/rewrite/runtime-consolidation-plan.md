# Runtime consolidation and legacy removal plan

## Purpose

This document turns the current Go migration bridge into an explicit sequence of removable compatibility layers. It is maintainer-facing and deliberately separates:

- changes implemented by the runtime-consolidation PR;
- changes that require production observation before deletion;
- business API ports that must be completed before `server/` can be removed.

The target is not to maximize Go line count. The target is one authoritative owner per capability, one canonical production topology and a repository where rollback history lives in releases/images rather than duplicate active implementations.

## Current ownership after the consolidation PR

| Capability | Default owner | Compatibility owner |
| --- | --- | --- |
| Public listener and SPA | Go `app` | Previous release/image only |
| Readiness and metrics | Go `app` | Fastify has internal readiness only |
| API-log retention | Go `go-jobs` | `legacy-jobs` rollback profile |
| Forwarding execution | Go `go-jobs` | `legacy-jobs` rollback profile |
| Business HTTP APIs | Fastify `legacy-api` | Not yet ported |
| Prisma business schema | Prisma migrations in `legacy-init` | Not yet ported |
| Additive Go runtime schema | `go-migrate` | No second writer |
| Cloudflare Email Worker | TypeScript Worker | Not part of backend migration |

## Phase 0 — implemented in the consolidation PR

### Runtime topology

- remove the default `go-jobs -> jobs` dependency;
- rename the old worker role to `legacy-jobs`;
- hide it behind the `rollback` Compose profile;
- introduce one-shot `legacy-init` before `go-migrate`;
- keep long-running API and jobs services free of startup migrations;
- disable automatic production `db push` unless an operator explicitly enables the P3005 repair switch;
- run long-lived legacy containers as UID/GID `10001` with read-only filesystem, dropped capabilities and `no-new-privileges`.

### Go runtime

- type both worker ownership settings;
- bound each forwarding pass;
- expose active-run progress and consecutive failures in the jobs heartbeat;
- make doctor reject stalled workers;
- move PostgreSQL readiness and retention execution from child `psql` processes to `pgx`;
- classify Resend HTTP errors by status rather than relying only on message fragments.

### Configuration and CI

- remove `.env.basic.example`;
- align the default and Cloudflare templates;
- add explicit rollback npm commands;
- split dependency audit from Docker smoke;
- keep final `release-gate` dependent on both;
- add a package-scoped, GHSA-specific and expiring exception for the React Router RSC advisory while the Vite SPA remains outside the affected feature path.

## Phase 1 — prove Go jobs parity, then delete Node jobs code

### Required observation window

Run the Go owners through at least one stable release window with production-like traffic. Track:

- forwarding claim count;
- sent/failed/skipped count;
- retry distribution;
- provider status-code distribution;
- claim-loss events;
- owner-lock loss;
- forwarding pass duration;
- retention deletion count and duration;
- duplicate-send reports;
- MOVE visibility correctness.

### Required tests

Add a real PostgreSQL forwarding integration suite:

1. apply Prisma migrations;
2. apply Go migrations;
3. seed domain, mailbox, sending configuration, inbound message and forward job rows;
4. start a mock Resend HTTP server;
5. execute the Go forwarding worker;
6. verify `SENT`, `FAILED`, `SKIPPED` and `MOVE` transitions;
7. verify claim-token mismatch cannot update a job;
8. verify expired leases can be reclaimed;
9. verify a second owner cannot acquire the advisory lock;
10. verify the provider idempotency key remains stable across retries.

Use shared JSON fixtures for Go and TypeScript parity until the TypeScript implementation is deleted.

### Deletion gate

Delete the following only after the observation and integration gates pass:

```text
server/src/jobs/forwarding.worker.ts
server/src/jobs/forwarding.worker.test.ts
server/src/jobs/forwarding.flow.test.ts
server/src/jobs/api-log-retention.ts
server/src/jobs/api-log-retention.test.ts
server/src/worker.ts
server/src/runtime/jobsHealth.ts
legacy-jobs service from docker-compose.yml
jobs role from docker/entrypoint.sh
start:npm:jobs compatibility command if no supported source workflow needs it
```

Then remove:

```text
FORWARDING_WORKER_OWNER
API_LOG_RETENTION_OWNER
```

from normal runtime configuration. Rollback should use a previous tagged image, not a permanently maintained second state machine in `main`.

## Phase 2 — split Go worker processes by capability

The combined `go-jobs` supervisor is acceptable during the first cutover, but it couples unrelated failure domains.

Target commands:

```text
allmail worker retention
allmail worker forwarding
allmail worker outbound-delivery
allmail worker mailbox-sync
```

Target Compose services:

```text
worker-retention
worker-forwarding
worker-outbound-delivery
worker-mailbox-sync
```

Each service should have:

- its own heartbeat;
- its own doctor target;
- its own run timeout and backoff;
- independent resource limits;
- independent restart behavior;
- no ability to stop unrelated capabilities when one owner connection fails.

Do not split merely by package. Split when lifecycle, scaling or failure isolation differs.

## Phase 3 — converge database migration ownership

The repository currently needs Prisma migrations for legacy business tables and Go migrations for additive runtime tables. The same physical database therefore has two ledgers.

Short-term rule:

- Prisma owns existing business schema;
- Go owns only numbered additive runtime migrations;
- no field/table is introduced independently in both systems without an explicit compatibility explanation;
- `legacy-init` completes before `go-migrate`.

Before final cutover, choose one database migration authority.

### Option A — Go becomes final owner

- freeze Prisma schema changes;
- export the final Prisma schema as a numbered Go baseline/cutover migration;
- validate all constraints, indexes, enum values and data transformations;
- archive Prisma migration history for reference;
- remove Prisma migrate from production images.

### Option B — external migration tool becomes final owner

- move both Go and legacy SQL into a dedicated migration project/tool;
- keep application binaries unable to mutate schema;
- run migrations as an explicit release step.

Do not keep dual ledgers permanently after Fastify has been removed.

## Phase 4 — port business APIs by vertical capability

Do not rewrite all routes at once. Each port must include handlers, authorization, validation, storage, audit behavior and failure tests.

Recommended order:

1. read-only dashboard queries;
2. API-key external read/allocation endpoints;
3. ingress signature and replay persistence;
4. outbound delivery jobs and attempt history;
5. Gmail History and Microsoft Graph delta synchronization;
6. IMAP UID/UIDVALIDITY synchronization;
7. domain and mailbox administration;
8. mailbox portal flows;
9. OAuth and administrator authentication last.

### Route ownership registry

Replace broad prefix proxying with an explicit registry:

```text
/admin/dashboard/*       -> Go
/api/mailboxes/*         -> Go
/ingress/domain-mail/*   -> Go
all other business paths -> legacy proxy
```

For every migrated prefix:

- add contract tests against the previous implementation;
- add auth and permission tests;
- add database failure tests;
- remove the prefix from legacy proxy ownership;
- remove the corresponding Fastify registration after a release window.

The gateway must never silently route the same write endpoint to two implementations.

## Phase 5 — remove duplicate static and source runtimes

Fastify still contains static-file registration and SPA fallback for the secondary Node source runtime. The canonical Docker runtime already serves the built React app from Go.

After formally ending Node-only production support, delete:

```text
Fastify @fastify/static registration
Fastify SPA index fallback
server-side static precompression path
scripts/prepare-public.mjs
root public/ compatibility build output
scripts/start-all-mail.mjs
Node-only deploy/up commands that imply production equivalence
```

Keep frontend development through Vite and build the SPA directly into the Go image.

Before deletion, update `docs/advanced-runtime.md` to either:

- describe development-only Fastify execution; or
- remove the source runtime entirely.

## Phase 6 — simplify configuration packages

The current Go `Config` remains a transitional aggregate. Split it when commands no longer need the same legacy bridge fields:

```go
type APIConfig struct {
    Port          int
    Mode          APIMode
    StaticDir     string
    LegacyAPIURL  string
    DatabaseURL   string
    RedisURL      string
}

type ForwardingConfig struct {
    DatabaseURL string
    StateDir    string
    Interval    time.Duration
    RunTimeout  time.Duration
    BatchSize   int
    ResendURL   string
}

type RetentionConfig struct {
    DatabaseURL string
    StateDir    string
    Interval    time.Duration
    Retry       time.Duration
    RunTimeout  time.Duration
    BatchSize   int
    Days        int
}

type MigrationConfig struct {
    DatabaseURL string
    Directory   string
}
```

Command-specific loaders should prevent an API process from loading worker secrets and prevent migration commands from requiring irrelevant HTTP configuration.

## Phase 7 — repository structure cleanup

Avoid a large path-only diff until runtime ownership is stable. Then consolidate tools:

```text
tools/oauth/google/       <- gmail_oauth/
tools/oauth/microsoft/    <- oauth-temp/
tools/source-runtime/     <- remaining compatibility source helpers
```

Suggested long-term layout:

```text
core/
  cmd/allmail/
  internal/gateway/
  internal/workers/
  internal/platform/
  migrations/
server/                   # removed after final business port
web/
cloudflare/workers/allmail-edge/
deploy/
tools/
docs/
```

Do not move directories only for appearance. Move them when imports, documentation and ownership boundaries can be updated atomically.

## Final deletion gate for `server/`

`server/` can be removed only when all of the following are true:

- no public or internal route is proxied to Fastify;
- no Node jobs process is supported;
- Go or an external tool owns all database migrations;
- authentication and OAuth parity tests pass;
- API-key permissions and rate limits pass failure-injection tests;
- mailbox/provider operations have production observation;
- the Go image no longer copies Node server artifacts;
- `legacy-api`, `legacy-init`, `Dockerfile.legacy` and Prisma dependencies are absent from Compose and CI;
- rollback is performed by deploying the previous release, not by starting compatibility code from the current release.

## Pull request sequencing

Prefer reviewable PRs with one ownership boundary each:

1. runtime consolidation and documentation;
2. forwarding PostgreSQL integration tests;
3. Node jobs deletion;
4. worker-process split;
5. first read-only business route port;
6. first write-route port with parity tests;
7. migration authority cutover;
8. Fastify static/source runtime removal;
9. final Fastify business API removal;
10. repository path cleanup.

Each PR description should include:

- current and new capability owner;
- data written by the change;
- concurrency guard;
- rollback procedure;
- tests and failure injection;
- exact files intentionally retained for compatibility;
- exact deletion gate for the next phase.
