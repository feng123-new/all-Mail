# Runtime Migration Roadmap

## Current production topology

```text
client / reverse proxy
        |
        v
app (Go gateway + React)
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

## Remaining vertical migrations

1. Add a machine-readable route ownership manifest and proxy metrics.
2. Move dashboard and operational read APIs to Go with response-parity fixtures.
3. Move API-key authentication, permissions, rate limits, and external read APIs.
4. Move ingress validation, replay protection, persistence, and outbound history.
5. Move domain, mailbox, alias, provider, and sending operations.
6. Move mailbox-portal and administrator authentication, including 2FA and OAuth state.
7. Transfer business-schema migration authority from Prisma to Go.
8. Rewrap or formally preserve every encrypted historical field before removing the compatibility crypto reader.

## Final Node/Prisma deletion gates

The `server/` runtime, Prisma engine, `business-api`, `business-init`, and `Dockerfile.server` may be removed only when all of the following are true:

- no production route is owned by Fastify;
- gateway proxy traffic remains zero for the agreed observation window;
- fresh install, in-place upgrade, backup restore, and rollback no longer require Node;
- Go owns the complete business schema and migration ledger;
- all historical encrypted values remain readable after the cutover;
- the final image and SBOM contain no Node runtime or Prisma engine.

Until those gates are met, the business runtime is active production code rather than removable redundancy.
