# Internal Documentation Boundary

This subtree is for **maintainer-facing reference material**, not for primary GitHub onboarding.

Use it for:

- design explorations
- implementation plans
- rewrite boundary notes
- internal operator integration notes
- naming and architecture reference material that supports maintainers more than end users

## Current internal sections

| Path | Purpose |
| --- | --- |
| [`desktop/`](./desktop/) | desktop-product explorations and solution planning |
| [`rewrite/`](./rewrite/) | historical rewrite-boundary and migration-reference notes |
| [`ops/`](./ops/) | OpenCode/OpenClaw integration notes and maintainer-side ops references |
| [`standards/`](./standards/) | internal naming and convention guidance |
| [`superpowers/`](./superpowers/) | historical specs and implementation plans generated during maintainer workflows |

## Rule of thumb

If a document explains **how a GitHub user should deploy, operate, or validate `all-Mail`**, it belongs in `docs/` root.

If a document mainly explains **how maintainers designed, planned, or reasoned about changes**, it belongs under `docs/internal/`.
