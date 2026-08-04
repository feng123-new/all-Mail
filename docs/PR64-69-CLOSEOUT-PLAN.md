# PR #64–#69 Stabilization and v2.1.1 Closeout Plan

Status: approved for sequential execution on 2026-08-04.

This plan closes the post-v2.1.0 stabilization work without changing the supported six-service Go-only topology or introducing a database migration. Every pull request starts from the latest merged `main`, passes the complete required repository checks, and is merged before the next branch is created.

## Fixed compatibility boundary

The program must preserve:

- the public Go gateway, private Go business API, forwarding worker, retention worker, PostgreSQL, and Redis topology;
- current public, administrator, mailbox-portal, ingress, and compatibility routes;
- cookie-first administrator and mailbox sessions, session-version revocation, forced password rotation, and server-driven OTP;
- existing PostgreSQL schema and migration ledgers;
- durable JWT, encryption, Redis, database-role, bootstrap, and legacy master-secret state;
- provider credential formats, OAuth authority profiles, forwarding leases, ingress signatures, and R2 lifecycle semantics;
- v2.1.0 persistent-state compatibility.

## PR sequence

### PR #64 — Closeout program and release truth

- add this canonical execution plan;
- align `SECURITY.md` with the current v2.1 support line;
- record PR #62 and PR #63 in the Unreleased changelog;
- strengthen release-document consistency so support and changelog drift cannot recur.

### PR #65 — CI supply-chain and deployment-host hardening

- pin reusable GitHub Actions to immutable commit SHAs while retaining version comments;
- document and verify production host requirements used by `compose-up.sh`;
- add an operator preflight for Bash, Git, Python 3, Docker Compose, and required utilities;
- preserve existing workflow permissions and release behavior.

### PR #66 — Operational observability

- make metrics exposure an explicit operator policy instead of an accidental public surface;
- add bounded business and worker operational signals suitable for diagnosis;
- cover metrics access and output with source, unit, and Docker contracts;
- avoid credentials, message content, addresses, and unbounded labels.

### PR #67 — Frontend request lifecycle and maintainability

- coalesce identical in-flight GET requests instead of cancelling earlier consumers;
- clear request cache and pending state across authentication boundaries;
- add administrator and mailbox-portal not-found surfaces;
- split Dashboard presentation concerns without changing its API calls or visual evidence budgets;
- preserve React Router 8, cookie sessions, and Frontend V3 behavior.

### PR #68 — Generated API contract

- add a canonical OpenAPI 3.1 document for supported automation-facing routes;
- verify method/path ownership and compatibility aliases against the Go route manifest;
- make the frontend API documentation consume or link the generated contract rather than independently defining route truth;
- keep administrator, portal, and ingress internals clearly separated from public API-key surfaces.

### PR #69 — Publish v2.1.1

- set canonical version identity to `2.1.1`;
- convert all accumulated Unreleased notes into a dated stable release entry;
- refresh README, deployment, support, upgrade, and release records where version-specific;
- publish checksummed cross-platform Go archives, CycloneDX SBOM, GHCR multi-architecture image, checksums, digest, immutable tag, and GitHub Release through the existing gated release workflow;
- verify branch cleanup and leave no open maintenance PR.

## Required verification for every implementation PR

At minimum, the exact PR head must pass all workflows required by repository policy, including:

- Full-stack consistency contract;
- CI: runtime, Go race/vet/build/vulnerability and PostgreSQL/Redis integrations, frontend lint/tests/build, Worker checks, dependency audit, Docker smoke, SBOM, doctors, route ownership, and release gate;
- Bootstrap administrator security;
- Security boundaries;
- Configuration and proxy security;
- Cross-platform release builds.

A PR must not merge when its head moved after review, a required check is missing or unsuccessful, the consistency inventory reports an error or warning, or the change exceeds its compatibility boundary.

## Merge and rollback rules

- use squash merges with an exact expected head SHA;
- merge only after the preceding PR is present on `main`;
- do not run concurrent revisions against one persisted deployment;
- no image-only rollback is assumed safe after a future schema or secret-layout change;
- this program itself adds no schema migration or durable-secret rotation, so v2.1.0 state remains the rollback floor;
- PR #69 must contain `[release:v2.1.1]` in the squash commit message so the stable release workflow can publish.

## Completion definition

The program is complete only when PR #64 through PR #69 are merged, the exact v2.1.1 release commit has all required checks, tag `v2.1.1` and its GitHub Release exist, the GHCR version tags and digest are published, release assets and checksums are present, maintenance branches are cleaned according to policy, and there are no open pull requests created by this program.
