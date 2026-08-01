# all-Mail source-available release checklist

This checklist is the publication and release-readiness closure loop for the custom non-commercial, source-available release.

`all-Mail` is not distributed under an OSI-approved open-source license. Public wording must say **source-available**, **non-commercial source license**, or equivalent wording unless the license changes.

## P0 - legal and publishability

- [ ] Confirm code, documentation, screenshots, and assets are legally publishable.
- [ ] Re-check `PROVENANCE.md` and `docs/internal/` for confidential or third-party material.
- [ ] Confirm the custom non-commercial license and all public messaging agree.
- [ ] Confirm release notes do not describe the repository as OSI open source.
- [ ] Confirm commercial-use inquiries have a documented contact path.

## P1 - secrets and security

- [ ] Re-scan tracked files for `.env`, tokens, OAuth outputs, screenshots, and local runtime artifacts.
- [ ] Confirm local state and Worker secret files remain ignored.
- [ ] Run `npm run audit:prod` and review every advisory exception.
- [ ] Confirm the one-time administrator password is retrieved through `go-business-api`, never `app` or logs.
- [ ] Confirm `worker-forwarding` mounts the isolated forwarding encryption key.
- [ ] Confirm `go-business-api` mounts the read-only JWT and encryption-key copies.
- [ ] Confirm `app`, `go-business-api`, `worker-forwarding`, and `worker-retention` run as UID `10001` with read-only filesystems, dropped capabilities, and `no-new-privileges`.
- [ ] Confirm `app` contains no database URL, Redis URL, JWT secret, or encryption key.

## P2 - engineering verification

- [ ] Runtime contract tests pass: `npm run test:runtime`.
- [ ] Go format, race, vet, build, and vulnerability checks pass.
- [ ] PostgreSQL and Redis integration tests pass.
- [ ] Forwarding integration tests pass.
- [ ] Web lint, test, and build pass.
- [ ] Cloudflare Worker checks pass.
- [ ] `docker compose config --quiet` passes.
- [ ] The release gate and dependency audit pass.

Canonical Docker smoke:

```bash
cp .env.example .env
./scripts/compose-up.sh
docker compose ps -a
curl --fail http://127.0.0.1:3002/readyz

docker compose exec -T app allmail doctor api
docker compose exec -T go-business-api allmail doctor business-api
docker compose exec -T worker-forwarding allmail doctor worker forwarding
docker compose exec -T worker-retention allmail doctor worker retention

! docker compose port go-business-api 3200
! docker compose port postgres 5432
! docker compose port redis 6379
```

- [ ] The temporary `app init` run completed successfully.
- [ ] `app`, `go-business-api`, `worker-forwarding`, `worker-retention`, `postgres`, and `redis` are healthy.
- [ ] No additional production service or one-shot Compose service exists.
- [ ] The Go runtime image contains no `psql`, Node runtime, or Prisma engine.

## P3 - migration and release safety

- [ ] Review embedded historical migrations, numbered Go migrations, and the catalog fingerprint.
- [ ] Confirm no applied migration changed after checksum recording.
- [ ] Confirm unknown, unresolved, checksum-mismatched, and drifted schemas fail closed.
- [ ] Back up PostgreSQL, `.env`, `runtime_secrets_data`, `forwarding_runtime_data`, and `go_business_runtime_data`.
- [ ] Confirm upgrade and rollback use `./scripts/compose-up.sh` with matching persisted state.
- [ ] Confirm processes from two revisions cannot run concurrently against one database.
- [ ] Confirm restore evidence covers the database and all matching secret volumes as one unit.

## P4 - runtime truthfulness

- [ ] `README.md` identifies `app` as the public Go listener and SPA server.
- [ ] `README.md` identifies `go-business-api` as the only private business service.
- [ ] The long-running service list is exactly `app`, `go-business-api`, `worker-forwarding`, `worker-retention`, `postgres`, and `redis`.
- [ ] Documentation says initialization uses a temporary `app init` container launched by `compose-up.sh`.
- [ ] Local development documentation does not claim production-topology equivalence.
- [ ] Cloudflare documentation routes ingress through `app` to `go-business-api`.
- [ ] `DEPLOY.md`, `RUNBOOK.md`, `ENVIRONMENT.md`, `GO-MIGRATION.md`, and Compose agree.
- [ ] Route documentation says all entries are complete and all business routes are Go-owned.
- [ ] Public readiness is documented as SPA plus private Go readiness; private readiness checks PostgreSQL and Redis.
- [ ] Former runtime or Prisma references are explicitly historical schema or release-history compatibility.

## P5 - repository presentation

- [ ] Public screenshots expose no live keys, full mailbox addresses, or production domains.
- [ ] `CHANGELOG.md` matches the state users encounter.
- [ ] `CONTRIBUTING.md`, `SECURITY.md`, `SUPPORT.md`, and `CODE_OF_CONDUCT.md` match current scope.
- [ ] Retired production entrypoints and separate server artifacts are absent.
- [ ] Release messaging uses `source-available` unless the license changes.

## P6 - release identity

- [ ] Choose alpha, beta, release-candidate, or stable messaging.
- [ ] Replace `[Unreleased]` with a dated release section when publishing a tag.
- [ ] Confirm `package.json`, release tag, image tag, and changelog version agree.
- [ ] Decide whether future product plans belong in the public release.
- [ ] Publish only after legal, security, engineering, migration, and presentation gates are green.

## Recommended release-note structure

1. What `all-Mail` is.
2. Source-available, non-commercial license boundary.
3. Go-only runtime and completed route ownership.
4. Stable providers and mail flows.
5. Deploy or upgrade instructions.
6. Schema, restore, and revision-rollback impact.
7. Security advisories or temporary exceptions.
8. Commercial licensing contact path.
