# Documentation index

`docs/` is split into two layers:

- **public docs** — operator and GitHub-facing deployment, runtime and recovery contracts;
- **internal docs** — design notes, implementation plans, deletion gates and historical references.

## Public docs

| Need | Canonical document |
| --- | --- |
| Deploy, update, smoke check and revision rollback | [`DEPLOY.md`](./DEPLOY.md) |
| Day-2 troubleshooting and recovery | [`RUNBOOK.md`](./RUNBOOK.md) |
| Environment variables and template ownership | [`ENVIRONMENT.md`](./ENVIRONMENT.md) |
| Go/Fastify ownership and migration guarantees | [`GO-MIGRATION.md`](./GO-MIGRATION.md) |
| Local API/frontend development | [`advanced-runtime.md`](./advanced-runtime.md) |
| External mailbox operator guide | [`external-email-management-guide.md`](./external-email-management-guide.md) |
| Open-source release readiness | [`open-source-release-checklist.md`](./open-source-release-checklist.md) |
| Sanitized GitHub-facing screenshots | [`screenshots/`](./screenshots/) |

The repository homepage remains [`../README.md`](../README.md).

## Internal docs

Maintainer-only material lives under [`internal/`](./internal/README.md).

Current migration references:

- [`internal/rewrite/runtime-consolidation-plan.md`](./internal/rewrite/runtime-consolidation-plan.md) — remaining vertical business-route ports and final Fastify removal gates;
- [`internal/rewrite/retire-legacy-runtime-status.md`](./internal/rewrite/retire-legacy-runtime-status.md) — completed Node runtime retirement scope;
- [`internal/rewrite/retire-legacy-runtime-review.md`](./internal/rewrite/retire-legacy-runtime-review.md) — review order for the retirement change.
