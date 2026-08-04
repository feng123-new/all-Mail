# PR #64–#69 stabilization and v2.1.1 closeout plan

Status: approved for execution on 2026-08-04.

This plan closes the post-v2.1.0 stabilization cycle. Every pull request starts from the latest verified `main`, preserves the Go-only production topology, and must pass the repository's permanent release, security, configuration, browser, database, Docker, and cross-platform gates before the next pull request begins.

## Compatibility boundary

The sequence must not introduce a database migration, rotate durable JWT/encryption/Redis/database-role/provider/ingress credentials, remove a public API route, weaken authorization, expose private service ports, or change the six-service production topology. Existing v2.1.0 state must remain directly upgradeable.

## PR sequence

### PR #64 — release governance and plan

- publish this canonical execution plan;
- align `SECURITY.md`, `SUPPORT.md`, `README.md`, `VERSION`, and changelog support language;
- record the PR #62 contract-alignment and PR #63 Dashboard changes in `Unreleased`;
- strengthen release contracts so the current stable minor line and support matrix cannot drift again.

### PR #65 — CI supply-chain and deployment-host hardening

- pin every third-party GitHub Action to a full immutable commit SHA while retaining readable version comments;
- add a permanent contract that rejects movable action tags;
- document the supported production host baseline and required Bash, Python, Git, OpenSSL, Docker Engine, and Compose capabilities;
- add a non-secret host preflight command used by deployment documentation and tests.

### PR #66 — production observability boundaries

- protect `/metrics` with an explicit allowlist that defaults to loopback and trusted internal callers;
- expose bounded gateway, business API, database, Redis, provider, ingress, and worker operational signals without mailbox content or secrets;
- document scrape and alerting expectations;
- add unit and live-boundary coverage without changing public business routes.

### PR #67 — frontend request lifecycle and maintainability

- coalesce duplicate GET requests instead of cancelling an existing caller;
- namespace and clear frontend request cache state across administrator and mailbox session transitions;
- add explicit administrator and mailbox-portal not-found surfaces;
- split the Dashboard operator overview into maintainable model/messages/section modules while preserving its current visual and browser contracts.

### PR #68 — generated OpenAPI contract

- publish an OpenAPI 3.1 document for public automation APIs and documented administrator, portal, and ingress route families;
- generate or validate the document from canonical Go route and request contracts;
- render the existing API documentation surface from generated metadata where practical;
- fail CI when route ownership, Go registration, and OpenAPI method/path coverage drift.

### PR #69 — v2.1.1 release and repository closeout

- set canonical release identity to `2.1.1`;
- convert all completed `Unreleased` notes into a dated v2.1.1 entry;
- update deployment, upgrade, support, security, and release documentation;
- publish checksummed cross-platform archives, CycloneDX SBOM, immutable Git tag, GitHub Release, and multi-architecture GHCR image through the existing release workflow;
- verify the exact release commit and remove only eligible merged maintenance branches.

## Verification matrix

Every implementation PR requires, as applicable:

- full-stack consistency contract with zero errors and zero warnings;
- Go formatting, race tests, vet, build, vulnerability scan, migrations, PostgreSQL and Redis integrations;
- frontend lint, unit/component tests, production build, bundle budget, and desktop/mobile Chromium smoke;
- Cloudflare Worker build, lint, tests, and production dependency audit;
- Docker topology, readiness, runtime doctors, final-image SBOM, route ownership, and bootstrap flow;
- configuration/proxy security, live security boundaries, and Linux/macOS/Windows amd64/arm64 release builds.

## Merge and rollback rules

- use squash merge so each PR has one auditable `main` commit;
- do not start the next PR until the previous PR is merged and its exact `main` commit has successful required workflows;
- if a PR changes persisted state, secrets, public routes, or topology unexpectedly, stop the sequence and revise the plan rather than silently broadening scope;
- rollback remains revision plus matching PostgreSQL and volume state; image-only rollback is not assumed safe.

## Definition of done

The sequence is complete only when PR #64 through PR #69 are merged, v2.1.1 is published from the exact verified release commit, all required checks are successful, no sequence PR remains open, and the final `main` documentation describes the deployed system truthfully.
