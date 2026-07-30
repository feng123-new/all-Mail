# Post-PR9 compatibility-runtime retirement assessment

## Decision

The compatibility runtime cannot be removed after the post-stabilization closeout alone.

The Go runtime currently owns the public listener, static frontend delivery, proxy identity, health endpoints, additive runtime migrations, forwarding, and API-log retention. It does not yet own a database-backed business route. Every administration, external API, mailbox portal, OAuth, and ingress business request is still handled by Fastify and Prisma behind the Go reverse proxy.

Removing `server/`, `legacy-api`, `legacy-init`, `Dockerfile.legacy`, Prisma migrations, or `legacy_runtime_data` now would remove required production behavior rather than redundant behavior.

## Removed safely in the closeout

The following items were redundant and are removed or demoted in the closeout:

- unused `@fastify/rate-limit`, `@fastify/static`, `@fastify/swagger`, and `@fastify/swagger-ui` direct dependencies;
- unused direct `pg` and `@types/pg` dependencies;
- production installation of `pino-pretty` (development-only after the change);
- stale worker secret/heartbeat paths and unsafe long-lived-secret printing examples;
- temporary source-export workflow used only to prepare the pull request.

These changes do not alter route ownership or database authority.

## Components that remain required

| Component | Why it remains required | Retirement gate |
| --- | --- | --- |
| `server/` Fastify runtime | Owns all database-backed business HTTP routes | No production route may be proxied to Fastify |
| Prisma Client and `server/prisma/migrations` | Own business schema and transactions | Go data layer and migration authority must cover the full schema |
| `legacy-init` | Runs Prisma migrations, runtime-secret compatibility migration, and first-admin bootstrap | Replacement one-shot Go initializer must prove fresh install and upgrade parity |
| `Dockerfile.legacy` | Builds `legacy-init` and `legacy-api` | Both roles removed from Compose |
| `legacy_runtime_data` | Stores JWT/encryption secrets and pending bootstrap credential | Secret ownership migrated with backward-compatible import and rollback |
| Go `legacycrypto` compatibility | Forwarding decrypts existing encrypted provider credentials | All encrypted rows rewrapped or a stable compatibility decoder retained |
| Redis-backed Fastify security state | Login, API-key limits, OAuth state/status, and ingress replay | Equivalent Go implementations and failure-injection tests |

## Optional tools

`gmail_oauth/` and `oauth-temp/` are not part of the production Compose runtime. They may be moved to `tools/oauth/google/` and `tools/oauth/microsoft/` in a low-risk repository-layout PR. Deletion should wait until the web OAuth flows and documented recovery procedures cover every use case currently provided by the scripts.

## Required migration sequence

### Slice 1: route ownership contract and proxy observability

- introduce a machine-readable route ownership manifest;
- generate or test both Go and Fastify prefix ownership from the manifest;
- count proxied requests by route family and response class;
- add parity and rollback tests.

This slice is required before business migration so removal decisions are based on measured traffic rather than directory names.

### Slice 2: read-only dashboard and status APIs

Move the lowest-risk database reads first. Add Go authorization middleware, query parity tests, response fixtures, and failure injection. Remove only the corresponding Fastify handlers after an observation window.

### Slice 3: API-key authenticated read routes

Port API-key lookup, permission evaluation, rate limiting, usage accounting, and read-only external endpoints as one vertical slice. Do not split authentication from permission enforcement.

### Slice 4: ingress persistence and outbound history

Port signed ingress authentication, atomic replay reservation, delivery deduplication, message persistence, forwarding-job creation, and outbound history. This is a transaction-heavy boundary and requires duplicate-delivery and partial-failure tests.

### Slice 5: domain, mailbox, provider, and synchronization operations

Move domain/mailbox CRUD and provider synchronization with transaction parity, encryption compatibility, external-provider failure injection, and audit-log parity.

### Slice 6: portal and administrator authentication

Move mailbox portal sessions, administrator login, 2FA, password rotation, step-up grants, OAuth state/status, and bootstrap cleanup last. Security-state and session compatibility must be tested across rolling restarts.

### Final removal slice

Delete Fastify/Prisma only when all of the following are true:

1. the route ownership manifest assigns no production route to Fastify;
2. proxy metrics show zero compatibility traffic for the agreed observation period;
3. fresh install, in-place upgrade, rollback, and backup/restore tests pass without Node;
4. Go owns the complete business schema migration chain;
5. secret import and encrypted-row compatibility are proven;
6. `legacy-api` and `legacy-init` are absent from Compose and release gates;
7. the final image and SBOM contain no Node runtime or Prisma engine.

## Recommended pull requests

1. `feat(go): add route ownership manifest and compatibility proxy metrics`
2. `feat(go): port dashboard and operational read APIs`
3. `feat(go): port API-key authentication and external reads`
4. `feat(go): port ingress persistence and outbound history`
5. `feat(go): port domain mailbox and provider operations`
6. `feat(go): port portal and administrator authentication`
7. `refactor(runtime): remove Fastify Prisma compatibility runtime`

Each pull request must be independently deployable and reversible. A single all-business-routes rewrite would make authorization, transaction, migration, and rollback regressions difficult to isolate.
