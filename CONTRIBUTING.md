# Contributing to all-Mail

Thanks for contributing to `all-Mail`.

## Scope

This repository is the primary home of the `all-Mail` project.

Please keep contributions aligned with the current product scope:

- external mailbox provider management
- domain mailbox operations
- mailbox portal flows
- ingress / sending / operational tooling
- deployment and operator documentation

## Before opening a pull request

1. Read `README.md` for project positioning and the canonical doc map.
2. Read `docs/DEPLOY.md`, `docs/ENVIRONMENT.md`, and `docs/RUNBOOK.md` if your change affects setup, runtime behavior, or operator workflows.
3. Read `PROVENANCE.md` for source acknowledgement rules.
4. Prefer `all-Mail` terminology in product-facing text, docs, and helper scripts.
5. Do not reintroduce historical upstream branding into the main README or current operator flows.
6. Follow `CODE_OF_CONDUCT.md` in all project interactions.

## Canonical local contributor flow

### 1. Install dependencies

```bash
npm run install:all
npm --prefix cloudflare/workers/allmail-edge ci
```

### 2. Choose a runtime path

- **Default**: follow `docs/DEPLOY.md` and use Docker Compose.
- **Secondary**: use `docs/advanced-runtime.md` only when you intentionally need the compiled source-runtime path.

### 3. Build what the repo ships

```bash
./bin/all-mail build
```

This runs the repo-root build contract:

- `build:server` → Prisma client generation + backend build
- `build:web` → frontend build + `public/` preparation

### 4. Verify before review

Use repo-root verification commands as the default contributor contract:

```bash
./bin/all-mail doctor
./bin/all-mail check
```

Notes:

- `./bin/all-mail doctor` is the readiness check (env resolution, PostgreSQL, Redis, build artifacts).
- `./bin/all-mail check` is the full local release gate (`lint + test + build:server + build:web + worker check`).
- If your shell exports `NODE_USE_ENV_PROXY` or `HTTP[S]_PROXY`, prefer the `./bin/all-mail ...` entrypoints because they sanitize those startup flags before Node/npm bootstraps.
- If `./bin/all-mail doctor` cannot pass because your environment intentionally lacks running services, say that explicitly in your PR and still run the strongest truthful local gate available.

## Pull request expectations

- Keep changes scoped.
- Explain why the change is needed.
- Include verification evidence.
- Acknowledge docs updates when setup, commands, or behavior changed.
- Add rollback and migration notes when deploy/runtime behavior is affected.
- Avoid mixing refactors, feature work, and operational cleanups in one PR when possible.

## Branding and provenance rules

- Use `all-Mail` as the primary project name.
- Use `all-Mail Cloud` only when referring to the Cloudflare-oriented edge branch or deployment shape.
- Use `allmail-edge` only for the worker/runtime identifier.
- Keep upstream acknowledgements in `PROVENANCE.md` rather than scattering them through core docs.

## Secrets and local runtime files

Do not commit:

- `.env` files with real secrets
- OAuth runtime outputs
- local screenshots and one-off migration artifacts
- generated build output unless a release workflow explicitly requires it

## Review checklist

Before requesting review, confirm:

- `./bin/all-mail check` passed, or you documented the strongest truthful substitute
- setup/behavior docs were updated if needed
- rollback impact is described for release-affecting changes
- migration impact is described for schema/deploy-flow changes

Also make sure the repo still reads like a standalone `all-Mail` project, not a personal mixed workspace snapshot.
