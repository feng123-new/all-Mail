# Deployment guide

## Boundary

This is the authoritative production startup, update, smoke-check and rollback guide.

- Use [`RUNBOOK.md`](./RUNBOOK.md) for troubleshooting.
- Use [`ENVIRONMENT.md`](./ENVIRONMENT.md) for variable and secret ownership.
- Use [`GO-MIGRATION.md`](./GO-MIGRATION.md) for runtime ownership.
- Use [`../CLOUDFLARE-DEPLOY.md`](../CLOUDFLARE-DEPLOY.md) for Worker ingress.

## Supported topology

Docker Compose is the only supported production topology.

Long-running services:

```text
app
worker-forwarding
worker-retention
legacy-api
postgres
redis
```

One-shot services:

```text
legacy-init
go-migrate
```

Only `app` is published. PostgreSQL, Redis and Fastify remain private.

## Prepare the environment

```bash
cp .env.example .env
```

Set `POSTGRES_PASSWORD` before Compose evaluation. It must contain at least 24 URL-safe characters; `openssl rand -hex 24` is a suitable generator. Configure public URL, proxy CIDRs, OAuth fallbacks, or ingress values as needed.

One-shot administrator inputs:

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=
```

Leave the password blank to generate a strong temporary password. These values are passed only to `legacy-init`, not the long-running API.

For a trusted tunnel/reverse proxy:

```env
TRUSTED_PROXY_CIDRS=<direct-peer-cidrs>
```

Never trust `0.0.0.0/0` or `::/0`.

## Start

```bash
docker compose config --quiet
docker compose up -d --build --wait --wait-timeout 300
docker compose ps -a
```

Expected sequence:

1. PostgreSQL and Redis become healthy.
2. `legacy-init` waits only for PostgreSQL.
3. It migrates any old combined secret bundle into separate runtime/admin files.
4. It loads or generates long-lived JWT/encryption secrets.
5. It exports only the forwarding encryption key; long-running Fastify later requires the existing secret file and cannot regenerate it.
6. It applies Prisma migrations.
7. It acquires an administrator-bootstrap advisory lock and creates the first DB administrator only when none exists.
8. `go-migrate` applies additive Go migrations.
9. `legacy-api`, `app`, and both workers become healthy.

## Verify service and network ownership

```bash
test "$(docker compose exec -T legacy-api id -u)" = "10001"
for service in app worker-forwarding worker-retention legacy-api postgres redis; do
  docker compose ps --services --filter status=running | grep -qx "$service"
done

docker compose port app 3000
! docker compose port postgres 5432
! docker compose port redis 6379
```

## Verify secret separation

Long-lived secrets:

```bash
docker compose exec legacy-api sh -lc \
  'test -r /var/lib/all-mail/runtime-secrets.env && cat /var/lib/all-mail/runtime-secrets.env'
```

That file must contain only `JWT_SECRET` and `ENCRYPTION_KEY`; it must not contain administrator credentials.

One-time administrator credential:

```bash
docker compose exec legacy-api sh -lc \
  "grep '^ADMIN_USERNAME=' /var/lib/all-mail/bootstrap-admin.env && \
   grep '^ADMIN_PASSWORD=' /var/lib/all-mail/bootstrap-admin.env"
```

Removed old bundle:

```bash
docker compose exec legacy-api sh -lc \
  'test ! -e /var/lib/all-mail/bootstrap-secrets.env'
```

Long-running API isolation:

```bash
docker compose exec legacy-api sh -lc '
  test -z "${ADMIN_USERNAME:-}"
  test -z "${ADMIN_PASSWORD:-}"
  test -z "${DOMAIN_BOOTSTRAP_ADMIN_USERNAME:-}"
  test -z "${DOMAIN_BOOTSTRAP_ADMIN_PASSWORD:-}"
  test -z "${ADMIN_2FA_SECRET:-}"
  test -n "${BOOTSTRAP_ADMIN_SECRET_FILE:-}"
'
```

Forwarding receives only its read-only key file at `/var/lib/all-mail-secrets/encryption-key`:

```bash
docker compose exec worker-forwarding sh -lc '
  test -r /var/lib/all-mail/encryption-key
  test -z "${ENCRYPTION_KEY:-}"
'
```

## First login and password retirement

1. Retrieve the credential from `bootstrap-admin.env`.
2. Log in through the public Go gateway.
3. The returned administrator must have `mustChangePassword=true`.
4. Change the password from the settings page before using other protected routes.
5. Confirm the one-time file is gone:

```bash
docker compose exec legacy-api sh -lc \
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
docker compose run --rm legacy-init
docker compose exec legacy-api sh -lc \
  'test ! -e /var/lib/all-mail/bootstrap-admin.env'
```

## Health checks

```bash
curl http://127.0.0.1:3002/health
curl --fail http://127.0.0.1:3002/readyz

docker compose exec -T app allmail doctor api
docker compose exec -T worker-forwarding allmail doctor worker forwarding
docker compose exec -T worker-retention allmail doctor worker retention

docker compose exec -T legacy-api node -e \
  "fetch('http://127.0.0.1:' + (process.env.PORT || 3100) + '/readyz').then(async (r) => { console.log(await r.text()); process.exit(r.ok ? 0 : 1); }).catch(() => process.exit(1))"
```

The public Go app has no database or Redis credentials. It checks the built SPA and Fastify readiness; Fastify owns PostgreSQL/Redis protocol checks.

## Proxy identity smoke

From an untrusted direct client, forged headers must not become login/audit IP state:

```bash
curl -H 'X-Forwarded-For: 203.0.113.99' \
  -H 'X-Real-IP: 203.0.113.100' \
  http://127.0.0.1:3002/health
```

Use a controlled login attempt to verify persisted IP data reflects the direct peer or a trusted tunnel-provided identity.

## Local Fastify development

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis
cp server/.env.example server/.env
npm --prefix server run db:migrate
ADMIN_USERNAME=admin \
ADMIN_PASSWORD=change-me-now \
BOOTSTRAP_ADMIN_SECRET_FILE=.all-mail-runtime/bootstrap-admin.env \
npm --prefix server run bootstrap:admin
npm run dev:api
```

`server/.env` contains no administrator username/password. The bootstrap command is explicit and one-shot.

## Migration expectations

- `legacy-init` is the only Docker role that runs Prisma migrations and administrator bootstrap.
- `go-migrate` is the only role that applies numbered Go migrations.
- Long-running services never mutate schema or create administrators at startup.
- Applied Go migrations are checksummed and immutable.
- P3009 requires manual recovery.
- P3005 does not silently fall back to `db push`.

Reviewed P3005 compatibility repair only:

```bash
docker compose run --rm \
  -e ALL_MAIL_ALLOW_LEGACY_DB_PUSH_REPAIR=true \
  legacy-init
```

## Upgrade from the old secret layout

Before upgrading:

1. back up PostgreSQL;
2. preserve the legacy runtime volume containing `bootstrap-secrets.env`;
3. record the current administrator username and whether the initial password is still pending;
4. deploy and inspect `legacy-init` logs;
5. verify `runtime-secrets.env` and, when appropriate, `bootstrap-admin.env`;
6. verify the old bundle was removed only after split migration;
7. complete password rotation if still pending.

The initializer uses password-hash matching to recover the correct username for historical deployments that used non-default bootstrap username aliases.

## Update an existing deployment

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

Rollback is revision based:

```bash
docker compose down
git switch <known-good-tag-or-commit>
docker compose up -d --build --wait --wait-timeout 300
```

This revision changes secret-file layout. Preserve:

```text
runtime-secrets.env
bootstrap-admin.env
pre-upgrade backup of bootstrap-secrets.env
PostgreSQL backup
```

Restore the layout expected by the target revision before startup. Do not run initializers or workers from two revisions against the same persisted state.
