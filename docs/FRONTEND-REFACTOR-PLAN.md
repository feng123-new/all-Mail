# all-Mail Frontend V3 Refactor Plan

Date: 2026-08-04
Status: Approved for execution
Target release: v2.1.0
Scope: PR #51 through PR #59

## 1. Purpose

The Go-only v2 runtime is stable, but the React console still presents too much of the product as a generic Ant Design administration template. This plan upgrades the complete web surface without changing the public route contract, Go authorization model, database schema, secret layout, or production topology.

The refactor must make all-Mail feel like a mail-infrastructure control plane:

- calm and operational rather than decorative;
- dense enough for administration work without becoming crowded;
- explicit about health, risk, ownership, and next actions;
- consistent between the administrator console and mailbox portal;
- responsive, keyboard accessible, and regression tested;
- maintainable through shared primitives rather than page-local style fragments.

## 2. Fixed constraints

The following boundaries are not negotiable during this program:

1. React, TypeScript, Vite, Ant Design, Axios, Zustand, i18next, and the existing Go business contracts remain the supported stack.
2. Existing browser URLs and route authorization semantics remain compatible.
3. Authentication remains cookie-first. No bearer token may be persisted in localStorage or sessionStorage.
4. The public Go gateway and private Go business API ownership model remains unchanged.
5. No database migration, durable secret rotation, or provider credential rewrite is introduced by a visual refactor.
6. Every PR must be independently testable, mergeable, and reversible.
7. New page styling must be token-driven. Raw color values and one-off layout objects must not spread through leaf pages.
8. Loading, empty, error, disabled, hover, focus-visible, and narrow-screen states are first-class acceptance requirements.

## 3. Product direction

### 3.1 Product identity

all-Mail is a **mail infrastructure control plane**, not a consumer inbox, marketing dashboard, or generic enterprise starter.

### 3.2 Visual posture

- trusted blue for primary interaction;
- restrained green/teal for healthy operational signals;
- warning and danger colors only for semantic state;
- cool neutral canvas and quiet white surfaces;
- 8–12 px control and surface radius;
- borders and spacing provide most separation; shadows stay subtle;
- one dominant work surface per page;
- sparse primary actions and compact secondary utilities;
- no decorative gradients, glow, rainbow badges, or nested card mosaics.

### 3.3 Information architecture

Administrator navigation is grouped without changing URLs:

- Overview
  - Dashboard
- Mail resources
  - Mailbox connections
  - Domains
  - Domain mailboxes
  - Portal users
- Mail flow
  - Domain messages
  - Forwarding jobs
  - Sending configuration
- Automation and audit
  - API keys
  - API documentation
  - Audit logs
- System
  - Administrators
  - Settings

The mailbox portal remains a related but lighter experience:

- Overview
- Inbox
- Settings

## 4. Target frontend architecture

```text
web/src/
├── app/
│   ├── routeMeta.ts
│   └── navigation.tsx
├── components/
│   ├── AppShell/
│   ├── DataToolbar/
│   ├── EmptyState/
│   ├── ErrorState/
│   ├── FilterBar/
│   ├── FormSection/
│   ├── MetricStrip/
│   ├── SectionHeader/
│   ├── StatusBadge/
│   └── existing shared primitives
├── features/
│   ├── dashboard/
│   ├── mailbox-connections/
│   ├── mail-resources/
│   ├── mail-flow/
│   ├── automation/
│   └── portal/
├── contracts/
├── layouts/
├── pages/
├── styles/
└── theme.ts
```

The migration is incremental. Existing page routes may continue to load from `pages/` while composition, hooks, and reusable blocks move into `features/`.

## 5. PR sequence

## PR #51 — Frontend V3 program contract

**Goal:** establish one canonical plan and supersede overlapping historical frontend specifications.

Changes:

- add this plan as the execution contract;
- document the visual, architectural, compatibility, verification, and rollback boundaries;
- link the plan from the web console documentation;
- record the expected PR sequence and completion criteria.

Verification:

- documentation links resolve;
- the existing complete CI and release gates remain green.

Rollback:

- documentation-only revert.

## PR #52 — Design system, responsive shell, and navigation

**Goal:** make every page inherit a coherent product shell before leaf-page redesign begins.

Changes:

- normalize semantic theme tokens, radius, spacing, typography, borders, shadows, and motion;
- add route metadata and grouped administrator navigation;
- refactor `MainLayout` and `MailboxLayout` around shared responsive shell behavior;
- add mobile drawers and remove fixed desktop assumptions on narrow screens;
- make the header show current route context instead of a fixed generic label;
- refine `PageHeader`, `PageSurface`, `SurfaceCard`, and `StatCard`;
- replace shell-specific inline styling with durable classes and semantic primitives.

Verification:

- administrator and portal shell tests;
- keyboard navigation and focus-visible checks;
- 390 px, 768 px, and 1440 px layout checks;
- web lint, tests, and production build;
- full repository CI.

Rollback:

- route and contract files remain unchanged, so the previous shell can be restored without backend action.

## PR #53 — Authentication entry and dashboard operating surface

**Goal:** replace the template-like first impression and make the dashboard action-oriented.

Changes:

- simplify administrator and portal login composition;
- make the form primary and supporting product context secondary;
- show OTP UI only after the server requires it;
- preserve automatic account-type compatibility while making the behavior explicit;
- restructure Dashboard around intervention, core metrics, trend, distribution, and recent activity;
- remove the opaque client-calculated `/100` health score;
- reduce repeated hero badges and nested card treatment;
- retain local proof modes for deterministic regression evidence, but isolate fixture concerns from normal production flow.

Verification:

- administrator and portal login tests;
- forced-password-change and OTP route tests;
- dashboard proof-mode tests in Chinese and English;
- dashboard loading, empty, degraded, and success states;
- complete CI.

Rollback:

- no auth protocol or Go endpoint changes; restore the prior React surfaces only.

## PR #54 — Mail-resource management surfaces

**Goal:** unify the highest-traffic resource pages and reduce the mailbox-connections god page.

Changes:

- introduce shared data-page, toolbar, filter, status, empty, error, detail, and form-section primitives;
- split mailbox connection list, filters, row actions, details, and create/edit flow into bounded modules;
- apply the shared resource skeleton to domains, domain mailboxes, and portal users;
- standardize table density, batch action behavior, drawers/modals, and destructive confirmations;
- keep provider capability details inside connection detail/setup contexts instead of the primary list surface.

Verification:

- mailbox connection CRUD/import/export/OAuth behavior tests;
- domains, domain-mailboxes, and portal-user tests;
- query-string filter compatibility;
- permissions and `SUPER_ADMIN` export visibility;
- complete CI and Docker smoke.

Rollback:

- contracts and routes remain stable; each page can revert independently.

## PR #55 — Mail-flow workspace

**Goal:** give messages, forwarding, and sending one coherent operational language.

Changes:

- standardize mail-flow states and status presentation;
- redesign domain messages for scan, preview, and detail workflows;
- make forwarding failures, retries, leases, next-attempt time, and terminal state easy to inspect;
- reorganize sending configuration around provider readiness, sender identity, recipients, approval, and test-send actions;
- reduce decorative tags and move secondary details into expandable rows or drawers;
- add consistent request IDs and failure context where already provided by contracts.

Verification:

- message detail and content-sanitization tests;
- forwarding state/filter/action tests;
- recipient parsing and sending configuration tests;
- empty, error, retry, and permission states;
- complete CI and Docker smoke.

Rollback:

- no forwarding worker or sending provider semantics change.

## PR #56 — Automation, audit, and system administration

**Goal:** finish the administrator long tail with the same design system.

Changes:

- redesign API-key inventory, permission summaries, one-time secret reveal, and usage context;
- make API documentation a focused reference surface rather than a generic card page;
- convert operation logs into a full-width audit workspace with filters and request detail;
- align administrator management and settings sections with shared form and status primitives;
- standardize dangerous actions, confirmation language, and role visibility.

Verification:

- API-key, audit-log, administrator, and settings tests;
- secret reveal remains one-time and permission controlled;
- password, 2FA, and role-change flows remain compatible;
- complete CI.

Rollback:

- UI-only rollback; security and session contracts are unchanged.

## PR #57 — Mailbox portal inbox-first redesign

**Goal:** turn the portal into a focused mailbox workspace rather than a smaller administration console.

Changes:

- refine the portal shell and mailbox identity/switching context;
- make unread work, verification codes, inbox navigation, and message detail primary;
- demote mailbox inventory to supporting context;
- tighten compose, forwarding, and account safety actions;
- make portal overview, inbox, login, and settings responsive and visually related to the administrator console;
- preserve mandatory password rotation and mailbox assignment enforcement.

Verification:

- portal session bootstrap and login tests;
- overview proof mode;
- inbox list/detail/read behavior;
- compose and settings flows;
- 390 px narrow-screen portal checks;
- complete CI and Docker smoke.

Rollback:

- portal contracts and Go authorization remain unchanged.

## PR #58 — Accessibility, performance, and browser regression gate

**Goal:** turn design quality into an enforced engineering contract.

Changes:

- add a small Playwright smoke suite for administrator login-to-dashboard and portal login-to-inbox;
- add deterministic screenshot-ready proof routes without live secrets;
- enforce keyboard focus, accessible labels, reduced-motion handling, and contrast-safe semantic states;
- verify chart and heavy form lazy loading;
- add bundle budget reporting and remove accidental duplicate dependencies;
- extend CI so browser smoke and design-contract checks are mandatory.

Verification:

- Vitest and React Testing Library suites;
- Playwright desktop and mobile smoke;
- production build and bundle budget;
- full repository CI, security, Docker, bootstrap, and release gates.

Rollback:

- browser gate may be reverted independently; production behavior is unchanged.

## PR #59 — Cleanup, documentation, and v2.1.0 publication

**Goal:** close the migration and publish the complete frontend release.

Changes:

- remove superseded style helpers, dead page fragments, obsolete proof coupling, and unused imports;
- archive the 2026-03-27, 2026-03-28, and 2026-04-05 overlapping frontend specifications as historical inputs;
- update web and root documentation with the new information architecture and development workflow;
- add a dated v2.1.0 changelog entry and canonical version identity;
- publish the normal checksummed binaries and shared multi-architecture image through the existing release workflow;
- retain the v2.0 data, secret, route, and upgrade compatibility boundary.

Verification:

- no new raw-color/style drift in migrated surfaces;
- no retired frontend helpers remain referenced;
- all web tests and browser smoke pass;
- full Go, Worker, dependency, Docker, security, bootstrap, cross-platform, and release gates pass;
- release identity, tag, image, assets, changelog, and version agree.

Rollback:

- no database migration or secret rotation is included. Roll back the complete application revision using the normal v2 upgrade procedure; persisted state remains compatible with v2.0.1.

## 6. Required checks for every implementation PR

At minimum:

```bash
npm --prefix web run lint
npm --prefix web run test
npm --prefix web run build
```

At milestone boundaries and before merge:

```bash
npm run verify:release
```

GitHub must also report the repository-required Go, Worker, dependency, Docker, security, bootstrap, and release-contract checks as successful for the exact PR head.

## 7. Design acceptance matrix

| Surface | Desktop | Tablet | Mobile | Loading | Empty | Error | Keyboard | English/Chinese |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Admin login | required | required | required | required | n/a | required | required | required |
| Dashboard | required | required | required | required | required | required | required | required |
| Mailbox connections | required | required | required | required | required | required | required | required |
| Domain resources | required | required | required | required | required | required | required | required |
| Mail flow | required | required | required | required | required | required | required | required |
| Automation/system | required | required | required | required | required | required | required | required |
| Portal | required | required | required | required | required | required | required | required |

## 8. Completion definition

The program is complete only when:

1. PR #51 through PR #59 are merged in order;
2. administrator navigation is grouped and responsive;
3. login and Dashboard no longer read as generic template surfaces;
4. high-traffic resource and mail-flow pages share a coherent skeleton;
5. mailbox portal is inbox-first and mobile usable;
6. cookie-first authentication and existing Go authorization remain intact;
7. web tests, browser smoke, build, Docker smoke, security gates, and release gates pass;
8. v2.1.0 is published with no database migration or secret rotation;
9. obsolete frontend design documents and style fragments are archived or removed;
10. main contains no unfinished refactor branch dependency.
