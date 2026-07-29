# Changelog

All notable changes to this project should be documented in this file.

The format is inspired by Keep a Changelog, and this project aims to use semantic versioning for public releases.

## [Unreleased]

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
- documented publish-readiness and open-source release closure guidance in the main README
- made backend static asset registration degrade gracefully when local `public/` assets are absent during tests or non-Docker runtimes
