# Legacy runtime retirement status

This document records the boundary of the `agent/retire-legacy-runtime` change.

## Completed in this change

- removed the TypeScript forwarding worker and API-log retention worker;
- removed the Node jobs entrypoint and heartbeat implementation;
- removed the in-revision rollback worker profile and dual-owner switches;
- split the combined Go jobs process into `worker-forwarding` and `worker-retention`;
- added independent heartbeat files and doctor commands for both Go workers;
- replaced the Go migration runner's `psql` subprocess with direct `pgx` transactions;
- removed `postgresql-client` from the Go runtime image;
- removed Fastify SPA/static hosting and root `public/` staging;
- removed the Node production source launcher;
- added PostgreSQL integration coverage for forwarding claim, lease, retry, idempotency, MOVE, skip and owner-lock behavior.

## Deliberately retained

The Fastify/Prisma process remains the compatibility business API for routes that
have not yet moved to Go. It still owns admin authentication, mailbox-portal
authentication, OAuth, API keys, domain and mailbox management, provider mailbox
operations, ingress business handling, and the legacy business-schema migration
history.

Those capabilities must move as vertical slices with authorization, validation,
transaction, parity and failure-injection coverage. They are not safe to replace
as one undifferentiated rewrite.

## Rollback boundary

The current revision contains one implementation for each background state
machine. Rollback means deploying the previous known-good revision or image,
not starting a hidden second writer from the same revision.
