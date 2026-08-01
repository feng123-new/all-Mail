# Runtime migration completion record

## Current production topology

```text
client / reverse proxy
        |
        v
app (Go gateway + React + route-family telemetry)
        |
        v
go-business-api (all business routes)
        |
        +---- PostgreSQL
        +---- Redis

worker-forwarding and worker-retention are independent Go processes
temporary app init owns schema and initialization before startup
```

The public `app` receives no database URL, Redis URL, JWT secret, or encryption key. `config/route-ownership.json` is the reviewed method-aware route ownership authority; `GO_BUSINESS_API_URL` is a transport target, not a mutable ownership switch.

## Completed foundation

- Go owns the public listener, React SPA, trusted-proxy boundary, request IDs, security headers, health, readiness, and metrics.
- The route ownership manifest supports exact, prefix, fallback, and HTTP-method-specific matching.
- Every response carries stable route-owner and route-family headers.
- Bounded Prometheus metrics expose traffic, latency, inflight work, and private-upstream errors.
- `allmail routes` prints the active manifest and digest.
- Forwarding and API-log retention run as independent Go workers.
- `go-business-api` receives PostgreSQL, Redis, and read-only JWT/encryption files.
- The public gateway receives no business credential.
- Go owns complete schema initialization, canonical migration ledgers, secret initialization, durable environment import, ciphertext preflight, and first-administrator bootstrap.

## Completed route migration

All route families are now owned by `go` or `go-business-api`. The method-aware manifest is version 3, every entry has `migrationStage: complete`, and no entry declares `targetOwner`.

Completed verticals include:

- Dashboard reads and log-deletion writes;
- API-key administration, explicit permissions, limiting, scopes, allocation, and audit;
- external mailbox and domain mailbox allocation/read/reset APIs;
- provider-backed mailbox read/delete/send/clear operations;
- OAuth configuration, state, exchange, identity binding, and refresh;
- sending configuration, history, and provider delivery;
- administrator, email-group, domain, alias, mailbox, and mailbox-user management;
- mailbox authentication, session, 2FA, messages, sending, sent history, and forwarding;
- signed ingress, replay protection, mailbox resolution, inbound persistence, and forwarding-job creation;
- domain messages and text extraction compatibility behavior.

## Completed runtime deletion

The final deletion gates are satisfied:

- no public path or method is owned by the former runtime;
- there is one private business upstream;
- fresh install, in-place upgrade, backup restore, and rollback use Go initialization;
- every historical encrypted value remains readable;
- the former server tree and separate production image are removed;
- the final production image and SBOM contain no Node runtime or Prisma engine.

Node.js remains a development build tool for the React app and Cloudflare Worker. It is not part of the production runtime.

## Historical schema compatibility

The Go schema runner retains the immutable migration history and ledger compatibility required to adopt databases created before the Go-only cutover. References to `_prisma_migrations`, former checksums, or historical schema names describe persisted database compatibility only. No active Prisma tooling or runtime remains.

## Future route work

There are no remaining route ports. Future API changes are ordinary Go feature work and must preserve authentication, authorization, validation, transactionality, audit behavior, route-family stability, readiness, secret isolation, and rollback impact.

Superseded plans and staged cutover records are retained under [`archive/2026-go-rewrite/`](./archive/2026-go-rewrite/) for traceability.
