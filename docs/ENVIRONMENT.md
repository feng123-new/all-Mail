# Environment and secret ownership

## Canonical operator surface

`.env.example` is the only production environment template. `config/runtime-env.json` defines its exact key set. Internal URLs, fixed paths, and secret-file mounts are owned by Compose and are intentionally absent from the operator template.

Production startup is:

```bash
cp .env.example .env
./scripts/compose-up.sh
```

`POSTGRES_PASSWORD` must be explicitly configured. JWT, encryption, and Redis authentication secrets may be left blank or absent from operator input because the initializer creates durable values.

The only non-template Compose substitutions are release/build launch controls: `ALL_MAIL_GO_IMAGE`, `ALL_MAIL_IMAGE_TAG`, `ALL_MAIL_VERSION`, `ALL_MAIL_COMMIT`, and `ALL_MAIL_BUILD_DATE`. They select or identify the complete application revision; they do not change business behavior or secret ownership.

## Process ownership

### Public gateway: `app`

The public process receives only gateway, metrics-access, and health configuration, including:

```text
GO_BUSINESS_API_URL=http://go-business-api:3200
TRUSTED_PROXY_CIDRS=
METRICS_ALLOWED_CIDRS=127.0.0.1/32,::1/128
READY_TIMEOUT_SECONDS=5
SHUTDOWN_TIMEOUT_SECONDS=15
```

`METRICS_ALLOWED_CIDRS` is evaluated against the direct TCP peer. Forwarded headers cannot grant metrics access, and allow-all CIDRs are rejected. It is independent from `TRUSTED_PROXY_CIDRS`; see [`OBSERVABILITY.md`](./OBSERVABILITY.md).

The gateway must not receive database, Redis, JWT, encryption, OAuth, ingress-signing, provider, or bootstrap secrets.

### Private API: `go-business-api`

Internal Compose values include:

```text
DATABASE_URL_FILE=/var/lib/all-mail-database/api-url
REDIS_URL=redis://redis:6379
REDIS_PASSWORD_FILE=/var/lib/all-mail-redis/redis-password
JWT_SECRET_FILE=/var/lib/all-mail-secrets/jwt-secret
ENCRYPTION_KEY_FILE=/var/lib/all-mail-encryption/encryption-key
BOOTSTRAP_ADMIN_SECRET_FILE=/var/lib/all-mail/bootstrap-admin.env
```

The loader reads the generated `allmail_api` URL from `DATABASE_URL_FILE` and injects the file-backed Redis password into the in-memory client URL. Production refuses to start without either file.

### `worker-forwarding`

Receives provider egress, forwarding policy, and read-only files for:

```text
DATABASE_URL_FILE=/var/lib/all-mail-database/forwarding-url
ENCRYPTION_KEY_FILE=/var/lib/all-mail-secrets/encryption-key
RESEND_API_BASE_URL=https://api.resend.com
```

The Resend base URL is fixed by the supported production Compose topology. It is not an operator `.env` setting, so an undeclared shell variable cannot silently redirect production delivery. Go tests and isolated source-development fixtures may still inject a local endpoint directly into the loader.

The forwarding worker receives no JWT or Redis credential.

### `worker-retention`

Receives retention policy and `DATABASE_URL_FILE=/var/lib/all-mail-database/retention-url`. It receives no JWT, encryption, Redis, provider, or database-owner credential.

### Temporary initializer

`app init` is the only process allowed to:

- generate or migrate runtime secrets;
- mutate schema;
- import compatibility configuration;
- create the first administrator;
- migrate the one-time bootstrap credential;
- provision and reconcile least-privilege PostgreSQL login roles;
- export least-privilege secret and database URL files.

Long-running processes never generate keys or migrate schema.

## Runtime database identities

`POSTGRES_USER` and `POSTGRES_PASSWORD` are schema-owner inputs used only by PostgreSQL and the temporary initializer. After schema migration the initializer idempotently reconciles three non-owner login roles:

- `allmail_api`: application-table CRUD and sequence use, without schema creation;
- `allmail_forwarding`: forwarding queue and inbound-message state plus the mailbox/domain configuration reads required for delivery;
- `allmail_retention`: select/delete plus the `UPDATE` privilege PostgreSQL requires for `FOR UPDATE SKIP LOCKED`, all on `api_logs` only.

Stale runtime grants are revoked before the canonical policy is reapplied. Long-running services receive a read-only `DATABASE_URL_FILE`; they never receive the owner URL or `POSTGRES_PASSWORD`.

## Durable secret volumes

### `runtime_secrets_data`

Preserved physical name:

```text
${COMPOSE_PROJECT_NAME}_legacy_runtime_data
```

Initializer-only master file:

```text
/var/lib/all-mail-state/runtime-secrets.env
  JWT_SECRET
  ENCRYPTION_KEY
  REDIS_PASSWORD
  DATABASE_API_PASSWORD
  DATABASE_FORWARDING_PASSWORD
  DATABASE_RETENTION_PASSWORD
```

No long-running service mounts this volume.

### `bootstrap_admin_data`

Mounted at `/var/lib/all-mail` only in the initializer and private API. It may contain:

```text
bootstrap-admin.env
runtime-secrets.env
```

`bootstrap-admin.env` is the one-time plaintext administrator credential and is deleted after successful forced password rotation. The second file is a non-secret reference manifest containing only `*_FILE` paths.

### `go_business_runtime_data`

```text
/var/lib/all-mail-secrets/jwt-secret
```

Read-only in `go-business-api`.

### `forwarding_runtime_data`

```text
encryption-key
```

Read-only in `go-business-api` and `worker-forwarding`, at separate target paths.

### `redis_runtime_data`

```text
redis-password
```

Read-only in `go-business-api` and `redis`. The Redis process starts with `requirepass`, and health checks authenticate using the file.

### `database_runtime_data`

```text
api-url
forwarding-url
retention-url
```

Each file contains the matching generated role URL and is mounted read-only only into its intended long-running service.

## Network ownership

```text
public-network    app
app-network       app, go-business-api                      internal
provider-network  go-business-api, worker-forwarding        egress
database-network  go-business-api, both workers, postgres   internal
cache-network     go-business-api, redis                    internal
```

`app` cannot resolve or connect directly to `postgres` or `redis`. `worker-retention` has no provider egress. Redis is not present on the database or public network.

## One-shot compatibility values

The initializer may import provider OAuth credentials, sending approvals, and ingress keys from `.env`. After one successful import and verification, remove populated one-shot values. Long-running services read encrypted or audited PostgreSQL state rather than the original environment values.

## Local development

The development overlay publishes PostgreSQL and Redis only to `127.0.0.1`. It explicitly overrides Redis to an unauthenticated local instance so existing source-development commands continue to work. This is a development-only convenience and is not equivalent to the authenticated, isolated production topology.

## Change rules

A variable or secret ownership change must update, as applicable:

```text
.env.example
config/runtime-env.json
docker-compose.yml
scripts/compose-up.sh
scripts/*.test.mjs
docs/ENVIRONMENT.md
relevant Go loader and tests
```

The full-stack consistency contract additionally resolves the production Compose model and compares its service environment ownership, operator interpolation, frontend requests, Go handlers, route ownership, tracked-file hygiene, and regression visibility.

Do not add hidden aliases, raw secret fallbacks, blanket proxy trust, or a direct database/cache path for `app`.
