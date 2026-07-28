# Documentation index

`docs/` is split into two layers:

- **public docs** — operator and GitHub-facing deployment, runtime and recovery contracts;
- **internal docs** — design notes, implementation plans, deletion gates and historical references.

## Public docs

| Need | Canonical document |
| --- | --- |
| Deploy, update, smoke check and rollback | [`DEPLOY.md`](./DEPLOY.md) |
| Day-2 troubleshooting and recovery | [`RUNBOOK.md`](./RUNBOOK.md) |
| Environment variables and template ownership | [`ENVIRONMENT.md`](./ENVIRONMENT.md) |
| Go/Fastify ownership and migration guarantees | [`GO-MIGRATION.md`](./GO-MIGRATION.md) |
| Secondary source-runtime path | [`advanced-runtime.md`](./advanced-runtime.md) |
| External mailbox operator guide | [`external-email-management-guide.md`](./external-email-management-guide.md) |
| Open-source release readiness | [`open-source-release-checklist.md`](./open-source-release-checklist.md) |
| Sanitized GitHub-facing screenshots | [`screenshots/`](./screenshots/) |

The repository homepage remains [`../README.md`](../README.md).

## Internal docs

Maintainer-only material lives under [`internal/`](./internal/README.md).

The current staged removal plan is:

- [`internal/rewrite/runtime-consolidation-plan.md`](./internal/rewrite/runtime-consolidation-plan.md)

It defines the deletion gates for Node jobs, Fastify routes, dual migration ownership, source-runtime compatibility and final `server/` removal.
