# all-Mail Frontend Hardening + Redesign Spec

Date: 2026-03-28
Status: Approved baseline for planning
Scope: `web/` shell redesign, login refresh, dashboard-first uplift, auth transport hardening, web test coverage, CI enforcement, and one full-stack smoke path

## 1. Objective

Improve the all-Mail frontend so it stops feeling like a generic Ant Design admin and starts feeling like a credible operator control plane.

This spec is intentionally not a pure visual refresh. The approved baseline combines:

- frontend shell redesign
- login experience redesign
- dashboard-first visual uplift
- auth transport tightening
- mandatory web tests in CI
- one end-to-end smoke path

The goal is to increase both product quality and engineering confidence in the same pass.

## 2. Approved Product Direction

The approved direction is:

- redesign the **login page**, **admin shell**, and **dashboard first**
- treat all-Mail as an **operator control plane**, not a marketing-style SaaS site
- keep the visual tone **trust-heavy, restrained, data-dense, and minimal**
- reduce generic Ant Design feeling without abandoning the current React + Ant Design stack
- use the redesign to fix confidence gaps in auth handling, frontend testing, and CI gates

This is the baseline the user approved for the written spec.

## 3. Current-State Evidence

### 3.1 Browser/runtime audit

Fresh browser audit on `http://127.0.0.1:3002/login` found:

- no console errors or warnings during page load
- network requests loaded successfully with HTTP 200 responses
- desktop layout is readable but visually generic
- mobile-width layout remains usable and balanced, with no obvious overflow or clipping

### 3.2 Visual findings

The login page is functional but under-expressive:

- hierarchy is clear enough to use, but not strong enough to feel premium or deliberate
- the screen reads like a polished template, not a distinct product entrance
- whitespace is generous, but the composition feels slightly too airy for an operator product
- CTA presence is acceptable, but the overall page still feels visually safe rather than confident

### 3.3 Codebase findings

Observed frontend/backend implementation details relevant to this spec:

- `web/src/App.tsx` already provides clean top-level separation between admin and mailbox portal experiences
- `web/src/layouts/MainLayout.tsx` is already moving toward a shell system, but the product character is still limited
- `web/src/theme.ts` and `web/src/index.css` define an early token layer, but the visual language is not yet strong enough to carry the product on its own
- `web/src/api/index.ts` still centralizes too much request behavior, response normalization, and auth handling
- `web/src/stores/authStore.ts` and `web/src/stores/mailboxAuthStore.ts` persist bearer tokens in `localStorage`
- backend admin login already sets an `httpOnly` cookie in `server/src/modules/auth/auth.routes.ts`
- `web/package.json` has no formal test script
- `.github/workflows/ci.yml` treats the web test step as optional via `npm run test --if-present`

## 4. Design Contract

### 4.1 Surface

The first-wave redesign surface is:

- login page
- admin shell: sidebar, header, page frame, global spacing, container rhythm
- dashboard first screen
- shared primitives touched by those areas, such as `PageHeader`, `StatCard`, and page surface wrappers

### 4.2 Context of use

all-Mail is an operator-facing mail control plane. The UI must optimize for:

- trust
- clarity
- control
- status readability
- fast scanning of operational information

It should not feel like a consumer inbox app or a startup landing page.

### 4.3 Constraints and taste

Target tone:

- professional
- calm
- infrastructure-grade
- information-dense without clutter
- minimal without feeling empty

Aesthetic rules:

- stronger hierarchy, fewer ornamental blocks
- clear distinction between navigation chrome and work surface
- restrained color system, not rainbow dashboards
- almost no decorative gradients
- minimal visual noise on cards and tables
- subtle motion only

### 4.4 System constraints

- stack remains React + Ant Design + Vite
- design decisions must be token-driven through shared theme/styling primitives
- avoid raw hex values scattered through leaf components
- avoid one-off style mixes between pages that should feel related
- preserve current route semantics and backend feature coverage
- auth redesign should prefer cookie-first transport instead of frontend-managed bearer persistence

### 4.5 Acceptance checks

The redesign is successful only if all of the following are true:

- login page feels like an intentional all-Mail entrance rather than a generic admin template
- admin shell feels cohesive and recognizably product-specific
- dashboard becomes easier to scan within a few seconds of landing
- frontend tests become a required CI gate instead of an optional step
- one login-to-dashboard smoke flow executes successfully in automation
- auth handling is tighter than the current `localStorage` token approach

### 4.6 Non-goals

This phase does not attempt:

- a full rewrite of every business page in one pass
- backend domain logic changes unrelated to auth transport or testability
- a marketing-site restyle
- decorative redesign without structural cleanup

## 5. Target Visual System

### 5.1 Product character

The UI should feel like a **utility-shell operator console**:

- steady, serious, credible
- visually lighter than legacy enterprise software
- denser and more operational than a typical marketing-oriented SaaS dashboard

### 5.2 Color and contrast

Base direction:

- primary: trusted blue
- accent: restrained teal for positive or healthy operational signals
- text: dark, high-legibility slate tones
- background: cool light gray-blue
- surface: clean white or near-white panels
- danger/warning: explicit but not overused

### 5.3 Typography and spacing

- keep Inter as the primary family
- use sharper title/subtitle hierarchy in shell and login surfaces
- use a stable 4/8 spacing rhythm
- reduce loose spacing that makes operational screens feel underfilled
- keep radius around the current 12px family and avoid oversized soft-card styling

### 5.4 Shell rules

Admin shell should emphasize:

- a stable sidebar with product identity and clear active state
- a header that provides context, not just chrome
- a work surface that feels framed and deliberate
- consistent page width, card spacing, and section rhythm

The shell must feel like infrastructure software with polish, not a themed template.

## 6. Login Redesign Rules

The login page should:

- preserve the current dual-purpose intent for admin and mailbox portal entry compatibility
- reduce generic split-layout feeling
- strengthen the product story and system credibility without turning into a sales page
- improve action hierarchy so the primary entry path is unmistakable
- keep desktop and mobile behavior balanced and readable

The login page should not:

- rely on decorative hero art
- use loud gradients or over-marketed copy
- feel sparse on large screens

## 7. Dashboard-First Uplift Rules

The dashboard should become the first proof that the shell system works.

Priority improvements:

- stronger first-screen hierarchy
- clearer KPI grouping
- reduced card-style inconsistency
- cleaner distinction between summary signals and secondary detail blocks
- more disciplined use of emphasis color
- faster operator scanability for health, provider distribution, and recent activity

## 8. Auth Hardening Strategy

### 8.1 Current issue

The backend already sets admin auth cookies, but the frontend still stores and reads tokens from `localStorage`.

That mismatch increases blast radius for XSS and keeps transport semantics inconsistent.

### 8.2 Approved direction

Adopt a **cookie-first frontend auth model**.

Target behavior:

- login depends on server-set auth cookies
- frontend state stores only minimal authenticated-user context
- request interceptors stop reading bearer tokens from `localStorage` for normal authenticated admin and mailbox requests
- logout clears frontend identity state and relies on server-side cookie clearing
- bootstrap and route guards remain explicit, but token transport is no longer owned by leaf frontend code

### 8.3 Boundary

This phase is about transport/storage hardening, not a total auth-system rewrite.

## 9. Web Test + CI Strategy

### 9.1 Web tests

Add a proper web test lane using a modern React test stack.

Minimum required coverage in phase one:

- auth guard behavior for protected routes
- shell/navigation rendering for approved roles
- login happy-path UI state transitions where feasible with mocked contracts
- response/contract normalization behavior for critical auth or dashboard requests

Recommended stack:

- Vitest
- React Testing Library
- jsdom

Tests should live in `web/src/__tests__/` unless a stronger colocated pattern is adopted consistently across the web app.

### 9.2 CI enforcement

The web test step must stop being optional.

Required change:

- `web/package.json` gains a real `test` script
- `.github/workflows/ci.yml` runs that script directly instead of `--if-present`

## 10. End-to-End Smoke Strategy

Add one full-stack smoke path that proves the redesigned surface is not just buildable but usable.

Minimum smoke path:

1. open login page
2. sign in with a test or seeded account
3. land on dashboard
4. verify dashboard shell renders correctly
5. open one representative admin page successfully

Test account provisioning may reuse the existing admin bootstrap mechanism or a dedicated seed path created during implementation planning.

Recommended tool:

- Playwright

This smoke path is intentionally small. Its job is confidence, not exhaustive regression coverage.

## 11. Delivery Phasing

### Phase 1 — shell and design baseline

- finalize token and shell rules
- refresh login page
- refresh admin shell
- normalize shared surface primitives

### Phase 2 — dashboard proof surface

- redesign dashboard first screen using the new shell and token rules
- align shared KPI and content-card patterns

### Phase 3 — engineering confidence layer

- implement cookie-first auth transport cleanup
- add web test setup and first required test cases
- enforce web tests in CI
- add one Playwright smoke path

### Phase 4 — follow-on rollout

- extend the same shell/design language to the next high-traffic business pages
- continue shrinking generic Ant Design page feel through shared primitives rather than one-off restyling

## 12. Success Criteria

This spec succeeds if:

1. the first-view frontend feels materially more productized
2. the UI looks like an operator console rather than a default admin theme
3. auth transport is safer and more consistent than the current browser-storage approach
4. the web frontend gains a mandatory test lane
5. CI becomes stricter instead of more permissive
6. at least one automated end-to-end smoke path proves the redesigned shell works in practice

## 13. Planning Implication

The next step after this approved spec is an implementation plan that sequences:

- visual shell/login/dashboard work
- auth transport refactor
- web test harness setup
- CI enforcement changes
- Playwright smoke creation
- verification checkpoints after each milestone
