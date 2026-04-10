# all-Mail Frontend Redesign Spec

Date: 2026-03-27
Status: Draft approved for planning
Scope: `web/` frontend refactor and visual redesign with backend contract alignment

## 1. Objective

Refactor and beautify the all-Mail frontend so the admin console and mailbox portal feel like one cohesive professional operations SaaS product, while keeping frontend-backend interfaces aligned during the redesign.

This is not a paint-only refresh. The redesign must improve:

- visual consistency
- layout clarity
- component reuse
- frontend module boundaries
- API contract alignment with backend routes and schemas

## 2. Confirmed Product Direction

The redesign direction is:

- unify **admin console** and **mail portal** under one shared design system
- target a **professional operations SaaS** look and feel
- allow **deep refactoring** of frontend structure and information architecture
- preserve backend contract correctness while the UI structure is reworked

The chosen execution approach is:

- **Design system + structural refactor in parallel**

This means the work will improve both appearance and maintainability instead of only refreshing styles.

## 3. Current-State Findings

The current frontend already has a good foundation:

- `web/src/App.tsx` defines two shells implicitly: admin and mailbox portal
- `web/src/layouts/MainLayout.tsx` and `web/src/layouts/MailboxLayout.tsx` already separate the two top-level experiences
- page structure is domain-shaped enough to refactor cleanly (`dashboard`, `emails`, `domains`, `domain-mailboxes`, `mailbox-users`, `domain-messages`, `sending-configs`, `mail-portal/*`)
- shared primitives already exist (`web/src/components/PageHeader.tsx`, `StatCard.tsx`, chart components, utilities)
- frontend requests are centralized enough to be reorganized, but currently over-concentrated in `web/src/api/index.ts`

Primary current weakness:

- request logic, response normalization, auth behavior, and domain-specific contract logic are too concentrated in one large API layer, which increases coupling during deep UI changes

## 4. Target Architecture

The redesigned frontend should move to four explicit layers.

### 4.1 Shell layer

Keep two product shells, but make their responsibilities explicit:

- **Admin shell**: global navigation, top context bar, page framing, role-aware navigation, breadcrumb/header framing
- **Portal shell**: lighter mailbox-focused shell for inbox, overview, and settings

Shells must not own business logic or endpoint knowledge.

### 4.2 Domain feature layer

Move page-level behavior into domain-oriented feature modules rather than letting each `pages/*/index.tsx` accumulate UI, data, and mapping logic.

Initial feature domains:

- dashboard
- emails
- domains
- domain-mailboxes
- mailbox-users
- domain-messages
- sending
- settings
- portal-inbox
- portal-overview
- portal-settings

Each domain should own:

- container/page composition
- local blocks and subcomponents
- view model mapping
- domain hooks/actions
- domain-specific empty/error states

### 4.3 Contract/data layer

Split the current monolithic API module into contract-oriented domain modules.

Representative targets:

- `contracts/admin/emails`
- `contracts/admin/domains`
- `contracts/admin/domain-mailboxes`
- `contracts/admin/sending`
- `contracts/portal/inbox`
- `contracts/shared/auth`

Each contract module is responsible for:

- endpoint definitions
- request parameter shape
- response normalization/parsing
- error mapping
- cache invalidation keys/prefixes

Pages and components must not hardcode `/admin/...`, `/api/...`, or `/mail/api/...` strings.

### 4.4 Design system layer

Introduce a shared design system that both admin and portal consume.

Core reusable primitives should include:

- page header
- KPI/stat cards
- filter bar
- data table shell
- board/list shell
- status badge
- empty state
- detail panel
- form section
- action toolbar

The goal is one visual language with controlled density differences between admin and portal.

## 5. Visual Design System

The product should feel like a trustworthy operator-facing SaaS control plane.

### 5.1 Visual tone

- professional
- clear
- stable
- information-dense without visual noise

### 5.2 Core tokens

- Primary: blue trust tone
- Accent: restrained teal for success/positive operational signals
- Background: light gray-blue surface field
- Surface: white cards and panels
- Typography: Inter
- Radius: 12px
- Shadow: low
- Motion: subtle

### 5.3 Anti-patterns

Avoid:

- decorative gradients
- heavy dashboard chrome
- mixed card styles on the same screen
- playful icon treatment on operational/destructive flows
- weak contrast on primary metrics and state labels

## 6. Page Skeleton Rules

### 6.1 Admin console pages

Use a consistent skeleton:

- sidebar navigation
- top context/header area
- page header
- KPI strip when useful
- filter/action bar
- primary content region (table, board, or split detail layout)

### 6.2 Detail/configuration pages

Use:

- overview/status card
- sectioned forms
- history/log/activity block when relevant

### 6.3 Portal pages

Use the same system, but lighter:

- simpler navigation surface
- more focused content width and hierarchy
- inbox readability prioritized over admin density

## 7. Interface Alignment Strategy

Frontend-backend alignment is a hard requirement during the redesign.

### 7.1 Alignment principles

- frontend contract names should track backend route/schema meaning closely
- frontend should not invent separate terminology for the same backend concept
- endpoint changes should be isolated in contract modules rather than scattered through pages
- response semantics should remain stable even when layout changes deeply

### 7.2 Priority high-risk flows

These areas must be aligned first because they combine high UI importance and contract risk:

- emails
- domain-mailboxes
- portal inbox
- send/sending flows

### 7.3 Contract migration rule

When migrating a domain:

1. identify the backend route/schema/service counterpart
2. define the frontend contract module for that domain
3. move the page to consume the contract module only
4. then refactor layout/components for that domain

This prevents contract drift during visual redesign.

## 8. Implementation Boundaries

This redesign is intentionally deep, but not reckless.

### Allowed

- restructure page composition
- move responsibilities between layouts, domain modules, shared components, and contracts
- redesign navigation and page skeletons
- consolidate repeated UI patterns
- reframe information architecture where it improves clarity

### Not allowed

- backend contract drift hidden behind UI changes
- one-shot full-site rewrite with no migration path
- paint-only restyling that keeps poor frontend boundaries intact

## 9. Delivery Strategy

The redesign should be staged.

### Phase 1

- establish shell rules
- establish token system
- establish shared page skeletons
- split API contracts for priority domains

### Phase 2

Migrate the first representative domains:

- dashboard
- emails
- domain-mailboxes
- portal inbox

### Phase 2b

Before broad rollout, pull the remaining highest-risk contract flow forward:

- sending / outbound flows

This keeps the redesign aligned with the spec's high-risk flow list before the long tail of page migration begins.

### Phase 3

Migrate the remaining admin and portal surfaces using the same design system and contract structure.

## 10. Verification Strategy

Verification is part of the redesign, not an afterthought.

For each migrated domain:

- verify corresponding backend route/schema/service alignment
- run `npm --prefix web run build`
- run relevant backend tests (`npm --prefix server run test` at minimum when contract-touching domains move)
- run `npm run check` at milestone boundaries for repository-level confidence

The redesign is only considered successful when:

- visual language is unified
- shells are coherent
- shared components replace repeated ad hoc structures
- contract logic is domain-scoped and easier to audit
- critical UI flows remain aligned with backend semantics

## 11. Success Criteria

The redesign succeeds if all of the following are true:

1. admin console and portal feel like one product family
2. page hierarchy and navigation become clearer
3. shared UI primitives replace fragmented patterns, with core high-traffic pages adopting the shared skeleton/primitives instead of ad hoc page structure
4. API contract logic becomes domain-scoped instead of monolithic
5. high-risk flows remain backend-aligned during refactor
6. the codebase becomes easier to extend after the redesign, not harder

## 12. Planning Implication

The next step after this approved spec is to produce an implementation plan that sequences:

- shell and design system setup
- contract-layer extraction
- phased domain migration
- verification gates after each milestone
