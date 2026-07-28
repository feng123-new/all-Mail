# Deployment guide

## Boundary

This document is the authoritative deployment entry for `all-Mail`.

- Use this file for startup, update, smoke checks and rollback.
- Use [`RUNBOOK.md`](./RUNBOOK.md) for day-2 troubleshooting.
- Use [`ENVIRONMENT.md`](./ENVIRONMENT.md) for variable meaning.
- Use [`GO-MIGRATION.md`](./GO-MIGRATION.md) for capability ownership.
- Use [`../CLOUDFLARE-DEPLOY.md`](../CLOUDFLARE-DEPLOY.md) for Worker ingress.

## Supported production path

Docker Compose is the only supported production topology.

Long-running services:

- `app` — Go public API and React SPA;
- `worker-forwarding` — independent Go forwarding runtime;
- `worker-retention` — independent Go API-log retention runtime;
- `legacy-api` — internal Fastify/Prisma business API;
- `postgres`;
- `redis`.

One-shot startup services:

- `legacy-init` — bootstrap secrets, forwarding-key export and Prisma migrations;
- `go-migrate` — additive checksummed Go migrations.

The repository CLI may run the compatibility API or frontend for local development, but it deliberately does not expose a second Node production topology.

## Prerequisites

- Docker Engine with `docker compose`;
- Node.js 20+ only for repository-level local verification;
- a root `.env` copied from a canonical template.

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
5. `app`, `worker-forwarding` and `worker-retention` become healthy.

Verify the service set:

```bash
test "$(docker compose exec -T legacy-api id -u)" = "10001"
for service in app worker-forwarding worker-retention legacy-api postgres redis; do
  docker compose ps --services --filter status=running | grep -qx "$service"
done
```

## Bootstrap-secret behavior

`JWT_SECRET`, `ENCRYPTION_KEY` and `ADMIN_PASSWORD` may be blank on first boot. `legacy-init` persists generated values in the legacy runtime volume.

Retrieve the generated password:

```bash
docker compose exec legacy-api sh -lc \
  "grep '^ADMIN_PASSWORD=' /var/lib/all-mail/bootstrap-secrets.env | cut -d= -f2-"
```

The forwarding worker receives only the encryption key it needs:

```bash
docker compose exec worker-forwarding sh -lc \
  'test -r /var/lib/all-mail/encryption-key && stat /var/lib/all-mail/encryption-key'
```

The retention worker does not mount the forwarding secret volume.

## Health and smoke checks

```bash
curl http://127.0.0.1:3002/health
curl --fail http://127.0.0.1:3002/readyz

docker compose exec -T app allmail doctor api
docker compose exec -T worker-forwarding allmail doctor worker forwarding
docker compose exec -T worker-retention allmail doctor worker retention

docker compose exec -T legacy-api node -e \
  "fetch('http://127.0.0.1:' + (process.env.PORT || 3100) + '/readyz').then(async (r) => { console.log(await r.text()); process.exit(r.ok ? 0 : 1); }).catch(() => process.exit(1))"
```

Each worker doctor validates its own process identity, heartbeat freshness, active-run deadline and latest completion status. A healthy forwarding process does not mask a failed retention process, or vice versa.

## Migration expectations

- `legacy-init` is the only Docker role that runs Prisma migrations.
- `go-migrate` is the only role that applies Go migration files.
- Long-running services never run schema migrations during ordinary startup.
- Applied Go migrations are checksummed; add a new migration rather than editing an applied file.
- The Go migration runner uses direct `pgx`; the Go runtime image does not require `psql`.
- Prisma P3009 requires manual recovery.
- Prisma P3005 does not silently fall back to `db push`.

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

5. Run all smoke checks above.
6. Run repository verification when available:

```bash
./bin/all-mail check
```

CI runs dependency audit and Docker smoke independently. The final `release-gate` requires both.

## Rollback

The current revision contains one implementation for each background state machine. There is no `legacy-jobs` profile and no owner switch.

Rollback means returning to a known-good revision or image:

```bash
# Stop external automation first.
docker compose down

git switch <known-good-tag-or-commit>
# Or configure Compose to use the previous known-good image set.

docker compose up -d --build --wait --wait-timeout 240
```

When schema or persistent state changed, restore matching PostgreSQL and runtime-volume backups before startup. Use the deployment guide from the target revision because its service names and migration sequence may differ.

Never run workers from two revisions against the same database at the same time. The PostgreSQL forwarding advisory lock is a final guard, not a substitute for a clean revision handover.

Do not drop additive Go runtime tables while any Go process can still write them.
