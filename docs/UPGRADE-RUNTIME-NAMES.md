# Go-only runtime and secret-boundary upgrade

This guide covers upgrades from earlier service names or the pre-isolation secret layout into the current Go-only stack.

## Current services

```text
app
go-business-api
worker-forwarding
worker-retention
postgres
redis
```

Historical `legacy-*` and `business-*` API/init services are removed. Initialization is a temporary `app init` run from `./scripts/compose-up.sh`.

## Preserved master volume

The logical volume `runtime_secrets_data` retains the physical name:

```text
${COMPOSE_PROJECT_NAME}_legacy_runtime_data
```

The stable physical name preserves JWT and encryption state for in-place upgrades. The current initializer also adds a generated Redis password to that master file.

Before this boundary change, `bootstrap-admin.env` could live beside the master secret bundle. The current release introduces:

```text
bootstrap_admin_data
redis_runtime_data
```

During the first startup, the initializer:

1. reads the existing master volume at `/var/lib/all-mail-state`;
2. creates or reuses `REDIS_PASSWORD` without rotating JWT or encryption keys;
3. exports the Redis password to `redis_runtime_data`;
4. copies any unconsumed bootstrap credential into `bootstrap_admin_data`;
5. rejects conflicting source and target bootstrap credentials;
6. removes the old plaintext bootstrap copy after a successful migration;
7. writes a non-secret `*_FILE` reference manifest for compatibility checks.

No long-running service mounts `runtime_secrets_data` after this upgrade.

## Before upgrading

Back up PostgreSQL, `.env`, the exact revision, and existing volumes. Keep the same `COMPOSE_PROJECT_NAME`.

```bash
docker compose ps -a
docker volume ls | grep '_legacy_runtime_data$'
docker compose down
```

Preserve at least:

```text
postgres_data
runtime_secrets_data
forwarding_runtime_data
go_business_runtime_data
database_runtime_data
redis_data
```

## Apply the upgrade

```bash
git switch <target-tag-or-commit>
docker compose down --remove-orphans
./scripts/compose-up.sh
docker compose ps -a
```

The helper creates the new `bootstrap_admin_data` and `redis_runtime_data` volumes automatically.

## Verify

```bash
docker compose exec -T app allmail doctor api
docker compose exec -T go-business-api allmail doctor business-api
docker compose exec -T worker-forwarding allmail doctor worker forwarding
docker compose exec -T worker-retention allmail doctor worker retention

! docker compose port go-business-api 3200
! docker compose port postgres 5432
! docker compose port redis 6379
```

```bash
docker compose exec -T go-business-api sh -lc '
  test ! -e /var/lib/all-mail-state
  test -r /var/lib/all-mail-secrets/jwt-secret
  test -r /var/lib/all-mail-encryption/encryption-key
  test -r /var/lib/all-mail-redis/redis-password
  ! grep -Eq "^(JWT_SECRET|ENCRYPTION_KEY|REDIS_PASSWORD)=" /var/lib/all-mail/runtime-secrets.env
'
```

If the administrator still requires first-password rotation, retrieve `/var/lib/all-mail/bootstrap-admin.env` from `go-business-api`. After rotation, the file must be absent.

## Rollback

Stop the complete current revision before starting an older one. An older revision may not understand Redis authentication or the split bootstrap volume. Roll back only to a revision explicitly compatible with the current schema and secret state, or restore the matching database and volume backup first.

Never use `docker compose down -v` during upgrade or rollback unless permanent data destruction is intended.
