# all-Mail Open-Source Release Checklist

This checklist is the publish-readiness closure loop for turning the repository from private to public.

## P0 — legal / provenance gate

- [ ] Confirm all upstream-derived code is legally redistributable
- [ ] Re-check `PROVENANCE.md` against actual inherited modules and docs
- [ ] If any upstream has no explicit license, obtain permission or remove / rewrite the affected implementation before publishing

## P1 — secrets / security gate

- [ ] Re-scan tracked files for `.env`, tokens, OAuth runtime outputs, screenshots, and local migration artifacts
- [ ] Confirm `.gitignore` still excludes runtime state (`oauth-temp/runtime/`, `gmail_oauth/runtime/`, `.dev.vars`, screenshots, local state)
- [ ] Run `npm audit --omit=dev` in `web`, `server`, and `cloudflare/workers/allmail-edge`
- [ ] Record any remaining risk that cannot be fully fixed without architectural change

## P2 — engineering verification gate

- [ ] `cd web && npm run lint && npm run build`
- [ ] `cd server && npm run lint && npm run build && npm run test`
- [ ] `cd cloudflare/workers/allmail-edge && npm run check`
- [ ] Smoke-check Docker deployment from root `docker-compose.yml`
- [ ] Smoke-check Cloudflare Worker preflight from `CLOUDFLARE-DEPLOY.md`

## P3 — repository presentation gate

- [ ] Main `README.md` explains scope, deployment path, capabilities, and limitations clearly
- [ ] Public-safe screenshots exist and do not expose live keys, full mailbox addresses, or production domains
- [ ] `CHANGELOG.md` reflects the state users will first encounter publicly
- [ ] `CONTRIBUTING.md`, `SECURITY.md`, `SUPPORT.md`, and `CODE_OF_CONDUCT.md` stay consistent with current project scope
- [ ] Remove template leftovers or dead default assets that make the repo look unfinished

## P4 — release decision gate

- [ ] GitHub repo visibility is still private until P0–P3 are complete
- [ ] Choose the public message: alpha / beta / stable
- [ ] Decide whether screenshots, desktop plans, and future roadmap docs belong in the first public cut
- [ ] Publish only after legal, security, engineering, and presentation gates are all green

## Recommended public release note structure

1. What `all-Mail` is
2. Which providers and mail flows are stable today
3. What remains intentionally out of scope
4. How to self-host quickly
5. Provenance and license posture
