# Operator runbook

## Boundary

This document is the authoritative day-2 troubleshooting and recovery guide for `all-Mail`.

- Use [`DEPLOY.md`](./DEPLOY.md) for normal deployment and rollback entry.
- Use [`ENVIRONMENT.md`](./ENVIRONMENT.md) for variable meaning.
- Use [`GO-MIGRATION.md`](./GO-MIGRATION.md) for ownership and migration guarantees.
- Use [`../CLOUDFLARE-DEPLOY.md`](../CLOUDFLARE-DEPLOY.md) for full Worker deployment details.

## Healthy baseline

A healthy default Docker deployment has five long-running services:

- `app`;
- `go-jobs`;
- `legacy-api`;
- `postgres`;
- `redis`.

It also has two successfully completed one-shot services:

- `legacy-init`;
- `go-migrate`.

`legacy-jobs` must not run unless the `rollback` profile was explicitly selected.

Baseline checks:

```bash
docker compose ps -a
curl http://127.0.0.1:3002/health
curl --fail http://127.0.0.1:3002/readyz
docker compose exec -T app allmail doctor api
docker compose exec -T go-jobs allmail doctor jobs
test "$(docker compose exec -T legacy-api id -u)" = "10001"
```

Inspect logs by responsibility:

```bash
docker compose logs legacy-init --tail=200
docker compose logs go-migrate --tail=200
docker compose logs legacy-api --tail=200
docker compose logs app --tail=200
docker compose logs go-jobs --tail=200
```

## Stack does not start

### Identify the failed stage

```bash
docker compose ps -a
```

Use the first failed stage in this order:

1. `postgres` / `redis` health;
2. `legacy-init` exit code;
3. `go-migrate` exit code;
4. `legacy-api` health;
5. `app` / `go-jobs` health.

Do not repeatedly restart later services when an earlier one-shot dependency failed.

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

Resolve credentials, storage or port conflicts before restarting application services.

## `legacy-init` failed

`legacy-init` owns:

- bootstrap-secret generation/persistence;
- isolated forwarding-key export;
- Prisma migration execution.

Inspect:

```bash
docker compose logs legacy-init --tail=300
```

### Prisma P3005

P3005 means Prisma found a non-empty database without the expected baseline. Automatic `db push` is disabled.

Do not permanently enable the compatibility switch. After inspecting and backing up the database, run the explicit repair once only when appropriate:

```bash
docker compose run --rm \
  -e ALL_MAIL_ALLOW_LEGACY_DB_PUSH_REPAIR=true \
  legacy-init
```

Then return the variable to `false` and start the normal stack.

### Prisma P3009

P3009 indicates a failed migration record. It requires manual inspection and recovery. Repeated container restarts do not repair it.

For disposable data only:

```bash
docker compose down -v
docker compose up -d --build --wait --wait-timeout 240
```

Do not use that reset when data must be preserved.

## `go-migrate` failed

Inspect:

```bash
docker compose logs go-migrate --tail=300
```

Common causes:

- a required legacy table is missing;
- a pre-existing runtime table has the wrong shape;
- an applied migration file was edited and its checksum no longer matches;
- PostgreSQL permissions are insufficient;
- another migration session holds the advisory lock longer than expected.

Rules:

- never edit an already applied numbered Go migration;
- add a new migration for corrective schema changes;
- preserve the database before manual ledger changes;
- do not delete `runtime_migrations` to bypass a checksum failure.

## Go jobs unhealthy or not processing

Symptoms include:

- forwarding jobs stop advancing;
- API logs stop expiring;
- `go-jobs` is unhealthy while `app` remains healthy;
- doctor reports a stale heartbeat, failed worker or exceeded run limit.

Inspect:

```bash
docker compose ps go-jobs
docker compose logs go-jobs --tail=300
docker compose exec -T go-jobs allmail doctor jobs
docker compose exec -T go-jobs sh -lc \
  'cat /var/lib/all-mail/go-jobs-heartbeat.json'
```

Heartbeat fields distinguish:

- process freshness (`updatedAt`);
- whether an individual worker is running;
- when that run started;
- when it last completed and succeeded;
- consecutive failures and the last error.

A fresh top-level heartbeat with an overlong `startedAt` is unhealthy.

### Forwarding run timeout

The default limit is:

```text
FORWARDING_RUN_TIMEOUT_SECONDS=120
```

A timeout usually points to a blocked database/provider request or an unexpectedly large batch. Inspect the last error before increasing the limit. Prefer fixing the operation or reducing `FORWARDING_WORKER_BATCH_SIZE` over making the timeout unbounded.

### Retention timeout

The default limit is:

```text
API_LOG_CLEANUP_TIMEOUT_SECONDS=60
```

Retention is bounded by `API_LOG_CLEANUP_BATCH_SIZE` and uses a transaction advisory lock. Check database load and lock contention before increasing the timeout.

## Transfer jobs to the rollback runtime

Use this only when the Go worker itself must be rolled back while the Fastify API remains usable.

```bash
# Stop the current writer and wait for drain.
docker compose stop go-jobs

# Start the rollback-only Node writer.
docker compose --profile rollback up -d legacy-jobs

docker compose --profile rollback ps
docker compose logs legacy-jobs --tail=300
```

The rollback service forces both owner values to `legacy`. Do not run another manually configured Node worker beside it.

Return ownership to Go:

```bash
docker compose --profile rollback stop legacy-jobs
docker compose up -d go-jobs
docker compose exec -T go-jobs allmail doctor jobs
```

If the second runtime reports that the forwarding advisory lock is already held, stop and identify the still-running owner rather than bypassing the lock.

## Legacy API unhealthy

Inspect:

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
- bootstrap secrets exist and satisfy Fastify validation;
- ingress placeholders are not left enabled.

The Fastify service is internal-only in the default Compose topology. Public traffic should enter through `app`.

## Redis degraded

`ALLOW_LOCAL_RATE_LIMIT_FALLBACK` defaults to `false`. Do not assume the system is safe merely because some routes still respond.

```bash
docker compose ps redis
docker compose logs redis --tail=200
docker compose exec redis redis-cli \
  -p "${REDIS_INTERNAL_PORT:-6379}" ping
```

After Redis recovery, recheck both Go and Fastify readiness.

## Bootstrap/admin secret confusion

Docker secrets are stored in the legacy runtime volume:

```bash
docker compose exec legacy-api sh -lc \
  'ls -l /var/lib/all-mail && cat /var/lib/all-mail/bootstrap-secrets.env'
```

The Go jobs container receives only the encryption key:

```bash
docker compose exec go-jobs sh -lc \
  'ls -l /var/lib/all-mail && test -r /var/lib/all-mail/encryption-key'
```

The public Go `app` container does not own or mount the bootstrap admin password. Older instructions using `docker compose exec app ...bootstrap-secrets.env` are invalid for the current topology.

For the source runtime, inspect:

```bash
cat "${ALL_MAIL_STATE_DIR:-.all-mail-runtime}/bootstrap-secrets.env"
```

## Dependency audit failure

CI runs production dependency audit independently from Docker smoke. An audit failure should not prevent Docker diagnostics.

The audit script supports only advisory-specific, package-scoped, expiring exceptions. It must not contain a blanket severity waiver.

Current exception review checklist:

1. confirm the advisory's affected feature is not used;
2. confirm package names and GHSA ID are exact;
3. set a near-term expiry date;
4. keep the patched-version upgrade tracked;
5. allow CI to fail automatically after expiry.

Remove the exception as soon as the dependency is upgraded.

## Cloudflare tunnel down or public hostnames return 530

First prove the local backend is healthy:

```bash
docker compose ps -a
curl http://127.0.0.1:3002/health
curl --fail http://127.0.0.1:3002/readyz
```

Then inspect the connector host and Cloudflare dashboard:

- tunnel status;
- active replica count;
- published routes;
- token-rotation warnings;
- `cloudflared` service status and logs.

Windows service checks:

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

Pin the working transport in the connector configuration instead of changing the backend when local readiness is already healthy. Never commit the tunnel token.

## Backup and restore starting point

Persistent Docker volumes in the canonical topology are:

- `postgres_data`;
- `redis_data`;
- `legacy_runtime_data` — bootstrap secrets and legacy runtime state;
- `go_runtime_data` — isolated Go heartbeat and forwarding key.

Before risky upgrades or manual migration recovery:

1. stop external writes where possible;
2. back up PostgreSQL using a database-aware method;
3. preserve both runtime-state volumes;
4. preserve Redis when its state matters to the recovery window;
5. record the exact application revision and `.env` contract;
6. test restore in an isolated environment.

Application rollback without matching persisted state may be insufficient after migrations or secret changes. When uncertain, preserve the current volumes before any destructive action.
