# Changelog

All notable changes to `all-Mail` are documented here. The project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and semantic versioning.

`all-Mail` is source-available under the custom all-Mail Non-Commercial License in [`LICENSE`](./LICENSE); it is not distributed under an OSI-approved open-source license.

## [Unreleased]

### Fixed

- Preserved email-first Outlook vendor imports (`email----password----clientId----refreshToken`) as IMAP OAuth instead of misclassifying their `M.*` refresh tokens as Microsoft Graph credentials.

## [2.1.2] - 2026-08-05

### Highlights

- Closed the post-v2.1.1 personal-deployment patch line without adding multi-tenant, high-availability, database, secret, route, or topology changes.
- Published the reviewed Mail.com compatibility correction, explicit OAuth permission profiles, stronger Linux host preflight, truthful provider-evidence guidance, and an automated synthetic backup/restore rehearsal.

### Security

- Kept new Gmail and Outlook OAuth configurations fail-closed at the `minimal` read-only profile while making `send`, `manage`, and `full` consent explicit.
- Extended the secret-safe production-host preflight to reject an unsafe Redis `vm.overcommit_memory` policy and insufficient memory, disk, or inode capacity without reading `.env` or runtime secrets.
- Preserved the existing direct-peer, database-role, provider-egress, session, ingress-signature, and secret-volume boundaries.

### Added

- Bilingual OAuth profile and effective-capability presentation for Gmail and Outlook, including the exact canonical scopes and a required reauthorization warning when permissions are broadened.
- A provider-validation evidence policy that distinguishes source/protocol/integration tests from operator-owned live-account canaries for all supported external providers.
- A guarded destructive CI rehearsal that dumps and restores PostgreSQL, archives and verifies the complete local state-volume set, preserves secret hashes, validates synthetic domain/message/API-key data, and reruns all runtime doctors.
- Host preflight regression tests for Redis memory policy, capacity thresholds, Docker capabilities, and upgrade-safe application-port warnings.

### Changed

- Replaced raw Gmail and Outlook scope editing in the administrator mailbox flow with the canonical `minimal`, `send`, `manage`, and `full` profiles already enforced by the Go backend.
- Updated deployment, provider, backup, support, and upgrade documentation for the v2.1.2 personal single-host release boundary.
- Documented public CI as implementation evidence rather than proof that every third-party provider currently accepts every account, tier, region, or anti-abuse condition.

### Fixed

- Documented that Mail.com direct access requires a Premium account and manual POP3/IMAP activation.
- Aligned Mail.com API/import defaults with IMAP 993 over TLS and SMTP 587 over STARTTLS.
- Corrected Mail.com folder mappings to `Sent Items` and `Junk email`.
- Removed contradictory Outlook documentation that described broad Graph permissions as the default while the backend correctly defaulted to `minimal`.
- Added the Redis host requirement that was previously visible only as a runtime warning during Docker smoke.

### Compatibility and upgrade notes

- No database migration or durable-secret rotation is introduced.
- No public route, authorization, provider credential format, forwarding state machine, service, network, volume, or persisted-state topology is changed.
- Existing v2.1.1 deployments can upgrade with the normal revision-based procedure after backing up PostgreSQL, the exact revision, required volumes, and external R2 state when it is part of the recovery objective.
- Changing an OAuth profile does not expand an existing refresh token; reauthorize the affected mailbox before relying on new send, manage, or full capabilities.
- Do not run concurrent revisions against one persisted deployment and do not use `docker compose down -v` during normal upgrade or recovery.

## [2.1.1] - 2026-08-04

### Highlights

- Completed the approved PR #64–#69 stabilization and release-closeout program after v2.1.0.
- Preserved the six-service Go-only topology, all public routes, current authorization, persistent state, provider formats, forwarding semantics, and secret layout.
- Published a deterministic OpenAPI 3.1 contract, protected operational metrics, hardened CI supply-chain inputs, and stabilized frontend request lifecycle behavior.

### Security

- Removed undocumented production endpoint and frontend API-base overrides so provider egress and browser requests remain owned by canonical deployment policy.
- Aligned the security support matrix with the stable 2.1.x line.
- Pinned third-party GitHub Actions to immutable commit SHAs and added a permanent movable-tag rejection contract.
- Restricted `/metrics` to an explicit direct-peer CIDR allowlist that defaults to loopback, ignores forwarded identity headers, and rejects allow-all prefixes.

### Added

- A canonical PR #64–#69 stabilization plan with compatibility, verification, rollback, and completion requirements.
- A secret-safe production-host preflight for Bash, Python, Git, OpenSSL, Docker Engine, Compose v2, and daemon access.
- An observability guide covering bounded Prometheus labels, readiness, runtime doctors, worker heartbeats, structured logs, privacy, and initial alerts.
- Scoped administrator, mailbox-portal, and public not-found recovery surfaces.
- Permanent frontend request-lifecycle, session-cache, unknown-route, and Dashboard-model contracts.
- A generated same-origin `/openapi.json` OpenAPI 3.1 document backed by a reviewable method/path/authentication inventory and CI drift checks.
- Desktop and mobile browser height budgets that prevent the Dashboard from regressing into an unbounded card wall after the real chart renders.

### Changed

- Migrated the frontend to React Router 8 and kept all production browser requests relative and same-origin.
- Rebuilt Dashboard as a compact operator overview with posture, resources, mail flow, automation trend, prioritized actions, provider concentration, and recent activity.
- Changed duplicate frontend GET handling from cancellation to shared in-flight Promises and isolated cached responses across administrator and mailbox identity epochs.
- Extracted Dashboard loading fallbacks into a pure model module without changing the verified desktop/mobile composition.
- Declared the supported production baseline as a single Linux host and documented unsupported HA, Kubernetes, multi-region, automatic-failover, and concurrent-revision modes.
- Generated the same versioned OpenAPI artifact in development, frontend production builds, and the final Docker image while excluding compatibility aliases from primary paths.

### Fixed

- Corrected API-key permission presentation, allocation cache invalidation, audit-log request typing, responsive tables, and narrow-workspace navigation.
- Isolated loopback development dependencies on a dedicated host bridge.
- Bounded Dashboard provider, connection-error, and activity density on desktop and mobile.
- Prevented stale in-flight GET responses from repopulating cache after writes or authentication transitions.
- Replaced the global unknown-route redirect with scope-aware 404 handling.

### Compatibility and upgrade notes

- No database migration or durable-secret rotation is introduced.
- No public route, authorization, provider credential format, forwarding state machine, service, network, volume, or persisted-state topology is changed.
- Existing v2.1.0 deployments can upgrade with the normal revision-based procedure after backing up PostgreSQL, the exact revision, required volumes, and external R2 state when it is part of the recovery objective.
- Do not run concurrent revisions against one persisted deployment and do not use `docker compose down -v` during normal upgrade or recovery.

## [2.1.0] - 2026-08-04

### Highlights

- Completed Frontend V3 across PR #51 through PR #59.
- Rebuilt administrator and mailbox-portal shells around grouped navigation, route context, responsive composition, semantic workspaces, and cookie-first sessions.
- Made the mailbox portal Inbox-first while preserving forced password rotation and existing URLs.

### Security

- Upgraded the transitive `fast-uri` override to the patched 4.1.2 release.

### Added

- Shared resource, mail-flow, control-boundary, and portal workspace primitives.
- Frontend source, bundle-budget, desktop Chromium, and mobile Chromium regression gates.

### Changed

- Replaced the client-generated `/100` Dashboard score with direct risk counts.
- Simplified login so OTP appears only after a server challenge.

### Compatibility

- No database migration or credential rotation was introduced.

## [2.0.1] - 2026-08-03

### Security

- Restricted full external-mailbox credential export to authenticated `SUPER_ADMIN` sessions.
- Added fail-closed provider egress resolution and DNS pinning for HTTP, OAuth, proxies, IMAP, and SMTP.

### Fixed

- Aligned session-cookie lifetime with `JWT_EXPIRES_IN`.
- Fixed mailbox-portal bootstrap completion and removed Worker references to the retired Node tree.

### Compatibility

- No database migration or durable-secret rotation was introduced.

## [2.0.0] - 2026-08-02

### Highlights

- Completed the production cutover to a Go-only runtime.
- Established the six-service Compose topology: `app`, `go-business-api`, `worker-forwarding`, `worker-retention`, `postgres`, and `redis`.
- Added canonical version identity, cross-platform archives, SBOM, checksums, GHCR publication, and GitHub Release automation.

### Security

- Added cookie-first sessions, durable revocation, same-origin enforcement, trusted-proxy normalization, login lockout, replay protection, encrypted credentials, least-privilege database identities, authenticated Redis, network isolation, and secret-volume separation.

### Removed

- Removed the Node/Fastify/Prisma production runtime and retired migration/job paths.

[Unreleased]: https://github.com/feng123-new/all-Mail/compare/v2.1.2...HEAD
[2.1.2]: https://github.com/feng123-new/all-Mail/compare/v2.1.1...v2.1.2
[2.1.1]: https://github.com/feng123-new/all-Mail/compare/v2.1.0...v2.1.1
[2.1.0]: https://github.com/feng123-new/all-Mail/compare/v2.0.1...v2.1.0
[2.0.1]: https://github.com/feng123-new/all-Mail/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/feng123-new/all-Mail/releases/tag/v2.0.0
