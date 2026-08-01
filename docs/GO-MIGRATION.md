# Go migration boundary

## Status

The production runtime and every public route are now Go-owned. The route migration is complete.

```text
Browser / automation / Cloudflare Worker
                  |
                  v
             app (Go gateway)
             /             \
      React SPA             go-business-api
                             private Go routes
                                  |
                          PostgreSQL + Redis

worker-forwarding and worker-retention run as independent Go processes
```

There is no production Node server, separate legacy API, or alternate route owner.

## Current ownership

`app` owns:

- the public listener;
- trusted-proxy normalization;
- the React SPA and fallback;
- request IDs and security headers;
- `/health`, `/livez`, `/readyz`, and `/metrics`;
- route-manifest loading and bounded route telemetry;
- proxying every business route to `go-business-api`.

`go-business-api` owns:

- administrator and mailbox authentication, password rotation, 2FA, and revocable sessions;
- Dashboard reads and operation-log deletion;
- administrator, API-key, email-group, domain, mailbox, alias, mailbox-user, and forwarding-job management;
- mailbox portal reads and writes;
- external mailbox allocation and provider operations;
- OAuth configuration/state and token refresh;
- signed ingress verification, replay protection, resolution, and persistence;
- sending configuration, history, and provider delivery;
- all `/admin`, `/api`, `/mail/api`, `/ingress`, and `/oauth` business families.

Independent Go processes own forwarding and API-log retention. The temporary `app init` run owns schema adoption/migration, secret initialization, durable configuration import, ciphertext verification, and first-administrator bootstrap.

## Runtime layout

```text
app                 public gateway, SPA, readiness, metrics, and one private proxy
go-business-api     complete private business API
worker-forwarding   forwarding runtime
worker-retention    retention runtime
postgres            private database
redis               private security/cache state
```

Only `app` is published. All six services use the shared Go image where applicable; initialization is not a Compose service.

## Startup ordering

`./scripts/compose-up.sh` is the canonical path:

```text
postgres healthy
      |
      v
build shared Go image
      |
      v
temporary app init
  - split old secret bundle when present
  - establish runtime secrets
  - execute or adopt immutable schema history
  - apply numbered Go migrations
  - verify historical ciphertext
  - import durable configuration
  - bootstrap the first administrator
  - export least-privilege key files
      |
      v
go-business-api + redis + workers
      |
      v
app ready
```

Long-running services do not mutate schema or create administrators.

## Secret ownership

Managed state on `runtime_secrets_data`:

```text
/var/lib/all-mail/runtime-secrets.env
  JWT_SECRET
  ENCRYPTION_KEY

/var/lib/all-mail/bootstrap-admin.env
  ADMIN_USERNAME
  ADMIN_PASSWORD
```

Least-privilege exports:

```text
go-business-api:
  JWT_SECRET_FILE=/var/lib/all-mail-secrets/jwt-secret
  ENCRYPTION_KEY_FILE=/var/lib/all-mail-encryption/encryption-key

worker-forwarding:
  ENCRYPTION_KEY_FILE=/var/lib/all-mail-secrets/encryption-key
```

`app` receives no database, Redis, JWT, encryption, OAuth, ingress-signing, or provider credential. `go-business-api` receives no raw secret environment value. The one-time administrator file is removed after successful forced password rotation.

## Route ownership

`config/route-ownership.json` is the source-controlled authority. Manifest version 3 permits only:

```text
go
go-business-api
```

Every entry has `migrationStage: complete`; no entry has `targetOwner`. System endpoints and the SPA fallback are handled by `go`; every business family is proxied to `go-business-api` through:

```text
GO_BUSINESS_API_URL=http://go-business-api:3200
```

Every response carries `X-All-Mail-Route-Owner` and `X-All-Mail-Route-Family`. See [`ROUTE-OWNERSHIP.md`](./ROUTE-OWNERSHIP.md).

## Authentication contract

Administrator and mailbox session verification requires:

1. HS256;
2. issuer `all-mail`;
3. the matching `admin-console` or `mailbox-portal` audience;
4. valid expiry and optional not-before;
5. positive subject and session version;
6. matching durable PostgreSQL session version;
7. an existing active database identity;
8. completed mandatory password rotation for ordinary protected routes.

Password, role, status, mandatory-rotation, and 2FA changes increment durable session state and revoke older tokens. Redis-backed login protection fails closed. Mailbox authorization reloads current memberships from PostgreSQL rather than trusting a token-carried mailbox list.

## Readiness and metrics

Public `/readyz` requires:

1. a valid method-aware route manifest;
2. the built React `index.html`;
3. private `go-business-api` readiness.

The private readiness probe checks PostgreSQL and Redis. Worker doctors validate their independent heartbeat files and process state.

Public metrics use bounded route owner, family, method, status-class, inflight, latency, request, and proxy-error labels. Raw paths, identities, addresses, API keys, request IDs, secrets, and error text are not metric labels.

## Historical schema compatibility

The Go schema runner uses direct `pgx` transactions, embedded immutable history, numbered Go SQL files, SHA-256 checksums, advisory locks, prefix validation, catalog postconditions, and atomic ledger recording.

The embedded history includes migrations originally created under Prisma. Existing `_prisma_migrations` databases are adopted only when names, order, checksums, and postconditions match. Ledgerless databases are adopted only when the complete owned-catalog fingerprint matches.

`allmail_schema_migrations` is authoritative. `_prisma_migrations` and `runtime_migrations` remain compatibility mirrors for supported in-place upgrades and declared rollback windows. These names describe immutable database history only; the production image contains no Node runtime, Prisma package or CLI, schema file, engine, or `psql`.

Applied migrations must never be edited. Unknown, gapped, checksum-mismatched, or structurally drifted state fails closed.

## Completed deletion gates

The final route migration and runtime deletion gates are satisfied:

- every public path and method is owned by `go` or `go-business-api`;
- the manifest contains only completed entries;
- the public gateway has one private upstream;
- fresh install, upgrade, restore, and rollback use the Go initializer;
- the former Node server tree and separate production image are removed;
- the production image and runtime topology are Go-only.

Historical implementation plans remain under `docs/internal/archive/` and are not current operator guidance.

## Rollback

Rollback is revision based. Preserve PostgreSQL and all secret volumes, stop the complete revision, and deploy a previous revision only when it explicitly supports the current schema and authentication state. Otherwise restore the matching database and secret-volume backup before startup.

Compatibility ledger rows may support a declared immediate rollback window; they are not a promise that arbitrary older revisions can consume the current state. Never run initializers, workers, or APIs from two revisions against the same persisted state.
