# Deployment guide

## Boundary

This is the authoritative production startup, update, smoke-check, restore, and rollback guide for `all-Mail`.

- Use [`RUNBOOK.md`](./RUNBOOK.md) for troubleshooting and recovery.
- Use [`ENVIRONMENT.md`](./ENVIRONMENT.md) for variable and secret ownership.
- Use [`GO-MIGRATION.md`](./GO-MIGRATION.md) for completed route migration and schema compatibility.
- Use [`../CLOUDFLARE-DEPLOY.md`](../CLOUDFLARE-DEPLOY.md) for Worker ingress.

## Supported topology

Docker Compose is the only supported production topology. It has exactly these long-running services:

```text
app
go-business-api
worker-forwarding
worker-retention
postgres
redis
```

Only `app` is host-published. `go-business-api`, PostgreSQL, and Redis stay private to the Compose network.

```text
client / reverse proxy
        |
        v
app: Go public gateway + React SPA
        |
        v
go-business-api: private Go business routes
        |
        +---- PostgreSQL
        +---- Redis

worker-forwarding ---- PostgreSQL + providers
worker-retention ----- PostgreSQL
```

Initialization is a temporary `app init` container created by the startup helper. It is not a Compose service and does not remain in `docker compose ps`.

## Prepare the environment

```bash
cp .env.example .env
openssl rand -hex 24
```

Set the generated value as `POSTGRES_PASSWORD`. It has no production default.

One-time administrator inputs:

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=
```

Leave `ADMIN_PASSWORD` blank to generate a strong temporary password. The helper supplies these values only to the temporary initializer; long-running services do not receive them.

For a trusted tunnel or reverse proxy:

```env
TRUSTED_PROXY_CIDRS=<direct-peer-cidrs>
```

List only peers connected directly to `app`. Never trust `0.0.0.0/0` or `::/0`.

## Start

Validate the Compose model, then use the canonical helper:

```bash
docker compose config --quiet
./scripts/compose-up.sh
docker compose ps -a
```

For a non-default environment file:

```bash
ALL_MAIL_ENV_FILE=/path/to/all-mail.env ./scripts/compose-up.sh
```

The helper performs this sequence:

1. require the selected environment file;
2. start and wait for `postgres`;
3. build the shared Go image through the `app` service;
4. resolve `runtime_secrets_data`, `forwarding_runtime_data`, and `go_business_runtime_data`;
5. run a temporary privileged `app init` container with only the capabilities and mounts needed to initialize files;
6. adopt or apply schema history, initialize secrets, import one-shot durable configuration, verify ciphertext, and bootstrap the first administrator;
7. start and wait for `app`, `go-business-api`, `worker-forwarding`, `worker-retention`, `postgres`, and `redis`.

Override the final wait bound with `ALL_MAIL_WAIT_TIMEOUT` when necessary.

## Verify service and network ownership

```bash
test "$(docker compose exec -T app id -u)" = "10001"
test "$(docker compose exec -T go-business-api id -u)" = "10001"
test "$(docker compose exec -T worker-forwarding id -u)" = "10001"
test "$(docker compose exec -T worker-retention id -u)" = "10001"

for service in \
  app go-business-api worker-forwarding worker-retention postgres redis; do
  docker compose ps --services --filter status=running | grep -qx "$service"
done

docker compose port app 3000
! docker compose port go-business-api 3200
! docker compose port postgres 5432
! docker compose port redis 6379
```

## Verify secret separation

The managed long-lived file is on `runtime_secrets_data` and is visible inside `go-business-api` at:

```text
/var/lib/all-mail/runtime-secrets.env
```

Inspect names without printing values:

```bash
docker compose exec go-business-api sh -lc '
  test -r /var/lib/all-mail/runtime-secrets.env
  sed -n "s/=.*$/=<redacted>/p" /var/lib/all-mail/runtime-secrets.env
  test ! -e /var/lib/all-mail/bootstrap-secrets.env
'
```

The file contains only `JWT_SECRET` and `ENCRYPTION_KEY`; it must not contain administrator credentials.

Retrieve the one-time administrator credential separately:

```bash
docker compose exec go-business-api sh -lc \
  "grep '^ADMIN_USERNAME=' /var/lib/all-mail/bootstrap-admin.env && \
   grep '^ADMIN_PASSWORD=' /var/lib/all-mail/bootstrap-admin.env"
```

The private API receives read-only least-privilege exports and no raw secret environment values:

```bash
docker compose exec go-business-api sh -lc '
  test -n "${DATABASE_URL:-}"
  test "${REDIS_URL:-}" = "redis://redis:6379"
  test -r /var/lib/all-mail-secrets/jwt-secret
  test -r /var/lib/all-mail-encryption/encryption-key
  test -z "${JWT_SECRET:-}"
  test -z "${ENCRYPTION_KEY:-}"
  test -z "${ADMIN_PASSWORD:-}"
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

The forwarding worker receives only its read-only key file:

```bash
docker compose exec worker-forwarding sh -lc '
  test -r /var/lib/all-mail-secrets/encryption-key
  test -z "${ENCRYPTION_KEY:-}"
'
```

## First login

1. Retrieve `bootstrap-admin.env` through `go-business-api`.
2. Log in through `app`.
3. Confirm the account requires a password change.
4. Change the password.
5. Confirm the one-time file was removed:

```bash
docker compose exec go-business-api sh -lc \
  'test ! -e /var/lib/all-mail/bootstrap-admin.env'
```

Running `./scripts/compose-up.sh` again is idempotent: initialization does not create a second administrator or restore the consumed plaintext credential.

## Health and readiness

```bash
curl http://127.0.0.1:3002/health
curl http://127.0.0.1:3002/livez
curl --fail http://127.0.0.1:3002/readyz

docker compose exec -T app allmail doctor api
docker compose exec -T go-business-api allmail doctor business-api
docker compose exec -T worker-forwarding allmail doctor worker forwarding
docker compose exec -T worker-retention allmail doctor worker retention
```

`/health` reports public-process and route-manifest identity. `/livez` is the liveness probe. Public `/readyz` requires the built SPA and the private Go business service. Private readiness performs real PostgreSQL and Redis protocol checks. Worker doctors validate heartbeat identity, process liveness, freshness, run duration, and last error state.

Inspect active route ownership and the committed manifest digest with:

```bash
docker compose exec -T app allmail routes
```

## Local development

Use the development overlay only for PostgreSQL and Redis host access:

```bash
./bin/all-mail deps up
npm run dev:api
npm run dev:web
```

The private API requires a separately initialized local state directory and explicit secret-file paths. Follow [`advanced-runtime.md`](./advanced-runtime.md); local source processes do not reproduce the complete production topology.

## Schema guarantees

- The temporary initializer is the only production startup role that mutates schema, initializes secrets, imports compatibility configuration, or creates the first administrator.
- `allmail migrate` is the schema-only operational entrypoint.
- Long-running services never migrate schema or create administrators at startup.
- Applied migration histories are checksummed and immutable.
- Known databases created before the Go-only cutover are adopted only when the former ledger or complete catalog fingerprint matches.
- Unknown, unresolved, gapped, checksum-mismatched, or structurally drifted histories fail closed; there is no schema-push fallback.

## Upgrade

Back up PostgreSQL, `.env`, and all secret volumes before switching revisions. Stop the previous stack and do not run two revisions concurrently.

```bash
docker compose down
git switch <target-tag-or-commit>
./scripts/compose-up.sh
docker compose ps -a
```

Use `--remove-orphans` once when upgrading from a revision with retired service names:

```bash
docker compose down --remove-orphans
./scripts/compose-up.sh
```

After verification, remove populated one-shot import values from `.env`; keep only the long-running policy values documented in [`ENVIRONMENT.md`](./ENVIRONMENT.md).

## Backup and restore

Treat these as one backup unit:

- PostgreSQL;
- `.env` and the exact application revision;
- `runtime_secrets_data`;
- `forwarding_runtime_data`;
- `go_business_runtime_data`.

Redis is persistent operational state and should also be preserved when the deployment requires OAuth, replay, or rate-limit continuity.

To restore:

```bash
docker compose down
git switch <matching-tag-or-commit>
# Restore PostgreSQL and the matching named volumes with the platform backup tool.
./scripts/compose-up.sh
```

Do not run the helper before all matching persisted state has been restored.

## Rollback

Rollback is revision based:

```bash
docker compose down
git switch <known-good-compatible-tag-or-commit>
./scripts/compose-up.sh
```

An application-only rollback is valid only when the target revision explicitly supports the current schema and authentication state. Otherwise restore the PostgreSQL and secret-volume backup captured for that revision before starting it. Never use `docker compose down -v` during upgrade, restore, or rollback unless permanent data destruction is intended.

Historical compatibility tables may allow an immediate rollback to a declared compatible revision. Their presence does not make arbitrary older images safe and does not indicate an active legacy runtime.
