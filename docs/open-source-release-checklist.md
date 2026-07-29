# all-Mail open-source release checklist

This checklist is the publication and release-readiness closure loop.

## P0 — legal and publishability

- [ ] Confirm code, docs and assets are legally publishable.
- [ ] Re-check `PROVENANCE.md` and `docs/internal/` for stale or confidential wording.
- [ ] Remove or rewrite tracked material whose publishing basis is unclear.
- [ ] Confirm the custom non-commercial license and public messaging match the intended release.

## P1 — secrets and security

- [ ] Re-scan tracked files for `.env`, tokens, OAuth outputs, screenshots and local runtime artifacts.
- [ ] Confirm `.gitignore` excludes `oauth-temp/runtime/`, `gmail_oauth/runtime/`, `.dev.vars`, `.all-mail-runtime/` and local state.
- [ ] Run `npm run audit:prod`.
- [ ] Review every advisory exception for exact GHSA ID, package scope, rationale and expiry.
- [ ] Confirm no expired audit exception remains.
- [ ] Confirm Docker bootstrap passwords are retrieved through `legacy-api`, not the public Go image.
- [ ] Confirm only `worker-forwarding` mounts the isolated forwarding encryption key.
- [ ] Confirm `legacy-api` runs as UID `10001` with read-only filesystem, dropped capabilities and `no-new-privileges`.

## P2 — engineering verification

- [ ] Runtime contract tests pass: `npm run test:runtime`.
- [ ] Go format/race/vet/build passes.
- [ ] Real PostgreSQL forwarding integration passes.
- [ ] Server lint/test/build passes.
- [ ] Web lint/test/build passes.
- [ ] Cloudflare Worker checks pass.
- [ ] `docker compose config --quiet` passes.
- [ ] Canonical Docker smoke passes:

```bash
cp .env.example .env
docker compose up -d --build --wait --wait-timeout 240
docker compose ps -a
curl --fail http://127.0.0.1:3002/readyz
docker compose exec -T app allmail doctor api
docker compose exec -T worker-forwarding allmail doctor worker forwarding
docker compose exec -T worker-retention allmail doctor worker retention
```

- [ ] `legacy-init` and `go-migrate` completed successfully.
- [ ] No `go-jobs`, `legacy-jobs`, or Node `jobs` service exists.
- [ ] The Go runtime image does not contain `psql`.
- [ ] `release-gate` is green; dependency audit and Docker smoke both succeeded.

## P3 — migration and release safety

- [ ] Review Prisma and Go migrations for the release.
- [ ] Confirm no applied Go migration was edited after checksum recording.
- [ ] Confirm P3005 automatic `db push` remains disabled.
- [ ] Document intentional one-time use of `ALL_MAIL_ALLOW_LEGACY_DB_PUSH_REPAIR=true`.
- [ ] Treat P3009 as manual recovery.
- [ ] Verify PostgreSQL and runtime-volume backups before risky deployment.
- [ ] Verify rollback uses a previous known-good revision/image and matching persisted state.
- [ ] Confirm workers from two revisions cannot run concurrently during rollout or rollback.
- [ ] Release notes name current capability owners and ownership changes.

## P4 — runtime truthfulness

- [ ] `README.md` identifies Go as the public listener and Fastify as the compatibility business API.
- [ ] Default long-running service list is `app`, `worker-forwarding`, `worker-retention`, `legacy-api`, `postgres`, and `redis`.
- [ ] Local development docs do not claim production topology equivalence.
- [ ] Cloudflare docs route ingress through the Go public listener.
- [ ] `DEPLOY.md`, `RUNBOOK.md`, `ENVIRONMENT.md`, and `GO-MIGRATION.md` match Compose.
- [ ] The remaining vertical route-port plan is current.

## P5 — repository presentation

- [ ] Public-safe screenshots expose no live keys, full mailbox addresses or production domains.
- [ ] `CHANGELOG.md` matches the state users encounter.
- [ ] `CONTRIBUTING.md`, `SECURITY.md`, `SUPPORT.md`, and `CODE_OF_CONDUCT.md` match current scope.
- [ ] Dead templates, static-hosting helpers and Node production entrypoints are absent.
- [ ] Reserved Go tables are not presented as completed workers.

## P6 — release decision

- [ ] Choose alpha, beta or stable messaging.
- [ ] Decide whether desktop plans and future-roadmap documents belong in the public cut.
- [ ] Publish only after legal, security, engineering, migration and presentation gates are green.

## Recommended release-note structure

1. What `all-Mail` is.
2. Current Go/Fastify ownership boundary.
3. Stable providers and mail flows.
4. Deploy or upgrade instructions.
5. Migration and revision-rollback impact.
6. Compatibility business API and remaining deletion gate.
7. Security advisories or temporary exceptions.
8. License and repository identity.
