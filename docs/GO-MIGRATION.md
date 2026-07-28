# Go migration bridge

## Status

The `agent/go-core-rewrite` branch is a migration foundation for local secondary
development. It is not merged automatically and it does not claim full feature
parity with the TypeScript backend yet.

The branch uses a strangler layout:

```text
Browser / automation / Cloudflare Worker
                  |
             Go public API
              /       \
        SPA assets   legacy API proxy
                         |
                 existing Fastify modules
```

This keeps the current UI and API contracts usable while individual modules are
ported to Go behind the same public listener.

## Local workflow

```bash
git fetch origin
git switch agent/go-core-rewrite
cp .env.example .env
docker compose up -d --build
curl http://127.0.0.1:3002/health
curl http://127.0.0.1:3002/readyz
```

To create the Go runtime tables explicitly:

```bash
docker compose run --rm app migrate
```

The legacy API still owns the existing Prisma migration set. The Go migration
command only creates the new runtime coordination tables and is idempotent.

## Service ownership during migration

| Capability | Current writer |
| --- | --- |
| Existing admin/domain/mailbox records | Fastify/Prisma |
| Existing forwarding job state | legacy jobs runtime |
| Go sync cursor and job tables | reserved for Go handlers |
| Public listener, SPA and health endpoints | Go API |
| Cloudflare Email Worker | existing TypeScript Worker |

Do not let the Go and TypeScript runtimes mutate the same state machine at the
same time. Move one capability at a time, add parity tests, then change the
single writer in Compose.

## Suggested next ports

1. Forwarding job claim/send/update loop.
2. Outbound delivery queue with provider idempotency.
3. Gmail History and Microsoft Graph delta synchronization.
4. IMAP UID/UIDVALIDITY synchronization.
5. API-key external allocation/read endpoints.
6. Admin and mailbox portal authentication.

## Rollback

The Go runtime tables are additive. To roll back the public listener, run the
legacy application image directly and leave the new tables in place. Do not drop
runtime tables until any local Go jobs have been stopped and their state has
been reviewed.
