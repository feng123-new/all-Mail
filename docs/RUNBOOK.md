# Operator runbook

## Boundary

This is the authoritative day-2 troubleshooting and recovery guide for `all-Mail`.

- Use [`DEPLOY.md`](./DEPLOY.md) for normal deployment and rollback entry.
- Use [`ENVIRONMENT.md`](./ENVIRONMENT.md) for variable meaning.
- Use [`GO-MIGRATION.md`](./GO-MIGRATION.md) for runtime ownership.
- Use [`../CLOUDFLARE-DEPLOY.md`](../CLOUDFLARE-DEPLOY.md) for Worker and tunnel details.

## Healthy baseline

Long-running services:

```text
app
worker-forwarding
worker-retention
legacy-api
postgres
redis
```

Completed one-shot services:

```text
legacy-init
go-migrate
```

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

Production exposure checks:

```bash
docker compose port app 3000
! docker compose port postgres 5432
! docker compose port redis 6379
```

PostgreSQL, Redis, and Fastify are internal-only.

Inspect logs by owner:

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

1. PostgreSQL/Redis health;
2. `legacy-init` exit code;
3. `go-migrate` exit code;
4. `legacy-api` health;
5. `app` or an independent worker.

Do not repeatedly restart later services while an earlier one-shot dependency is failed.

### PostgreSQL or Redis unhealthy

```bash
docker compose logs postgres --tail=200
docker compose logs redis --tail=200
docker compose exec postgres pg_isready -U "${POSTGRES_USER:-allmail}" -p 5432
docker compose exec redis redis-cli -p 6379 ping
```

Production has no host port for these services. For local Fastify development use:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis
```

## `legacy-init` failed

`legacy-init` owns bootstrap-secret persistence, forwarding-key export, and Prisma migrations. It waits only for PostgreSQL; a Redis outage is not an initializer dependency.

```bash
docker compose logs legacy-init --tail=300
```

### Prisma P3005

Automatic `db push` is disabled. After inspecting and backing up the database, run the explicit one-shot compatibility repair only when appropriate:

```bash
docker compose run --rm \
  -e ALL_MAIL_ALLOW_LEGACY_DB_PUSH_REPAIR=true \
  legacy-init
```

The repair switch is absent from `.env.example` by design. Do not persist it.

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

- required business tables are missing;
- a pre-existing runtime table has the wrong shape;
- an applied file was edited and its checksum changed;
- permissions are insufficient;
- another migration transaction holds the advisory lock.

Never edit applied numbered migrations or delete `runtime_migrations` to bypass validation. The runner uses direct `pgx`; a missing `psql` executable is not a cause.

## Public Go gateway unhealthy

```bash
docker compose ps app
docker compose logs app --tail=300
curl -i http://127.0.0.1:3002/health
curl -i http://127.0.0.1:3002/readyz
docker compose exec -T app allmail doctor api
```

The Go readiness report covers:

- built React `index.html`;
- the compatibility API `/readyz` contract.

It does not independently probe PostgreSQL or Redis because the public gateway no longer receives those credentials. Inspect `legacy-api` readiness for database/Redis detail.

Confirm the app environment has no shared-state credentials:

```bash
docker compose exec app sh -lc \
  'test -z "${DATABASE_URL:-}" && test -z "${REDIS_URL:-}"'
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
- UID is `10001`;
- PostgreSQL and Redis are healthy;
- bootstrap secrets satisfy validation;
- no shipped ingress placeholder remains.

Fastify is API-only and internal-only. Public traffic enters through Go.

## Client IP or login lockouts look wrong

Symptoms:

- all clients appear to use the same container IP;
- spoofed `X-Forwarded-For` appears in login/audit state;
- real client IP disappears behind a tunnel;
- unrelated users share a login lockout bucket.

Inspect the direct peer path:

```bash
docker compose logs app --tail=300
docker compose logs legacy-api --tail=300
```

Rules:

- direct clients should leave `TRUSTED_PROXY_CIDRS` blank;
- a tunnel/reverse proxy must be listed only when it connects directly to `app`;
- do not trust public client networks or `0.0.0.0/0`;
- Fastify must remain `trustProxy: 1`, not blanket trust;
- changing the CIDR requires recreating `app`.

Spoofing check from an untrusted direct peer:

```bash
curl -H 'X-Forwarded-For: 203.0.113.99' \
  -H 'X-Real-IP: 203.0.113.100' \
  -H 'CF-Connecting-IP: 203.0.113.101' \
  http://127.0.0.1:3002/health
```

Use a controlled login/audit request to verify those values are not persisted. Through a trusted tunnel, verify the canonical client value is persisted instead.

## Forwarding worker unhealthy or not processing

```bash
docker compose ps worker-forwarding
docker compose logs worker-forwarding --tail=300
docker compose exec -T worker-forwarding allmail doctor worker forwarding
docker compose exec -T worker-forwarding sh -lc \
  'cat /var/lib/all-mail/worker-forwarding-heartbeat.json'
```

Default run limit:

```text
FORWARDING_RUN_TIMEOUT_SECONDS=120
```

A timeout usually indicates a blocked database/provider request, provider latency, or an unexpectedly large batch. Fix the operation or reduce the batch before increasing the limit.

The forwarding worker now accepts only the isolated key file:

```bash
docker compose exec worker-forwarding sh -lc \
  'test -r /var/lib/all-mail/encryption-key && test -z "${ENCRYPTION_KEY:-}"'
```

If the advisory owner lock is held, stop the other revision/process. Do not bypass the lock.

```bash
docker compose up -d --force-recreate worker-forwarding
docker compose exec -T worker-forwarding allmail doctor worker forwarding
```

## Retention worker unhealthy or not processing

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

Check database load and lock contention before increasing limits.

## Redis degraded

Production still has transitional local fallback code in selected Fastify flows, but `ALLOW_LOCAL_RATE_LIMIT_FALLBACK=false` is the supported setting. Some endpoints responding does not prove degraded Redis is safe.

```bash
docker compose ps redis
docker compose logs redis --tail=200
docker compose exec redis redis-cli -p 6379 ping
```

After recovery, recheck Fastify readiness and then Go readiness.

## Bootstrap/admin secret confusion

Current bootstrap secrets live in the legacy runtime volume:

```bash
docker compose exec legacy-api sh -lc \
  'ls -l /var/lib/all-mail && cat /var/lib/all-mail/bootstrap-secrets.env'
```

Only the forwarding key is exported to `worker-forwarding`. `app` and `worker-retention` do not mount the admin password.

A later stacked PR moves administrator creation fully into the one-shot initializer and removes credentials from the long-running API. Until it lands, follow the current revision's bootstrap instructions.

## Dependency audit or configuration-security failure

CI runs production audit, Docker smoke, and the configuration/proxy workflow independently.

The configuration workflow verifies:

- removed aliases are absent from production Go code;
- proxy tests pass under the race detector;
- the app has no database/Redis credentials;
- production PostgreSQL/Redis ports remain private;
- forwarding receives only the key file.

Do not weaken these checks to silence a failure. Fix the ownership regression.

## Cloudflare tunnel down or public hostnames return 530

First prove the local backend:

```bash
docker compose ps -a
curl http://127.0.0.1:3002/health
curl --fail http://127.0.0.1:3002/readyz
```

Then inspect tunnel status, active replicas, published routes, token rotation, and connector logs. If the tunnel peer changes network ranges, update `TRUSTED_PROXY_CIDRS` narrowly.

Windows checks:

```powershell
Get-Service cloudflared
sc query cloudflared
```

Foreground diagnosis:

```powershell
cloudflared.exe tunnel run --token <token-from-dashboard>
```

Never commit a tunnel token.

## Roll back the application revision

There is no hidden Node jobs runtime.

1. Stop external automation/new writes.
2. Back up PostgreSQL and runtime volumes.
3. `docker compose down`.
4. Switch to a previous known-good revision/image.
5. Restore matching data if migrations/secrets changed.
6. Use that revision's environment contract and deployment guide.
7. Re-run readiness and functional checks.

Never run workers from two revisions against the same state machine concurrently.

## Backup and restore starting point

Persistent volumes:

- `postgres_data`;
- `redis_data`;
- `legacy_runtime_data` — bootstrap/runtime secrets;
- `forwarding_runtime_data` — forwarding key and heartbeat;
- `retention_runtime_data` — retention heartbeat.

Before risky upgrades:

1. stop external writes where possible;
2. create a database-aware PostgreSQL backup;
3. preserve runtime-state volumes;
4. preserve Redis when its state matters;
5. record the exact revision and `.env` contract;
6. test restore in isolation.
