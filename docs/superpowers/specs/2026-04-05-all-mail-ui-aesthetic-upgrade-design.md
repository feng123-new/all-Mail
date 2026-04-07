# all-Mail UI Aesthetic Upgrade Spec

Date: 2026-04-05
Status: Approved for implementation
Scope: `web/` visual refactor of the admin shell, dashboard-first surface, auth entry surfaces, and mailbox portal overview

## 1. Objective

Upgrade the existing all-Mail frontend so it feels like a deliberate mail-infrastructure control plane instead of a polished generic admin template.

This is not a bugfix pass and not a color-only refresh. The work should improve:

- visual hierarchy
- spacing rhythm and density balance
- component restraint
- shell quietness
- product tone consistency across admin and portal surfaces

The redesign must preserve current functionality and route semantics.

## 2. Current-State Diagnosis

### 2.1 Core visual problems

- too many blocks read at the same visual level
- the shell chrome remains too present relative to the main work surface
- cards, tags, and action buttons appear too frequently and with too little hierarchy discipline
- the dashboard reads as a composition of useful panels rather than one strong operating surface
- login surfaces are clear but still feel like composed templates instead of a product entrance

### 2.2 What is process debt rather than pure aesthetics

- there is no all-Mail-specific durable proof/context pack in the repo
- published durable workbench artifacts target the frontend-workbench surface, not all-Mail
- shared primitives exist, but they are reused without a strong surface-specific temperament contract
- leaf pages still rely heavily on per-page inline style objects, which makes rhythm drift easier

### 2.3 Category diagnosis

#### Hierarchy

- dashboard header, hero, KPI strip, and secondary panels compete too evenly
- the shell and page chrome stay louder than they should for an operator console
- portal overview gives similar visual weight to unread work and secondary mailbox inventory

#### Rhythm

- too many sections use similar card boundaries, similar title treatment, and similar padding
- the reading tempo is flat: title -> card -> card -> card

#### Density balance

- top-level summaries and lower-level details repeat adjacent signals instead of creating a clear drill-down
- provider and mailbox inventory surfaces consume more visual area than their decision value justifies

#### Component restraint

- tags often function as decoration or labeling instead of true state expression
- primary, link, and secondary actions do not yet follow a strict emphasis ladder
- many surfaces still read as card collections instead of one composed work area with supporting detail

#### Brand / tone fit

- the current UI is competent and clean but still feels like a refined admin starter rather than a product with its own operating tone
- visual language does not yet fully match “mail infrastructure control plane”

## 3. Approved Product Direction

The approved direction is:

- treat all-Mail as a restrained operator console
- keep the visual tone calm, serious, and trust-heavy
- strengthen one dominant work surface per page
- make shell chrome supportive rather than attention-seeking
- preserve the current React + Ant Design stack and shared component model
- prefer minimal diff over broad structural rewrite

## 4. Brief

### 4.1 Aesthetic Master

Calm Professional

Reason:

- the product is operations-facing and trust-first
- the current problem is template drift and noisy hierarchy, not lack of spectacle
- the UI needs more authority and order, not more flourish

### 4.2 Surface

- admin login
- mailbox portal login
- admin shell (`MainLayout`)
- mailbox portal shell (`MailboxLayout`)
- admin dashboard
- mailbox portal overview
- shared primitives touched by those surfaces (`PageHeader`, `SurfaceCard`, `StatCard`, `AuthSplitLayout`)

### 4.3 Context of Use

all-Mail is used to manage external mail connections, domain mailboxes, portal users, forwarding, and automation activity. The UI should support three operator behaviors:

- quick scan of current system posture
- recognition of what needs intervention next
- immediate transition into the right object page or workspace

Portal users need a lighter but related work surface oriented around unread mail, mailbox access, and account safety.

### 4.4 Constraints & Taste

#### Visual posture

Restrained operator console with quieter chrome and one dominant work surface.

#### Density target

Balanced to slightly compact. The UI should feel information-capable, not airy, but should avoid crowded action bars and badge walls.

#### Dominant hierarchy

1. main work surface
2. summary metrics and directional context
3. supporting chrome and secondary utilities

#### Palette / type / radius / shadow / motion expectations

- trusted blue as the main interaction color
- restrained teal/green for healthy operational signals
- danger and warning colors only for state expression
- slightly tighter radius than soft consumer SaaS
- very light shadows, with borders and surface value doing most of the separation work
- typography should sharpen title/subtitle contrast without becoming editorial or flashy
- motion should remain subtle and utility-driven

#### Component temperament

- card: calm, structural, not decorative
- primary action: singular and deliberate, never loud by default
- sidebar: subdued navigation rail, not a brand stage
- toolbar: sparse and contextual
- status pill: semantic only, not ornamental

#### Forbidden clichés

- decorative gradients
- glow or soft-neon emphasis
- button walls
- rainbow status color as pseudo-branding

#### Required states

- loading
- empty
- error
- hover
- focus-visible
- active / selected navigation states

### 4.5 System Constraints

- stack remains React + Ant Design + Vite
- preserve existing contracts, routing, and domain behavior
- avoid unnecessary component or data-structure rewrites
- reduce raw per-page styling drift where possible by strengthening shared theme/common styles
- execution mode remains headless-first
- workbench artifacts may inform workflow posture but cannot be reused as all-Mail proof because the surface id does not match

### 4.6 Acceptance Checks

The redesign succeeds only if:

- admin and portal entry pages feel more focused and less template-like
- the dashboard has a visibly stronger primary focus before text is fully read
- shell chrome no longer competes with the main work area
- KPI, chart, signal, and log sections have a clear emphasis ladder
- portal overview makes unread work feel primary and mailbox inventory feel supporting
- status color usage becomes more disciplined
- the result survives browser-based audit, not just static code review

### 4.7 Non-goals

- no Ant Design replacement
- no broad business logic rewrite
- no whole-site redesign of every business page in one pass
- no marketing-style restyling

## 5. Reference Synthesis

Selected references:

1. https://ant.design/docs/spec/visualization-page
2. https://github.com/ant-design/pro-components/tree/master/demos/card/StatisticCard
3. https://www.pencilandpaper.io/articles/ux-pattern-analysis-data-dashboards

### Reference DNA

#### borrow

- summary -> analysis -> detail page sequencing
- disciplined KPI grouping with consistent internal rhythm
- strong scan-path support and layered disclosure

#### avoid

- component demo look where every block feels equally important
- chart/KPI mosaics with no dominant work zone
- persistent action clutter

#### spacing-rhythm

- larger section spacing than internal card spacing
- tighter KPI grouping than cross-section spacing
- different pacing between summary, work surface, and detail zones

#### hierarchy-cues

- place core status and primary action decisions at the first scan point
- keep tables/lists quieter than hero or primary work blocks
- use composition, not extra color, to indicate priority

#### density-motion

- support fast scanning with compact but readable layouts
- keep motion minimal and explainable
- hide or defer secondary controls where possible

## 6. Target Files

Primary implementation targets:

- `web/src/theme.ts`
- `web/src/styles/common.ts`
- `web/src/layouts/MainLayout.tsx`
- `web/src/layouts/MailboxLayout.tsx`
- `web/src/components/PageHeader.tsx`
- `web/src/components/SurfaceCard.tsx`
- `web/src/components/StatCard.tsx`
- `web/src/components/AuthSplitLayout.tsx`
- `web/src/pages/dashboard/index.tsx`
- `web/src/pages/login/index.tsx`
- `web/src/pages/mail-portal/login/index.tsx`
- `web/src/pages/mail-portal/overview/index.tsx`

## 7. Implementation Plan

### Phase 1 — Shared tone and shell discipline

- tighten tokens, borders, spacing, shadow, and chrome behavior in `theme.ts` and `styles/common.ts`
- quiet the admin and portal shells so the content surface dominates

### Phase 2 — Shared primitive temperament

- refine `PageHeader`, `SurfaceCard`, `StatCard`, and `AuthSplitLayout`
- make action emphasis, card behavior, and title/subtitle rhythm more consistent

### Phase 3 — Dashboard-first visual hierarchy

- strengthen the dashboard summary block
- de-emphasize repetitive chrome and low-value card noise
- preserve data and behavior while improving section priority and scanability

### Phase 4 — Auth and portal polish

- tighten login surfaces so the form is primary and the supporting story stays secondary
- tune portal overview so unread work is clearly primary and mailbox inventory is secondary

### Phase 5 — Verification

- run web tests and build
- refresh browser evidence on admin login, dashboard, portal login, and portal overview
- perform UI audit and story-gap evaluation

## 8. Notes

- This spec is written and approved for implementation.
- It is intentionally not committed in this session because no git commit was requested.
