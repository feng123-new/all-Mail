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

1. Read `README.md` for project positioning.
2. Read `PROVENANCE.md` for source acknowledgement rules.
3. Prefer `all-Mail` terminology in product-facing text, docs, and helper scripts.
4. Do not reintroduce historical upstream branding into the main README or current operator flows.
5. Follow `CODE_OF_CONDUCT.md` in all project interactions.

## Local development

### Web

```bash
cd web
npm ci
npm run lint
npm run build
```

### Server

```bash
cd server
npm ci
npm run lint
npm run build
npm run test
```

## Pull request expectations

- Keep changes scoped.
- Explain why the change is needed.
- Mention any user-facing naming or doc changes explicitly.
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

Before requesting review, run:

```bash
cd web && npm run lint && npm run build
cd ../server && npm run lint && npm run build && npm run test
```

Also make sure the repo still reads like a standalone `all-Mail` project, not a personal mixed workspace snapshot.
