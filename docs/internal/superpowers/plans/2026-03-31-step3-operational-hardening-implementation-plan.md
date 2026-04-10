# all-Mail Step 3 Operational Hardening Implementation Plan

Date: 2026-03-31
Based on: `docs/internal/superpowers/specs/2026-03-31-step3-operational-hardening-design.md`

## Goal

Implement Step 3 operational hardening by turning the repo’s fragmented deployment, verification, environment, and recovery guidance into one enforceable operator-facing contract.

This implementation should produce:
- authoritative deployment, environment, and runbook docs
- aligned onboarding/contributor/release-governance docs
- CI / PR template behavior that matches the documented release gate
- a final verification pass that checks documentation-to-runtime truthfulness

## Safe execution order

1. **Authoritative docs scaffolding**
2. **Environment contract**
3. **Deployment guide**
4. **Operator runbook**
5. **README and adjacent doc alignment**
6. **Contributor and release-governance alignment**
7. **CI / PR gate alignment**
8. **Final truthfulness verification**

Do not change the order. The higher-level docs need stable authoritative targets first, and CI / PR governance should only be tightened after the documentation contract is clear.

## Slice 1 — Authoritative docs scaffolding

### Files
- `docs/DEPLOY.md` (new)
- `docs/RUNBOOK.md` (new)
- `docs/ENVIRONMENT.md` (new)

### Changes
- Create the three authoritative Step 3 documents.
- Keep each doc sharply bounded:
  - `DEPLOY.md` = deployment, update, smoke, rollback entry
  - `RUNBOOK.md` = day-2 operations and recovery entries
  - `ENVIRONMENT.md` = variable contract and env-template mapping
- Add a short opening section in each doc explaining its boundary and which adjacent docs it defers to.

### Verification gate
- Files exist with clear boundary sections and no overlapping ownership ambiguity.

## Slice 2 — Environment contract

### Files
- `docs/ENVIRONMENT.md`
- `.env.example`
- `.env.cloudflare.example`
- `server/.env.example`
- `cloudflare/workers/allmail-edge/.dev.vars.example`
- `docker-compose.yml`

### Changes
- Build one environment matrix that covers root/server/worker variables.
- Classify each variable as:
  - required
  - optional
  - feature-gated
- Document the variables already surfaced by runtime/deploy docs and docker compose, especially the ones currently underexplained in repo docs.
- Cross-check `ENVIRONMENT.md` against the example env files and `docker-compose.yml` so the guide reflects the real runtime contract.
- If an example file is missing an already-used variable that operators must understand, update the example file or document the reason it stays implicit.

### Verification gate
- Every variable referenced in the new guide points back to a real example/config surface.
- No required operator-facing variable is documented only in prose while missing from all repo-controlled templates unless explicitly justified.

## Slice 3 — Deployment guide

### Files
- `docs/DEPLOY.md`
- `README.md`
- `docs/advanced-runtime.md`
- `CLOUDFLARE-DEPLOY.md`
- `package.json`

### Changes
- Write the canonical default Docker-first deployment path in `docs/DEPLOY.md`.
- Include:
  - prerequisites
  - environment selection
  - startup sequence
  - health checks
  - release verification entrypoints (`doctor`, `check`, `verify:release`)
  - migration expectations
  - rollback entry
- Treat `README.md` as onboarding + routing, not as the full deploy runbook.
- Keep `docs/advanced-runtime.md` explicitly secondary.
- Keep `CLOUDFLARE-DEPLOY.md` as the worker-specific deploy/runbook and link to it from `DEPLOY.md` rather than duplicating it.
- If root scripts need wording or small naming cleanup so docs tell the truth, make the smallest script/doc alignment change possible.

### Verification gate
- A reader can follow `DEPLOY.md` to choose the correct deployment path without guessing which doc is authoritative.
- `README.md`, `DEPLOY.md`, and `advanced-runtime.md` do not contradict each other about the primary runtime.

## Slice 4 — Operator runbook

### Files
- `docs/RUNBOOK.md`
- `docker-compose.yml`
- `docker/entrypoint.sh`
- `bin/all-mail.mjs`
- `docs/advanced-runtime.md`
- `CLOUDFLARE-DEPLOY.md`

### Changes
- Document the expected healthy baseline for:
  - app
  - jobs
  - postgres
  - redis
  - Cloudflare worker path when applicable
- Add first-entry procedures for:
  - jobs not processing
  - Redis degraded/local fallback implications
  - failed migration / `P3009`-style recovery entry
  - bootstrap/admin-secret confusion or rotation entry
  - backup/restore starting point for PostgreSQL + persisted volumes
- Point each runbook entry to the real commands/operators already exposed by the repo when available.
- Do not invent recovery automation that does not exist.

### Verification gate
- Each runbook entry references real repo/runtime surfaces.
- Recovery sections clearly state when the repo provides automation vs when the operator must act manually.

## Slice 5 — README and adjacent doc alignment

### Files
- `README.md`
- `docs/advanced-runtime.md`
- `web/README.md`
- `docs/internal/ops/opencode-all-mail-ops.md`

### Changes
- Reduce `README.md` to:
  - product positioning
  - quick start
  - health check
  - canonical link-out to `DEPLOY.md`, `RUNBOOK.md`, `ENVIRONMENT.md`, and Cloudflare guide
- Elevate root-level commands (`npm run doctor`, `npm run check`, `npm run verify:release`) as the default verification entrypoints.
- Fix obvious documentation drift identified during exploration, including mismatches between package scripts and subordinate README/operator docs.
- If `docs/internal/ops/opencode-all-mail-ops.md` points to missing tooling, either correct the path/reference or explicitly mark it historical/out-of-scope.

### Verification gate
- `README.md` is shorter, clearer, and points to the new authoritative docs.
- Adjacent docs no longer disagree about how to start or verify the system.

## Slice 6 — Contributor and release-governance alignment

### Files
- `CONTRIBUTING.md`
- `docs/open-source-release-checklist.md`
- `CHANGELOG.md`
- `PROVENANCE.md` (reference check only unless wording drift is discovered)

### Changes
- Rewrite `CONTRIBUTING.md` around one canonical contributor flow:
  - clone
  - choose env/runtime path
  - run/install/build as needed
  - verify with root-level commands
- Update the open-source release checklist so it matches the Step 3 release contract:
  - verification gate
  - migration awareness
  - smoke checks
  - rollback awareness
  - release note/governance updates
- Only touch `CHANGELOG.md` or `PROVENANCE.md` if alignment wording is required; do not expand scope into a release-content rewrite.

### Verification gate
- `CONTRIBUTING.md`, the release checklist, and root scripts describe the same minimum verification path.
- Release-governance docs do not imply checks the repo cannot actually perform.

## Slice 7 — CI / PR gate alignment

### Files
- `.github/workflows/ci.yml`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `package.json`

### Changes
- Align CI naming and checks with the documented local release gate.
- Decide whether CI should:
  - continue using split jobs while matching the same logical contract, or
  - add a repo-root release gate step where appropriate.
- Preserve useful job granularity; do not collapse CI into a slower opaque job unless it materially improves parity.
- Update the PR template so release-affecting changes require:
  - verification evidence
  - docs update acknowledgement when setup/behavior changes
  - rollback note
  - migration note when schema/deploy flow changes are involved
- Do not attempt to change non-repo GitHub environment settings in this slice; document those expectations instead.

### Verification gate
- CI and PR template language match the Step 3 documentation contract.
- Repo-controlled governance surfaces enforce what the docs ask for, as far as code/files can enforce it.

## Slice 8 — Final truthfulness verification

### Files
- all files touched in Slices 1–7

### Checks
- Read every changed doc against the underlying runtime/config file it references.
- Re-run the repo verification gate after edits.
- If docs claim a command or path is canonical, confirm the command actually exists and succeeds in the current repo.

### Final verification commands
```bash
cd /home/fengyong/github/all-Mail && npm run doctor
cd /home/fengyong/github/all-Mail && npm run check
```

If Step 3 changes affect only docs/CI templates and `npm run doctor` is environment-sensitive in a way that cannot pass in the local session, document that constraint explicitly and still run the strongest truthful local gate available.

## Explicit defer list

Out of scope for Step 3:
- reopening Step 2 mail-flow internals
- provider behavior changes
- schema redesign unrelated to documented production migration flow
- large frontend redesigns
- GitHub environment/reviewer settings that cannot be represented in repo files
- introducing new deployment platforms or orchestration systems

## Implementation guardrails

- Prefer documentation and governance alignment over adding new automation.
- Any code/script changes must be minimal and only to keep documentation truthful.
- Do not duplicate the Cloudflare worker runbook into the main deploy guide.
- Do not let contributor docs drift back into package-by-package tribal knowledge.
- Do not require rollback/migration procedures that the repo cannot explain concretely.

## Risk notes

- `npm run doctor` may depend on local environment/dependency availability; verify honestly and document any environment-specific limitation encountered during the implementation phase.
- CI parity must be improved without destroying the existing split-job signal.
- Environment documentation must stay grounded in actual repo-controlled templates and config surfaces, not aspirational production setup.
