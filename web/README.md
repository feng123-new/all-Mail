# all-Mail Web Console

`web/` contains the React + Ant Design administrator console and mailbox portal for `all-Mail`.

## Scope

- explainable Dashboard and provider overview;
- mailbox management for Outlook, Gmail, QQ, and the remaining supported providers;
- domain mailbox, portal user, and domain message operations;
- API key, audit log, administrator, and system settings pages;
- forwarding and sending configuration for outbound mail workflows;
- Inbox-first mailbox portal with overview, compose, sent history, and account settings.

## Frontend V3

Frontend V3 is complete in all-Mail v2.1.0. The canonical execution record is [`docs/FRONTEND-REFACTOR-PLAN.md`](../docs/FRONTEND-REFACTOR-PLAN.md).

The product direction is a restrained **mail infrastructure control plane**. New work must prefer shared semantic primitives and theme tokens over page-local card mosaics, raw colors, decorative gradients, or one-off inline layout objects.

Current shared foundations include:

- grouped and responsive administrator navigation;
- responsive mailbox-portal navigation with Inbox-first landing;
- route-specific resource, mail-flow, security-boundary, and portal context;
- cookie-first authentication with server-triggered OTP;
- explainable Dashboard risk counts;
- semantic status, focus-visible, reduced-motion, and narrow-screen behavior;
- bundle budgets and desktop/mobile Chromium regression smoke.

## Local development

```bash
npm ci
npm run dev
```

By default the frontend talks to the backend through the root deployment or `VITE_DEV_PROXY_TARGET` in `.env.example`. Only `/mail/api` is proxied; `/mail/login`, `/mail/inbox`, `/mail/overview`, and `/mail/settings` remain React SPA routes.

## Verification

```bash
npm run lint
npm run test
npm run build
npm run check:budget
```

The browser smoke is intentionally installed and run by the release-required CI contract so Playwright does not become a production or application lockfile dependency:

```bash
npm run test:browser
```

Repository-level milestone verification runs from the root checkout:

```bash
npm run verify:release
```

## Engineering boundaries

- preserve existing public URLs and Go business contracts;
- keep browser authentication cookie-first and never persist bearer credentials or passwords in browser storage;
- use the shared design tokens, responsive shells, workspace contexts, and page primitives;
- cover loading, empty, error, disabled, hover, focus-visible, reduced-motion, and narrow-screen states;
- keep administrator and mailbox portal experiences visually related while preserving their different density and task priorities;
- keep the Dashboard based on inspectable state rather than invented aggregate scores;
- keep normal mailbox users landing on Inbox while mandatory password rotation continues to win over every other portal route.

## Repository hygiene

- product-facing naming must stay aligned with the root repository branding (`all-Mail`);
- do not add live credentials, unsanitized screenshots, or one-off local assets;
- sanitized repository screenshots may be added under `../docs/screenshots/` after manual review and redaction;
- deterministic proof fixtures belong in bounded test/proof modules and must not depend on production secrets;
- Playwright reports, traces, screenshots, and videos are CI artifacts and must not be committed.
