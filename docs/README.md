# Documentation index

`docs/` is split into two layers:

- **public docs** — operator and GitHub-facing deployment, runtime, recovery, and publication contracts;
- **internal docs** — design notes, implementation plans, deletion gates, and historical references.

The production runtime is Go-only: `app` serves the React SPA and system endpoints, then forwards every business route to the private `go-business-api`. The route migration is complete.

## Public docs

| Need | Canonical document |
| --- | --- |
| Deploy, update, smoke check, and revision rollback | [`DEPLOY.md`](./DEPLOY.md) |
| Upgrade an existing installation to the Go-only topology | [`UPGRADE-RUNTIME-NAMES.md`](./UPGRADE-RUNTIME-NAMES.md) |
| Day-2 troubleshooting and recovery | [`RUNBOOK.md`](./RUNBOOK.md) |
| Environment variables and secret ownership | [`ENVIRONMENT.md`](./ENVIRONMENT.md) |
| Completed Go migration and schema compatibility guarantees | [`GO-MIGRATION.md`](./GO-MIGRATION.md) |
| Method-aware route ownership and private-upstream metrics | [`ROUTE-OWNERSHIP.md`](./ROUTE-OWNERSHIP.md) |
| Local API and frontend development | [`advanced-runtime.md`](./advanced-runtime.md) |
| External mailbox operator guide | [`external-email-management-guide.md`](./external-email-management-guide.md) |
| Source-available release readiness | [`open-source-release-checklist.md`](./open-source-release-checklist.md) |
| Sanitized GitHub-facing screenshots | [`screenshots/`](./screenshots/) |

The repository uses a custom non-commercial source license. Public documentation must not describe it as OSI-approved open source unless the license changes.

The repository homepage remains [`../README.md`](../README.md).

## Internal docs

Maintainer-only material lives under [`internal/`](./internal/README.md).

Migration references:

- [`internal/runtime-migration-roadmap.md`](./internal/runtime-migration-roadmap.md) — completed Go route migration and runtime deletion record;
- [`internal/archive/2026-go-rewrite/`](./internal/archive/2026-go-rewrite/) — historical plans and status snapshots retained for traceability.
