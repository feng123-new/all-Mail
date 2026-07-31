# Changelog

All notable changes to this project should be documented in this file.

The format is inspired by Keep a Changelog, and this project aims to use semantic versioning for public releases.

## [Unreleased]

- moved signed domain-mail ingress to the private Go business service with endpoint-scoped encrypted secrets, Redis replay protection, transactional mailbox routing and persistence, and PII-free compensating R2 lifecycle handling
- moved the Dashboard single and batch operation-log deletion endpoints to the private Go business service with bounded validation and transactionally coupled administrator audit records
- added durable administrator and mailbox session versions so password, role, status, mandatory-rotation, and 2FA changes immediately revoke older JWTs; also reduced default Microsoft OAuth scopes to identity and mail capabilities
- replaced implicit full-access API-key permissions with an explicit fail-closed model, while backfilling historical NULL or empty permission maps to `all=true` before either runtime starts
- aligned deployment, recovery, environment, and release documentation with the active `app` + `go-business-api` + `business-api` topology
- added runtime-documentation contract tests for service lists, private ports, aggregate readiness, Secret ownership, and source-available licensing language
- moved API-key administration, hash authentication, permission aliases, Redis-backed limiting, usage accounting, and allocation state into the private Go business service
- moved database-only external email/domain-mail allocation, listing, statistics, reset, and persisted message reads to Go while retaining provider and regex compatibility routes on Fastify
- added real PostgreSQL and Redis integration gates plus public-gateway bootstrap coverage for the second Go business vertical slice
- added a private `go-business-api` service so database-backed Go handlers do not widen the Internet-facing gateway's PostgreSQL or Secret access
- upgraded route ownership to a method-aware manifest and moved Dashboard statistics, API-trend, and operation-log reads to Go while retaining Fastify log-deletion writes
- added administrator JWT/database-state parity, bounded Dashboard validation, UTC PostgreSQL queries, private-service readiness, and least-privilege JWT file export
- bounded arbitrary HTTP method labels to `OTHER` and identified private upstreams in proxy-error telemetry
- added a canonical route ownership manifest, stable owner/family response headers, bounded Prometheus migration telemetry, and an `allmail routes` inspection command
- removed the migration-era proxy marker and made the dashboard route family the first measured Go migration candidate
- renamed migration-era runtime services and configuration to business ownership names, while preserving the existing physical runtime-secret volume for in-place upgrades

- moved provider OAuth credentials, domain send approval, and ingress signing secrets from the long-running API environment into encrypted or audited PostgreSQL state
- added an idempotent initializer-only compatibility importer with explicit conflict detection and unknown-domain rejection
- made ingress authentication require an endpoint-scoped encrypted secret while preserving safe deployment checks for already imported endpoints
- made administrator login fail closed when 2FA is enabled without a persisted secret and added a database integrity constraint
- made OAuth authorization state consumption atomic with Redis `GETDEL`
- aligned Cloudflare production deployment and doctor checks with disabled `workers.dev`, explicit health routes, quoted env parsing, and configurable raw-message limits
- corrected worker secret/heartbeat documentation, redacted long-lived secret examples, and removed unused Fastify/PostgreSQL direct dependencies
- raised the supported runtime baseline to Go 1.26.5 and Node.js 24 LTS, with `govulncheck` added to CI
- removed the production PostgreSQL default password and added fail-closed production configuration validation
- made administrator login protection, API-key limiting, OAuth state, and ingress replay protection fail closed when Redis is unavailable in production
- restricted runtime-secret generation and legacy secret migration to the one-shot initializer; the long-running API now requires existing secret state
- made forwarding leases configurable, releases unprocessed claims after interrupted passes, and rejects unsafe timeout relationships
- added PostgreSQL health probes and bounded consecutive backlog draining to the retention worker
- made old runtimes reject migration-ledger entries introduced by newer revisions
- consolidated Go and compatibility services onto two named application images and removed the persistent retention-heartbeat volume
- updated the Cloudflare Email Worker compatibility baseline, disabled `workers.dev`, minimized health disclosure, and rejected oversized mail before MIME parsing
- replaced the ad-hoc dependency-refresh workflow with Dependabot coverage for npm, Go, Docker, and GitHub Actions
- startup now prints the first-login URL, bootstrap admin username, and bootstrap password on first boot, with an explicit localhost replacement warning for remote deployments
- repository licensing has moved from MIT wording to the custom `all-Mail Non-Commercial License`, which blocks commercial use without prior permission
- hardened production dependency tree and reduced `npm audit --omit=dev` to zero known vulnerabilities across `web`, `server`, and `cloudflare/workers/allmail-edge`
- upgraded core runtime packages including `axios`, `react-router-dom`, `fastify`, `mailparser`, `nodemailer`, `undici`, `prisma`, and `@prisma/client`
- added safe public screenshots for dashboard and Outlook OAuth setup to improve repository presentation
- added a dedicated login screenshot, end-to-end Mermaid flow diagram, and clearer guided-reading links for the GitHub README
- separated `docs/` into public operator docs plus `docs/internal/` for design notes, plans, and maintainer-only reference material
- documented source-available publication readiness and license messaging in the documentation index and release checklist
- made backend static asset registration degrade gracefully when local `public/` assets are absent during tests or non-Docker runtimes
