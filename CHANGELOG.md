# Changelog

All notable changes to `all-Mail` are documented here. The project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses semantic versioning for stable releases.

`all-Mail` is source-available under the custom non-commercial license in [`LICENSE`](./LICENSE); it is not distributed under an OSI-approved open-source license.

## [Unreleased]

### Security

- Removed the undocumented production `RESEND_API_BASE_URL` shell override; the supported Compose topology now fixes the forwarding provider endpoint to `https://api.resend.com`.
- Removed the undocumented frontend `VITE_API_BASE_URL` build override so administrator and mailbox requests always use relative same-origin paths through the public Go gateway.

### Added

- Added a permanent full-stack consistency contract covering environment ownership, resolved Compose configuration, React routes and navigation, frontend requests, Go method/path handlers, route ownership, page regression visibility, repository hygiene, and dependency reproducibility.
- Added Cookie/OTP fixture coverage for the local Gmail OAuth helper and method-aware coverage for every public Go business route.

### Changed

- Registered API-key allocation, usage, reset, and mailbox-assignment routes explicitly so frontend/backend method and path compatibility can be verified statically.
- Migrated the optional Gmail OAuth helper to the current administrator Cookie session, server-driven OTP challenge, mandatory password-rotation guard, safe account verification, and canonical Google `manage` scopes.

### Compatibility

- These unreleased changes add no database migration, durable-secret rotation, public route removal, authorization change, provider credential-format change, or production service/network/volume topology change.

## [2.1.0] - 2026-08-04

### Highlights

- Completed the Frontend V3 program across PR #51 through PR #59, giving the administrator console and mailbox portal one coherent mail-infrastructure control-plane design language.
- Rebuilt the administrator and portal shells around grouped navigation, route context, responsive narrow-screen navigation, semantic surfaces, restrained operational state, and shared workspace primitives.
- Made the mailbox portal Inbox-first while preserving mandatory password rotation, mailbox assignment enforcement, cookie-backed sessions, and every existing portal URL.

### Security

- Upgraded the transitive `fast-uri` production override and lockfile to `4.1.2`, the patched release for the host-confusion advisory affecting earlier 4.x versions. No audit exception was added.

### Added

- Shared data-workspace primitives for route framing, toolbars, section headings, semantic status badges, and bounded empty states.
- Explicit mail-flow context for inbound delivery, forwarding execution, and outbound readiness without changing worker or provider state machines.
- Explicit control-boundary context for API keys, API documentation, audit logs, administrator security, and system settings.
- Route-specific mailbox-portal context for Inbox, Overview, and Settings.
- Permanent Frontend V3 source contracts covering cookie-first authentication, Inbox-first routing, explainable Dashboard state, shared shell integration, responsive and reduced-motion foundations, and the prohibition on decorative operational gradients.
- A production bundle budget for the largest JavaScript asset, total JavaScript, and total CSS.
- Desktop Chromium (1440×900) and mobile Chromium (390×844) browser smoke for administrator login-to-Dashboard and portal login-to-Inbox flows, including failure traces and screenshot evidence.

### Changed

- Grouped administrator navigation into Overview, Mail resources, Mail flow, Automation and audit, and System without changing public URLs.
- Replaced fixed generic shell labels with current route title and operational context.
- Simplified the authentication entry surfaces so the form is primary and the OTP step appears only after the Go API returns an OTP challenge.
- Replaced the client-generated weighted `/100` Dashboard score with direct counts for abnormal mailbox connections, inactive domains, and inactive domain mailboxes.
- Standardized shared page headers, surfaces, metrics, table density, focus treatment, responsive spacing, and reduced-motion behavior.
- Reordered portal navigation around Inbox, Overview, and Settings and changed authenticated `/mail` plus successful portal-login landing to `/mail/inbox`.
- Tightened the Vite chunk warning threshold and added the bundle budget to normal release verification.

### Fixed

- Scoped the development proxy to `/mail/api` instead of `/mail`, so direct mailbox-portal SPA routes such as `/mail/login` and `/mail/inbox` are no longer swallowed by the backend proxy during local development and browser tests.
- Isolated Playwright specifications from Vitest collection and isolated CI-only Playwright installation from application dependency metadata.
- Removed an incomplete Frontend V3 translation descriptor that passed lint/tests but failed the TypeScript production build.

### Compatibility and upgrade notes

- This release adds no database schema migration and does not rotate JWT, encryption, Redis, database-role, ingress, OAuth, or provider credentials.
- Public API routes, Go authorization, session revocation, route ownership, forwarding leases, sending behavior, Docker topology, and persistent volume layout remain compatible with v2.0.1.
- Existing deployments may upgrade with the normal revision-based maintenance procedure. Back up PostgreSQL, the exact revision, required secret/data volumes, and R2 when raw-message recovery matters before changing revision.
- The React bundle and Go binary/image are published together as one complete revision; do not mix the v2.1.0 SPA with an older private business API.

## [2.0.1] - 2026-08-03

### Security

- Restricted full external-mailbox credential export to authenticated `SUPER_ADMIN` sessions while preserving the original saved credentials for personal owner recovery and migration.
- Added fail-closed provider egress resolution for HTTP, OAuth, explicit HTTP/SOCKS proxies, IMAP, and SMTP. Localhost, private, link-local, shared, multicast, unspecified, and reserved targets are rejected, and public DNS results are pinned before dialing to prevent DNS rebinding.

### Fixed

- Administrator and mailbox-portal cookies now use the configured `JWT_EXPIRES_IN` lifetime and matching expiration timestamp instead of a separate fixed two-hour duration.
- Mailbox-portal session bootstrap now finishes and redirects to login when the API returns a resolved non-success envelope instead of remaining on an infinite loading indicator.
- Cloudflare Worker deployment and doctor tooling no longer reference the removed Node `server/` directory or the retired `ensure-ingress-endpoint.ts` helper; ingress endpoint creation remains owned by the Go initializer.

### Changed

- Replaced the remaining Node-era `NODE_ENV` production selector with `ALL_MAIL_RUNTIME_ENV`; stale `NODE_ENV` entries are rejected by production preflight.
- Documented the Cloudflare R2 raw-message bucket as external durable state, including lifecycle, backup, restore, and acceptance requirements when raw `.eml` recovery matters.
- Generalized the release workflow so version, tag, changelog date, release notes, and release validation are derived from `VERSION` rather than being fixed to `v2.0.0`.

### Upgrade notes

- This patch does not add a database schema migration or rotate existing JWT, encryption, Redis, or database-role secrets.
- Remove any manually supplied `NODE_ENV` entry before startup. Standard Compose injects `ALL_MAIL_RUNTIME_ENV=production` internally; operators should not add it to `.env`.
- Back up PostgreSQL, all required secret/data volumes, and the R2 raw-message bucket when it is part of the recovery objective before upgrading.

## [2.0.0] - 2026-08-02

### Highlights

- Completed the production cutover to a Go-only runtime. The public gateway, private business API, initializer, migration runner, forwarding worker, retention worker, health checks, and route ownership are all implemented in Go.
- Established one canonical Docker Compose topology with six long-running services: `app`, `go-business-api`, `worker-forwarding`, `worker-retention`, `postgres`, and `redis`.
- Added a stable release identity contract across `VERSION`, package metadata, the Go binary, OCI image labels, release archives, the Git tag, and this changelog.

### Added

- Private `go-business-api` ownership for administrator authentication, mailbox portal authentication, dashboard data, API keys, external mailbox operations, domains, ingress, sending, and management routes.
- Method-aware route ownership metadata, migration telemetry, aggregate readiness, independent runtime doctors, and fail-closed production configuration validation.
- PostgreSQL schema adoption and immutable migration ledgers for supported historical databases, including drift, checksum, and unknown-migration rejection.
- Durable forwarding leases, claim recovery, retry state, retention cleanup, and real PostgreSQL integration coverage.
- Canonical OAuth permission profiles (`minimal`, `send`, `manage`, and `full`) with least-privilege defaults for Google and Microsoft.
- `allmail version` and `allmail version --json`, populated through Go linker flags and OCI build metadata.
- Platform-specific runtime-secret file locking so the published Linux, macOS, and Windows archives all cross-compile from the verified release source.
- A stable release workflow that verifies all required checks, creates `v2.0.0`, publishes checksummed Go binaries and a multi-architecture GHCR image, creates the GitHub Release, and removes merged maintenance branches.
- Dedicated upgrade, rollback, backup, and restore documentation.

### Changed

- The public `app` is now a credential-free Go gateway and React SPA host. It has no direct PostgreSQL, Redis, provider, JWT, encryption, OAuth, ingress-signing, or bootstrap credential.
- PostgreSQL owner credentials are initializer-only. Runtime access is split across generated `allmail_api`, `allmail_forwarding`, and `allmail_retention` identities delivered through read-only URL files.
- Redis authentication is generated by the initializer, required in production, mounted read-only, and verified by authenticated readiness checks.
- Runtime secrets are split into least-privilege volumes. The master secret state is never mounted by a long-running service.
- Administrator and mailbox sessions use durable revocation versions; password, role, status, required-rotation, and 2FA changes invalidate older JWTs.
- API-key permissions are explicit and fail closed. Historical implicit-all keys are backfilled before the new runtime starts.
- The supported baselines are Go 1.26.5, Node.js 24 for frontend and Worker builds, PostgreSQL 16, and Redis 7.
- Public project wording is standardized on **source-available under a custom non-commercial license**.

### Security

- Added same-origin protection for unsafe browser requests, `Sec-Fetch-Site` enforcement, clickjacking protection, and a strict framing/content-security policy.
- Applied one password policy across administrator and mailbox flows, including bcrypt's 72-byte input boundary.
- Removed arbitrary server-path OAuth client-secret reads; Google client-secret documents are accepted only as uploaded or pasted JSON.
- Added endpoint-scoped encrypted ingress secrets, Redis-backed replay protection, atomic OAuth state consumption, login lockout, API-key limiting, and provider timeout boundaries.
- Removed browser persistence and prefill of portal passwords and added cleanup for historical storage keys.
- Added static, race, vulnerability, dependency, PostgreSQL/Redis integration, Docker boundary, bootstrap, SBOM, and release-gate checks.

### Removed

- Removed the Node/Fastify/Prisma production runtime, legacy jobs runtime, migration proxy mode, duplicate API images, and retired service names.
- Removed the superseded `oauth-temp` Python helper and its local credential flow.
- Removed production default passwords, raw secret fallbacks, implicit API-key permissions, and direct database/cache access from the public gateway.

### Upgrade notes

- Back up PostgreSQL, the exact revision, `.env`, and every matching secret/data volume before upgrading.
- Stop the old revision before running `./scripts/compose-up.sh` from `v2.0.0`; concurrent revisions against one persisted state are unsupported.
- Rollback after initialization or migration requires restoring the database and volume backup captured for the target revision. Image-only rollback is not a safe default.
- Follow [`docs/UPGRADE.md`](./docs/UPGRADE.md) and [`docs/BACKUP-RESTORE.md`](./docs/BACKUP-RESTORE.md).

[Unreleased]: https://github.com/feng123-new/all-Mail/compare/v2.1.0...HEAD
[2.1.0]: https://github.com/feng123-new/all-Mail/compare/v2.0.1...v2.1.0
[2.0.1]: https://github.com/feng123-new/all-Mail/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/feng123-new/all-Mail/releases/tag/v2.0.0
