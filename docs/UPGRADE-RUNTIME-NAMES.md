# Runtime service-name upgrade

This guide applies when upgrading from a revision that used the migration-era names `legacy-init`, `legacy-api`, `LEGACY_API_URL`, and `Dockerfile.legacy`.

## What changes

| Previous name | Current name |
| --- | --- |
| `legacy-init` | `business-init` |
| `legacy-api` | `business-api` |
| `LEGACY_API_URL` | `BUSINESS_API_URL` |
| `ALL_MAIL_LEGACY_IMAGE` | `ALL_MAIL_SERVER_IMAGE` |
| `Dockerfile.legacy` | `Dockerfile.server` |
| `ALL_MAIL_ALLOW_LEGACY_DB_PUSH_REPAIR` | Removed; the Go initializer has no `db push` fallback |

The logical Compose volume is now `runtime_secrets_data`, but its explicit physical name remains:

```text
${COMPOSE_PROJECT_NAME}_legacy_runtime_data
```

This is intentional. Existing `runtime-secrets.env`, `bootstrap-admin.env`, JWT signing state, and the encryption key are reused without copying the volume.

## Before upgrading

Back up PostgreSQL and inspect the existing secret volume. Do not delete volumes and do not run initializers from two revisions at the same time.

```bash
docker compose ps -a
docker volume ls | grep '_legacy_runtime_data$'
```

Keep the same `COMPOSE_PROJECT_NAME` used by the existing installation. Changing the project name selects a different physical volume.

## Apply the upgrade

After switching to the new revision, use `--remove-orphans` so containers created under the removed service names do not remain running:

```bash
docker compose config --quiet
docker compose up -d --build --remove-orphans --wait --wait-timeout 300
docker compose ps -a
```

Expected long-running services:

```text
app
business-api
worker-forwarding
worker-retention
postgres
redis
```

Expected one-shot services:

```text
business-init
```

Confirm the old service containers are absent:

```bash
! docker compose ps -a --format '{{.Service}}' | grep -Eq '^(legacy-api|legacy-init)$'
```

## Verify persisted state

```bash
docker compose exec -T business-api sh -lc '
  test -r /var/lib/all-mail/runtime-secrets.env
  sed -n "s/=.*$/=<redacted>/p" /var/lib/all-mail/runtime-secrets.env
'

docker compose exec -T app allmail doctor api
docker compose exec -T worker-forwarding allmail doctor worker forwarding
docker compose exec -T worker-retention allmail doctor worker retention
```

The runtime secret file must contain the same long-lived keys used before the rename. Do not regenerate `JWT_SECRET` or `ENCRYPTION_KEY` during this service-name-only cutover.

## Schema adoption

`business-init` is now the Go initializer. It adopts a known checksum-matching Prisma history or a ledgerless database whose complete catalog matches the owned-schema fingerprint. Unknown, unresolved, gapped, or drifted histories stop without a Prisma or `db push` fallback.

## Rollback

Stop the complete new revision before starting an older one. The physical secret volume is unchanged, but the older revision expects the previous service and variable names.

```bash
docker compose down
git switch <previous-known-good-revision>
docker compose up -d --build --remove-orphans --wait --wait-timeout 300
```

Never use `docker compose down -v` during an upgrade or rollback unless the persisted database and secret state are intentionally being destroyed.
