# Documentation Index

`docs/` is split into two clear layers:

- **public docs** — the operator and GitHub-facing documents that describe how to deploy, run, and maintain `all-Mail`
- **internal docs** — design notes, implementation plans, rewrite checklists, and other historical reference material that are not part of the primary onboarding path

## Public docs

Use these files as the canonical product and operations contract:

| Need | Canonical doc |
| --- | --- |
| Deploy, update, smoke check, rollback | [`DEPLOY.md`](./DEPLOY.md) |
| Day-2 troubleshooting and recovery | [`RUNBOOK.md`](./RUNBOOK.md) |
| Environment variables and template ownership | [`ENVIRONMENT.md`](./ENVIRONMENT.md) |
| Secondary source-runtime path | [`advanced-runtime.md`](./advanced-runtime.md) |
| External mailbox operator guide | [`external-email-management-guide.md`](./external-email-management-guide.md) |
| Open-source release readiness | [`open-source-release-checklist.md`](./open-source-release-checklist.md) |
| Sanitized GitHub-facing screenshots | [`screenshots/`](./screenshots/) |

If you entered this directory from the repository homepage, the main entrypoint is still [`../README.md`](../README.md).

## Internal docs

Internal-only reference material now lives under [`internal/`](./internal/README.md).

These files may still be useful for maintainers, but they are not the user-facing setup/tutorial path and should not be treated as the canonical operating contract.
