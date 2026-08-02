# Documentation index

`all-Mail` v2 is a Docker-first, Go-only email control plane. Public documentation describes the supported runtime and operator procedures; historical design and migration notes live under [`internal/`](./internal/README.md).

The supported request path is the public Go `app` gateway forwarding owned business routes to the private Go `go-business-api`; `worker-forwarding` and `worker-retention` remain independent background runtimes. The method-aware ownership contract is documented in [`ROUTE-OWNERSHIP.md`](./ROUTE-OWNERSHIP.md).

The project is **source-available under the custom all-Mail Non-Commercial License**. It is not distributed under an OSI-approved open-source license. Use that wording consistently in public material.

## Operator documentation

| Need | Canonical document |
| --- | --- |
| Install or deploy v2.0 | [`DEPLOY.md`](./DEPLOY.md) |
| Upgrade to a new revision and decide when rollback is safe | [`UPGRADE.md`](./UPGRADE.md) |
| Back up, restore, and rehearse recovery | [`BACKUP-RESTORE.md`](./BACKUP-RESTORE.md) |
| Day-2 diagnosis and incident response | [`RUNBOOK.md`](./RUNBOOK.md) |
| Environment, secret, volume, and network ownership | [`ENVIRONMENT.md`](./ENVIRONMENT.md) |
| Browser, network, cache, database, and secret boundaries | [`SECURITY-BOUNDARIES.md`](./SECURITY-BOUNDARIES.md) |
| Completed Go migration and schema compatibility | [`GO-MIGRATION.md`](./GO-MIGRATION.md) |
| Method-aware route ownership and telemetry | [`ROUTE-OWNERSHIP.md`](./ROUTE-OWNERSHIP.md) |
| Local Go API and React development | [`advanced-runtime.md`](./advanced-runtime.md) |
| External mailbox operations | [`external-email-management-guide.md`](./external-email-management-guide.md) |
| Source-available release gate | [`source-available-release-checklist.md`](./source-available-release-checklist.md) |
| Cloudflare Email Worker ingress | [`../CLOUDFLARE-DEPLOY.md`](../CLOUDFLARE-DEPLOY.md) |

The repository homepage is [`../README.md`](../README.md), the security reporting policy is [`../SECURITY.md`](../SECURITY.md), and support expectations are in [`../SUPPORT.md`](../SUPPORT.md).

## Historical material

- [`UPGRADE-RUNTIME-NAMES.md`](./UPGRADE-RUNTIME-NAMES.md) records the one-time migration-era service-name transition. It is not the current upgrade guide.
- [`internal/runtime-migration-roadmap.md`](./internal/runtime-migration-roadmap.md) records the completed Go route migration.
- [`internal/archive/2026-go-rewrite/`](./internal/archive/2026-go-rewrite/) contains archived plans and status snapshots retained for traceability.
