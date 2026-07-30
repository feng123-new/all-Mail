# Go migration boundary

## Status

The Go runtime is the canonical public Docker entrypoint. Migration is complete for public HTTP ownership, SPA delivery, route governance, forwarding, API-log retention, Dashboard reads, API-key administration/security, and the database-only external mailbox/domain-mail slice. The complete business API is not yet migrated.

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
            private Go reads      Fastify / Prisma
                     \                 /
                      v               v
                         PostgreSQL
```

Go owns:

- the public listener, trusted-proxy normalization, SPA, request IDs, security headers, liveness/readiness, and metrics;
- the method-aware route ownership manifest and bounded migration telemetry;
- the private `go-business-api` service for migrated database-backed handlers;
- authenticated Dashboard statistics, API trend, and operation-log reads;
- API-key administration, hash authentication, permissions, Redis limiting, usage accounting, and allocation state;
- database-backed external email/domain-mail allocation, listing, statistics, reset, and persisted message reads;
- additive Go migrations;
- forwarding;
- API-log retention.

Fastify/Prisma still owns administrator login and 2FA, OAuth, provider-dependent mailbox operations, domain/mailbox writes, ingress, Dashboard log deletion, JavaScript regex text extraction compatibility, and business-schema migrations.

## Runtime layout

```text
business-init       secrets + Prisma migrations + durable imports + initial DB administrator
                    + exports least-privilege JWT/encryption files
go-migrate          additive checksummed Go migrations
app                 public Go gateway, SPA, method-aware private-upstream routing
go-business-api     private Go database-backed business handlers
business-api        private Fastify/Prisma remaining business handlers
worker-forwarding   independent Go forwarding runtime
worker-retention    independent Go retention runtime
postgres            private database
redis               private OAuth/rate-limit/replay/cache backend
```

Only `app` is host-published. `go-business-api`, `business-api`, PostgreSQL, and Redis are private to the Compose network.

## Startup ordering

```text
postgres healthy
      |
      v
business-init
  - split old secret bundle
  - establish runtime secrets
  - export forwarding encryption key
  - export Go-business JWT key
  - Prisma migrate
  - durable environment import
  - advisory-locked admin bootstrap
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

## Secret-file ownership

Long-lived Node business state remains:

```text
/var/lib/all-mail/runtime-secrets.env
  JWT_SECRET
  ENCRYPTION_KEY
```

One-time administrator state remains:

```text
/var/lib/all-mail/bootstrap-admin.env
  ADMIN_USERNAME
  ADMIN_PASSWORD
```

The removed combined bundle remains:

```text
/var/lib/all-mail/bootstrap-secrets.env
```

The initializer exports only the minimum secrets required by Go roles:

```text
worker-forwarding:
  ENCRYPTION_KEY_FILE=/var/lib/all-mail-secrets/encryption-key

go-business-api:
  JWT_SECRET_FILE=/var/lib/all-mail-secrets/jwt-secret
```

The public `app` receives neither file. `go-business-api` now receives the private Redis URL for fail-closed API-key limits, but still receives no encryption key, ingress secret, OAuth credential, or provider credential.

After successful initial password rotation, Fastify removes `bootstrap-admin.env`. Rerunning the initializer does not recreate plaintext or a second administrator. Operator inspection must redact values, for example:

```bash
docker compose exec -T business-api sh -lc '
  sed -n "s/=.*$/=<redacted>/p" /var/lib/all-mail/runtime-secrets.env
'
```

## Public gateway least privilege

`app` receives only static assets, trusted-proxy settings, timeouts, the route manifest, and two internal upstream URLs:

```text
BUSINESS_API_URL=http://business-api:3100
GO_BUSINESS_API_URL=http://go-business-api:3200
```

It receives no `DATABASE_URL`, `REDIS_URL`, JWT secret, or encryption key. The manifest determines ownership; these URLs are transport targets, not mutable ownership switches.

Manifest version 2 supports HTTP-method-specific ownership. The current split is:

```text
GET /admin/dashboard/stats       -> go-business-api
GET /admin/dashboard/api-trend   -> go-business-api
GET /admin/dashboard/logs        -> go-business-api

DELETE /admin/dashboard/logs/:id -> business-api
POST /admin/dashboard/logs/batch-delete -> business-api

/admin/api-keys/** -> go-business-api
Database-only /api mailbox allocation/list/stats/reset -> go-business-api
Database-only /api/domain-mail allocation/list/stats/reset/messages -> go-business-api
/api/domain-mail/messages/text and /mail_text -> business-api
```

Every response carries:

```text
X-All-Mail-Route-Owner
X-All-Mail-Route-Family
```

See [`ROUTE-OWNERSHIP.md`](./ROUTE-OWNERSHIP.md).

## Private Go business service

`go-business-api` is a separate process in the existing Go image:

```bash
allmail business-api
allmail doctor business-api
```

Its administrator and API-key security boundaries mirror the existing Fastify behavior:

1. read the `token` cookie or Bearer token;
2. require HS256;
3. verify signature, expiry, optional not-before, and `admin-console` audience;
4. require a positive administrator subject;
5. reload the administrator from PostgreSQL;
6. reject removed or disabled administrators;
7. reject `mustChangePassword=true` outside the password-change flow.

It uses a bounded PostgreSQL pool with UTC session timezone and a private Redis client. Query parameters are bounded, query contexts are cancelled after a configured timeout, and `/readyz` performs real PostgreSQL and Redis protocol checks. API-key calls preserve Fastify ordering: status/expiry checks, atomic Redis limiting, usage accounting, then per-action permission enforcement.

## Dashboard response contract

Migrated reads preserve the existing envelope:

```json
{"success":true,"data":{}}
```

Errors preserve:

```json
{"success":false,"requestId":"...","error":{"code":"...","details":null}}
```

Behavioral guarantees include:

- `days` is limited to 1–90;
- `page` is positive;
- `pageSize` is limited to 1–100;
- operation-log action filters are bounded;
- trend rows include zero-count dates;
- dates are calculated in UTC;
- operation logs are ordered by time and ID;
- missing API-key/email names remain `-`;
- metadata request IDs are preserved.

The Fastify read handlers remain temporarily for revision rollback. Delete them only after route metrics show zero Fastify traffic for the agreed observation window.

## API-key and external database contract

Go now owns API-key CRUD, one-time raw-key return, SHA-256 lookup, permission aliases/wildcards, status and expiry checks, Redis-backed per-minute limits, `usageCount`/`lastUsedAt`, email and domain mailbox allocation state, and external API audit logs. Database-only external routes are exact Go-owned entries; provider/IMAP/Graph/SMTP operations and regex text extraction remain Fastify-owned.

Redis failure is fail closed for authentication limits and makes `go-business-api` not ready. The Redis URL is private to the Go business service and is never passed to the public gateway.

## Aggregate readiness

Public `/readyz` requires:

1. a valid method-aware route manifest;
2. the built React `index.html`;
3. Fastify `business-api` readiness;
4. private `go-business-api` readiness.

Fastify and the private Go service both check PostgreSQL and Redis for their active security state. A failed required upstream makes the public gateway not ready.

## Metrics

The public `/metrics` endpoint exports route owner, declared methods, request count, bounded method/status labels, inflight requests, latency histogram, and proxy errors by private upstream.

Allowed method labels are:

```text
GET POST PUT PATCH DELETE HEAD OPTIONS OTHER
```

Arbitrary client methods collapse to `OTHER`. Raw paths, users, domains, mailboxes, request IDs, secrets, and exact error text are never labels.

## Trusted proxy contract

`TRUSTED_PROXY_CIDRS` lists only direct tunnel/reverse-proxy peers. `app` rejects forwarded identity from untrusted peers, strips inbound forwarding and ownership headers, and writes one canonical client IP, protocol, host, route owner, and route family. Both private upstreams are not host-published.

## Dedicated workers

Forwarding:

```bash
allmail worker forwarding
allmail doctor worker forwarding
```

The forwarding heartbeat lives at:

```text
/tmp/all-mail/worker-forwarding-heartbeat.json
```

Retention:

```bash
allmail worker retention
allmail doctor worker retention
```

Both workers use independent atomic heartbeats, advisory ownership, bounded passes, shutdown draining, and PostgreSQL protocol checks where applicable.

## Migration guarantees

The Go migration runner uses one direct `pgx` transaction. It loads numbered files lexically, rejects transaction control and direct ledger writes, computes SHA-256 checksums, holds an advisory transaction lock, validates/adopts the ledger, rejects modified or unknown migrations, and records checksums atomically. The Go image contains no `psql`.

Prisma still owns the complete business schema in `business-init`; transferring that authority is a later migration gate.

## Validation evidence

Repository gates cover:

- Go format, race, vet, build, and `govulncheck`;
- method-aware manifest parsing, ambiguity rejection, prefix coverage, bounded metrics, and ownership-header spoof rejection;
- administrator JWT and database-state parity for Dashboard reads;
- Dashboard validation and response fixtures;
- Fastify, Web, and Worker checks;
- real PostgreSQL migrations, retention, and forwarding state machine;
- Compose credential, Secret, and network boundaries;
- full Docker bootstrap, login, forced password rotation, plaintext deletion, initializer idempotency, both private upstreams, and all runtime doctors.

## Current ownership

| Capability | Owner |
| --- | --- |
| Public gateway, SPA, proxy identity | Go `app` |
| Route/method ownership and telemetry | Go `app` + committed manifest |
| Dashboard read APIs | private `go-business-api` |
| Dashboard log deletion | Fastify/Prisma `business-api` |
| Forwarding | `worker-forwarding` |
| Retention | `worker-retention` |
| Initial administrator creation | `business-init` one-shot |
| Administrator login, 2FA, JWT issuance | Fastify/Prisma |
| API-key administration/authentication/limits/allocation | `go-business-api` |
| Database-only external email/domain-mail routes | `go-business-api` |
| OAuth, ingress, provider-dependent and domain/mailbox write operations | Fastify/Prisma |
| Business schema migrations | Prisma in `business-init` |
| Additive runtime migrations | `go-migrate` |
| Cloudflare Email Worker | TypeScript Worker |

## Next ports

Recommended order:

1. Dashboard log deletion with audit/transaction parity;
2. ingress persistence, replay protection, and outbound history;
3. provider-dependent reads, synchronization, OAuth configuration, and sending operations;
4. domain, mailbox, alias, and user writes;
5. mailbox-portal authentication;
6. administrator authentication and OAuth state last;
7. business-schema authority and encrypted-data cutover;
8. zero-traffic observation, then Node/Prisma deletion.

Every slice must move authorization, validation, transactions, parity, failure injection, method-aware manifest ownership, Docker smoke, and revision rollback together.

## Rollback

Rollback is revision based. Preserve PostgreSQL, the runtime secret volume, the forwarding encryption-key volume, and the Go-business JWT volume. Stop the complete revision before starting an older one. Route ownership is never rolled back with an environment flag; deploy the prior known-good revision instead. Never run initializers or workers from two revisions concurrently.
