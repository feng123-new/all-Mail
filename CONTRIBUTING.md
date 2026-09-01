# Contributing to all-Mail

Thanks for contributing to `all-Mail`.

## Scope

Keep contributions aligned with external mailbox providers, domain mailboxes, portal flows, signed ingress, outbound sending, automation APIs, and operator tooling.

## Before opening a pull request

1. Read `README.md` and the canonical doc map.
2. Read `docs/DEPLOY.md`, `docs/ENVIRONMENT.md`, and `docs/RUNBOOK.md` for runtime changes.
3. Read `docs/GO-MIGRATION.md` before moving route, migration, or worker ownership.
4. Prefer `all-Mail` terminology and do not reintroduce historical branding.
5. Follow `CODE_OF_CONDUCT.md`.

## Canonical local flow

Install:

```bash
npm run install:all
```

Local PostgreSQL/Redis dependencies are explicit, because production keeps them private:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis
# or
./bin/all-mail deps up
```

Build:

```bash
./bin/all-mail build
```

Verify:

```bash
./bin/all-mail doctor
./bin/all-mail check
```

Go-specific changes must also pass:

```bash
cd core
test -z "$(gofmt -l .)"
go test -race ./...
go vet ./...
go build -trimpath ./cmd/allmail
```

Runtime/security changes should validate both Compose models:

```bash
cp .env.example .env
docker compose config --quiet
docker compose -f docker-compose.yml -f docker-compose.dev.yml config --quiet
```

## Configuration ownership rules

- `.env.example` is the single production backend template.
- Do not add a copied provider-specific backend template.
- Internal file paths and container ports belong in Compose, not the operator template.
- Do not add hidden aliases or silently ignore malformed canonical values.
- Public `app` must not receive database, Redis, JWT, encryption, ingress, OAuth, or provider credentials.
- Forwarding receives `ENCRYPTION_KEY_FILE`, not the raw key environment variable.
- `go-business-api`, PostgreSQL, and Redis remain unpublished in production.
- Proxy trust must be an explicit direct-peer CIDR, never blanket trust.

Changes that add, rename, or remove a variable must update:

```text
.env.example
docker-compose.yml
scripts/env-contract.test.mjs
docs/ENVIRONMENT.md
relevant service loader/tests
```

## Pull request expectations

- Keep one ownership boundary per PR where possible.
- Explain old and new owners, data written, concurrency guard, and rollback.
- Include tests and truthful verification evidence.
- Update setup/operator docs when behavior changes.
- Do not weaken race, migration, Docker, dependency, or proxy-security gates to make a PR green.
- For stacked PRs, state the base branch and merge order explicitly.

## Licensing of contributions

`all-Mail` is licensed under the GNU Affero General Public License v3.0 only (`AGPL-3.0-only`). By submitting a contribution, you agree that your contribution may be distributed under the same license and that you have the right to submit it under those terms.

No contributor license agreement is required for ordinary contributions. Do not submit code, documentation, assets, or generated material whose license is incompatible with `AGPL-3.0-only` or whose provenance you cannot explain.

## Secrets and local files

Do not commit:

- real `.env` files or secrets;
- OAuth runtime outputs;
- tunnel tokens;
- local screenshots with live data;
- generated build output unless a release workflow requires it;
- database dumps or runtime volumes.

## Review checklist

Before requesting review, confirm:

- `./bin/all-mail check` passed, or the strongest truthful substitute is documented;
- Go format/race/vet/build passed when Go changed;
- production and development Compose models validate;
- proxy/client-IP changes include spoofing tests;
- setup/behavior docs were updated;
- rollback and migration impact are described;
- the repository still reads like a coherent standalone project.
