# all-Mail source-available release checklist

This is the publication and release-readiness closure loop for the custom non-commercial source release.

`all-Mail` is **not distributed under an OSI-approved open-source license**. Public wording must say **source-available**, **non-commercial source license**, or equivalent wording unless the license changes.

## P0 — legal and publishability

- [ ] Code, documentation, screenshots, and assets are legally publishable.
- [ ] The custom license and public messaging agree.
- [ ] Commercial-use inquiries have a documented contact path.
- [ ] No release note describes the repository as OSI open source.

## P1 — credentials and browser security

- [ ] No portal password is written to `localStorage`, `sessionStorage`, a URL, analytics, or logs.
- [ ] Loading the fixed UI removes historical `all-mail:portal-login:` storage entries.
- [ ] Portal links contain only a username and require the user to enter the password.
- [ ] The first administrator credential is available only through `go-business-api` and is deleted after rotation.
- [ ] Tracked files and screenshots are re-scanned for tokens, `.env` files, OAuth outputs, and local runtime artifacts.

## P2 — runtime boundaries

The long-running service list is exactly:

```text
app
go-business-api
worker-forwarding
worker-retention
postgres
redis
```

- [ ] `app` is attached only to `public-network` and `app-network`.
- [ ] `app` has no database, Redis, provider-egress, JWT, encryption, or bootstrap credential.
- [ ] `postgres` is attached only to `database-network`.
- [ ] `redis` is attached only to `cache-network`.
- [ ] `worker-retention` has no provider egress.
- [ ] Only `app` is host-published.

Canonical checks:

```bash
! docker compose port go-business-api 3200
! docker compose port postgres 5432
! docker compose port redis 6379
```

## P3 — secret ownership and Redis authentication

- [ ] `runtime_secrets_data` is initializer-only and contains the master JWT, encryption, and Redis values.
- [ ] `go-business-api` does not mount `runtime_secrets_data`.
- [ ] `bootstrap_admin_data`, `go_business_runtime_data`, `forwarding_runtime_data`, and `redis_runtime_data` are mounted only where required.
- [ ] Redis starts with `requirepass` from `redis_runtime_data`.
- [ ] Unauthenticated `redis-cli ping` fails.
- [ ] Authenticated Redis health succeeds without printing the password.
- [ ] An upgrade migrates an old bootstrap credential without overwriting a conflict.

## P4 — engineering verification

- [ ] Runtime contract tests pass: `npm run test:runtime`.
- [ ] Go format, race, vet, build, and vulnerability checks pass.
- [ ] PostgreSQL and Redis integration tests pass.
- [ ] Forwarding integration tests pass.
- [ ] Web lint, test, and build pass.
- [ ] Cloudflare Worker checks pass.
- [ ] Production dependency audit passes.
- [ ] `docker compose config --quiet` passes.
- [ ] Docker smoke and release gate pass.

Run all doctors:

```bash
docker compose exec -T app allmail doctor api
docker compose exec -T go-business-api allmail doctor business-api
docker compose exec -T worker-forwarding allmail doctor worker forwarding
docker compose exec -T worker-retention allmail doctor worker retention
```

## P5 — migration, backup, and rollback

- [ ] Applied migrations remain immutable and checksummed.
- [ ] Unknown, gapped, checksum-mismatched, and structurally drifted schemas fail closed.
- [ ] Backup evidence covers PostgreSQL, `.env`, the exact revision, `runtime_secrets_data`, `bootstrap_admin_data`, `go_business_runtime_data`, `forwarding_runtime_data`, and `redis_runtime_data`.
- [ ] Redis persistence is included when OAuth, replay, lockout, or rate-limit continuity matters.
- [ ] Restore evidence proves the complete state set starts cleanly.
- [ ] Two revisions cannot run concurrently against one database.

## P6 — operator truthfulness

- [ ] `README.md`, `DEPLOY.md`, `RUNBOOK.md`, `ENVIRONMENT.md`, and Compose agree.
- [ ] Public readiness is documented as SPA plus private `go-business-api` readiness.
- [ ] Private readiness performs authenticated PostgreSQL and Redis checks.
- [ ] Initialization is documented as a temporary `app init` container launched by `compose-up.sh`.
- [ ] Historical runtime names are clearly archival only.

## P7 — release identity

- [ ] Choose alpha, beta, release-candidate, or stable messaging.
- [ ] Replace `[Unreleased]` with a dated section when publishing a tag.
- [ ] Package, binary, image, tag, and changelog versions agree.
- [ ] Publish only after legal, security, engineering, migration, and presentation gates are green.
