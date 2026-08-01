# Operations runbook

## Canonical topology

The production stack contains exactly:

```text
app
go-business-api
worker-forwarding
worker-retention
postgres
redis
```

Use `./scripts/compose-up.sh` for startup and upgrades. It runs temporary initialization before the long-running stack.

## First response

```bash
docker compose ps -a
docker compose logs --no-color --timestamps app go-business-api worker-forwarding worker-retention postgres redis
curl -i http://127.0.0.1:3002/health
curl -i http://127.0.0.1:3002/readyz
```

Run all doctors:

```bash
docker compose exec -T app allmail doctor api
docker compose exec -T go-business-api allmail doctor business-api
docker compose exec -T worker-forwarding allmail doctor worker forwarding
docker compose exec -T worker-retention allmail doctor worker retention
```

Verify private services remain unpublished:

```bash
! docker compose port go-business-api 3200
! docker compose port postgres 5432
! docker compose port redis 6379
```

## Readiness failures

Public `/readyz` requires the React build and private `go-business-api`. Private readiness performs real PostgreSQL and authenticated Redis checks.

### PostgreSQL failure

```bash
docker compose ps postgres
docker compose logs --tail=200 postgres
docker compose exec -T postgres pg_isready -U "${POSTGRES_USER:-allmail}" -p 5432
```

Do not reset the database or delete volumes. Confirm the exact revision and matching password before restore or rollback.

### Redis failure

```bash
docker compose ps redis
docker compose logs --tail=200 redis
docker compose exec -T redis sh -lc '
  test -r /run/all-mail-secrets/redis-password
  REDISCLI_AUTH="$(cat /run/all-mail-secrets/redis-password)" redis-cli -p 6379 ping
'
```

Unauthenticated access should fail:

```bash
! docker compose exec -T redis redis-cli -p 6379 ping
```

Check that `redis_runtime_data` is mounted read-only in both `redis` and `go-business-api`. Do not print the password into logs or copy it into `.env`.

### Private API failure

```bash
docker compose logs --tail=300 go-business-api
docker compose exec -T go-business-api sh -lc '
  test -r /var/lib/all-mail-secrets/jwt-secret
  test -r /var/lib/all-mail-encryption/encryption-key
  test -r /var/lib/all-mail-redis/redis-password
  test ! -e /var/lib/all-mail-state
'
```

The private API should receive `go_business_runtime_data`, `forwarding_runtime_data`, `redis_runtime_data`, and `bootstrap_admin_data`, but never `runtime_secrets_data`.

## Network boundary checks

```bash
docker inspect "$(docker compose ps -q app)" --format '{{json .NetworkSettings.Networks}}'
docker inspect "$(docker compose ps -q go-business-api)" --format '{{json .NetworkSettings.Networks}}'
docker inspect "$(docker compose ps -q postgres)" --format '{{json .NetworkSettings.Networks}}'
docker inspect "$(docker compose ps -q redis)" --format '{{json .NetworkSettings.Networks}}'
```

Expected:

- `app`: `public-network`, `app-network` only;
- `go-business-api`: `app-network`, `provider-network`, `database-network`, `cache-network`;
- `postgres`: `database-network` only;
- `redis`: `cache-network` only;
- `worker-forwarding`: `provider-network`, `database-network`;
- `worker-retention`: `database-network` only.

Any public gateway membership in `database-network` or `cache-network` is a release blocker.

## Bootstrap administrator problems

Retrieve the credential only when the account still requires first-password rotation:

```bash
docker compose exec go-business-api sh -lc \
  "grep '^ADMIN_USERNAME=' /var/lib/all-mail/bootstrap-admin.env && \
   grep '^ADMIN_PASSWORD=' /var/lib/all-mail/bootstrap-admin.env"
```

After successful rotation:

```bash
docker compose exec -T go-business-api sh -lc \
  'test ! -e /var/lib/all-mail/bootstrap-admin.env'
```

During an upgrade, the initializer moves an old credential from `runtime_secrets_data` to `bootstrap_admin_data`. A conflict intentionally stops startup rather than choosing one plaintext password.

## Browser credential incident

Current releases never store or prefill portal-user passwords. On first load, the management and portal login pages remove keys with the historical `all-mail:portal-login:` prefix.

For a browser used with an affected older release:

1. deploy the fixed revision;
2. reload the admin and portal pages once;
3. clear site data manually if the browser cannot access storage during cleanup;
4. rotate any portal password that may have been exposed to an untrusted extension, shared profile, or XSS.

Do not send passwords in login URLs. Portal links may contain only `username`.

## Worker failures

```bash
docker compose logs --tail=300 worker-forwarding
docker compose logs --tail=300 worker-retention
docker compose exec -T worker-forwarding allmail doctor worker forwarding
docker compose exec -T worker-retention allmail doctor worker retention
```

Do not delete heartbeat files while diagnosing a running process. Confirm lease, run timeout, shutdown timeout, database availability, and provider credentials.

## Backup and restore

Back up PostgreSQL and the matching application revision plus:

```text
runtime_secrets_data
bootstrap_admin_data
forwarding_runtime_data
go_business_runtime_data
redis_runtime_data
redis_data
```

Restore all matching state before startup. A database restored without JWT/encryption state can invalidate sessions or make ciphertext unreadable. A missing Redis password export prevents Redis and the private API from becoming ready; rerunning the matching initializer safely recreates the export from `runtime_secrets_data`.

## Rollback

```bash
docker compose down
git switch <known-good-compatible-tag-or-commit>
# Restore the matching database and secret volumes when required.
./scripts/compose-up.sh
```

Never run two revisions against one persisted state, never use an arbitrary old image with a newer schema, and never run `docker compose down -v` during recovery unless destruction is intended.
