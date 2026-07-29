# Runtime consolidation and remaining business migration plan

## Purpose

The repository now has one canonical production topology, one implementation for each background state machine, one trusted public proxy boundary, and one database-backed administrator lifecycle.

The remaining target is not maximum Go line count. It is:

- one visible owner per route and state transition;
- no hidden environment identities or fallback writers;
- deterministic, reviewable migration ownership;
- least-privilege process credentials;
- revision-based rollback with matching persisted state.

## Completed consolidation

### Public/runtime ownership

Completed:

- Go owns the public listener, React SPA, request IDs, trusted-proxy normalization, readiness and metrics;
- `worker-forwarding` and `worker-retention` are independent Go services;
- Node forwarding, Node retention, Node jobs, combined `go-jobs`, rollback owner switches, and hidden second writers are removed;
- Fastify is API-only and internal-only;
- PostgreSQL and Redis are private in production;
- local dependency ports live only in `docker-compose.dev.yml`;
- the public Go container receives no PostgreSQL or Redis credentials while it owns no native business route.

### Configuration hard deletion

Removed:

```text
GO_API_MODE
ALL_MAIL_ENV
ALL_MAIL_PUBLIC_BASE_URL
ALL_MAIL_SECRET_STATE_DIR
GO_JOBS_HEARTBEAT_SECONDS
GO_JOBS_HEARTBEAT_MAX_AGE_SECONDS
APP_INTERNAL_PORT
LEGACY_API_INTERNAL_PORT
POSTGRES_PUBLISH_HOST
POSTGRES_PORT
POSTGRES_INTERNAL_PORT
REDIS_PUBLISH_HOST
REDIS_PORT
REDIS_INTERNAL_PORT
.env.basic.example
.env.cloudflare.example
```

The canonical production template is `.env.example`. Hidden aliases and silent invalid-value fallback are not supported.

### Proxy security

Completed:

- `TRUSTED_PROXY_CIDRS` names only direct tunnel/reverse-proxy peers;
- Go rejects forwarded identity from untrusted peers;
- Go strips and rewrites downstream forwarding headers;
- Fastify trusts exactly one internal Go hop;
- spoofed `X-Forwarded-For`, `X-Real-IP`, and `CF-Connecting-IP` behavior is covered by tests.

### Secrets and administrator bootstrap

Completed:

```text
runtime-secrets.env
  JWT_SECRET
  ENCRYPTION_KEY

bootstrap-admin.env
  ADMIN_USERNAME
  ADMIN_PASSWORD
```

The old combined `bootstrap-secrets.env` is split and removed by `legacy-init`.

Administrator ownership:

- `legacy-init` applies Prisma migrations and creates the first database administrator under a PostgreSQL advisory transaction lock;
- long-running Fastify does not receive `ADMIN_USERNAME` or `ADMIN_PASSWORD`;
- API startup and login cannot create administrators;
- every administrator token maps to an active positive-ID database row;
- the environment-managed `ADMIN_2FA_SECRET`, virtual `adminId=0`, `legacyEnv`, and `DOMAIN_BOOTSTRAP_ADMIN_*` paths are removed;
- successful initial password rotation removes the one-time plaintext file;
- rerunning the initializer does not create another administrator or restore plaintext.

Historical custom bootstrap usernames are recovered through password-hash matching. Installations that used the old domain bootstrap aliases may copy those values once into canonical `ADMIN_USERNAME`/`ADMIN_PASSWORD` during upgrade.

### Migrations and workers

Completed:

- Go migrations use one direct `pgx` transaction, advisory lock, ordered files, and SHA-256 checksums;
- the Go image has no `psql` dependency;
- forwarding has owner lock, claim token, lease, retry classification, idempotency, and PostgreSQL integration coverage;
- retention uses bounded `pgx` deletion and an advisory transaction lock;
- workers have independent heartbeats and doctors.

## Current ownership

| Capability | Current owner |
| --- | --- |
| Public listener, SPA, proxy identity | Go `app` |
| API-log retention | `worker-retention` |
| Forwarding execution | `worker-forwarding` |
| Initial administrator creation | `legacy-init` one-shot |
| Admin login, JWT/cookies, password and database 2FA | Fastify/Prisma |
| Mailbox portal authentication | Fastify/Prisma |
| OAuth/provider configuration | Fastify/Prisma |
| API keys and external APIs | Fastify/Prisma |
| Domain/mailbox/alias management | Fastify/Prisma |
| Ingress business handling | Fastify/Prisma |
| Prisma business schema | Prisma migrations in `legacy-init` |
| Additive runtime schema | `go-migrate` |
| Cloudflare Email Worker | TypeScript Worker |

## Remaining phase 1 — explicit route ownership registry

The Go gateway still proxies broad business namespaces. Replace broad prefix detection with an explicit registry that names the owner of every migrated prefix.

Target shape:

```text
/admin/dashboard/*       -> Go
/api/mailboxes/*         -> Go
/ingress/domain-mail/*   -> Go
all other business paths -> Fastify compatibility proxy
```

For every migrated prefix:

- add contract tests against Fastify behavior;
- add authentication and permission tests;
- add request/response validation and database failure tests;
- move transaction and audit behavior together;
- route the prefix to Go;
- remove the Fastify registration only after an observation window.

The same write endpoint must never be active in both implementations.

## Remaining phase 2 — vertical business API ports

Recommended order:

1. read-only dashboard and status queries;
2. external API-key mailbox allocation/read endpoints;
3. ingress replay persistence and signed delivery handling;
4. outbound delivery jobs and attempt history;
5. Gmail History and Microsoft Graph delta synchronization;
6. IMAP UID/UIDVALIDITY synchronization;
7. domain/mailbox/alias administration;
8. mailbox portal flows;
9. administrator authentication and OAuth last.

Each slice includes:

- route and handler ownership;
- authorization/permission parity;
- validation;
- database transactions;
- rate-limit/replay/audit behavior;
- failure injection;
- migration and rollback notes.

Do not move only controllers while leaving hidden Fastify writes.

## Remaining phase 3 — production Redis fail-closed

Selected Fastify security flows still have single-process local fallbacks when Redis becomes unavailable.

Target:

- administrator login-attempt state fails closed in production;
- API-key rate limiting fails closed;
- OAuth state/status fails closed;
- ingress replay reservation fails closed;
- local Maps remain development/test-only;
- Redis outage and multi-replica consistency tests are mandatory.

After this cut, remove `ALLOW_LOCAL_RATE_LIMIT_FALLBACK` from the production contract.

## Remaining phase 4 — configuration moves into durable state

Still-live environment compatibility:

- Google/Microsoft OAuth client configuration;
- `SEND_ENABLED_DOMAINS` policy;
- global `INGRESS_SIGNING_SECRET`.

Target sequence:

1. dry-run importer reports database/env conflicts;
2. copy OAuth fallbacks into encrypted database records;
3. replace sending allowlist with database policy/audit state;
4. move ingress secrets to endpoint-scoped encrypted or external secret references;
5. support key rotation overlap;
6. remove the environment fallbacks.

## Remaining phase 5 — worker and rollback hardening

Follow-up worker work:

- release or immediately requeue unprocessed claims when a forwarding pass terminates early;
- relate lease duration to run timeout;
- drain retention backlog in bounded consecutive batches;
- expose claimed/sent/failed/skipped/retried/claim-lost and queue-age metrics;
- reject database migration ledger entries unknown to an older runtime unless explicit backward compatibility is declared;
- test old-image/new-schema rollback behavior.

## Remaining phase 6 — converge migration authority

The same PostgreSQL database still has:

- Prisma history for business tables;
- Go history for additive runtime tables.

Short-term rules:

- Prisma owns existing business schema;
- Go owns numbered additive runtime migrations;
- no table or column is introduced independently in both systems without a compatibility explanation;
- `legacy-init` completes before `go-migrate`.

Before final Fastify removal, select one authority:

### Go authority

- freeze Prisma schema changes;
- export a validated business-schema baseline/cutover migration;
- verify constraints, indexes, enums, and data transformations;
- archive Prisma history;
- remove Prisma migrate from production images.

### External migration project

- move both histories into an explicit migration tool/project;
- keep application processes unable to mutate schema;
- run migrations as a release step.

Dual ledgers must not remain after Fastify removal.

## Remaining phase 7 — repository cleanup

Path cleanup comes after ownership stabilization:

```text
tools/oauth/google/       <- gmail_oauth/
tools/oauth/microsoft/    <- oauth-temp/
core/internal/gateway/
core/internal/workers/
core/internal/platform/
deploy/
```

Do not create path-only churn. Move code when imports, docs, tests, and ownership can change atomically.

## Final deletion gate for `server/`

Remove `server/`, Prisma, `legacy-api`, `legacy-init`, and `Dockerfile.legacy` only when all are true:

- no route is proxied to Fastify;
- administrator and portal authentication parity tests pass;
- API-key permissions/rate limits and ingress replay pass failure injection;
- provider mailbox operations have a production observation window;
- one migration authority owns the complete schema;
- Go or an external init surface owns required secret/bootstrap behavior;
- the Go image contains every production capability;
- rollback uses a previous release and matching persisted state.

## Recommended PR sequence after the current stack

1. production Redis fail-closed;
2. explicit route registry plus first read-only Go route;
3. API-key read/allocation slice;
4. ingress persistence and endpoint-scoped secrets;
5. outbound delivery and metrics;
6. provider synchronization;
7. domain/mailbox administration;
8. portal authentication;
9. admin OAuth/authentication;
10. migration-authority cutover;
11. final Fastify/Prisma removal;
12. repository path cleanup.

Every PR states:

- old and new owner;
- data written;
- concurrency guard;
- rollback procedure;
- tests and failure injection;
- compatibility files intentionally retained;
- deletion gate for the next slice.
