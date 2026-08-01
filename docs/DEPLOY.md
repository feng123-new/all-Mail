# Deployment guide

## Boundary

This is the authoritative production startup, update, smoke-check, and rollback guide for `all-Mail`.

- Use [`RUNBOOK.md`](./RUNBOOK.md) for troubleshooting and recovery.
- Use [`ENVIRONMENT.md`](./ENVIRONMENT.md) for variable and secret ownership.
- Use [`GO-MIGRATION.md`](./GO-MIGRATION.md) for route and runtime ownership.
- Use [`../CLOUDFLARE-DEPLOY.md`](../CLOUDFLARE-DEPLOY.md) for Worker ingress.

## Supported topology

Docker Compose is the only supported production topology.

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
```

Only `app` is host-published. Both business APIs, PostgreSQL, and Redis stay private to the Compose network.

```text
client / reverse proxy
        |
        v
app: Go public gateway + React
        |
        +-----------------------------+
        |                             |
        v                             v
go-business-api                  business-api
private migrated Go routes       remaining Fastify/Prisma routes
        |                             |
        +-------------+---------------+
                      |
                PostgreSQL + Redis
```

The public `app` has no database URL, Redis URL, JWT secret, encryption key, OAuth credential, ingress signing secret, or provider credential.

## Prepare the environment

```bash
cp .env.example .env
```

Set `POSTGRES_PASSWORD` before Compose evaluation. It must contain at least 24 URL-safe characters. A suitable generator is:

```bash
openssl rand -hex 24
```

One-shot administrator inputs:

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=
```

Leave `ADMIN_PASSWORD` blank to generate a strong temporary password. These values are supplied only to `business-init`, not to either long-running business API.

For a trusted tunnel or reverse proxy:

```env
TRUSTED_PROXY_CIDRS=<direct-peer-cidrs>
```

List only the peers that connect directly to `app`. Never trust `0.0.0.0/0` or `::/0`.

## Start

```bash
docker compose config --quiet
docker compose up -d --build --wait --wait-timeout 300
docker compose ps -a
```

Expected sequence:

1. PostgreSQL and Redis become healthy.
2. `business-init` waits for PostgreSQL.
3. It migrates any old combined secret bundle into separate runtime and administrator files.
4. It loads or generates the long-lived JWT and encryption secrets.
5. It exports a read-only forwarding encryption-key file and a separate read-only JWT file for `go-business-api`.
6. It executes or adopts the immutable Prisma history, applies numbered Go migrations, and validates the complete owned-catalog fingerprint.
7. It authenticates every historical ciphertext category, imports durable compatibility configuration, and bootstraps the first database administrator under advisory locks.
8. It publishes the forwarding encryption key and Go-business JWT only after the database phases pass.
9. `business-api` and `go-business-api` become healthy.
10. `app` aggregates both private upstreams and becomes healthy; both Go workers become healthy.

## Verify service and network ownership

```bash
test "$(docker compose exec -T business-api id -u)" = "10001"
test "$(docker compose exec -T go-business-api id -u)" = "10001"

for service in \
  app go-business-api business-api \
  worker-forwarding worker-retention postgres redis; do
  docker compose ps --services --filter status=running | grep -qx "$service"
done

docker compose port app 3000
! docker compose port go-business-api 3200
! docker compose port business-api 3100
! docker compose port postgres 5432
! docker compose port redis 6379
```

## Verify secret separation

Long-lived Fastify secrets:

```bash
docker compose exec business-api sh -lc '
  test -r /var/lib/all-mail/runtime-secrets.env
  sed -n "s/=.*$/=<redacted>/p" /var/lib/all-mail/runtime-secrets.env
'
```

That file contains only `JWT_SECRET` and `ENCRYPTION_KEY`; it must not contain administrator credentials.

One-time administrator credential:

```bash
docker compose exec business-api sh -lc \
  "grep '^ADMIN_USERNAME=' /var/lib/all-mail/bootstrap-admin.env && \
   grep '^ADMIN_PASSWORD=' /var/lib/all-mail/bootstrap-admin.env"
```

Removed old bundle:

```bash
docker compose exec business-api sh -lc \
  'test ! -e /var/lib/all-mail/bootstrap-secrets.env'
```

Long-running Fastify isolation:

```bash
docker compose exec business-api sh -lc '
  test -z "${ADMIN_USERNAME:-}"
  test -z "${ADMIN_PASSWORD:-}"
  test -z "${DOMAIN_BOOTSTRAP_ADMIN_USERNAME:-}"
  test -z "${DOMAIN_BOOTSTRAP_ADMIN_PASSWORD:-}"
  test -z "${ADMIN_2FA_SECRET:-}"
  test -n "${BOOTSTRAP_ADMIN_SECRET_FILE:-}"
'
```

The private Go business service receives PostgreSQL, Redis, and read-only JWT/encryption files, but no raw secret environment value:

```bash
docker compose exec go-business-api sh -lc '
  test -n "${DATABASE_URL:-}"
  test "${REDIS_URL:-}" = "redis://redis:6379"
  test -r /var/lib/all-mail-secrets/jwt-secret
  test -r /var/lib/all-mail-encryption/encryption-key
  test -z "${JWT_SECRET:-}"
  test -z "${ENCRYPTION_KEY:-}"
  test -z "${INGRESS_SIGNING_SECRET:-}"
'
```

The public gateway remains credential-free:

```bash
docker compose exec app sh -lc '
  test -z "${DATABASE_URL:-}"
  test -z "${REDIS_URL:-}"
  test -z "${JWT_SECRET:-}"
  test -z "${ENCRYPTION_KEY:-}"
'
```

Forwarding receives only its read-only key file:

```bash
docker compose exec worker-forwarding sh -lc '
  test -r /var/lib/all-mail-secrets/encryption-key
  test -z "${ENCRYPTION_KEY:-}"
'
```

## First login and password retirement

1. Retrieve the credential from `bootstrap-admin.env`.
2. Log in through the public Go gateway.
3. Confirm the returned administrator has `mustChangePassword=true`.
4. Change the password before using other protected routes.
5. Confirm the one-time file is gone:

```bash
docker compose exec business-api sh -lc \
  'test ! -e /var/lib/all-mail/bootstrap-admin.env'
```

6. Confirm database state:

```bash
docker compose exec postgres psql \
  -U "${POSTGRES_USER:-allmail}" \
  -d "${POSTGRES_DB:-allmail}" \
  -Atqc 'SELECT username, must_change_password FROM admins ORDER BY id'
```

Re-running the initializer must not create another administrator or restore plaintext:

```bash
docker compose run --rm business-init
docker compose exec business-api sh -lc \
  'test ! -e /var/lib/all-mail/bootstrap-admin.env'
```

## Health checks

```bash
curl http://127.0.0.1:3002/health
curl --fail http://127.0.0.1:3002/readyz

docker compose exec -T app allmail doctor api
docker compose exec -T go-business-api allmail doctor business-api
docker compose exec -T worker-forwarding allmail doctor worker forwarding
docker compose exec -T worker-retention allmail doctor worker retention

docker compose exec -T business-api node -e \
  "fetch('http://127.0.0.1:' + (process.env.PORT || 3100) + '/readyz').then(async (r) => { console.log(await r.text()); process.exit(r.ok ? 0 : 1); }).catch(() => process.exit(1))"
```

Public `/readyz` requires the route manifest, built SPA, `go-business-api`, and `business-api`. The two private business services perform their own PostgreSQL and Redis protocol checks for the state they actively use.

Inspect active route ownership and the committed manifest digest:

```bash
docker compose exec -T app allmail routes
```

## Proxy identity smoke

From an untrusted direct client, forged forwarding headers must not become login or audit IP state:

```bash
curl -H 'X-Forwarded-For: 203.0.113.99' \
  -H 'X-Real-IP: 203.0.113.100' \
  http://127.0.0.1:3002/health
```

Use a controlled login attempt to confirm persisted IP data reflects the direct peer or a trusted tunnel-provided identity.

## Local development

Start the private dependencies explicitly:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis
```

Fastify development remains available while its routes are still active:

```bash
cp server/.env.example server/.env
(cd core && \
  DATABASE_URL='<local-postgresql-url>' \
  ALL_MAIL_MIGRATION_DIR="$PWD/migrations" \
  ALL_MAIL_STATE_DIR="$PWD/../.all-mail-runtime" \
  ADMIN_USERNAME=admin \
  ADMIN_PASSWORD=change-me-now \
  go run ./cmd/allmail init)
npm run dev:api
```

`server/.env` contains no administrator username or password. The Go initializer is explicit and one-shot.

## Migration expectations

- `business-init` is the only Docker role that mutates schema, initializes secrets, imports compatibility configuration, or bootstraps an administrator.
- `allmail migrate` is the schema-only operational entrypoint and uses the same Go-owned history and ledger.
- Long-running services never mutate schema or create administrators at startup.
- Applied Prisma-history and Go migrations are checksummed and immutable.
- Existing Prisma ledgers must be a known checksum-matching prefix; ledgerless databases must match the complete catalog fingerprint.
- Route ownership changes only through `config/route-ownership.json`.
- Unknown, unresolved, gapped, checksum-mismatched, or structurally drifted histories require backup-based/manual recovery; no `db push` fallback exists.

## Update an existing deployment

Before applying the administrator 2FA integrity constraint, confirm that no enabled administrator is missing its encrypted secret:

```bash
docker compose exec postgres psql \
  -U "${POSTGRES_USER:-allmail}" \
  -d "${POSTGRES_DB:-allmail}" \
  -c 'SELECT id, username FROM admins WHERE two_factor_enabled = true AND two_factor_secret IS NULL'
```

The query must return no rows. If it finds a row, restore the valid encrypted secret or disable 2FA through a controlled recovery before running migrations.

```bash
docker compose up -d --build --wait --wait-timeout 300
./bin/all-mail check
```

Remove obsolete keys from the real `.env`:

```text
DOMAIN_BOOTSTRAP_ADMIN_USERNAME
DOMAIN_BOOTSTRAP_ADMIN_PASSWORD
ADMIN_2FA_SECRET
```

`ADMIN_USERNAME` and `ADMIN_PASSWORD` remain one-shot initializer inputs only.

## Rollback

Rollback is revision based, but the administrator/mailbox authentication cutover establishes a Fastify compatibility floor. The revision that first makes `go-business-api` own administrator and mailbox authentication, while retaining database-backed compatibility handlers in `business-api`, is the oldest application revision that may use post-cutover authentication state.

After any mailbox user enables 2FA on the cutover revision, do not roll `business-api` back to the PR #35 image or any earlier revision while keeping the current PostgreSQL state. Those older handlers do not enforce mailbox TOTP or the cutover's revocable session version and can accept password-only or stale sessions.

For an application-only rollback, deploy a known-good revision at or above the authentication compatibility floor:

```bash
docker compose down
git switch <known-good-compatible-tag-or-commit>
docker compose up -d --build --wait --wait-timeout 300
```

To roll back below that floor, stop the entire stack and restore a PostgreSQL backup captured before the first mailbox 2FA mutation on the cutover revision. Restore the matching runtime secret volumes as well, then deploy the older application revision. A database restore is mandatory; changing only the image or Git revision is not a valid rollback below the floor.

The PR #37 schema head writes compatibility rows to `_prisma_migrations` and `runtime_migrations`, so a known-good PR #36-or-newer image can read this exact schema during the immediate rollback window. Any later Go-only migration needs its own backward-compatibility declaration; otherwise restore PostgreSQL.

Preserve the PostgreSQL backup and every runtime secret volume expected by the target revision. Database and secret-volume backups are one rollback unit. Do not run initializers, workers, or business APIs from two revisions against the same persisted state.
