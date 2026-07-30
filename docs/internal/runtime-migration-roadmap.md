# Runtime Migration Roadmap

## Current production topology

```text
client / reverse proxy
        |
        v
app (Go gateway + React + method-aware route telemetry)
        |
        +----------------------------+
        |                            |
        v                            v
go-business-api                business-api
(private Go business reads)    (Fastify + Prisma remaining routes)
        |                            |
        +-------------+--------------+
                      v
                 PostgreSQL

business-init -> go-migrate -> long-running services
worker-forwarding and worker-retention are independent Go processes
```

The public `app` remains least privilege: it receives no database URL, Redis URL, JWT secret, or encryption key. It owns routing and forwards each committed route family to one of two private upstreams:

- `go-business-api` owns migrated database-backed Go handlers;
- `business-api` owns the remaining Fastify/Prisma handlers;
- `GO_BUSINESS_API_URL` and `BUSINESS_API_URL` are internal Compose inputs, never operator-controlled ownership switches;
- `business-init` owns Prisma migration, durable configuration import, runtime-secret initialization, first-administrator bootstrap, and least-privilege secret export;
- `Dockerfile.server` builds the two Node business roles;
- the shared Go image builds `app`, `go-business-api`, migrations, and workers;
- `runtime_secrets_data` retains the explicit physical name `${COMPOSE_PROJECT_NAME}_legacy_runtime_data` so upgrades reuse existing JWT and encryption state.

## Completed migration foundation

The platform and ownership foundation is complete:

- `config/route-ownership.json` is the reviewed machine-readable ownership authority;
- manifest version 2 supports HTTP-method-specific exact and longest-prefix ownership;
- system routes and the SPA remain directly Go-owned;
- every response carries stable owner and route-family headers;
- Prometheus metrics expose declared methods, owner, request volume, bounded method/status classes, inflight work, duration, and private-upstream proxy errors;
- arbitrary client method strings are collapsed to `OTHER` to prevent metric cardinality growth;
- `allmail routes` prints the active manifest digest and method-aware route set;
- ownership cannot be changed by an environment flag;
- Fastify route-prefix additions must update the manifest in the same PR;
- a private `go-business-api` now provides authenticated Dashboard reads without giving the public gateway database credentials;
- Dashboard GET routes are Go-owned while Dashboard log deletion remains Fastify-owned by method.

## First vertical cutover: Dashboard reads

These routes are now owned by `go-business-api`:

```text
GET /admin/dashboard/stats
GET /admin/dashboard/api-trend
GET /admin/dashboard/logs
```

The private service verifies the existing HS256 administrator token, requires the `admin-console` audience, reloads the administrator from PostgreSQL, rejects disabled accounts, and preserves the mandatory initial-password-change boundary. Dashboard queries use UTC, bounded query parameters, PostgreSQL protocol checks, and the existing response envelope.

These write routes deliberately remain on Fastify until audit and transaction parity is implemented:

```text
DELETE /admin/dashboard/logs/:id
POST   /admin/dashboard/logs/batch-delete
```

The Fastify read handlers also remain temporarily as revision rollback code. They are deleted only after an observation window confirms that the corresponding Fastify route-family proxy traffic remains zero.

## Second vertical cutover: API-key security and database external routes

`go-business-api` now owns the administrator API-key surface, API-key hash authentication, permissions and aliases, fail-closed Redis limiting, usage accounting, email/domain mailbox allocation state, and persisted domain-message reads. Exact route ownership keeps provider-dependent APIs and JavaScript regex text extraction on Fastify.

The private Go service now depends on PostgreSQL, Redis, and the read-only JWT file. The public gateway remains credential-free.

## Remaining vertical migrations

1. Decide and migrate Dashboard log-deletion writes with audit and transaction parity.
2. Move ingress validation, encrypted endpoint secrets, replay protection, persistence, forwarding-job creation, and outbound history.
3. Move provider-dependent mailbox reads, provider synchronization, OAuth configuration, and sending operations.
4. Move domain, mailbox, alias, and user write operations.
5. Move mailbox-portal and administrator authentication, including login lockout, 2FA, password rotation, OAuth state, and JWT issuance.
6. Transfer complete business-schema migration authority from Prisma to Go.
7. Rewrap or formally preserve every encrypted historical field before removing the compatibility crypto reader.
8. Observe zero Fastify proxy traffic, then remove the Node/Prisma runtime in a separate revision.

Each route cutover must change the method-aware manifest owner in the same revision as its Go handler, authorization, validation, response parity, failure injection, Docker smoke, and rollback tests. Deleting a Fastify handler requires a later observation window in which that route family's Fastify proxy traffic and proxy errors remain zero.

## Final Node/Prisma deletion gates

The `server/` runtime, Prisma engine, `business-api`, `business-init`, and `Dockerfile.server` may be removed only when all of the following are true:

- no public route or HTTP method is owned by Fastify in the route ownership manifest;
- route-family Fastify proxy requests and proxy errors remain zero for the agreed observation window;
- fresh install, in-place upgrade, backup restore, and rollback no longer require Node;
- Go owns the complete business schema and migration ledger;
- all historical encrypted values remain readable after the cutover;
- the final image and SBOM contain no Node runtime or Prisma engine.

Until those gates are met, the Node business runtime is active production code rather than removable redundancy.
