# Deployment guide

## Boundary

This document is the authoritative deployment entry for `all-Mail`.

- Use this file for startup, update, smoke checks and rollback.
- Use [`RUNBOOK.md`](./RUNBOOK.md) for day-2 troubleshooting.
- Use [`ENVIRONMENT.md`](./ENVIRONMENT.md) for variable meaning.
- Use [`GO-MIGRATION.md`](./GO-MIGRATION.md) for capability ownership.
- Use [`../CLOUDFLARE-DEPLOY.md`](../CLOUDFLARE-DEPLOY.md) only for Worker ingress.

## Supported paths

### Canonical: Docker Compose

Default long-running services:

- `app` — Go public API and SPA;
- `go-jobs` — Go retention and forwarding;
- `legacy-api` — Fastify/Prisma business API;
- `postgres`;
- `redis`.

One-shot startup services:

- `legacy-init` — bootstrap secrets, isolated key export and Prisma migrations;
- `go-migrate` — additive checksummed Go migrations.

Rollback-only service:

- `legacy-jobs` — available only with `--profile rollback`.

### Secondary: compiled source runtime

Use `npm run start:npm` only for advanced debugging or compatibility workflows. It runs the compiled Fastify API and Node worker directly and does not prove that the Go listener or Go workers function.

### Optional: Cloudflare Worker ingress

Deploy the main application first, then follow [`../CLOUDFLARE-DEPLOY.md`](../CLOUDFLARE-DEPLOY.md).

## Prerequisites

- Docker Engine with `docker compose`;
- Node.js 20+ only for repository-level local verification;
- a root `.env` copied from one canonical template.

## Environment selection

Default:

```bash
cp .env.example .env
```

Cloudflare ingress-oriented:

```bash
cp .env.cloudflare.example .env
```

Replace `POSTGRES_PASSWORD` and any ingress placeholder before a real remote deployment.

## Startup sequence

```bash
docker compose config --quiet
docker compose up -d --build --wait --wait-timeout 240
docker compose ps -a
```

Expected sequence:

1. PostgreSQL and Redis become healthy.
2. `legacy-init` generates or reads bootstrap secrets and runs Prisma migrations.
3. `go-migrate` applies additive Go migrations.
4. `legacy-api` starts as UID `10001` and becomes healthy.
5. `app` and `go-jobs` start.
6. `legacy-jobs` remains absent in the default profile.

Verify the service set:

```bash
test "$(docker compose exec -T legacy-api id -u)" = "10001"
if docker compose ps --services | grep -qx legacy-jobs; then
  echo "unexpected legacy-jobs service in default profile"
  exit 1
fi
```

## Bootstrap-secret behavior

`JWT_SECRET`, `ENCRYPTION_KEY` and `ADMIN_PASSWORD` may be blank on first boot. `legacy-init` persists generated values in the legacy runtime volume.

Retrieve the generated password:

```bash
docker compose exec legacy-api sh -lc \
  "grep '^ADMIN_PASSWORD=' /var/lib/all-mail/bootstrap-secrets.env | cut -d= -f2-"
```

The Go jobs volume receives only the encryption key required for forwarding:

```bash
docker compose exec go-jobs sh -lc \
  'test -r /var/lib/all-mail/encryption-key && stat /var/lib/all-mail/encryption-key'
```

## Health and smoke checks

```bash
curl http://127.0.0.1:3002/health
curl --fail http://127.0.0.1:3002/readyz
docker compose exec -T app allmail doctor api
docker compose exec -T go-jobs allmail doctor jobs
docker compose exec -T legacy-api node -e \
  "fetch('http://127.0.0.1:' + (process.env.PORT || 3100) + '/readyz').then(async (r) => { console.log(await r.text()); process.exit(r.ok ? 0 : 1); }).catch(() => process.exit(1))"
```

`allmail doctor jobs` now checks both heartbeat freshness and worker progress. A continuously updated global heartbeat does not hide a forwarding or retention pass that exceeds its configured run limit.

## Migration expectations

- `legacy-init` is the only Docker role that runs Prisma migrations.
- `go-migrate` is the only role that applies Go migration files.
- `legacy-api`, `app`, `go-jobs` and `legacy-jobs` do not run schema migrations during ordinary startup.
- applied Go migrations are checksummed; add a new migration rather than editing an applied file.
- Prisma P3009 requires manual recovery.
- Prisma P3005 no longer silently falls back to `db push`.

For a reviewed legacy P3005 repair only:

```bash
docker compose run --rm \
  -e ALL_MAIL_ALLOW_LEGACY_DB_PUSH_REPAIR=true \
  legacy-init
```

Do not make that variable a standing production default.

## Updating an existing deployment

1. Back up PostgreSQL and persisted runtime volumes.
2. Pull the target revision.
3. Review `.env.example`, migration files and ownership changes.
4. Recreate the canonical stack:

```bash
docker compose up -d --build --wait --wait-timeout 240
```

5. Run the smoke checks above.
6. Run repository verification when available:

```bash
./bin/all-mail check
```

The dependency audit and Docker smoke jobs execute independently in CI. The final `release-gate` requires both.

## Background worker rollback

The main branch retains the Node worker only as an explicit rollback profile.

### Move ownership from Go to Node

```bash
# Stop Go first and wait for the stop command to return.
docker compose stop go-jobs

# Start the rollback-only service. Compose forces both owners to legacy.
docker compose --profile rollback up -d legacy-jobs

docker compose --profile rollback ps
docker compose logs legacy-jobs --tail=200
```

Validate that forwarding jobs move and the heartbeat remains fresh before resuming normal traffic.

### Move ownership back to Go

```bash
docker compose --profile rollback stop legacy-jobs
docker compose up -d go-jobs
docker compose exec -T go-jobs allmail doctor jobs
```

Never intentionally run both writers at once. The shared advisory lock should reject the second owner, but a clean stop/start handover remains mandatory.

## Full application rollback

The repository does not provide one-button data rollback.

1. Stop new changes and external automation.
2. Stop `app`, `go-jobs` and any rollback worker.
3. Return application source or images to the last known-good revision.
4. Restore matching PostgreSQL/runtime-volume backups when schema or persisted state changed.
5. Start the previous topology according to that revision's own deployment guide.
6. Re-run readiness and functional checks.

Do not drop additive Go runtime tables while any Go worker can still write them.
