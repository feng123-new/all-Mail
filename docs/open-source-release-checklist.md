# Open-source release checklist

This checklist is the release closure loop for `all-Mail`. The repository is free and open-source software licensed under the GNU Affero General Public License v3.0 only (`AGPL-3.0-only`); see [`../LICENSE`](../LICENSE).

## 1. Release identity

- [ ] `VERSION`, root `package.json`, the changelog section, Git tag, binary output, release archive names, and OCI image labels use the same semantic version.
- [ ] `allmail version --json` reports a non-development version, full commit SHA, UTC build timestamp, and Go toolchain version.
- [ ] The release commit is on `main` and every required check is successful.
- [ ] The tag is immutable and points to the release commit.
- [ ] Release assets include checksums and are built from the tagged commit.

## 2. License and public wording

- [ ] `LICENSE`, `README.md`, `SECURITY.md`, `SUPPORT.md`, `CHANGELOG.md`, `package.json`, `Dockerfile`, and `docs/README.md` agree on `AGPL-3.0-only`.
- [ ] Current public documentation describes `all-Mail` as free and open-source software and uses the canonical AGPL license identity consistently.
- [ ] Commercial use is permitted subject to `AGPL-3.0-only`; support and warranty arrangements are separate from the license.
- [ ] Operators who modify the program and make that modified version available to users over a computer network provide those users an opportunity to obtain the Corresponding Source as required by AGPLv3 section 13.
- [ ] Code, screenshots, dependencies, and release assets are legally publishable and license-compatible.

## 3. Security and credentials

- [ ] No password, token, `.env`, OAuth output, raw message, database URL, or runtime secret is committed or included in an artifact.
- [ ] Portal passwords are never persisted, prefilled, placed in URLs, or logged.
- [ ] Browser authentication remains cookie-first and frontend auth stores are not persisted.
- [ ] Browser same-origin and framing protections pass.
- [ ] Redis authentication, secret-volume isolation, database role isolation, and private-port checks pass.
- [ ] The one-time bootstrap credential is removed after successful password rotation.

## 4. Runtime topology

The long-running production service set is exactly:

```text
app
go-business-api
worker-forwarding
worker-retention
postgres
redis
```

- [ ] Only `app` is host-published.
- [ ] `app` has no database, cache, provider, JWT, encryption, OAuth, ingress, or bootstrap credential.
- [ ] PostgreSQL, Redis, provider egress, and internal app transport use separate networks.
- [ ] Runtime database identities are generated, non-owner, and table-scoped.
- [ ] The master secret volume is initializer-only.

Private-port verification remains explicit:

```bash
! docker compose port go-business-api 3200
! docker compose port postgres 5432
! docker compose port redis 6379
```

## 5. Engineering verification

- [ ] Go formatting, race tests, unit/integration tests, vet, build, and `govulncheck` pass.
- [ ] Runtime and Frontend V3 source-contract tests pass.
- [ ] React lint, unit tests, production build, and bundle budget pass.
- [ ] Desktop and mobile Chromium administrator and mailbox-portal smoke pass.
- [ ] Browser reports, traces, screenshots, and videos contain no live secrets or production message data.
- [ ] Cloudflare Worker checks pass.
- [ ] Production dependency audit passes.
- [ ] Fresh, repeated, historical-ledger, malformed-schema, OAuth, API-key, forwarding, and retention database tests pass.
- [ ] Full Docker startup, bootstrap rotation, network/secret boundaries, doctors, SBOM, and release gate pass.

Runtime doctors remain part of the release evidence:

```bash
docker compose exec -T app allmail doctor api
docker compose exec -T go-business-api allmail doctor business-api
docker compose exec -T worker-forwarding allmail doctor worker forwarding
docker compose exec -T worker-retention allmail doctor worker retention
```

## 6. Upgrade and recovery

- [ ] [`UPGRADE.md`](./UPGRADE.md) matches the target release and identifies incompatible rollback points.
- [ ] [`BACKUP-RESTORE.md`](./BACKUP-RESTORE.md) covers PostgreSQL, `.env`, exact revision, every secret export, Redis persistence, checksums, and restore verification.
- [ ] A restore rehearsal succeeds on isolated infrastructure.
- [ ] No two revisions run concurrently against one database or secret set.
- [ ] `docker compose down -v` is absent from normal upgrade and recovery instructions.

## 7. Publication and cleanup

- [ ] The GitHub Release is created only after all required checks pass.
- [ ] The multi-architecture GHCR image and release archives report the same injected version and commit.
- [ ] The OCI image carries `org.opencontainers.image.licenses=AGPL-3.0-only`.
- [ ] Release notes are generated from the dated changelog section.
- [ ] Merged maintenance branches are removed only after their changes are safely present on `main`; unmerged branches are preserved.
