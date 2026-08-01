# Environment and secret ownership

## Canonical operator surface

`.env.example` is the only production environment template. `config/runtime-env.json` defines its exact key set. Internal URLs, fixed paths, and secret-file mounts are owned by Compose and are intentionally absent from the operator template.

Production startup is:

```bash
cp .env.example .env
./scripts/compose-up.sh
```

`POSTGRES_PASSWORD` must be explicitly configured. JWT, encryption, and Redis authentication secrets may be left blank or absent from operator input because the initializer creates durable values.

## Process ownership

### Public gateway: `app`

The public process receives only gateway and health configuration, including:

```text
GO_BUSINESS_API_URL=http://go-business-api:3200
TRUSTED_PROXY_CIDRS=
READY_TIMEOUT_SECONDS=5
SHUTDOWN_TIMEOUT_SECONDS=15
```

It must not receive database, Redis, JWT, encryption, OAuth, ingress-signing, provider, or bootstrap secrets.

### Private API: `go-business-api`

Internal Compose values include:

```text
DATABASE_URL=postgresql://...
REDIS_URL=redis://redis:6379
REDIS_PASSWORD_FILE=/var/lib/all-mail-redis/redis-password
JWT_SECRET_FILE=/var/lib/all-mail-secrets/jwt-secret
ENCRYPTION_KEY_FILE=/var/lib/all-mail-encryption/encryption-key
BOOTSTRAP_ADMIN_SECRET_FILE=/var/lib/all-mail/bootstrap-admin.env
```

The loader injects the file-backed Redis password into the in-memory client URL. Production refuses to start without `REDIS_PASSWORD_FILE`.

### `worker-forwarding`

Receives PostgreSQL, provider egress, forwarding policy, and:

```text
ENCRYPTION_KEY_FILE=/var/lib/all-mail-secrets/encryption-key
```

It receives no JWT or Redis credential.

### `worker-retention`

Receives PostgreSQL and retention policy only. It receives no application secret volume.

### Temporary initializer

`app init` is the only process allowed to:

- generate or migrate runtime secrets;
- mutate schema;
- import compatibility configuration;
- create the first administrator;
- migrate the one-time bootstrap credential;
- export least-privilege secret files.

Long-running processes never generate keys or migrate schema.

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

Do not add hidden aliases, raw secret fallbacks, blanket proxy trust, or a direct database/cache path for `app`.
