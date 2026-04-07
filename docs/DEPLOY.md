# Deployment Guide

## Boundary

This document is the authoritative deployment entry for `all-Mail`.

- Use this file for deployment path selection, startup, update, smoke checks, and rollback.
- Use [`docs/RUNBOOK.md`](./RUNBOOK.md) for day-2 troubleshooting and recovery.
- Use [`docs/ENVIRONMENT.md`](./ENVIRONMENT.md) for variable meaning and template mapping.
- Use [`CLOUDFLARE-DEPLOY.md`](../CLOUDFLARE-DEPLOY.md) only for the worker-specific ingress path.
- Use [`docs/advanced-runtime.md`](./advanced-runtime.md) only when you intentionally run the compiled app outside the main Docker app container.

## Supported deployment paths

### 1. Default: Docker Compose (canonical)

This repository is Docker-first. The default stack is defined in `docker-compose.yml` and starts:

- `app`
- `jobs`
- `postgres`
- `redis`

The `app` service is the migration-owning runtime. The `jobs` service sets `ALL_MAIL_RUN_MIGRATIONS=0` and should not be treated as the migration entrypoint.

### 2. Secondary: compiled source runtime

Use the source runtime only for advanced local debugging or operator workflows. The repo entrypoint is:

```bash
npm run start:npm
```

That path is documented in [`docs/advanced-runtime.md`](./advanced-runtime.md).

### 3. Optional: Cloudflare worker ingress

The Cloudflare worker is not the main app deployment path. If you need Cloudflare Email Routing or signed ingress, deploy the main app first and then follow [`CLOUDFLARE-DEPLOY.md`](../CLOUDFLARE-DEPLOY.md).

## Prerequisites

- Docker Engine with `docker compose`
- Node.js 20+ only if you plan to use repo-level verification commands locally
- A copied environment file at repo root

## Environment selection

Default Docker path:

```bash
cp .env.example .env
```

Docker path with Cloudflare ingress-oriented settings from day one:

```bash
cp .env.cloudflare.example .env
```

Important bootstrap behavior:

- `JWT_SECRET`, `ENCRYPTION_KEY`, and `ADMIN_PASSWORD` may be left blank on first boot.
- In Docker mode, generated values are persisted to `/var/lib/all-mail/bootstrap-secrets.env` inside the runtime volume.
- In the source runtime, generated values default to `.all-mail-runtime/bootstrap-secrets.env`. If you need a different bootstrap-state location, export `ALL_MAIL_STATE_DIR` before launching the source runtime; putting it only in the env file does not move the initial bootstrap-secret write.

## Startup sequence (Docker)

```bash
docker compose up -d --build
docker compose ps
```

Expected baseline:

- `app` is running and eventually healthy
- `jobs` is running and eventually healthy
- `postgres` is healthy
- `redis` is healthy

If this is the first boot and secrets were generated automatically, startup output prints the first-login URL and the bootstrap admin username. `ADMIN_PASSWORD` stays out of startup logs by default; retrieve it from the persisted bootstrap-secret file unless you explicitly set `ALL_MAIL_PRINT_BOOTSTRAP_PASSWORD=true` for short-lived recovery. Any generated password must be changed immediately after login.

## Health and smoke checks

Basic health probe:

```bash
curl http://127.0.0.1:3002/health
```

If you changed `APP_PORT`, replace `3002` accordingly.

Container-level quick check:

```bash
docker compose ps
```

`jobs` now reports health from a runtime heartbeat file under `/var/lib/all-mail/jobs-heartbeat.txt`, so a long-lived `starting` or `unhealthy` state should be treated as a background-runtime problem rather than as a cosmetic gap.

Repo verification entrypoints:

| Command | What it proves |
| --- | --- |
| `./bin/all-mail doctor` | Preferred readiness check; sanitizes Node proxy startup flags before running the local doctor |
| `./bin/all-mail check` | Preferred full local release gate; sanitizes Node proxy startup flags before running lint, tests, builds, worker checks, and production dependency audits |
| `npm run verify:release` | Compatibility alias for the full local release gate |
| `npm run check` | Compatibility alias for `npm run verify:release` |

When your shell exports `NODE_USE_ENV_PROXY` / `HTTP[S]_PROXY`, prefer the `./bin/all-mail ...` entrypoints above. They sanitize those startup flags before Node/npm bootstraps, which avoids noisy `UNDICI-EHPA` warnings in operator workflows.

`doctor` is not the full release gate. Use `./bin/all-mail check`, `check`, or `verify:release` before calling a change release-ready.

## Migration expectations

- Docker `app` startup runs Prisma migrations.
- Docker `jobs` startup does not.
- `docker/entrypoint.sh` and `scripts/start-all-mail.mjs` fall back from Prisma migrate to a targeted legacy repair plus `db push` only when Prisma reports `P3005` for a legacy non-empty database.
- `P3009` is not auto-recovered. Treat it as a manual operator intervention case and use [`docs/RUNBOOK.md`](./RUNBOOK.md).

## Updating an existing deployment

1. Pull the target revision.
2. Review env changes before restart.
3. Rebuild and restart the stack:

```bash
docker compose up -d --build
```

4. Re-run smoke checks:

```bash
docker compose ps
curl http://127.0.0.1:3002/health
./bin/all-mail doctor
```

If the release changed background-job wiring, also verify the `jobs` service is healthy in `docker compose ps` before calling the Docker loop closed.

5. Before wider rollout, run the local release gate when your environment can support it:

```bash
./bin/all-mail check
```

## Rollback entry

The repo does not provide one-button rollback automation.

Rollback means restoring a previously known-good application revision and, when necessary, restoring matching persisted data.

Minimum rollback procedure:

1. Stop applying new changes.
2. Return the repo or image source to the previous known-good revision.
3. Restart the stack with that revision:

```bash
docker compose up -d --build
```

4. Re-run the same smoke checks used for deploy.

If the failed release already changed database state, application-only rollback may be insufficient. In that case, restore PostgreSQL and persisted runtime data together. See the backup/restore starting point in [`docs/RUNBOOK.md`](./RUNBOOK.md).
