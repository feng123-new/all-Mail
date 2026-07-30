# Runtime Migration Roadmap

## Current production topology

```text
client / reverse proxy
        |
        v
app (Go gateway + React + route-family telemetry)
        |
        v
business-api (Fastify + Prisma business routes)

business-init -> go-migrate -> long-running services
worker-forwarding and worker-retention are independent Go processes
```

The active service and configuration names describe ownership rather than migration age:

- `business-api` owns database-backed business HTTP routes;
- `business-init` owns Prisma migration, durable configuration import, runtime-secret initialization, and first-administrator bootstrap;
- `BUSINESS_API_URL` is the internal Go-to-Fastify upstream;
- `Dockerfile.server` builds both business roles;
- `runtime_secrets_data` is the logical Compose volume. Its explicit physical name remains `${COMPOSE_PROJECT_NAME}_legacy_runtime_data` so upgrades reuse existing JWT and encryption secrets.

## Completed migration foundation

The route ownership stage is complete:

- `config/route-ownership.json` is the reviewed machine-readable ownership authority;
- exact, longest-prefix, namespace catch-all, and SPA fallback semantics are validated in Go and Node tests;
- every response carries stable owner and route-family headers;
- Prometheus metrics expose declared ownership, request volume, status class, inflight work, duration, and Go-to-Fastify proxy errors without raw-path cardinality;
- the `allmail routes` command prints the active manifest digest and route set;
- ownership cannot be changed by an environment flag;
- Fastify route-prefix additions must update the manifest in the same PR.

The active observation candidate is `admin-dashboard`. Its traffic must be measured before implementation and cutover.

## Remaining vertical migrations

1. Move dashboard and operational read APIs to Go with administrator-auth parity and response fixtures.
2. Decide the dashboard log-deletion boundary after read traffic and method usage are observed; move writes only with audit and transaction parity.
3. Move API-key authentication, permissions, rate limits, and external read APIs.
4. Move ingress validation, replay protection, persistence, and outbound history.
5. Move domain, mailbox, alias, provider, and sending operations.
6. Move mailbox-portal and administrator authentication, including 2FA and OAuth state.
7. Transfer business-schema migration authority from Prisma to Go.
8. Rewrap or formally preserve every encrypted historical field before removing the compatibility crypto reader.

Each route-family cutover must change the manifest owner in the same revision as the Go handler, authorization, validation, parity, failure-injection, Docker, and rollback tests. Deleting a Fastify handler requires a later observation window in which that family's proxy traffic and proxy errors remain zero.

## Final Node/Prisma deletion gates

The `server/` runtime, Prisma engine, `business-api`, `business-init`, and `Dockerfile.server` may be removed only when all of the following are true:

- no production route is owned by Fastify in the route ownership manifest;
- route-family proxy request and proxy error metrics remain zero for the agreed observation window;
- fresh install, in-place upgrade, backup restore, and rollback no longer require Node;
- Go owns the complete business schema and migration ledger;
- all historical encrypted values remain readable after the cutover;
- the final image and SBOM contain no Node runtime or Prisma engine.

Until those gates are met, the business runtime is active production code rather than removable redundancy.
