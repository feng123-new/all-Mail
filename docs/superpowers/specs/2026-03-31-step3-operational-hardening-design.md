# all-Mail Step 3 Operational Hardening Design

Date: 2026-03-31
Status: Draft accepted for planning
Scope owner: deployment path / release governance / operator documentation

## 1. Goal

Turn the post-Step-2 repository into something an operator or contributor can deploy, verify, and recover **without relying on private tribal knowledge**.

After this phase, the repository should expose one canonical path for:
- deployment and updates
- release verification
- rollback and incident handling
- environment configuration

Step 3 is not about changing core mail behavior. It is about making the existing system operable, repeatable, and auditable.

## 2. Current state

Observed repository state today:
- Step 1 and Step 2 have already hardened core product and mail-pipeline behavior.
- The repo already contains useful operational pieces, but they are fragmented across `README.md`, `docs/advanced-runtime.md`, `CLOUDFLARE-DEPLOY.md`, `.env*` files, package scripts, and CI.
- Root-level verification helpers already exist in `package.json` and `bin/all-mail.mjs` (`doctor`, `check`, `verify:release`), but the docs do not elevate them as the canonical workflow.
- Docker-first runtime guidance exists, but day-2 operations, recovery, backup/restore, and release/rollback procedure are still weak or scattered.
- CI verification exists in `.github/workflows/ci.yml`, but release-governance surfaces (`README.md`, `CONTRIBUTING.md`, release checklist, PR template) do not yet form one consistent operator-facing contract.

## 3. Scope and non-goals

### 3.1 In scope
- consolidate deployment documentation into one authoritative path
- consolidate runtime/environment documentation into one explicit contract
- align contributor verification guidance with real root-level commands
- align CI/release checklist/PR template with the documented release gate
- define rollback and incident-entry procedures for the default deployment shape
- define change-type verification expectations for docs/runtime/worker/config changes

### 3.2 Out of scope
- changing forwarding / ingress / provider runtime semantics unless a tiny supporting fix is required so docs remain truthful
- mailbox/provider feature expansion
- broad UI redesign work
- schema redesign beyond documenting production migration flow and gating
- introducing a large new deployment platform or infrastructure layer

## 4. Recommended architecture

### 4.1 Documentation surface model

Step 3 should shrink operational guidance into a small set of authoritative documents:

1. `README.md`
   - short onboarding and repository positioning only
   - point readers to deploy, environment, and runbook docs
   - make `doctor` / `check` the visible default verification path

2. `docs/DEPLOY.md`
   - canonical deployment/update path
   - prerequisites
   - environment selection
   - startup sequence
   - migration sequence
   - health and smoke checks
   - rollback entry
   - Cloudflare worker rollout cross-reference

3. `docs/RUNBOOK.md` or `docs/runbooks/`
   - day-2 operator guidance
   - expected healthy service layout
   - log inspection and routine recovery procedures
   - jobs/runtime health checks
   - failed migration handling
   - bootstrap/admin secret recovery entry
   - backup/restore pointer

4. `docs/ENVIRONMENT.md`
   - single env matrix for root, server, and worker variables
   - required vs optional vs feature-gated variables
   - source-of-truth references back to `.env.example`, `.env.cloudflare.example`, `server/.env.example`, and worker `.dev.vars.example`

### 4.2 Release-governance surface model

The documented release path should be enforced across the repo’s operational surfaces:

- `package.json`
  - root `doctor`, `check`, and `verify:release` stay as the canonical local gate
- `.github/workflows/ci.yml`
  - CI must reflect the documented release gate, not a parallel hidden standard
- `docs/open-source-release-checklist.md`
  - align with actual release verification and rollback expectations
- `CONTRIBUTING.md`
  - define one contributor verification path instead of package-by-package discovery
- `.github/PULL_REQUEST_TEMPLATE.md`
  - require verification evidence and rollback awareness when a change affects release/runtime behavior

### 4.3 Runtime contract model

The default operational contract is Docker-first, with source-runtime and Cloudflare worker paths documented as explicit secondary/adjacent flows.

That means Step 3 should treat these surfaces as the operational truth:
- `docker-compose.yml`
- `Dockerfile`
- `docker/entrypoint.sh`
- `bin/all-mail.mjs`
- `scripts/start-all-mail.mjs`
- `cloudflare/workers/allmail-edge/bin/doctor.js`
- `cloudflare/workers/allmail-edge/bin/deploy-prod.js`

Docs must describe these actual runtime surfaces rather than inventing parallel procedures.

## 5. Release flow

Step 3 should define one release sequence.

### 5.1 Preflight
- run root-level verification (`doctor`, `check`, `verify:release` as appropriate)
- confirm environment selection and deploy scope
- confirm whether database migration is part of the release
- confirm whether Cloudflare worker rollout is part of the release

### 5.2 Deploy
- deploy app/runtime changes
- run `prisma migrate deploy` as the production schema step when migrations are included
- deploy worker changes through the documented Cloudflare path when worker code changes are included

### 5.3 Post-deploy verification
- confirm app health endpoint
- confirm targeted smoke checks
- confirm job/background processing health
- confirm worker ingress-specific checks when relevant

### 5.4 Accept or rollback
- a release is not done until post-deploy verification passes
- if verification fails, rollback steps must be explicit and immediate

## 6. Verification gates

### 6.1 Canonical local gate
Document and use a single repo-level verification path:
- `npm run doctor`
- `npm run check`
- `npm run verify:release`

### 6.2 CI gate
CI should mirror the documented local expectations:
- runtime/web/server/worker checks should stay aligned with the repo-root release contract
- release-facing checks should not rely on undocumented extra conditions

### 6.3 Change-type verification matrix
Step 3 should document minimum required verification by change type:
- docs-only change
- server/runtime change
- worker change
- deployment/config change
- release-governance/documentation-only change that modifies operator instructions

This keeps verification proportional without making the release path ambiguous.

## 7. Rollback and recovery model

### 7.1 Rollback categories
Docs should clearly distinguish rollback paths for:
- app/runtime-only failures
- migration-related failures
- worker rollout failures
- environment/configuration mistakes

### 7.2 Recovery entries
The runbook should provide first-entry procedures for:
- `jobs` runtime not processing work
- Redis degraded/local-fallback mode implications
- failed or partially applied migration
- bootstrap/admin secret confusion or forced rotation
- backup/restore starting point for PostgreSQL and persistent volumes

### 7.3 Release metadata expectations
For release-affecting changes, the repo should surface:
- rollback note
- migration risk note when applicable
- operator ownership/accountability for the change

## 8. Success criteria

Step 3 is complete when all of the following are true:

1. A new operator can deploy and update the default stack from repo docs alone.
2. A contributor can verify changes from one canonical path without rediscovering commands from multiple package files.
3. `README.md`, `CONTRIBUTING.md`, CI, the release checklist, and the PR template no longer disagree about release verification expectations.
4. Recovery basics exist for jobs health, migration trouble, bootstrap/admin-secret issues, rollback, and backup/restore entry.
5. The implementation stays focused on operational hardening and does not reopen Step 2 product internals except for tiny truth-preserving fixes.

## 9. Recommended implementation order

1. create and populate `docs/DEPLOY.md`, `docs/RUNBOOK.md`, and `docs/ENVIRONMENT.md`
2. reduce `README.md` to a clean onboarding/index surface pointing to those docs
3. align `CONTRIBUTING.md` and `docs/open-source-release-checklist.md` with the same verification/release contract
4. align CI and PR template expectations with the documented gate
5. run the full repo verification gate and fix any documentation-to-runtime drift discovered during verification

## 10. External guidance that informed this design

This design follows the same operational themes emphasized by reputable external sources that were reviewed during brainstorming:
- staged/progressive rollout and rollback discipline
- production-safe Prisma migration flow (`prisma migrate deploy` in deployment automation)
- environment-driven configuration as an explicit contract
- centralized operator runbooks and launch/readiness checklists

The implementation phase may cite those sources directly in user-facing planning or release-governance notes if needed, but this design remains anchored to repository-local changes.
