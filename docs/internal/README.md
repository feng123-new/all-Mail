# Internal Documentation Boundary

This subtree is for **maintainer-facing reference material**, not for primary GitHub onboarding.

Use it for:

- design explorations;
- implementation plans;
- rewrite boundary notes;
- internal operator integration notes;
- naming and architecture reference material that supports maintainers more than end users.

## Current internal sections

| Path | Purpose |
| --- | --- |
| [`desktop/`](./desktop/) | Desktop-product explorations and solution planning |
| [`rewrite/`](./rewrite/) | Rewrite boundaries, migration references and the staged legacy-removal plan |
| [`rewrite/runtime-consolidation-plan.md`](./rewrite/runtime-consolidation-plan.md) | Current deletion gates for Node jobs, Fastify routes, dual migrations and compatibility runtimes |
| [`ops/`](./ops/) | OpenCode/OpenClaw integration notes and maintainer-side ops references |
| [`standards/`](./standards/) | Internal naming and convention guidance |
| [`superpowers/`](./superpowers/) | Historical specs and implementation plans generated during maintainer workflows |

## Rule of thumb

If a document explains **how a GitHub user should deploy, operate or validate `all-Mail`**, it belongs in the `docs/` root.

If a document mainly explains **how maintainers designed, planned or reasoned about changes**, it belongs under `docs/internal/`.
