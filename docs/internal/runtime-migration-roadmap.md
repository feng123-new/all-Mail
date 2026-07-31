# Runtime Migration Roadmap

## Current production topology

```text
client / reverse proxy
        |
        v
app (Go gateway + React + route-family telemetry)
        |
        +----------------------------+
        |                            |
        v                            v
go-business-api                business-api
private migrated Go routes     remaining Fastify/Prisma routes
        |                            |
        +-------------+--------------+
                      v
             PostgreSQL + Redis

business-init -> go-migrate -> long-running services
worker-forwarding and worker-retention are independent Go processes
```

The public `app` remains least privilege: it receives no database URL, Redis URL, JWT secret, or encryption key. `config/route-ownership.json` is the reviewed method-aware ownership authority; `GO_BUSINESS_API_URL` and `BUSINESS_API_URL` are transport targets, never mutable ownership switches.

## Completed migration foundation

The platform foundation is complete:

- Go owns the public listener, React SPA, trusted-proxy boundary, request IDs, security headers, health, readiness, and metrics;
- the route ownership manifest supports exact, prefix, fallback, and HTTP-method-specific ownership;
- every response carries a stable route owner and route-family header;
- bounded Prometheus metrics expose route owner, methods, traffic, latency, inflight work, and private-upstream errors;
- `allmail routes` prints the active manifest and digest;
- forwarding and API-log retention run as independent Go workers;
- a private `go-business-api` receives only PostgreSQL, Redis, and a read-only JWT file;
- the public gateway receives no business credential.

## Completed vertical cutovers

### Dashboard reads and log-deletion writes

The following routes are owned by `go-business-api`:

```text
GET    /admin/dashboard/stats
GET    /admin/dashboard/api-trend
GET    /admin/dashboard/logs
DELETE /admin/dashboard/logs/:id
POST   /admin/dashboard/logs/batch-delete
```

The private service verifies the existing administrator JWT, requires issuer `all-mail` and audience `admin-console`, reloads account and session-version state from PostgreSQL, rejects disabled or stale sessions, and preserves the mandatory password-change boundary.

Dashboard log deletion is transactional. The target delete and a separate administrator audit record commit together. Batch input is bounded to 1–1000 positive IDs, duplicates are normalized, and audit metadata records the administrator ID, request ID, client IP, requested/deleted counts, and response time.

Fastify Dashboard handlers remain temporarily as revision rollback code. They receive no traffic for methods owned by Go and may be removed only after the observation window proves zero Fastify requests and proxy errors for those route families.

### API-key security and database-backed external routes

`go-business-api` owns:

- administrator API-key create/list/detail/update/delete;
- explicit fail-closed permissions, aliases, wildcards, scopes, status, and expiry;
- SHA-256 key lookup, Redis-backed limiting, usage accounting, and API audit logs;
- external mailbox allocation/list/statistics/reset;
- domain mailbox allocation/list/statistics/reset;
- persisted domain-message reads.
- external mailbox account management and provider-backed read/delete/send/clear operations;
- OAuth configuration, Redis state/status, code exchange, verified remote identity binding, and token refresh;
- sending configuration/history and Resend delivery.

JavaScript regular-expression text extraction remains Fastify-owned.

### Session-security foundation

Administrator and mailbox JWTs carry issuer, audience, algorithm, and durable session-version state. Password, role, status, mandatory-rotation, and 2FA changes increment the stored version and revoke older tokens. Browser cookies rotate after security changes.

### Signed ingress and raw-message lifecycle

### Database administration surfaces

Administrator, email-group, domain-mailbox, and mailbox-user management are owned by `go-business-api`. Password mutations emit bcrypt cost-10 hashes compatible with existing sessions. Mailbox creation, membership replacement, batch creation/deletion, API-key domain-scope updates, catch-all cleanup, and user deletion use PostgreSQL transactions.


`POST /ingress/domain-mail/receive` is owned by `go-business-api`. The Go handler verifies the existing HMAC canonical form, enforces a bounded timestamp window, decrypts the endpoint-scoped persisted signing secret, reserves delivery keys atomically in Redis, resolves exact mailboxes, aliases, and catch-all targets, and commits inbound messages, forwarding jobs, and endpoint usage in one PostgreSQL transaction. Database delivery keys remain the durable idempotency authority.

The Cloudflare Email Worker now stores raw messages under deterministic SHA-256 object keys without domain, mailbox, sender, or recipient data in the path or R2 metadata. Permanent application-level rejection schedules compensating deletion with `ctx.waitUntil`; replay and retryable failures retain the deterministic object for idempotent retry. Logs contain only bounded request/error codes and truncated delivery hashes.

## Remaining vertical migrations

1. Move remaining domain, message, alias, and portal operations.
2. Move mailbox-portal and administrator authentication, including login lockout, 2FA, password rotation, and JWT issuance.
3. Transfer complete business-schema migration authority from Prisma to Go.
4. Rewrap or formally preserve every encrypted historical field before removing the compatibility crypto reader.
5. Observe zero Fastify proxy traffic, then remove the Node/Prisma runtime in a separate revision.

Each route cutover must include its Go handler, authorization, validation, transaction behavior, response parity, failure injection, method-aware manifest change, public-gateway Docker smoke, readiness checks, and revision rollback path.

## Final Node/Prisma deletion gates

`server/`, Prisma, `business-api`, `business-init`, and `Dockerfile.server` may be removed only when all of the following are true:

- no public path or HTTP method is Fastify-owned;
- Fastify proxy requests and proxy errors remain zero for the agreed observation window;
- fresh install, in-place upgrade, backup restore, and rollback no longer require Node;
- Go owns the complete business schema and migration ledger;
- every historical encrypted value remains readable;
- the final image and SBOM contain no Node runtime or Prisma engine.

Until those gates are met, the Node business runtime is active production code, not removable redundancy.
