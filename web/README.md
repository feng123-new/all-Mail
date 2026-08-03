# all-Mail Web Console

`web/` contains the React + Ant Design administrator console and mailbox portal for `all-Mail`.

## Scope

- dashboard and provider overview;
- mailbox management for Outlook, Gmail, QQ, and the remaining supported providers;
- domain mailbox, portal user, and domain message operations;
- API key, operation log, administrator, and system settings pages;
- sending configuration pages for outbound mail workflows;
- mailbox portal overview, inbox, compose, and account settings.

## Frontend V3 program

The canonical visual and structural migration contract is [`docs/FRONTEND-REFACTOR-PLAN.md`](../docs/FRONTEND-REFACTOR-PLAN.md). It sequences PR #51 through PR #59 and fixes the compatibility, accessibility, responsive-design, verification, and rollback boundaries for the v2.1.0 frontend release.

The product direction is a restrained **mail infrastructure control plane**. New work should prefer shared semantic primitives and theme tokens over page-local card mosaics, raw colors, or one-off inline layout objects.

## Local development

```bash
npm ci
npm run dev
```

By default the frontend talks to the backend through the root deployment or `VITE_DEV_PROXY_TARGET` in `.env.example`.

## Verification

```bash
npm run lint
npm run test
npm run build
```

Repository-level milestone verification runs from the root checkout:

```bash
npm run verify:release
```

## Engineering boundaries

- preserve the existing public URLs and Go business contracts while surfaces are migrated;
- keep browser authentication cookie-first and never persist bearer credentials in browser storage;
- use the shared design tokens, responsive shell, and page primitives for migrated surfaces;
- cover loading, empty, error, disabled, hover, focus-visible, and narrow-screen states;
- keep administrator and mailbox portal experiences visually related while preserving their different density and task priorities.

## Repository hygiene

- product-facing naming must stay aligned with the root repository branding (`all-Mail`);
- do not add live credentials, unsanitized screenshots, or one-off local assets;
- sanitized repository screenshots may be added under `../docs/screenshots/` after manual review and redaction;
- deterministic proof fixtures belong in bounded test/proof modules and must not depend on production secrets.
