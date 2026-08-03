# all-Mail Frontend V3 Execution Record

Date: 2026-08-04
Status: Completed in v2.1.0
Scope: PR #51 through PR #59
Product direction: mail infrastructure control plane

## 1. Result

Frontend V3 replaced the generic administration-template posture with one coherent operational system for both the administrator console and mailbox portal.

The completed product now has:

- grouped administrator navigation without URL changes;
- responsive administrator and portal shells;
- current route title and operational context in the shell header;
- form-first authentication with server-triggered OTP;
- an explainable Dashboard using direct risk counts rather than a weighted client score;
- shared resource, mail-flow, security-boundary, and portal workspace primitives;
- an Inbox-first mailbox portal;
- semantic status, focus-visible, reduced-motion, and narrow-screen foundations;
- production bundle budgets;
- mandatory desktop and mobile Chromium regression smoke.

This was a frontend and release-engineering program. It did not change the public Go route contract, authorization semantics, database schema, durable secret layout, forwarding state machine, provider credential format, or Docker topology.

## 2. Preserved compatibility boundaries

The following constraints remained true throughout PR #51–#59:

1. React, TypeScript, Vite, Ant Design, Axios, Zustand, and the existing contract modules remain the supported frontend stack.
2. Existing public browser URLs remain valid.
3. Authentication remains cookie-first. Administrator and mailbox auth stores are not persisted to localStorage or sessionStorage.
4. Mandatory password rotation continues to override normal administrator and mailbox navigation.
5. Go remains the sole production gateway/business/runtime implementation.
6. No Frontend V3 PR adds a database migration or rotates a durable secret.
7. The public `app`, private `go-business-api`, PostgreSQL, Redis, forwarding worker, and retention worker boundaries remain unchanged.
8. External-mail credential export remains limited by the existing `SUPER_ADMIN` authorization contract.

## 3. Final information architecture

Administrator navigation is grouped as follows:

```text
Overview
  Dashboard
Mail resources
  Mailbox connections
  Domains
  Domain mailboxes
  Portal users
Mail flow
  Domain messages
  Forwarding jobs
  Sending configuration
Automation and audit
  API keys
  API documentation
  Audit logs
System
  Administrators
  Settings
```

The mailbox portal is ordered around the user’s primary task:

```text
Inbox
Overview
Settings
```

Normal authenticated mailbox users land on `/mail/inbox`. Users with `mustChangePassword` still land on `/mail/settings` first.

## 4. PR execution record

| PR | Scope | Result |
| --- | --- | --- |
| #51 | Canonical Frontend V3 program contract | Established fixed design, compatibility, verification, rollback, and release boundaries. |
| #52 | Design system, responsive shells, grouped navigation | Added semantic tokens, route metadata, grouped administrator navigation, responsive sidebars, mobile overlays, and current route context. |
| #53 | Authentication and Dashboard | Made authentication form-first, kept OTP server-triggered, and replaced the opaque `/100` Dashboard score with direct risk counts. |
| #54 | Shared data workspaces | Added `WorkspaceFrame`, `DataToolbar`, `SectionHeading`, `StatusBadge`, `WorkspaceEmpty`, table-density rules, and route-level workspace classification. |
| #55 | Mail-flow context | Added typed inbound, forwarding, and outbound operational state vocabulary and semantic presentation. |
| #56 | Automation and system security context | Added explicit API-key, API-doc, audit, administrator, and settings boundary guidance without changing backend security behavior. |
| #57 | Inbox-first mailbox portal | Reordered portal navigation, changed normal landing to Inbox, added route-specific portal context, and preserved forced password rotation. |
| #58 | Permanent quality gates | Added source contracts, bundle budgets, scoped `/mail/api` development proxying, and desktop/mobile Chromium smoke. |
| #59 | Cleanup, documentation, and v2.1.0 publication | Updated version identity, changelog, operator/developer documentation, historical-spec status, and stable release metadata. |

## 5. Shared frontend foundations

The current shared system includes:

- `PageSurface`, `PageHeader`, `SurfaceCard`, and `StatCard`;
- `WorkspaceFrame`, `DataToolbar`, `SectionHeading`, `StatusBadge`, and `WorkspaceEmpty`;
- `MailFlowContext` and typed mail-flow state mapping;
- `ControlBoundaryContext` for automation/audit/system routes;
- `PortalWorkspaceContext` for Inbox, Overview, and Settings;
- responsive shell behavior shared by administrator and portal layouts;
- semantic CSS variables and Ant Design theme tokens;
- focus-visible and reduced-motion rules.

Leaf pages may continue to evolve incrementally, but new work must build on these foundations rather than reintroducing page-local card mosaics, decorative gradients, raw-color state labels, or persistent browser credentials.

## 6. Explainable Dashboard contract

The Dashboard does not publish a client-generated health score. Its primary intervention summary is derived from directly inspectable state:

- abnormal external mailbox connections;
- inactive domains;
- inactive domain mailboxes;
- the sum of those items requiring attention.

Trend, provider distribution, system signals, and recent activity remain supporting views. Future metrics must be traceable to a backend contract or an explicit documented calculation.

## 7. Authentication and portal contract

Authentication remains server-session based:

- Axios sends cookies with `withCredentials: true`;
- administrator and mailbox Zustand stores hold only in-memory identity state;
- passwords and bearer credentials are not persisted in browser storage;
- OTP UI appears only after the API returns `OTP_REQUIRED` or an equivalent challenge state;
- unified login may fall back to a mailbox account only after administrator authentication does not succeed;
- normal mailbox login lands on Inbox;
- forced password rotation lands on Settings.

The Vite development proxy owns `/mail/api` only. React owns `/mail/login`, `/mail/inbox`, `/mail/overview`, and `/mail/settings`.

## 8. Required frontend verification

Local and release verification includes:

```bash
npm --prefix web run lint
npm --prefix web run test
npm --prefix web run build
npm --prefix web run check:budget
```

The production bundle budget checks:

- largest JavaScript asset;
- total JavaScript;
- total CSS.

The release-required browser contract runs:

- administrator login to the explainable Dashboard;
- mailbox-portal login to the Inbox-first workspace;
- Desktop Chromium at 1440×900;
- Mobile Chromium at 390×844.

Playwright is installed in an isolated CI directory and linked only for the browser job. It is not a production dependency and does not rewrite the application lockfile.

## 9. Repository-level acceptance

Every implementation PR passed the applicable complete repository gates:

- frontend lint, unit tests, production build, and bundle budget;
- Chromium browser smoke where introduced;
- Go formatting, race tests, vet, build, vulnerability scan, and PostgreSQL/Redis integration;
- Cloudflare Worker checks;
- production dependency audit;
- Docker startup, Go-only topology, readiness, runtime doctors, and SBOM checks;
- configuration/proxy security;
- bootstrap-administrator security;
- live network, database, cache, and secret boundaries;
- Linux, macOS, and Windows amd64/arm64 builds;
- release identity and publication contracts.

## 10. Historical specification boundary

The following earlier specifications were useful planning inputs but are not current implementation contracts:

- `docs/internal/superpowers/specs/2026-03-27-all-mail-frontend-redesign-design.md`;
- `docs/internal/superpowers/specs/2026-03-28-all-mail-frontend-hardening-redesign-design.md`;
- `docs/internal/superpowers/specs/2026-04-05-all-mail-ui-aesthetic-upgrade-design.md`.

Their superseded status and relationship to this execution record are documented in [`internal/archive/FRONTEND-V3-SUPERSEDED-SPECS.md`](./internal/archive/FRONTEND-V3-SUPERSEDED-SPECS.md).

## 11. Release and rollback boundary

v2.1.0 publishes the React SPA and Go runtime as one complete revision. It adds no schema migration and rotates no durable secret. Existing v2.0.1 state remains compatible.

Use the normal revision-based procedure in [`UPGRADE.md`](./UPGRADE.md). Do not mix the v2.1.0 SPA with an older private business API or run two revisions against the same persisted state.
