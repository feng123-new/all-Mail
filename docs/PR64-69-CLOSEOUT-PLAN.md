# PR #64–#69 stabilization and v2.1.1 closeout record

Status: completed on 2026-08-04.

The approved post-v2.1.0 stabilization program was executed sequentially from verified `main` while preserving the six-service Go-only topology, public routes, authorization, database schema, durable secrets, provider formats, forwarding semantics, and v2.1.0 persisted-state compatibility.

## Completed sequence

### PR #64 — release governance and plan

- published the canonical scope, compatibility, verification, merge, rollback, and completion rules;
- aligned security/support language with the stable 2.1.x line;
- restored complete post-v2.1.0 changelog truth;
- added permanent release-governance regression coverage.

### PR #65 — CI supply-chain and deployment-host hardening

- pinned every third-party GitHub Action to an immutable commit SHA;
- added a movable-Action rejection contract;
- added a secret-safe host preflight;
- documented the supported single-Linux-host production baseline and unsupported HA modes.

### PR #66 — production observability boundaries

- protected `/metrics` with direct-peer CIDR policy;
- rejected malformed and allow-all metric CIDRs;
- ignored forwarded identity headers for metrics authorization;
- documented bounded metrics, readiness, doctors, heartbeats, logs, privacy, and alerts.

### PR #67 — frontend request lifecycle and maintainability

- coalesced duplicate GET requests;
- isolated cache state by authentication epoch;
- prevented stale responses from repopulating cache;
- added scoped administrator, mailbox-portal, and public 404 surfaces;
- extracted Dashboard fallback modeling without changing visual evidence.

### PR #68 — generated OpenAPI contract

- added a reviewable canonical operation inventory;
- generated and published OpenAPI 3.1 at `/openapi.json`;
- verified route ownership, Go registration, authentication boundaries, Docker publication, and version identity;
- kept compatibility aliases implemented but out of primary paths.

### Release closeout

The sixth implementation stage was planned as PR #69. A duplicate plan branch consumed PR #69 after PR #64–#68 had already merged and was closed without merge. GitHub pull request numbers cannot be reused, so the actual v2.1.1 publication continued as PR #70 with the same approved scope and release marker.

## Verification record

Each merged implementation PR passed the required exact-head workflows:

- Full-stack consistency contract;
- CI, including runtime, Go race/vet/build/vulnerability and PostgreSQL/Redis integrations, frontend lint/tests/build, Worker checks, dependency audit, Docker smoke, SBOM, doctors, route ownership, and release gate;
- Bootstrap administrator security and desktop/mobile browser proof;
- Security boundaries;
- Configuration and proxy security;
- Cross-platform Linux/macOS/Windows amd64/arm64 release builds.

## Compatibility and rollback

No stage introduced a database migration, durable-secret rotation, public route removal, authorization weakening, provider credential-format change, service/network/volume topology change, or persisted-state incompatibility. Normal v2.1.0-to-v2.1.1 upgrade and revision-plus-state rollback procedures remain applicable.

## Completion definition

The program is complete when the v2.1.1 release PR is merged with `[release:v2.1.1]`, all required checks succeed on the exact release commit, tag `v2.1.1`, GitHub Release, checksummed archives, CycloneDX SBOM, GHCR multi-architecture tags, and image digest are published, eligible maintenance branches are cleaned, and no sequence PR remains open.
