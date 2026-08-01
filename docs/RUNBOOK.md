# Operator runbook

## Boundary

This is the authoritative day-2 troubleshooting and recovery guide for `all-Mail`.

- Use [`DEPLOY.md`](./DEPLOY.md) for startup, updates, restore, and rollback.
- Use [`ENVIRONMENT.md`](./ENVIRONMENT.md) for variable and secret ownership.
- Use [`GO-MIGRATION.md`](./GO-MIGRATION.md) for completed route migration and schema compatibility.
- Use [`../CLOUDFLARE-DEPLOY.md`](../CLOUDFLARE-DEPLOY.md) for Worker and tunnel operations.

## Healthy baseline

The long-running stack is:

```text
app
go-business-api
worker-forwarding
worker-retention
postgres
redis
```

Initialization is a temporary `app init` container launched by `./scripts/compose-up.sh`; no initializer service remains after startup.

Baseline checks:

```bash
docker compose ps -a
curl http://127.0.0.1:3002/health
curl http://127.0.0.1:3002/livez
curl --fail http://127.0.0.1:3002/readyz

docker compose exec -T app allmail doctor api
docker compose exec -T go-business-api allmail doctor business-api
docker compose exec -T worker-forwarding allmail doctor worker forwarding
docker compose exec -T worker-retention allmail doctor worker retention

! docker compose port go-business-api 3200
! docker compose port postgres 5432
! docker compose port redis 6379
```

Logs:

```bash
docker compose logs postgres --tail=300
docker compose logs redis --tail=300
docker compose logs go-business-api --tail=300
docker compose logs app --tail=300
docker compose logs worker-forwarding --tail=300
docker compose logs worker-retention --tail=300
```

## Startup failure order

Investigate the earliest failed stage:

1. the selected `.env` exists and Compose renders;
2. `postgres` becomes healthy;
3. the shared Go image builds;
4. the temporary `app init` run succeeds;
5. `redis` and `go-business-api` become healthy;
6. `app` becomes ready;
7. both workers publish healthy heartbeats.

Rerun `./scripts/compose-up.sh` after fixing the earliest cause. Initialization is transactional and idempotent. Do not improvise a partial initializer command without the helper's three secret-volume mounts and export paths.

### PostgreSQL or Redis

```bash
docker compose exec postgres pg_isready -U "${POSTGRES_USER:-allmail}" -p 5432
docker compose exec redis redis-cli -p 6379 ping
```

Production does not publish either service. Local host access requires `docker-compose.dev.yml` or `./bin/all-mail deps up`.

## Temporary initializer failed

The temporary `app init` run owns:

- migration of the old combined secret bundle;
- persistence of JWT and encryption secrets;
- least-privilege key exports;
- execution or adoption of immutable schema history;
- numbered Go migrations and catalog validation;
- historical ciphertext verification;
- durable environment import;
- idempotent first-administrator creation.

Because the container is removed after each run, inspect the helper's terminal output. After correcting the cause, rerun:

```bash
./scripts/compose-up.sh
```

### Schema adoption failure

The Go initializer rejects unknown/newer migrations, unresolved former-ledger rows, history gaps, checksum mismatches, malformed objects, and ledgerless catalogs that do not match the complete owned-schema fingerprint.

Inspect `allmail_schema_migrations`, `_prisma_migrations`, and `runtime_migrations` without deleting or editing rows. Restore a matching backup or repair a proven catalog defect under a reviewed maintenance procedure, then rerun the helper. Compatibility table names are historical database state, not active runtime dependencies.

### Administrator 2FA integrity migration

The migration stops if an administrator is enabled for 2FA without a persisted encrypted secret:

```bash
docker compose exec postgres psql \
  -U "${POSTGRES_USER:-allmail}" \
  -d "${POSTGRES_DB:-allmail}" \
  -c 'SELECT id, username FROM admins WHERE two_factor_enabled = true AND two_factor_secret IS NULL'
```

Restore the valid encrypted secret from a matching backup or disable 2FA through a controlled recovery. Do not bypass the constraint.

### Initializer lock

The initializer uses filesystem and PostgreSQL advisory locks. Stop duplicate helper runs rather than removing locks or terminating an unknown backend transaction.

## Secret layout

| Purpose | Location | Volume |
| --- | --- | --- |
| Managed JWT and encryption values | `/var/lib/all-mail/runtime-secrets.env` | `runtime_secrets_data` |
| One-time administrator credential | `/var/lib/all-mail/bootstrap-admin.env` | `runtime_secrets_data` |
| Private JWT copy | `/var/lib/all-mail-secrets/jwt-secret` | `go_business_runtime_data` |
| Private encryption-key copy | `/var/lib/all-mail-encryption/encryption-key` | `forwarding_runtime_data` mounted read-only into `go-business-api` |
| Forwarding encryption-key copy | `/var/lib/all-mail-secrets/encryption-key` | `forwarding_runtime_data` |

Inspect names without printing values:

```bash
docker compose exec go-business-api sh -lc '
  ls -l /var/lib/all-mail
  sed -n "s/=.*$/=<redacted>/p" /var/lib/all-mail/runtime-secrets.env
  test ! -e /var/lib/all-mail/bootstrap-secrets.env
'
```

`runtime-secrets.env` must contain no administrator username or password.

### Initial password is still required

```bash
docker compose exec go-business-api sh -lc \
  "grep '^ADMIN_USERNAME=' /var/lib/all-mail/bootstrap-admin.env && \
   grep '^ADMIN_PASSWORD=' /var/lib/all-mail/bootstrap-admin.env"
```

After successful first password rotation:

```bash
docker compose exec go-business-api sh -lc \
  'test ! -e /var/lib/all-mail/bootstrap-admin.env'
```

If the database row still has `must_change_password=true` but the file is missing, recover the existing administrator under a reviewed procedure. Do not create a second account.

## Unexpected credentials

The private API receives active database, Redis, and secret-file inputs, not raw secret values:

```bash
docker compose exec go-business-api sh -lc '
  test -n "${DATABASE_URL:-}"
  test "${REDIS_URL:-}" = "redis://redis:6379"
  test -r /var/lib/all-mail-secrets/jwt-secret
  test -r /var/lib/all-mail-encryption/encryption-key
  test -z "${JWT_SECRET:-}"
  test -z "${ENCRYPTION_KEY:-}"
  test -z "${ADMIN_USERNAME:-}"
  test -z "${ADMIN_PASSWORD:-}"
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

There is no environment-backed administrator.

```bash
docker compose exec postgres psql \
  -U "${POSTGRES_USER:-allmail}" \
  -d "${POSTGRES_DB:-allmail}" \
  -c 'SELECT id, username, status, must_change_password, two_factor_enabled FROM admins ORDER BY id'
```

Common causes:

- username mismatch;
- disabled administrator;
- initial password already rotated;
- mandatory password change still pending;
- database-managed 2FA is enabled;
- Redis login protection is unavailable and correctly fails closed;
- restored database and secret volumes do not belong to the same backup set.

Do not reintroduce environment-backed authentication.

## Public gateway unhealthy

```bash
docker compose logs app --tail=300
curl -i http://127.0.0.1:3002/readyz
docker compose exec -T app allmail doctor api
docker compose exec -T app allmail routes
```

Public readiness requires the route manifest, the built React `index.html`, and `go-business-api` readiness. The public process itself has no PostgreSQL or Redis credential.

## Private Go service unhealthy

```bash
docker compose logs go-business-api --tail=300
docker compose exec -T go-business-api allmail doctor business-api
docker compose exec go-business-api sh -lc '
  test -r /var/lib/all-mail-secrets/jwt-secret
  test -r /var/lib/all-mail-encryption/encryption-key
  test -n "${DATABASE_URL:-}"
  test -n "${REDIS_URL:-}"
'
```

Its `/readyz` performs real PostgreSQL and Redis protocol checks. Redis failure is not degraded-ready because login, API-key, OAuth, and ingress security state fails closed.

## Wrong route owner or unexpected 404

```bash
docker compose exec -T app allmail routes
curl -si http://127.0.0.1:3002/admin/dashboard/stats | \
  grep -Ei '^(HTTP/|X-All-Mail-Route-Owner:|X-All-Mail-Route-Family:)'
```

Every business route must report `go-business-api`; system endpoints and the SPA report `go`. Ownership is source-controlled in `config/route-ownership.json`; there is no runtime owner switch.

## Client IP or lockout behavior is wrong

- Leave `TRUSTED_PROXY_CIDRS` blank for direct access.
- List only direct tunnel or reverse-proxy peers.
- Never trust public client networks or blanket CIDRs.
- Go strips untrusted forwarding headers and writes one canonical identity before proxying.

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

Do not bypass the advisory owner lock or shorten the lease below the run timeout plus shutdown and safety margin.

## Retention worker

```bash
docker compose logs worker-retention --tail=300
docker compose exec -T worker-retention allmail doctor worker retention
docker compose exec -T worker-retention sh -lc \
  'cat /tmp/all-mail/worker-retention-heartbeat.json'
```

## Redis degraded

Redis loss affects administrator and mailbox login protection, API-key limiting, OAuth state, and ingress replay reservation. Recover Redis, then recheck `go-business-api` and public readiness. Do not add a production in-memory fallback.

## Cloudflare or tunnel failure

Prove local health first, then inspect tunnel replicas, routes, transport, and tokens. Update `TRUSTED_PROXY_CIDRS` narrowly when the direct peer changes. Never commit tunnel tokens.

## Backup, restore, and rollback

Persisted volumes are:

```text
postgres_data
redis_data
runtime_secrets_data
forwarding_runtime_data
go_business_runtime_data
```

Before risky upgrades preserve PostgreSQL, `.env`, all three secret volumes, the exact Git revision, and Redis when operational-state continuity matters. Preserve `bootstrap-admin.env` or an old `bootstrap-secrets.env` when present in the source backup.

Treat PostgreSQL and secret volumes as one restore unit:

```bash
docker compose down
git switch <matching-tag-or-commit>
# Restore PostgreSQL and all matching named volumes.
./scripts/compose-up.sh
```

For rollback, use a revision explicitly compatible with the current schema or restore the backup captured for the target revision. Never run initializers, workers, or APIs from two revisions against the same persisted state, and never use `docker compose down -v` unless destruction is intentional.

## CI failure

The main verification gate covers runtime contracts, Go format/race/vet/build checks, real PostgreSQL and Redis integration, React and Worker checks, dependency audit, Docker bootstrap, secret isolation, route ownership, and all four Go doctors. Use the failed job's diagnostics instead of weakening a gate.
