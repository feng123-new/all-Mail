# all-Mail Open-Source Release Checklist

This checklist is the publish-readiness closure loop for turning the repository from private to public.

## P0 — legal / publishability gate

- [ ] Confirm the current code, docs, and assets in this repository are legally publishable
- [ ] Re-check `PROVENANCE.md` and `docs/internal/` for wording drift that no longer matches the repository posture
- [ ] Remove or rewrite any tracked material whose publishing basis is unclear before the repo is promoted publicly

## P1 — secrets / security gate

- [ ] Re-scan tracked files for `.env`, tokens, OAuth runtime outputs, screenshots, and local migration artifacts
- [ ] Confirm `.gitignore` still excludes runtime state (`oauth-temp/runtime/`, `gmail_oauth/runtime/`, `.dev.vars`, screenshots, local state)
- [ ] Run `npm audit --omit=dev` in `web`, `server`, and `cloudflare/workers/allmail-edge`
- [ ] Record any remaining risk that cannot be fully fixed without architectural change

## P2 — engineering verification gate

- [ ] `./bin/all-mail doctor`
- [ ] `./bin/all-mail check`
- [ ] Docker smoke path from `docs/DEPLOY.md` still works (`docker compose up -d --build`, `docker compose ps`, `/health`)
- [ ] Cloudflare worker preflight from `CLOUDFLARE-DEPLOY.md` still works when that path is in scope
- [ ] Any environment-specific `doctor` limitation is documented truthfully instead of being silently skipped

## P3 — release-safety gate

- [ ] Migration expectations are reviewed for the release (`P3005` fallback vs. manual `P3009` recovery)
- [ ] Rollback path is still documented and realistic for this release
- [ ] Setup/behavior docs (`README.md`, `docs/DEPLOY.md`, `docs/RUNBOOK.md`, `docs/ENVIRONMENT.md`) match the shipped runtime contract
- [ ] PR/release notes mention deploy-impacting docs, rollback notes, and migration notes where relevant

## P4 — repository presentation gate

- [ ] Main `README.md` explains scope, primary deployment path, verification entrypoints, and limitations clearly
- [ ] Public-safe screenshots exist and do not expose live keys, full mailbox addresses, or production domains
- [ ] `CHANGELOG.md` reflects the state users will first encounter publicly
- [ ] `CONTRIBUTING.md`, `SECURITY.md`, `SUPPORT.md`, and `CODE_OF_CONDUCT.md` stay consistent with current project scope
- [ ] Remove template leftovers or dead default assets that make the repo look unfinished

## P5 — release decision gate

- [ ] GitHub repo visibility is still private until P0–P4 are complete
- [ ] Choose the public message: alpha / beta / stable
- [ ] Decide whether screenshots, desktop plans, and future roadmap docs belong in the first public cut
- [ ] Publish only after legal, security, engineering, release-safety, and presentation gates are all green

## Recommended public release note structure

1. What `all-Mail` is
2. Which providers and mail flows are stable today
3. What remains intentionally out of scope
4. How to self-host quickly
5. Repository identity and license posture
