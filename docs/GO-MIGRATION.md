# Go migration boundary

## Status

The Go runtime is the canonical Docker entrypoint. Migration is complete for public HTTP ownership, SPA delivery, forwarding, and API-log retention, but not for the complete business API.

```text
Browser / automation / Cloudflare Worker
                  |
             Go public gateway
              /       \
        React SPA    business API proxy
                         |
                 Fastify / Prisma
```

Go owns:

- public listener, trusted-proxy normalization, SPA, request IDs, security headers, liveness/readiness and metrics;
- additive Go migrations;
- forwarding;
- API-log retention.

Fastify/Prisma owns database-backed authentication, OAuth, API keys, domain/mailbox administration, provider operations, ingress business handling, and business-schema migrations.

The environment-backed administrator has been removed. Initial administrator creation is a one-shot initializer responsibility.

## Runtime layout

```text
business-init         secrets + Prisma migrations + initial DB administrator
go-migrate          additive checksummed Go migrations
app                 Go public gateway, SPA and compatibility proxy
worker-forwarding   independent Go forwarding runtime
worker-retention    independent Go retention runtime
business-api          internal Fastify/Prisma business API
postgres            private database
redis               private OAuth/rate-limit/replay/cache backend
```

## Startup ordering

```text
postgres healthy
      |
      v
business-init
  - split old secret bundle
  - establish runtime secrets
  - Prisma migrate
  - advisory-locked admin bootstrap
      |
      v
go-migrate
      |
      +-----------------------------+
      |                             |
      v                             v
business-api healthy               Go workers
      |
      v
     app
```

`business-init` does not depend on Redis. Long-running services do not migrate schema or create administrators.

## Administrator ownership

`business-init` accepts one-shot `ADMIN_USERNAME`/`ADMIN_PASSWORD`, or generates a password when blank. Under PostgreSQL advisory transaction lock `(421337, 240730)` it:

1. inspects existing administrators;
2. creates a `SUPER_ADMIN` only when none exist;
3. marks it `mustChangePassword=true`;
4. persists the one-time credential separately;
5. never changes an existing administrator password.

Fastify receives no administrator credentials. Login always resolves a positive database administrator ID that still exists and is active. Removed paths:

```text
ensureBootstrapAdmin()
login-time account creation
environment password authentication
adminId=0 virtual administrator
ADMIN_2FA_SECRET
legacyEnv
DOMAIN_BOOTSTRAP_ADMIN_*
```

Administrator 2FA is database-managed.

## Secret-file ownership

Long-lived:

```text
/var/lib/all-mail/runtime-secrets.env
  JWT_SECRET
  ENCRYPTION_KEY
```

One-time:

```text
/var/lib/all-mail/bootstrap-admin.env
  ADMIN_USERNAME
  ADMIN_PASSWORD
```

Removed/migrated:

```text
/var/lib/all-mail/bootstrap-secrets.env
```

The old combined file is split atomically and removed. Historical custom usernames are recovered by comparing the preserved password with pending administrator hashes.

After successful initial password rotation, Fastify removes `bootstrap-admin.env`. Rerunning the initializer does not recreate plaintext or a second administrator.

The forwarding worker accepts only:

```text
ENCRYPTION_KEY_FILE=/var/lib/all-mail-secrets/encryption-key
```

## Public gateway least privilege

The Go gateway owns no native business route yet, so it receives no `DATABASE_URL` or `REDIS_URL`.

Its `/readyz` checks:

1. the built React `index.html`;
2. Fastify `/readyz` protocol/payload.

Fastify verifies PostgreSQL and Redis.

## Trusted proxy contract

`TRUSTED_PROXY_CIDRS` lists only direct tunnel/reverse-proxy peers. Go rejects forwarded identity from untrusted peers, strips all inbound forwarding headers, and writes one canonical client IP/protocol/host. Fastify trusts exactly one internal Go hop and is not host-published.

## Dedicated workers

### Forwarding

```bash
allmail worker forwarding
allmail doctor worker forwarding
```

Guarantees include advisory single ownership, `FOR UPDATE SKIP LOCKED`, claim tokens, configurable expiring leases, immediate release of unprocessed claims after an interrupted pass, fenced terminal updates, transactional MOVE visibility, stable provider idempotency, structured retry classification, and bounded passes.

### Retention

```bash
allmail worker retention
allmail doctor worker retention
```

Uses a persistent `pgxpool`, periodic database health probes, an advisory transaction lock, bounded consecutive batches, ordered deletion and `FOR UPDATE SKIP LOCKED`.

Each worker writes an independent atomic heartbeat. Canonical controls:

```text
WORKER_HEARTBEAT_SECONDS=15
WORKER_HEARTBEAT_MAX_AGE_SECONDS=90
```

## Migration guarantees

The Go migration runner uses one direct `pgx` transaction. It:

1. loads numbered files lexically;
2. rejects transaction control, psql meta-commands and direct ledger writes;
3. computes SHA-256 checksums;
4. holds an advisory transaction lock;
5. validates/adopts the ledger;
6. skips only exact checksum matches;
7. rejects modified applied files;
8. rejects ledger entries unknown to the current image so an old runtime cannot silently start on a newer schema;
9. records checksums atomically.

The Go image contains no `psql`. Never edit an applied numbered migration.

## Production networking

`docker-compose.yml` publishes only `app`. Local dependency ports belong to `docker-compose.dev.yml`.

## Validation evidence

Repository gates cover:

- Go format/race/vet/build;
- Fastify lint/test/build;
- web lint/test/build;
- runtime contracts;
- real PostgreSQL migrations and forwarding state machine;
- proxy spoof rejection;
- Compose credential/exposure boundaries;
- real PostgreSQL administrator bootstrap;
- full Docker first-login, forced password rotation, plaintext deletion, and initializer idempotency.

## Current ownership

| Capability | Owner |
| --- | --- |
| Public gateway/SPA/proxy identity | Go `app` |
| Forwarding | `worker-forwarding` |
| Retention | `worker-retention` |
| Initial administrator creation | `business-init` one-shot |
| Administrator login/2FA/session | Fastify/Prisma database-backed |
| Other business APIs | Fastify/Prisma |
| Business schema migrations | Prisma in `business-init` |
| Additive runtime migrations | `go-migrate` |
| Cloudflare Email Worker | TypeScript Worker |

## Next ports

Recommended order:

1. read-only dashboard/status routes;
2. external API-key allocation/read routes;
3. ingress persistence;
4. outbound delivery history;
5. provider synchronization;
6. domain/mailbox writes;
7. portal authentication;
8. administrator authentication last.

Every slice must move authorization, validation, transactions, parity tests and failure injection together.

## Rollback

Rollback is revision based. Preserve PostgreSQL plus both new secret files and a pre-upgrade copy of any old combined file. Restore the layout expected by the target revision. Never run initializers or workers from two revisions concurrently.
