# Operator runbook

## Boundary

This document is the authoritative day-2 troubleshooting and recovery guide for `all-Mail`.

- Use [`DEPLOY.md`](./DEPLOY.md) for normal deployment and rollback.
- Use [`ENVIRONMENT.md`](./ENVIRONMENT.md) for variable meaning.
- Use [`GO-MIGRATION.md`](./GO-MIGRATION.md) for ownership and migration guarantees.
- Use [`../CLOUDFLARE-DEPLOY.md`](../CLOUDFLARE-DEPLOY.md) for full Worker deployment details.

## Healthy baseline

Long-running services:

- `app`;
- `worker-forwarding`;
- `worker-retention`;
- `legacy-api`;
- `postgres`;
- `redis`.

Completed one-shot services:

- `legacy-init`;
- `go-migrate`.

Baseline checks:

```bash
docker compose ps -a
curl http://127.0.0.1:3002/health
curl --fail http://127.0.0.1:3002/readyz

docker compose exec -T app allmail doctor api
docker compose exec -T worker-forwarding allmail doctor worker forwarding
docker compose exec -T worker-retention allmail doctor worker retention
test "$(docker compose exec -T legacy-api id -u)" = "10001"
```

Inspect logs by responsibility:

```bash
docker compose logs legacy-init --tail=200
docker compose logs go-migrate --tail=200
docker compose logs legacy-api --tail=200
docker compose logs app --tail=200
docker compose logs worker-forwarding --tail=200
docker compose logs worker-retention --tail=200
```

## Stack does not start

Use the first failed stage:

1. `postgres` / `redis` health;
2. `legacy-init` exit code;
3. `go-migrate` exit code;
4. `legacy-api` health;
5. `app`, `worker-forwarding`, or `worker-retention` health.

Do not repeatedly restart later services while an earlier one-shot dependency is failed.

### PostgreSQL or Redis unhealthy

```bash
docker compose logs postgres --tail=200
docker compose logs redis --tail=200
docker compose exec postgres pg_isready \
  -U "${POSTGRES_USER:-allmail}" \
  -p "${POSTGRES_INTERNAL_PORT:-5432}"
docker compose exec redis redis-cli \
  -p "${REDIS_INTERNAL_PORT:-6379}" ping
```

Resolve credentials, storage or port conflicts first.

## `legacy-init` failed

`legacy-init` owns bootstrap-secret persistence, forwarding-key export and Prisma business migrations.

```bash
docker compose logs legacy-init --tail=300
```

### Prisma P3005

P3005 means Prisma found a non-empty database without its expected baseline. Automatic `db push` is disabled.

After inspecting and backing up the database, run the explicit compatibility repair only when appropriate:

```bash
docker compose run --rm \
  -e ALL_MAIL_ALLOW_LEGACY_DB_PUSH_REPAIR=true \
  legacy-init
```

Return the variable to `false` before normal startup.

### Prisma P3009

P3009 indicates a failed migration record and requires manual inspection. Repeated restarts do not repair it.

For disposable data only:

```bash
docker compose down -v
docker compose up -d --build --wait --wait-timeout 240
```

Never use that reset when data must be preserved.

## `go-migrate` failed

```bash
docker compose logs go-migrate --tail=300
```

Common causes:

- a required business table is missing;
- a pre-existing runtime table has the wrong shape;
- an applied migration file was edited and its checksum changed;
- PostgreSQL permissions are insufficient;
- another migration transaction holds the advisory lock.

Rules:

- never edit an applied numbered Go migration;
- add a new migration for corrective changes;
- do not delete or rewrite `runtime_migrations` to bypass validation;
- preserve the database before manual ledger work.

The runner uses direct `pgx`; a missing `psql` executable is not a cause in the current revision.

## Forwarding worker unhealthy or not processing

Symptoms:

- forward jobs stop advancing;
- `worker-forwarding` is unhealthy while the API remains healthy;
- doctor reports a stale heartbeat, owner-lock loss, failed run or exceeded deadline.

Inspect:

```bash
docker compose ps worker-forwarding
docker compose logs worker-forwarding --tail=300
docker compose exec -T worker-forwarding allmail doctor worker forwarding
docker compose exec -T worker-forwarding sh -lc \
  'cat /var/lib/all-mail/worker-forwarding-heartbeat.json'
```

Heartbeat fields show process freshness, active-run start, completion, last success, consecutive failures and last error.

Default run limit:

```text
FORWARDING_RUN_TIMEOUT_SECONDS=120
```

A timeout usually indicates a blocked database/provider request, provider latency, or an unexpectedly large batch. Inspect the error before increasing the limit. Prefer fixing the operation or reducing `FORWARDING_WORKER_BATCH_SIZE`.

If logs report that the advisory ownership lock is held, identify and stop the other revision/process. Do not bypass the lock.

Restart only this failure domain after dependencies are healthy:

```bash
docker compose up -d --force-recreate worker-forwarding
docker compose exec -T worker-forwarding allmail doctor worker forwarding
```

## Retention worker unhealthy or not processing

Symptoms:

- old API logs stop expiring;
- `worker-retention` is unhealthy while forwarding remains healthy;
- doctor reports a stale heartbeat, failed query or exceeded deadline.

```bash
docker compose ps worker-retention
docker compose logs worker-retention --tail=300
docker compose exec -T worker-retention allmail doctor worker retention
docker compose exec -T worker-retention sh -lc \
  'cat /var/lib/all-mail/worker-retention-heartbeat.json'
```

Defaults:

```text
API_LOG_CLEANUP_TIMEOUT_SECONDS=60
API_LOG_CLEANUP_BATCH_SIZE=5000
```

Check database load and lock contention before increasing limits. Restart only retention when appropriate:

```bash
docker compose up -d --force-recreate worker-retention
docker compose exec -T worker-retention allmail doctor worker retention
```

## Compatibility API unhealthy

```bash
docker compose ps legacy-api
docker compose logs legacy-api --tail=300
docker compose exec -T legacy-api node -e \
  "fetch('http://127.0.0.1:' + (process.env.PORT || 3100) + '/readyz').then(async (r) => { console.log(await r.text()); process.exit(r.ok ? 0 : 1); }).catch(console.error)"
```

Confirm:

- `legacy-init` and `go-migrate` completed;
- the process runs as UID `10001`;
- PostgreSQL and Redis are healthy;
- bootstrap secrets satisfy Fastify validation;
- ingress placeholders are not left enabled.

Fastify is internal-only and API-only. It does not serve the React SPA; public traffic enters through `app`.

## Public Go API unhealthy

```bash
docker compose ps app
docker compose logs app --tail=300
curl -i http://127.0.0.1:3002/health
curl -i http://127.0.0.1:3002/readyz
docker compose exec -T app allmail doctor api
```

`/readyz` identifies whether PostgreSQL, Redis or the compatibility API failed its protocol-level probe. Do not treat `/health` alone as release readiness.

## Redis degraded

`ALLOW_LOCAL_RATE_LIMIT_FALLBACK` defaults to `false`. Some endpoints responding does not prove degraded Redis is safe.

```bash
docker compose ps redis
docker compose logs redis --tail=200
docker compose exec redis redis-cli \
  -p "${REDIS_INTERNAL_PORT:-6379}" ping
```

After recovery, recheck Go readiness and the compatibility API.

## Bootstrap/admin secret confusion

All bootstrap secrets live in the legacy runtime volume:

```bash
docker compose exec legacy-api sh -lc \
  'ls -l /var/lib/all-mail && cat /var/lib/all-mail/bootstrap-secrets.env'
```

Only the forwarding key is exported to `worker-forwarding`:

```bash
docker compose exec worker-forwarding sh -lc \
  'ls -l /var/lib/all-mail && test -r /var/lib/all-mail/encryption-key'
```

`app` and `worker-retention` do not mount the admin password. Instructions using `docker compose exec app ...bootstrap-secrets.env` are invalid.

## Dependency audit failure

CI runs production dependency audit independently from Docker smoke. An audit failure remains blocking but does not suppress Docker diagnostics.

Exceptions must be advisory-specific, package-scoped and expiring. Do not add a blanket severity waiver. Remove an exception as soon as the dependency is upgraded.

## Roll back the application revision

There is no hidden Node jobs runtime in the current revision.

1. Stop external automation and new writes where possible.
2. Back up PostgreSQL and runtime volumes.
3. Stop the current stack:

```bash
docker compose down
```

4. Switch to the previous known-good tag, commit or image set.
5. Restore matching persisted state if migrations or secrets changed.
6. Start according to that revision's deployment guide.
7. Re-run its readiness and functional checks.

Never run workers from two revisions against the same state machine concurrently.

## Cloudflare tunnel down or public hostnames return 530

First prove the local backend is healthy:

```bash
docker compose ps -a
curl http://127.0.0.1:3002/health
curl --fail http://127.0.0.1:3002/readyz
```

Then inspect:

- tunnel status and active replica count;
- published routes;
- token-rotation warnings;
- connector service status and logs.

Windows checks:

```powershell
Get-Service cloudflared
sc query cloudflared
```

Foreground diagnosis:

```powershell
cloudflared.exe tunnel run --token <token-from-dashboard>
```

If QUIC repeatedly times out but HTTP/2 succeeds:

```powershell
cloudflared.exe tunnel run --protocol http2 --token <token-from-dashboard>
```

Pin the working transport rather than changing a locally healthy backend. Never commit a tunnel token.

## Backup and restore starting point

Persistent volumes:

- `postgres_data`;
- `redis_data`;
- `legacy_runtime_data` — bootstrap secrets;
- `forwarding_runtime_data` — forwarding key and heartbeat;
- `retention_runtime_data` — retention heartbeat.

Before risky upgrades or migration recovery:

1. stop external writes where possible;
2. create a database-aware PostgreSQL backup;
3. preserve runtime-state volumes;
4. preserve Redis when its state matters to the recovery window;
5. record the exact application revision and `.env` contract;
6. test restore in an isolated environment.

When uncertain, preserve current data before destructive recovery.
