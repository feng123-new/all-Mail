# Go-only runtime upgrade

This guide applies when upgrading an existing installation across earlier runtime naming and topology revisions into the current Go-only stack.

## Historical names

Earlier migration revisions used these names:

| Historical surface | Later migration-era surface | Current status |
| --- | --- | --- |
| `legacy-init` | `business-init` | Removed; initialization is a temporary `app init` run |
| `legacy-api` | `business-api` | Removed; all business routes use `go-business-api` |
| `LEGACY_API_URL` | `BUSINESS_API_URL` | Removed; only `GO_BUSINESS_API_URL` remains internal |
| `ALL_MAIL_LEGACY_IMAGE` | `ALL_MAIL_SERVER_IMAGE` | Removed; all Go services share one image |
| `Dockerfile.legacy` | `Dockerfile.server` | Removed; production uses `Dockerfile` |
| `ALL_MAIL_ALLOW_LEGACY_DB_PUSH_REPAIR` | no replacement | Removed; schema adoption fails closed |

These names are historical upgrade context, not current commands or configuration.

## Preserved physical volume

The logical Compose volume is `runtime_secrets_data`, but its explicit physical name remains:

```text
${COMPOSE_PROJECT_NAME}_legacy_runtime_data
```

The physical name is intentionally stable so existing `runtime-secrets.env`, `bootstrap-admin.env`, JWT signing state, and encryption state are reused in place. It does not imply a live legacy service.

Keep the same `COMPOSE_PROJECT_NAME`. Changing it selects a different physical volume.

## Before upgrading

Back up PostgreSQL and every secret volume. Do not delete volumes and do not run two revisions at the same time.

```bash
docker compose ps -a
docker volume ls | grep '_legacy_runtime_data$'
docker compose down
```

Preserve:

```text
postgres_data
runtime_secrets_data
forwarding_runtime_data
go_business_runtime_data
```

Preserve Redis as well when OAuth, replay, or rate-limit continuity matters.

## Apply the upgrade

After switching to the Go-only revision, remove containers created by retired services, then use the canonical helper:

```bash
git switch <target-tag-or-commit>
docker compose down --remove-orphans
./scripts/compose-up.sh
docker compose ps -a
```

Expected long-running services:

```text
app
go-business-api
worker-forwarding
worker-retention
postgres
redis
```

There is no one-shot Compose service. The helper runs initialization in a temporary `app init` container.

Confirm retired containers are absent:

```bash
! docker compose ps -a --format '{{.Service}}' | \
  grep -Eq '^(legacy-api|legacy-init|business-api|business-init)$'
```

## Verify persisted state

```bash
docker compose exec -T go-business-api sh -lc '
  test -r /var/lib/all-mail/runtime-secrets.env
  sed -n "s/=.*$/=<redacted>/p" /var/lib/all-mail/runtime-secrets.env
'

docker compose exec -T app allmail doctor api
docker compose exec -T go-business-api allmail doctor business-api
docker compose exec -T worker-forwarding allmail doctor worker forwarding
docker compose exec -T worker-retention allmail doctor worker retention
```

Do not regenerate `JWT_SECRET` or `ENCRYPTION_KEY` during the topology upgrade. The database and all secret volumes must come from the same backup set.

## Historical schema adoption

The Go initializer adopts a known checksum-matching former Prisma history or a ledgerless database whose complete catalog matches the owned-schema fingerprint. Unknown, unresolved, gapped, or drifted histories stop without an active Prisma tool or schema-push fallback.

## Rollback

Stop the complete Go-only revision before starting an older one. Use an older revision only if it explicitly supports the current schema and authentication state. Otherwise restore the PostgreSQL and secret-volume backup captured for that revision.

```bash
docker compose down
git switch <previous-known-good-revision>
# Restore matching PostgreSQL and secret volumes when required.
# Follow that revision's startup documentation.
```

Never use `docker compose down -v` during upgrade or rollback unless persisted state is intentionally being destroyed.
