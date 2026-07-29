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

- `app` — Go public gateway and React SPA;
- `worker-forwarding` — independent Go forwarding runtime;
- `worker-retention` — independent Go API-log retention runtime;
- `legacy-api` — internal Fastify/Prisma business API;
- `postgres`;
- `redis`.

One-shot startup services:

- `legacy-init` — bootstrap secrets, forwarding-key export and Prisma migrations;
- `go-migrate` — additive checksummed Go migrations.

Only `app` is published by the production Compose file. PostgreSQL, Redis, and `legacy-api` remain private to the Compose network.

## Prerequisites

- Docker Engine with `docker compose`;
- Node.js 20+ only for repository-level local verification;
- a root `.env` copied from `.env.example`.

## Environment preparation

```bash
cp .env.example .env
```

Replace `POSTGRES_PASSWORD` and configure any public base URL, proxy CIDRs, OAuth fallback, or ingress secret required by the deployment.

Cloudflare ingress uses the same root template. Set:

```env
INGRESS_SIGNING_SECRET=<strong-random-value>
INGRESS_ALLOWED_SKEW_SECONDS=300
TRUSTED_PROXY_CIDRS=<direct-tunnel-or-reverse-proxy-cidrs>
```

Do not copy a second backend Cloudflare template; it has been removed.

## Trusted proxy decision

Direct local access requires no trusted CIDR:

```env
TRUSTED_PROXY_CIDRS=
```

When a reverse proxy or tunnel connects directly to `app`, list only that peer network. The Go gateway ignores forwarded client identity from every other peer and overwrites the headers sent to Fastify. Do not configure a blanket `0.0.0.0/0` or `::/0` trust range.

## Startup sequence

```bash
docker compose config --quiet
docker compose up -d --build --wait --wait-timeout 240
docker compose ps -a
```

Expected sequence:

1. PostgreSQL and Redis become healthy.
2. `legacy-init` waits only for PostgreSQL, generates or reads bootstrap secrets, and runs Prisma migrations.
3. `go-migrate` applies additive Go migrations.
4. `legacy-api` starts as UID `10001` and verifies PostgreSQL and Redis.
5. `app`, `worker-forwarding`, and `worker-retention` become healthy.

Verify the service set:

```bash
test "$(docker compose exec -T legacy-api id -u)" = "10001"
for service in app worker-forwarding worker-retention legacy-api postgres redis; do
  docker compose ps --services --filter status=running | grep -qx "$service"
done
```

Verify production network exposure:

```bash
docker compose port app 3000
! docker compose port postgres 5432
! docker compose port redis 6379
```

`docker compose port app 3000` should report the configured public bind. PostgreSQL and Redis should report no published port.

## Secret isolation

`JWT_SECRET`, `ENCRYPTION_KEY`, and `ADMIN_PASSWORD` may be blank on first boot. `legacy-init` persists generated values in the protected legacy runtime volume.

Retrieve the generated password:

```bash
docker compose exec legacy-api sh -lc \
  "grep '^ADMIN_PASSWORD=' /var/lib/all-mail/bootstrap-secrets.env | cut -d= -f2-"
```

The forwarding worker receives only the file it needs:

```bash
docker compose exec worker-forwarding sh -lc \
  'test -r /var/lib/all-mail/encryption-key && test "$(wc -c < /var/lib/all-mail/encryption-key)" -ge 32'
```

Confirm that direct environment injection was removed:

```bash
! docker compose exec worker-forwarding sh -lc 'test -n "${ENCRYPTION_KEY:-}"'
```

The retention worker mounts no forwarding secret volume.

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

The Go readiness payload validates the built SPA plus the Fastify compatibility API. Fastify owns the PostgreSQL and Redis protocol checks. The public Go container therefore does not carry database or Redis credentials before native Go business routes exist.

Each worker doctor validates its own process identity, heartbeat freshness, active-run deadline, and latest completion status.

## Proxy identity smoke

From a direct client that is not in `TRUSTED_PROXY_CIDRS`, a spoofed header must not become the audit/login IP:

```bash
curl -H 'X-Forwarded-For: 203.0.113.99' \
  -H 'X-Real-IP: 203.0.113.100' \
  http://127.0.0.1:3002/health
```

For full verification, inspect the Fastify request/audit record after a login attempt and confirm it contains the actual direct peer, not the spoofed values. When testing through a trusted tunnel, confirm it contains the tunnel-provided client address.

## Local Fastify development

Production does not publish PostgreSQL or Redis. Start the development overlay explicitly:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis
```

Then:

```bash
cp server/.env.example server/.env
npm run dev:api
```

Equivalent dependency helpers:

```bash
./bin/all-mail deps up
./bin/all-mail deps down
```

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

The switch is deliberately absent from `.env.example`; do not make it a standing production default.

## Updating an existing deployment

1. Back up PostgreSQL and persisted runtime volumes.
2. Pull the target revision.
3. Review `.env.example`, migration files, removed aliases, and ownership changes.
4. Remove obsolete keys from the real `.env`; they are no longer read.
5. Recreate the canonical stack:

```bash
docker compose up -d --build --wait --wait-timeout 240
```

6. Run the health, exposure, secret-isolation, and proxy checks above.
7. Run repository verification when available:

```bash
./bin/all-mail check
```

CI runs dependency audit and Docker smoke independently. The final `release-gate` requires both.

## Rollback

The current revision contains one implementation for each background state machine. There is no `legacy-jobs` profile and no owner switch.

Rollback means returning to a known-good revision or image:

```bash
docker compose down
git switch <known-good-tag-or-commit>
docker compose up -d --build --wait --wait-timeout 240
```

When schema or persisted state changed, restore matching PostgreSQL and runtime-volume backups before startup. Use the deployment guide from the target revision because older revisions may require now-removed variables or service names.

Never run workers from two revisions against the same database at the same time. The PostgreSQL forwarding advisory lock is a final guard, not a substitute for a clean revision handover.
