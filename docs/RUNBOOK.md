# Operator runbook

## Boundary

This is the authoritative day-2 troubleshooting and recovery guide for `all-Mail`.

- Use [`DEPLOY.md`](./DEPLOY.md) for startup and rollback.
- Use [`ENVIRONMENT.md`](./ENVIRONMENT.md) for variable/secret ownership.
- Use [`GO-MIGRATION.md`](./GO-MIGRATION.md) for runtime ownership.
- Use [`../CLOUDFLARE-DEPLOY.md`](../CLOUDFLARE-DEPLOY.md) for Worker/tunnel details.

## Healthy baseline

Long-running:

```text
app
worker-forwarding
worker-retention
legacy-api
postgres
redis
```

Completed one-shot:

```text
legacy-init
go-migrate
```

Baseline:

```bash
docker compose ps -a
curl http://127.0.0.1:3002/health
curl --fail http://127.0.0.1:3002/readyz
docker compose exec -T app allmail doctor api
docker compose exec -T worker-forwarding allmail doctor worker forwarding
docker compose exec -T worker-retention allmail doctor worker retention
test "$(docker compose exec -T legacy-api id -u)" = "10001"
! docker compose port postgres 5432
! docker compose port redis 6379
```

Logs:

```bash
docker compose logs legacy-init --tail=300
docker compose logs go-migrate --tail=300
docker compose logs legacy-api --tail=300
docker compose logs app --tail=300
docker compose logs worker-forwarding --tail=300
docker compose logs worker-retention --tail=300
```

## Stack does not start

Investigate the first failed stage:

1. PostgreSQL/Redis;
2. `legacy-init`;
3. `go-migrate`;
4. `legacy-api`;
5. `app` or an independent worker.

Do not restart downstream services while an earlier one-shot stage is failed.

### PostgreSQL or Redis

```bash
docker compose exec postgres pg_isready -U "${POSTGRES_USER:-allmail}" -p 5432
docker compose exec redis redis-cli -p 6379 ping
```

Local host access requires `docker-compose.dev.yml`.

## `legacy-init` failed

The initializer owns:

- legacy combined-secret migration;
- long-lived JWT/encryption secret persistence;
- forwarding-key export;
- Prisma migrations;
- idempotent first database administrator creation.

It waits only for PostgreSQL.

```bash
docker compose logs legacy-init --tail=400
```

### Prisma P3005

After inspection and backup, run the explicit one-shot compatibility repair only when appropriate:

```bash
docker compose run --rm \
  -e ALL_MAIL_ALLOW_LEGACY_DB_PUSH_REPAIR=true \
  legacy-init
```

Do not persist the switch.

### Prisma P3009

A failed migration record requires manual recovery. Repeated restarts do not fix it. Use `docker compose down -v` only for disposable data.

### Administrator advisory lock or creation failure

The initializer holds PostgreSQL advisory lock `(421337, 240730)` while inspecting/creating the administrator. If another initializer is running, stop the duplicate rather than removing the lock.

Check:

```bash
docker compose exec postgres psql \
  -U "${POSTGRES_USER:-allmail}" \
  -d "${POSTGRES_DB:-allmail}" \
  -c 'SELECT id, username, status, must_change_password FROM admins ORDER BY id'
```

The initializer must never overwrite an existing administrator password.

## Secret-layout troubleshooting

Expected long-lived file:

```text
/var/lib/all-mail/runtime-secrets.env
```

Expected one-time file while initial rotation is pending:

```text
/var/lib/all-mail/bootstrap-admin.env
```

Removed legacy file:

```text
/var/lib/all-mail/bootstrap-secrets.env
```

Inspect names without printing values:

```bash
docker compose exec legacy-api sh -lc '
  ls -l /var/lib/all-mail
  sed -n "s/=.*$/=<redacted>/p" /var/lib/all-mail/runtime-secrets.env
  test ! -e /var/lib/all-mail/bootstrap-secrets.env
'
```

`runtime-secrets.env` must contain no `ADMIN_USERNAME` or `ADMIN_PASSWORD`.

### Initial password is still required

```bash
docker compose exec legacy-api sh -lc \
  "grep '^ADMIN_USERNAME=' /var/lib/all-mail/bootstrap-admin.env && \
   grep '^ADMIN_PASSWORD=' /var/lib/all-mail/bootstrap-admin.env"
```

After successful first password rotation:

```bash
docker compose exec legacy-api sh -lc \
  'test ! -e /var/lib/all-mail/bootstrap-admin.env'
```

If the DB administrator still has `must_change_password=true` but the file is missing, do not create a second administrator. Reset that existing database administrator through a controlled recovery procedure.

### Historical custom username migration

Old combined files often did not store the username. The new initializer compares the preserved password with pending administrator hashes. If a match is found, it rewrites `bootstrap-admin.env` with the actual username.

If logs report a pending administrator with no recoverable file:

1. preserve the current DB and volume;
2. identify the pending administrator;
3. perform a controlled password reset on that row;
4. set `must_change_password=true` if a temporary password is issued;
5. create a protected `bootstrap-admin.env` only for that same username/password;
6. rotate it immediately through the UI.

## Long-running API has bootstrap credentials

This is a configuration regression. It must report empty values:

```bash
docker compose exec legacy-api sh -lc '
  test -z "${ADMIN_USERNAME:-}"
  test -z "${ADMIN_PASSWORD:-}"
  test -z "${DOMAIN_BOOTSTRAP_ADMIN_USERNAME:-}"
  test -z "${DOMAIN_BOOTSTRAP_ADMIN_PASSWORD:-}"
  test -z "${ADMIN_2FA_SECRET:-}"
'
```

The only related value allowed in Fastify is the cleanup path:

```text
BOOTSTRAP_ADMIN_SECRET_FILE=/var/lib/all-mail/bootstrap-admin.env
```

## Login fails after upgrade

The API now authenticates database administrators only. There is no environment password fallback and no virtual `adminId=0` account.

Check:

```bash
docker compose exec postgres psql \
  -U "${POSTGRES_USER:-allmail}" \
  -d "${POSTGRES_DB:-allmail}" \
  -c 'SELECT id, username, status, must_change_password, two_factor_enabled FROM admins ORDER BY id'
```

Common causes:

- using an old environment-only credential that was never represented in the DB;
- username mismatch;
- disabled administrator;
- initial password already rotated;
- database-managed 2FA enabled.

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
```

The public app checks SPA assets and Fastify readiness. It has no PostgreSQL/Redis credentials.

## Fastify unhealthy

```bash
docker compose logs legacy-api --tail=300
docker compose exec -T legacy-api node -e \
  "fetch('http://127.0.0.1:' + (process.env.PORT || 3100) + '/readyz').then(async (r) => { console.log(await r.text()); process.exit(r.ok ? 0 : 1); }).catch(console.error)"
```

Confirm migrations completed, PostgreSQL/Redis are healthy, UID is `10001`, and runtime secrets validate.

## Client IP or lockout behavior is wrong

Rules:

- leave `TRUSTED_PROXY_CIDRS` blank for direct access;
- list only a direct tunnel/proxy peer;
- never trust public client networks or blanket CIDRs;
- Fastify remains `trustProxy: 1`;
- Go overwrites forwarding headers.

Test forged direct headers and inspect the resulting login/audit IP.

## Forwarding worker

```bash
docker compose logs worker-forwarding --tail=300
docker compose exec -T worker-forwarding allmail doctor worker forwarding
docker compose exec -T worker-forwarding sh -lc '
  cat /var/lib/all-mail/worker-forwarding-heartbeat.json
  test -r /var/lib/all-mail/encryption-key
  test -z "${ENCRYPTION_KEY:-}"
'
```

Do not bypass the advisory owner lock.

## Retention worker

```bash
docker compose logs worker-retention --tail=300
docker compose exec -T worker-retention allmail doctor worker retention
docker compose exec -T worker-retention sh -lc \
  'cat /var/lib/all-mail/worker-retention-heartbeat.json'
```

## Redis degraded

`ALLOW_LOCAL_RATE_LIMIT_FALLBACK=false` is the supported production setting. Recover Redis, then recheck Fastify and Go readiness. A later security slice removes remaining production in-memory fallbacks.

## CI bootstrap-flow failure

The dedicated workflow verifies:

- secret split and old-file removal;
- one database administrator;
- no bootstrap vars in Fastify;
- login through Go;
- forced password rotation;
- plaintext file deletion;
- initializer idempotency after rotation;
- all three Go doctors.

Use uploaded `bootstrap-admin-docker-diagnostics` rather than weakening the gate.

## Cloudflare/tunnel failures

Prove local health first, then inspect tunnel replicas, routes, transport and tokens. Update `TRUSTED_PROXY_CIDRS` narrowly when the direct peer changes. Never commit tunnel tokens.

## Rollback and backup

Persisted volumes:

```text
postgres_data
redis_data
legacy_runtime_data
forwarding_runtime_data
retention_runtime_data
```

Before risky upgrades preserve:

- PostgreSQL;
- `runtime-secrets.env`;
- `bootstrap-admin.env` when present;
- a pre-upgrade backup of any `bootstrap-secrets.env`;
- forwarding and retention state volumes;
- exact revision and `.env` contract.

Rollback with the target revision's deployment guide and restore the secret layout it expects. Never run initializers or workers from two revisions concurrently.
