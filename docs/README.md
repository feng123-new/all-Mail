# Documentation index

`docs/` is split into two layers:

- **public docs** — operator and GitHub-facing deployment, runtime and recovery contracts;
- **internal docs** — design notes, implementation plans, deletion gates and historical references.

The active transition uses a least-privilege public Go gateway plus two private business upstreams: migrated API-key and database-backed business routes run in `go-business-api`, while remaining routes continue in the Fastify/Prisma `business-api`.

## Public docs

| Need | Canonical document |
| --- | --- |
| Deploy, update, smoke check and revision rollback | [`DEPLOY.md`](./DEPLOY.md) |
| Upgrade across the runtime service-name cutover | [`UPGRADE-RUNTIME-NAMES.md`](./UPGRADE-RUNTIME-NAMES.md) |
| Day-2 troubleshooting and recovery | [`RUNBOOK.md`](./RUNBOOK.md) |
| Environment variables and template ownership | [`ENVIRONMENT.md`](./ENVIRONMENT.md) |
| Go/Fastify ownership and migration guarantees | [`GO-MIGRATION.md`](./GO-MIGRATION.md) |
| Method-aware route ownership, private upstream metrics, and cutover procedure | [`ROUTE-OWNERSHIP.md`](./ROUTE-OWNERSHIP.md) |
| Local API/frontend development | [`advanced-runtime.md`](./advanced-runtime.md) |
| External mailbox operator guide | [`external-email-management-guide.md`](./external-email-management-guide.md) |
| Open-source release readiness | [`open-source-release-checklist.md`](./open-source-release-checklist.md) |
| Sanitized GitHub-facing screenshots | [`screenshots/`](./screenshots/) |

The repository homepage remains [`../README.md`](../README.md).

## Internal docs

Maintainer-only material lives under [`internal/`](./internal/README.md).

Current migration references:

- [`internal/runtime-migration-roadmap.md`](./internal/runtime-migration-roadmap.md) — current `go-business-api` cutover, remaining vertical Go ports, and final Node/Prisma deletion gates;
- [`internal/archive/2026-go-rewrite/`](./internal/archive/2026-go-rewrite/) — historical plans and status snapshots retained for traceability.
