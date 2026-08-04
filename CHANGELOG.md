# Changelog

All notable changes to `all-Mail` are documented here. The project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses semantic versioning for stable releases.

`all-Mail` is source-available under the custom non-commercial license in [`LICENSE`](./LICENSE); it is not distributed under an OSI-approved open-source license.

## [Unreleased]

### Security

- Removed the undocumented production `RESEND_API_BASE_URL` shell override; the supported Compose topology fixes the forwarding provider endpoint to `https://api.resend.com`.
- Removed the undocumented frontend `VITE_API_BASE_URL` build override so administrator and mailbox requests always use relative same-origin paths through the public Go gateway.
- Aligned the security support matrix with the current stable `2.1.x` line and documented `2.0.x` as limited compatibility support.
- Pinned every third-party GitHub Action to an immutable full commit SHA while retaining readable release annotations and Dependabot maintenance.
- Restricted `/metrics` to an explicit direct-peer CIDR allowlist that defaults to loopback, ignores forwarded identity headers, and rejects allow-all prefixes.

### Added

- Added a permanent full-stack consistency contract covering environment ownership, resolved Compose configuration, React routes and navigation, frontend requests, Go method/path handlers, route ownership, page visibility, repository hygiene, and dependency reproducibility.
- Added Cookie/OTP fixture coverage for the local Gmail OAuth helper and method-aware coverage for every public Go business route.
- Added the canonical PR #64–#69 stabilization and v2.1.1 closeout plan.
- Added narrow-workspace, navigation, API-key permission, allocation-cache, and audit-log regression coverage.
- Added browser height budgets for the real desktop and mobile Dashboard after chart rendering.
- Added a secret-safe production-host preflight for Bash, Python, Git, OpenSSL, Docker Engine, Compose v2, and daemon access.
- Added a permanent CI supply-chain contract that rejects movable Action tags and incomplete deployment-host documentation.
- Added an observability guide covering bounded Prometheus labels, health/readiness, runtime doctors, worker heartbeats, structured logs, privacy, and initial alerting.
- Added Go regression coverage for default/custom metrics CIDRs, unsafe CIDR rejection, direct-peer authorization, malformed peers, and forwarded-header spoofing.

### Changed

- Registered API-key allocation, usage, reset, and mailbox-assignment routes explicitly so frontend/backend method and path compatibility can be verified statically.
- Migrated the optional Gmail OAuth helper to the current administrator Cookie session, server-driven OTP challenge, mandatory password-rotation guard, safe account verification, and canonical Google `manage` scopes.
- Migrated the frontend to the React Router 8 package surface and kept the production client on relative same-origin requests.
- Rebuilt Dashboard as a compact operator overview that combines posture, resource availability, mail flow, automation activity, prioritized actions, provider concentration, and recent operations.
- Declared the supported production baseline as a single Linux host with Bash 4+, Python 3.9+, Git, OpenSSL, Docker Engine, and Docker Compose v2, and documented unsupported HA and multi-region modes.
- Added `METRICS_ALLOWED_CIDRS` as a canonical gateway-owned operator variable without giving the public gateway any new database, Redis, provider, JWT, or encryption credential.

### Fixed

- Isolated loopback development dependencies on a dedicated host bridge.
- Corrected API-key permission presentation, allocation cache invalidation, audit-log request typing, and responsive table behavior.
- Bounded Dashboard provider, error-sample, and activity density on desktop and mobile.

### Compatibility

- These unreleased changes add no database migration, durable-secret rotation, public route removal, authorization change, provider credential-format change, or production service/network/volume topology change.

## [2.1.0] - 2026-08-04

### Highlights

- Completed the Frontend V3 program across PR #51 through PR #59, giving the administrator console and mailbox portal one coherent mail-infrastructure control-plane design language.
- Rebuilt administrator and portal shells around grouped navigation, route context, responsive navigation, semantic surfaces, and shared workspace primitives.
- Made the mailbox portal Inbox-first while preserving mandatory password rotation, mailbox assignment enforcement, cookie-backed sessions, and every existing portal URL.

### Security

- Upgraded the transitive `fast-uri` production override and lockfile to `4.1.2` without adding an audit exception.

### Added

- Shared resource, mail-flow, control-boundary, and portal workspace primitives.
- Permanent source contracts for cookie-first authentication, Inbox-first routing, explainable Dashboard state, responsive behavior, reduced motion, and restrained operational styling.
- Production JavaScript/CSS bundle budgets and desktop/mobile Chromium administrator and mailbox-portal smoke flows.

### Changed

- Replaced the client-generated weighted `/100` Dashboard score with direct risk counts.
- Grouped administrator navigation into Overview, Mail resources, Mail flow, Automation and audit, and System.
- Simplified login so the OTP step appears only after a server challenge.
- Reordered mailbox portal navigation around Inbox, Overview, and Settings.

### Fixed

- Scoped the development proxy to `/mail/api` so portal SPA routes remain React-owned.
- Isolated Playwright specifications and CI-only browser dependencies from application dependency metadata.
- Removed an incomplete translation descriptor that passed lint/tests but failed the TypeScript production build.

### Compatibility and upgrade notes

- No database schema migration or credential rotation is introduced.
- Public routes, Go authorization, route ownership, forwarding leases, sending behavior, Docker topology, and v2.0.1 persistent state remain compatible.

## [2.0.1] - 2026-08-03

### Security

- Restricted full external-mailbox credential export to authenticated `SUPER_ADMIN` sessions.
- Added fail-closed provider egress resolution and DNS pinning for HTTP, OAuth, proxies, IMAP, and SMTP.

### Fixed

- Aligned administrator and mailbox-portal Cookie lifetime with `JWT_EXPIRES_IN`.
- Fixed mailbox-portal session bootstrap completion on non-success envelopes.
- Removed Cloudflare Worker tooling references to the retired Node server tree.

### Changed

- Replaced the final Node-era `NODE_ENV` selector with `ALL_MAIL_RUNTIME_ENV`.
- Documented R2 raw-message lifecycle, backup, restore, and recovery boundaries.
- Generalized release publication from canonical `VERSION` metadata.

### Compatibility and upgrade notes

- No database migration or durable-secret rotation is introduced.
- Remove stale `NODE_ENV` configuration before startup and back up PostgreSQL, required volumes, and R2 when it is part of the recovery objective.

## [2.0.0] - 2026-08-02

### Highlights

- Completed the production cutover to a Go-only runtime.
- Established the six-service Compose topology: `app`, `go-business-api`, `worker-forwarding`, `worker-retention`, `postgres`, and `redis`.
- Added canonical version identity across source, package metadata, binary, OCI image, tag, release assets, and changelog.

### Added

- Private Go ownership for authentication, administration, mailbox/domain/ingress/provider/sending/portal/external APIs.
- Immutable schema adoption and migration ledgers with drift, checksum, and unknown-state rejection.
- Durable forwarding leases, retry state, retention cleanup, runtime doctors, and method-aware route ownership.
- Canonical OAuth permission profiles and least-privilege defaults.
- Cross-platform Linux, macOS, and Windows release archives, SBOM, checksums, GHCR image, and GitHub Release publication.
- Upgrade, rollback, backup, restore, runbook, environment, and security-boundary documentation.

### Changed

- Made `app` a credential-free public gateway and SPA host.
- Split PostgreSQL runtime access across generated API, forwarding, and retention identities.
- Added authenticated Redis and least-privilege read-only runtime secret exports.
- Added durable session revocation and explicit fail-closed API-key permissions.

### Security

- Added browser same-origin enforcement, trusted-proxy normalization, CSP, clickjacking protection, login lockout, replay protection, provider network controls, encrypted credentials, and database/network/secret isolation.
- Added race, vulnerability, dependency, integration, Docker, bootstrap, SBOM, security-boundary, and release gates.

### Removed

- Removed the Node/Fastify/Prisma production runtime, legacy jobs runtime, migration proxy mode, duplicate API images, production default passwords, raw secret fallbacks, and direct database/cache access from the public gateway.

### Upgrade notes

- Back up PostgreSQL, the exact revision, `.env`, required secret/data volumes, and external R2 state before upgrading.
- Stop the old revision before starting the new revision; concurrent revisions against one persisted state are unsupported.
- Rollback after initialization or migration requires the matching database and volume backup.

[Unreleased]: https://github.com/feng123-new/all-Mail/compare/v2.1.0...HEAD
[2.1.0]: https://github.com/feng123-new/all-Mail/compare/v2.0.1...v2.1.0
[2.0.1]: https://github.com/feng123-new/all-Mail/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/feng123-new/all-Mail/releases/tag/v2.0.0
