# Upgrade and rollback guide

This is the canonical upgrade procedure for `all-Mail` v2. Use [`BACKUP-RESTORE.md`](./BACKUP-RESTORE.md) before every production change and [`RUNBOOK.md`](./RUNBOOK.md) for incident response.

## Supported upgrade model

- Upgrades are **revision based** and require a maintenance window. Zero-downtime mixed-version operation is not supported.
- Run only one initializer and one application revision against a persisted state set.
- The current `v2.1.x` migration runner can adopt the known historical schema ledgers embedded in the Go migration runner. It rejects unknown, gapped, checksum-mismatched, or structurally drifted schemas.
- A deployment that still runs the retired Node/Fastify/Prisma runtime must be tested against a restored copy before production cutover. Historical schema adoption does not make an arbitrary old runtime safe to restart after v2 writes data.
- Rollback after migration or secret-layout reconciliation is a **state restore**, not merely an image change.

## v2.1.2 patch boundary

`v2.1.2` closes the personal single-host patch line after v2.1.1. It publishes the Mail.com compatibility correction, makes Gmail/Outlook OAuth permission profiles explicit, strengthens Linux/Redis/capacity preflight, documents provider evidence boundaries, and adds an isolated synthetic backup-and-restore rehearsal to the release-required bootstrap workflow.

The patch adds no database schema migration and rotates no durable secret. It does not change public routes, authorization, provider credential formats, forwarding state, or the six-service Compose topology. Existing v2.1.1 persistent state remains directly compatible. Raising an OAuth profile requires reauthorization before the affected mailbox gains broader consent.

## v2.1.0 release boundary

`v2.1.0` completes the Frontend V3 migration: responsive grouped shells, explainable Dashboard state, shared operational workspaces, Inbox-first mailbox portal, bundle budgets, and desktop/mobile Chromium regression smoke.

The release adds no database schema migration and does not rotate durable secrets. It does not change public API routes, Go authorization, route ownership, forwarding leases, provider credential formats, session revocation, or the Docker service/volume topology. Existing v2.0.1 persistent state remains compatible.

One development-only compatibility fix narrows the Vite proxy from `/mail` to `/mail/api`, preventing portal SPA routes from being treated as backend requests. Production routing through the Go gateway is unchanged.

## v2.0.1 patch boundary

`v2.0.1` added no schema migration and did not rotate durable secrets. It hardened provider egress, aligned session cookies with JWT lifetime, repaired the mailbox portal bootstrap path, removed the last Worker dependency on the retired Node `server/` tree, and published a reusable release workflow.

Before upgrading from `v2.0.0`, remove `NODE_ENV` from `.env`, shell exports, systemd units, and custom Compose overlays. Do not add `ALL_MAIL_RUNTIME_ENV` to the operator template; the canonical Compose model owns it internally.

## 1. Record the current state

```bash
date -u +'%Y-%m-%dT%H:%M:%SZ'
git rev-parse HEAD
git describe --tags --always --dirty
docker compose ps -a
docker compose images
```

For v2 runtimes:

```bash
for service in app go-business-api worker-forwarding worker-retention; do
  docker compose exec -T "$service" allmail version --json
done
```

Record the current image digest and verify that the working tree contains no local production-only edits.

## 2. Create and verify a complete backup

Follow [`BACKUP-RESTORE.md`](./BACKUP-RESTORE.md). The backup unit includes:

- a PostgreSQL custom-format dump;
- `.env`, the exact commit/tag, and resolved Compose model;
- `runtime_secrets_data` (physical compatibility name: `${COMPOSE_PROJECT_NAME}_legacy_runtime_data`);
- `bootstrap_admin_data`;
- `forwarding_runtime_data`;
- `go_business_runtime_data`;
- `redis_runtime_data`;
- `database_runtime_data`;
- `redis_data` when OAuth-state, replay, lockout, or rate-limit continuity matters;
- the Cloudflare R2 raw-message bucket when raw `.eml` recovery matters.

Do not continue until checksums verify and a recent restore rehearsal exists.

## 3. Inspect the target release

```bash
git fetch --tags --prune
git show v2.1.2:VERSION
git show v2.1.2:CHANGELOG.md | sed -n '/## \[2.1.2\]/,/^## \[/p'
```

Review environment and runtime-contract changes:

```bash
git diff <current-revision>..v2.1.2 -- \
  .env.example config/runtime-env.json docker-compose.yml web/vite.config.ts
```

`POSTGRES_PASSWORD` remains required. JWT, encryption, Redis, and runtime database-role passwords remain initializer-managed. Do not copy generated secret files into `.env`.

## 4. Select build mode

### Build from the checked-out release

```bash
git switch --detach v2.1.2
./scripts/compose-up.sh
```

### Use the published multi-architecture image

```bash
git switch --detach v2.1.2
ALL_MAIL_USE_PUBLISHED_IMAGE=1 \
ALL_MAIL_GO_IMAGE=ghcr.io/feng123-new/all-mail \
ALL_MAIL_IMAGE_TAG=2.1.2 \
./scripts/compose-up.sh
```

Keep the repository checkout because Compose, migration files, environment contracts, and operational scripts are versioned with the image.

## 5. Stop the old revision

```bash
docker compose down --remove-orphans
```

Do **not** use `-v`. Never run `docker compose down -v` during an upgrade. Confirm no old application or worker container remains and no external scheduler is starting a second revision.

## 6. Start v2

Run one of the commands from the selected build mode. `compose-up.sh` performs:

1. PostgreSQL readiness;
2. release-metadata resolution;
3. image build or pull;
4. schema adoption/migration;
5. durable secret migration and export;
6. runtime database-role reconciliation;
7. long-running service startup and health waits;
8. version output for all four Go processes.

If initialization fails, stop and diagnose. Do not repeatedly change files or delete volumes to force startup.

## 7. Verify the upgraded deployment

```bash
docker compose ps -a
curl --fail http://127.0.0.1:3002/health
curl --fail http://127.0.0.1:3002/livez
curl --fail http://127.0.0.1:3002/readyz

docker compose exec -T app allmail doctor api
docker compose exec -T go-business-api allmail doctor business-api
docker compose exec -T worker-forwarding allmail doctor worker forwarding
docker compose exec -T worker-retention allmail doctor worker retention
```

Version parity:

```bash
for service in app go-business-api worker-forwarding worker-retention; do
  docker compose exec -T "$service" allmail version --json
done
```

All four outputs must report `2.1.2` and the release commit. Then verify administrator login, the explainable Dashboard risk summary, mailbox portal login landing on Inbox, one provider mailbox read, signed ingress, one forwarding path, one sending path, and API-key authorization using synthetic data.

## Rollback decision table

| Point reached | Safe default |
| --- | --- |
| Target checkout selected, initializer not run | Return to the previous revision and start it |
| Initializer started but failed before any schema/secret change | Inspect logs; rollback may be possible, but verify state before starting the old revision |
| Schema migration, secret export, role reconciliation, or v2 application writes occurred | Restore the complete pre-upgrade backup and then start the previous revision |
| Backup is incomplete or unverified | Do not attempt destructive rollback; preserve state and investigate |

Because v2.1.2 adds no migration or secret rotation, a clean revision rollback to v2.1.1 is normally possible when no incompatible later application writes or configuration changes occurred. The conservative default remains restoring the complete backup whenever state is uncertain.

## Full rollback procedure

```bash
docker compose down --remove-orphans
```

Then follow the in-place restore procedure in [`BACKUP-RESTORE.md`](./BACKUP-RESTORE.md), select the exact previous tag/commit, and start that revision with its matching `.env` and volumes.

After rollback, verify the old revision's supported doctors or health endpoints, login, decryption, forwarding, and provider operations. Never run v2.1.2 workers beside an older API or vice versa.
