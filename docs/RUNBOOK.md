# Operator runbook

## Boundary

This is the authoritative day-2 troubleshooting and recovery guide for `all-Mail`.

- Use [`DEPLOY.md`](./DEPLOY.md) for startup, updates, and rollback.
- Use [`ENVIRONMENT.md`](./ENVIRONMENT.md) for variable and secret ownership.
- Use [`GO-MIGRATION.md`](./GO-MIGRATION.md) for route and runtime ownership.
- Use [`../CLOUDFLARE-DEPLOY.md`](../CLOUDFLARE-DEPLOY.md) for Worker and tunnel operations.

## Healthy baseline

Long-running services:

```text
app
go-business-api
business-api
worker-forwarding
worker-retention
postgres
redis
```

Completed one-shot services:

```text
business-init
go-migrate
```

Baseline commands:

```bash
docker compose ps -a
curl http://127.0.0.1:3002/health
curl --fail http://127.0.0.1:3002/readyz

docker compose exec -T app allmail doctor api
docker compose exec -T go-business-api allmail doctor business-api
docker compose exec -T worker-forwarding allmail doctor worker forwarding
docker compose exec -T worker-retention allmail doctor worker retention

test "$(docker compose exec -T business-api id -u)" = "10001"
test "$(docker compose exec -T go-business-api id -u)" = "10001"
! docker compose port go-business-api 3200
! docker compose port business-api 3100
! docker compose port postgres 5432
! docker compose port redis 6379
```

Logs:

```bash
docker compose logs business-init --tail=300
docker compose logs go-migrate --tail=300
docker compose logs go-business-api --tail=300
docker compose logs business-api --tail=300
docker compose logs app --tail=300
docker compose logs worker-forwarding --tail=300
docker compose logs worker-retention --tail=300
```

## Startup order and first failure

Investigate the earliest failed stage:

1. PostgreSQL and Redis;
2. `business-init`;
3. `go-migrate`;
4. `business-api` and `go-business-api`;
5. `app`;
6. independent workers.

Do not repeatedly restart downstream services while an earlier one-shot stage is failed.

### PostgreSQL or Redis

```bash
docker compose exec postgres pg_isready -U "${POSTGRES_USER:-allmail}" -p 5432
docker compose exec redis redis-cli -p 6379 ping
```

Production does not publish either service. Local host access requires `docker-compose.dev.yml`.

## `business-init` failed

The initializer owns:

- old combined-secret migration;
- long-lived JWT and encryption-secret persistence;
- forwarding encryption-key export;
- Go-business JWT export;
- Prisma migrations;
- durable environment import;
- idempotent first administrator creation.

```bash
docker compose logs business-init --tail=400
```

### Prisma P3005

After inspection and backup, run the explicit one-shot compatibility repair only when appropriate:

```bash
docker compose run --rm \
  -e ALL_MAIL_ALLOW_PRISMA_P3005_REPAIR=true \
  business-init
```

Do not persist the switch.

### Prisma P3009

A failed migration record requires manual recovery. Repeated restarts do not repair it. Use `docker compose down -v` only for disposable data.

### Administrator 2FA integrity migration

The migration intentionally stops if an administrator is enabled for 2FA without a persisted encrypted secret:

```bash
docker compose exec postgres psql \
  -U "${POSTGRES_USER:-allmail}" \
  -d "${POSTGRES_DB:-allmail}" \
  -c 'SELECT id, username FROM admins WHERE two_factor_enabled = true AND two_factor_secret IS NULL'
```

Restore the valid encrypted secret from a matching backup or disable 2FA through a controlled recovery. Do not bypass the constraint.

### Administrator advisory lock

The initializer holds advisory lock `(421337, 240730)` while inspecting or creating the first administrator. Stop duplicate initializers rather than removing the lock.

```bash
docker compose exec postgres psql \
  -U "${POSTGRES_USER:-allmail}" \
  -d "${POSTGRES_DB:-allmail}" \
  -c 'SELECT id, username, status, must_change_password FROM admins ORDER BY id'
```

The initializer must never overwrite an existing administrator password.

## Secret layout

Expected long-lived Fastify file:

```text
/var/lib/all-mail/runtime-secrets.env
```

Expected one-time administrator file while rotation is pending:

```text
/var/lib/all-mail/bootstrap-admin.env
```

Expected private Go JWT file:

```text
/var/lib/all-mail-secrets/jwt-secret
```

Expected forwarding file:

```text
/var/lib/all-mail-secrets/encryption-key
```

Removed legacy file:

```text
/var/lib/all-mail/bootstrap-secrets.env
```

Inspect names without printing values:

```bash
docker compose exec business-api sh -lc '
  ls -l /var/lib/all-mail
  sed -n "s/=.*$/=<redacted>/p" /var/lib/all-mail/runtime-secrets.env
  test ! -e /var/lib/all-mail/bootstrap-secrets.env
'
```

`runtime-secrets.env` must contain no `ADMIN_USERNAME` or `ADMIN_PASSWORD`.

### Initial password is still required

```bash
docker compose exec business-api sh -lc \
  "grep '^ADMIN_USERNAME=' /var/lib/all-mail/bootstrap-admin.env && \
   grep '^ADMIN_PASSWORD=' /var/lib/all-mail/bootstrap-admin.env"
```

After a successful first password rotation:

```bash
docker compose exec business-api sh -lc \
  'test ! -e /var/lib/all-mail/bootstrap-admin.env'
```

If the database administrator still has `must_change_password=true` but the file is missing, reset that existing row through a controlled recovery. Do not create a second administrator.

## Long-running service contains unexpected credentials

Fastify must not receive bootstrap values:

```bash
docker compose exec business-api sh -lc '
  test -z "${ADMIN_USERNAME:-}"
  test -z "${ADMIN_PASSWORD:-}"
  test -z "${DOMAIN_BOOTSTRAP_ADMIN_USERNAME:-}"
  test -z "${DOMAIN_BOOTSTRAP_ADMIN_PASSWORD:-}"
  test -z "${ADMIN_2FA_SECRET:-}"
'
```

`go-business-api` must receive only its active database, Redis, and read-only JWT inputs:

```bash
docker compose exec go-business-api sh -lc '
  test -n "${DATABASE_URL:-}"
  test "${REDIS_URL:-}" = "redis://redis:6379"
  test -r /var/lib/all-mail-secrets/jwt-secret
  test -z "${JWT_SECRET:-}"
  test -z "${ENCRYPTION_KEY:-}"
  test -z "${INGRESS_SIGNING_SECRET:-}"
'
```

The public gateway must remain credential-free:

```bash
docker compose exec app sh -lc '
  test -z "${DATABASE_URL:-}"
  test -z "${REDIS_URL:-}"
  test -z "${JWT_SECRET:-}"
  test -z "${ENCRYPTION_KEY:-}"
'
```

## Login fails after upgrade

There is no environment-backed administrator and no virtual `adminId=0` account.

```bash
docker compose exec postgres psql \
  -U "${POSTGRES_USER:-allmail}" \
  -d "${POSTGRES_DB:-allmail}" \
  -c 'SELECT id, username, status, must_change_password, two_factor_enabled FROM admins ORDER BY id'
```

Common causes:

- an old environment-only credential was never represented in PostgreSQL;
- username mismatch;
- disabled administrator;
- initial password already rotated;
- database-managed 2FA is enabled;
- Redis login-lock state is unavailable and production correctly fails closed.

Do not reintroduce `ADMIN_2FA_SECRET` or login-time account creation.

## `go-migrate` failed

```bash
docker compose logs go-migrate --tail=300
```

Never edit applied numbered migrations or delete `runtime_migrations` to bypass checksum validation.

## Public Go gateway unhealthy

```bash
docker compose logs app --tail=300
curl -i http://127.0.0.1:3002/readyz
docker compose exec -T app allmail doctor api
docker compose exec -T app allmail routes
```

Public readiness requires:

- a valid route-ownership manifest;
- the built React `index.html`;
- Fastify `business-api` readiness;
- private `go-business-api` readiness.

The public process itself has no PostgreSQL or Redis credential.

## Private Go business service unhealthy

```bash
docker compose logs go-business-api --tail=300
docker compose exec -T go-business-api allmail doctor business-api
docker compose exec go-business-api sh -lc '
  test -r /var/lib/all-mail-secrets/jwt-secret
  test -n "${DATABASE_URL:-}"
  test -n "${REDIS_URL:-}"
'
```

Its `/readyz` performs real PostgreSQL and Redis protocol checks. Redis failure is intentionally not treated as degraded-ready because API-key limits fail closed.

## Fastify business service unhealthy

```bash
docker compose logs business-api --tail=300
docker compose exec -T business-api node -e \
  "fetch('http://127.0.0.1:' + (process.env.PORT || 3100) + '/readyz').then(async (r) => { console.log(await r.text()); process.exit(r.ok ? 0 : 1); }).catch(console.error)"
```

Confirm Prisma migrations completed, PostgreSQL and Redis are healthy, UID is `10001`, and runtime secrets validate.

## Wrong route owner or unexpected 404

Inspect the active manifest and response headers:

```bash
docker compose exec -T app allmail routes
curl -si http://127.0.0.1:3002/admin/dashboard/stats | \
  grep -Ei '^(HTTP/|X-All-Mail-Route-Owner:|X-All-Mail-Route-Family:)'
```

Ownership is source-controlled in `config/route-ownership.json`; there is no runtime owner switch. Roll back the complete revision rather than mutating an environment variable.

## Client IP or lockout behavior is wrong

Rules:

- leave `TRUSTED_PROXY_CIDRS` blank for direct access;
- list only direct tunnel or reverse-proxy peers;
- never trust public client networks or blanket CIDRs;
- Fastify remains `trustProxy: 1`;
- Go strips and rewrites forwarding headers before proxying.

Test forged direct headers and inspect the resulting login or audit IP.

## Forwarding worker

```bash
docker compose logs worker-forwarding --tail=300
docker compose exec -T worker-forwarding allmail doctor worker forwarding
docker compose exec -T worker-forwarding sh -lc '
  cat /tmp/all-mail/worker-forwarding-heartbeat.json
  test -r /var/lib/all-mail-secrets/encryption-key
  test -z "${ENCRYPTION_KEY:-}"
'
```

Do not bypass the advisory owner lock.

## Retention worker

```bash
docker compose logs worker-retention --tail=300
docker compose exec -T worker-retention allmail doctor worker retention
docker compose exec -T worker-retention sh -lc \
  'cat /tmp/all-mail/worker-retention-heartbeat.json'
```

## Redis degraded

Production security state fails closed. Redis loss affects:

- administrator login protection;
- API-key limiting in both business implementations;
- OAuth state and completion status;
- ingress replay reservation.

Recover Redis, then recheck both business APIs and public readiness. Do not add a production in-memory fallback.

## CI failure

The main CI workflow verifies:

- runtime and environment contracts;
- Go formatting, race tests, vet, build, and vulnerability checks;
- real PostgreSQL and Redis integration paths;
- Fastify, React, and Worker checks;
- production dependency audit;
- full Docker bootstrap and route-owner smoke;
- all four Go doctors: public API, private business API, forwarding, and retention.

Use the uploaded diagnostics from the failed job instead of weakening a gate.

## Cloudflare or tunnel failure

Prove local health first, then inspect tunnel replicas, routes, transport, and tokens. Update `TRUSTED_PROXY_CIDRS` narrowly when the direct peer changes. Never commit tunnel tokens.

## Rollback and backup

Persisted volumes currently include:

```text
postgres_data
redis_data
runtime_secrets_data
forwarding_runtime_data
go_business_runtime_data
```

Before risky upgrades preserve:

- PostgreSQL;
- `runtime-secrets.env`;
- `bootstrap-admin.env` when present;
- a pre-upgrade backup of any `bootstrap-secrets.env`;
- the forwarding encryption-key volume;
- the private Go JWT volume;
- the exact Git revision and `.env` contract.

Rollback with the target revision's deployment guide and restore the secret layout it expects. Never run initializers, workers, or business APIs from two revisions against the same persisted state.