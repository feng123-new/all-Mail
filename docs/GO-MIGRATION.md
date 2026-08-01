# Go migration boundary

## Status

The Go runtime is the canonical public Docker entrypoint. Migration is complete for public HTTP ownership, SPA delivery, route governance, forwarding, API-log retention, Dashboard reads and log-deletion writes, API-key administration/security, signed domain-mail ingress, and the database-only external mailbox/domain-mail slice. The complete business API is not yet migrated.

```text
Browser / automation / Cloudflare Worker
                  |
                  v
             app (Go gateway)
              /      |       \
        React SPA    |        remaining business routes
                     |                 |
                     v                 v
            go-business-api       business-api
            private Go routes     Fastify / Prisma
                     \                 /
                      v               v
                    PostgreSQL + Redis
```

## Current ownership

Go owns:

- public listener, trusted-proxy normalization, SPA, request IDs, security headers, liveness, readiness, and metrics;
- method-aware route ownership and bounded migration telemetry;
- the private `go-business-api` service;
- Dashboard statistics, trend, operation-log reads, single deletion, and batch deletion;
- API-key administration, explicit permissions, authentication, Redis limiting, usage accounting, and allocation state;
- database-backed external mailbox/domain-mail allocation, listing, statistics, reset, and persisted message reads;
- signed ingress authentication, encrypted endpoint-secret reads, Redis replay protection, mailbox resolution, inbound persistence, and forwarding-job creation;
- administrator, email-group, domain-mailbox, and mailbox-user management, including batch mailbox transactions and membership synchronization;
- external mailbox account management, OAuth state/configuration, Gmail/Graph/IMAP/SMTP provider operations, sending configuration/history, and Resend delivery;
- checksummed additive migrations;
- forwarding and API-log retention workers.

Fastify/Prisma still owns remaining domain/message/alias and mailbox-portal operations, JavaScript regex text extraction compatibility, durable business configuration import, initial administrator bootstrap, complete business-schema migrations, and dormant authentication handlers retained for revision rollback.

## Runtime layout

```text
business-init       secrets + Prisma migrations + durable imports + first administrator
                    + least-privilege secret exports
go-migrate          additive checksummed Go migrations
app                 public gateway, SPA, method-aware private-upstream routing
go-business-api     private migrated business handlers
business-api        remaining Fastify/Prisma handlers
worker-forwarding   independent Go forwarding runtime
worker-retention    independent Go retention runtime
postgres            private database
redis               private security/cache state
```

Only `app` is host-published.

## Startup ordering

```text
postgres + redis healthy
        |
        v
business-init
  - split old secret bundle
  - establish runtime secrets
  - export forwarding key and Go-business JWT
  - Prisma migrate
  - durable configuration import
  - advisory-locked administrator bootstrap
        |
        v
go-migrate
        |
        +------------------------------+
        |              |               |
        v              v               v
business-api   go-business-api     Go workers
        \              /
         +-------------+
                |
                v
               app
```

Long-running services do not migrate schema or create administrators.

## Secret ownership

Long-lived Fastify state:

```text
/var/lib/all-mail/runtime-secrets.env
  JWT_SECRET
  ENCRYPTION_KEY
```

One-time administrator state:

```text
/var/lib/all-mail/bootstrap-admin.env
```

Least-privilege Go exports:

```text
worker-forwarding:
  ENCRYPTION_KEY_FILE=/var/lib/all-mail-secrets/encryption-key

go-business-api:
  JWT_SECRET_FILE=/var/lib/all-mail-secrets/jwt-secret
  ENCRYPTION_KEY_FILE=/var/lib/all-mail-encryption/encryption-key
```

The public `app` receives neither file. `go-business-api` receives PostgreSQL, Redis, the read-only JWT file, and a read-only encryption-key copy used to decrypt persisted provider, OAuth, sending, and ingress credentials; raw secrets remain absent from its environment.

## Public gateway routing

The gateway receives only static assets, proxy settings, timeouts, the route manifest, and fixed internal transport URLs:

```text
BUSINESS_API_URL=http://business-api:3100
GO_BUSINESS_API_URL=http://go-business-api:3200
```

The manifest, not an environment flag, determines ownership.

Current method split:

```text
GET    /admin/dashboard/stats              -> go-business-api
GET    /admin/dashboard/api-trend          -> go-business-api
GET    /admin/dashboard/logs               -> go-business-api
DELETE /admin/dashboard/logs/:id           -> go-business-api
POST   /admin/dashboard/logs/batch-delete  -> go-business-api

/admin/api-keys/**                         -> go-business-api
/admin/emails/**                           -> go-business-api
/admin/oauth/**                            -> go-business-api
/admin/send/**                             -> go-business-api
/oauth                                     -> go-business-api
database-only /api mailbox routes          -> go-business-api
provider /api mail_new/mail_all/process    -> go-business-api
database-only /api/domain-mail routes      -> go-business-api
regex compatibility routes                 -> business-api
```

```text
POST /ingress/domain-mail/receive              -> go-business-api

/admin/admins/**                                -> go-business-api
/admin/email-groups/**                         -> go-business-api
/admin/domain-mailboxes/**                     -> go-business-api
/admin/mailbox-users/**                        -> go-business-api
/admin/auth/**                                 -> go-business-api
POST /mail/api/login|logout|change-password    -> go-business-api
GET  /mail/api/session|mailboxes               -> go-business-api
/mail/api/2fa/**                               -> go-business-api
GET  /mail/api/messages/**                     -> go-business-api
other /mail/api operations                     -> business-api
other /ingress compatibility paths             -> business-api
```

Every response carries `X-All-Mail-Route-Owner` and `X-All-Mail-Route-Family`. See [`ROUTE-OWNERSHIP.md`](./ROUTE-OWNERSHIP.md).

## Private Go authentication

Administrator and mailbox session verification requires:

1. HS256;
2. issuer `all-mail`;
3. audience `admin-console` or `mailbox-portal` for the matching identity type;
4. valid expiry and optional not-before;
5. positive subject and session version;
6. matching durable PostgreSQL session version;
7. an existing active database identity;
8. `mustChangePassword=false` for ordinary business routes, while session inspection and password rotation remain available.

Go issues Fastify-compatible administrator and mailbox JWTs and `HttpOnly`, `SameSite=Lax`, production-`Secure` cookies. Password, role, status, mandatory-rotation, and 2FA changes increment durable session state and revoke older tokens. Redis login protection is fail closed; administrator keys retain their historical byte format and mailbox users use an isolated namespace. Mailbox message authorization reloads current memberships from PostgreSQL and never trusts the JWT mailbox list.

## Dashboard contract

Dashboard reads preserve the existing success and error envelopes, UTC date behavior, bounded query parameters, deterministic ordering, and request-ID metadata.

Dashboard writes preserve:

```json
{"success":true,"data":{"deleted":true}}
{"success":true,"data":{"deleted":2}}
```

Single and batch deletion run in PostgreSQL transactions. The target deletion and administrator audit row commit together. Batch requests accept 1–1000 positive IDs and normalize duplicates. Audit metadata records the administrator, request ID, client IP, operation details, and response time.

Fastify Dashboard handlers remain temporarily for revision rollback. They are removed only after route metrics show zero Fastify traffic and errors for the agreed observation window.

## API-key and external database contract

Go owns API-key CRUD, explicit fail-closed permissions, aliases and wildcards, SHA-256 lookup, status and expiry checks, Redis-backed per-minute limits, `usageCount` and `lastUsedAt`, resource scopes, allocation state, and API audit logs.

Historical keys with NULL or empty permissions are migrated to explicit `all=true` before either runtime starts. New keys require at least one enabled known permission.

Database and provider-dependent external mailbox routes are exact Go-owned entries. JavaScript regex text extraction remains Fastify-owned.

Redis failure is fail closed and makes `go-business-api` not ready.

## Aggregate readiness and metrics

Public `/readyz` requires:

1. a valid method-aware manifest;
2. built React assets;
3. Fastify readiness;
4. private Go-business readiness.

Both private services perform real PostgreSQL and Redis protocol checks for active security state.

Public metrics expose bounded owner, method, status-class, inflight, latency, request, and private-upstream error series. Arbitrary methods collapse to `OTHER`; raw paths, identities, addresses, API keys, request IDs, secrets, and error text never become labels.

## Migration guarantees

The Go migration runner uses a direct `pgx` transaction, lexical numbered files, SHA-256 checksums, an advisory transaction lock, immutable ledger validation, and atomic recording. The Go image contains no `psql`.

Prisma still owns the complete business schema in `business-init`; transferring that authority is a later deletion gate.

Repository gates cover Go format/race/vet/build/govulncheck, route ownership, JWT/session parity, Dashboard read/write fixtures, real PostgreSQL/Redis integrations, Fastify, React, Worker, dependency audit, Docker bootstrap, secret isolation, stale-token revocation, route-owner smoke, and all runtime doctors.

## Next ports

Recommended order:

1. remaining domain, message, alias, and portal operations;
2. complete business-schema authority and encrypted-data cutover;
3. zero-traffic observation and final Node/Prisma deletion.

Every slice must move authorization, validation, transactions, parity, failure injection, method-aware ownership, Docker smoke, and revision rollback together.

## Rollback

Rollback is revision based. Preserve PostgreSQL and all runtime secret volumes, stop the complete revision, and deploy the previous known-good revision. Never run initializers, workers, or business APIs from two revisions against the same persisted state.

After any mailbox user enrolls in 2FA, the authentication slice must not roll `business-api` back to a revision older than this compatibility contract because the older login handler does not enforce mailbox 2FA. Roll back the route cut by committing a manifest owner revert while retaining the compatible Fastify handlers, then deploy that complete revision. This preserves source-controlled ownership and keeps password, Redis lockout, OTP, and session-version checks active.
