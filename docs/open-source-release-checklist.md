# all-Mail source-available release checklist

This checklist is the publication and release-readiness closure loop for the custom non-commercial, source-available release.

`all-Mail` is not distributed under an OSI-approved open-source license. Public wording must say **source-available**, **non-commercial source license**, or equivalent wording unless the license is changed.

## P0 — legal and publishability

- [ ] Confirm code, documentation, screenshots, and assets are legally publishable.
- [ ] Re-check `PROVENANCE.md` and `docs/internal/` for stale, confidential, or third-party material.
- [ ] Remove or rewrite tracked material whose publishing basis is unclear.
- [ ] Confirm the custom non-commercial license and all public messaging agree.
- [ ] Confirm commercial-use inquiries have a documented contact path.
- [ ] Confirm release notes do not describe the repository as OSI open source.

## P1 — secrets and security

- [ ] Re-scan tracked files for `.env`, tokens, OAuth outputs, screenshots, and local runtime artifacts.
- [ ] Confirm `.gitignore` excludes `oauth-temp/runtime/`, `gmail_oauth/runtime/`, `.dev.vars`, `.all-mail-runtime/`, and local state.
- [ ] Run `npm run audit:prod`.
- [ ] Run `govulncheck ./...` through the canonical Go gate.
- [ ] Review every advisory exception for exact GHSA ID, package scope, rationale, and expiry.
- [ ] Confirm no expired advisory exception remains.
- [ ] Confirm Docker bootstrap passwords are retrieved through `business-api`, never the public Go image.
- [ ] Confirm only `worker-forwarding` mounts the isolated forwarding encryption key.
- [ ] Confirm only `go-business-api` mounts the isolated read-only JWT copy.
- [ ] Confirm `business-api` and `go-business-api` run as UID `10001` with read-only filesystems, dropped capabilities, and `no-new-privileges`.
- [ ] Confirm the public `app` contains no database URL, Redis URL, JWT secret, or encryption key.

## P2 — engineering verification

- [ ] Runtime contract tests pass: `npm run test:runtime`.
- [ ] Go format, race, vet, build, and vulnerability checks pass.
- [ ] Real PostgreSQL and Redis Go-business integration passes.
- [ ] Real PostgreSQL forwarding integration passes.
- [ ] Server lint, test, and build pass while Fastify remains active.
- [ ] Web lint, test, and build pass.
- [ ] Cloudflare Worker checks pass.
- [ ] `docker compose config --quiet` passes.
- [ ] Canonical Docker smoke passes:

```bash
cp .env.example .env
docker compose up -d --build --wait --wait-timeout 300
docker compose ps -a
curl --fail http://127.0.0.1:3002/readyz

docker compose exec -T app allmail doctor api
docker compose exec -T go-business-api allmail doctor business-api
docker compose exec -T worker-forwarding allmail doctor worker forwarding
docker compose exec -T worker-retention allmail doctor worker retention
```

- [ ] Go `business-init` completed successfully and `go-migrate` is absent.
- [ ] `app`, `go-business-api`, `business-api`, both workers, PostgreSQL, and Redis remain healthy.
- [ ] No `go-jobs`, `legacy-jobs`, or Node `jobs` service exists.
- [ ] The Go runtime image does not contain `psql`.
- [ ] `release-gate` is green; dependency audit and Docker smoke both succeeded.

## P3 — migration and release safety

- [ ] Review the embedded Prisma history, numbered Go migrations, and catalog fingerprint for the release.
- [ ] Confirm no applied migration was edited after checksum recording.
- [ ] Confirm unknown, unresolved, checksum-mismatched, and drifted schemas fail closed without Prisma or `db push`.
- [ ] Verify PostgreSQL and every runtime-secret volume are backed up before risky deployment.
- [ ] Verify rollback uses a previous known-good revision or image with matching persisted state.
- [ ] Confirm initializers, workers, and business APIs from two revisions cannot run concurrently.
- [ ] Release notes name current route and capability owners.
- [ ] Route-owner changes include parity, failure, Docker-smoke, and revision-rollback evidence.

## P4 — runtime truthfulness

- [ ] `README.md` identifies `app` as the public Go listener.
- [ ] `README.md` identifies `go-business-api` as the private migrated Go business service.
- [ ] `README.md` identifies `business-api` as the remaining Fastify/Prisma business service.
- [ ] Default long-running service list is `app`, `go-business-api`, `business-api`, `worker-forwarding`, `worker-retention`, `postgres`, and `redis`.
- [ ] Completed one-shot list is only `business-init`.
- [ ] Local development documentation does not claim production topology equivalence.
- [ ] Cloudflare documentation routes ingress through the public Go listener.
- [ ] `DEPLOY.md`, `RUNBOOK.md`, `ENVIRONMENT.md`, `GO-MIGRATION.md`, and `docker-compose.yml` agree.
- [ ] The remaining vertical route-port plan is current.
- [ ] No documentation says public readiness checks only Fastify; it aggregates both private business services.

## P5 — repository presentation

- [ ] Public-safe screenshots expose no live keys, full mailbox addresses, or production domains.
- [ ] `CHANGELOG.md` matches the state users encounter.
- [ ] `CONTRIBUTING.md`, `SECURITY.md`, `SUPPORT.md`, and `CODE_OF_CONDUCT.md` match current scope.
- [ ] Dead templates, static-hosting helpers, and retired Node production entrypoints are absent.
- [ ] Reserved Go tables are not presented as completed workers.
- [ ] Release messaging uses `source-available` unless the license has changed.

## P6 — release identity

- [ ] Choose alpha, beta, release-candidate, or stable messaging.
- [ ] Replace `[Unreleased]` with a dated release section when publishing a tag.
- [ ] Confirm `package.json`, release tag, image tag, and changelog version agree.
- [ ] Decide whether desktop plans and future-roadmap documents belong in the public cut.
- [ ] Publish only after legal, security, engineering, migration, and presentation gates are green.

## Recommended release-note structure

1. What `all-Mail` is.
2. Source-available, non-commercial license boundary.
3. Current Go/Fastify route and capability ownership.
4. Stable providers and mail flows.
5. Deploy or upgrade instructions.
6. Migration and revision-rollback impact.
7. Remaining Node/Prisma deletion gates.
8. Security advisories or temporary exceptions.
9. Commercial licensing contact path.
