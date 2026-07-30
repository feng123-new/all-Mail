# PR 5 configuration and proxy security status

## Ownership changes

| Capability | Before | After |
| --- | --- | --- |
| Public client IP | Implicit socket/proxy behavior | Go gateway canonicalizes identity from explicit direct-peer CIDRs |
| Fastify proxy trust | Disabled/implicit container IP | Exactly one internal Go hop |
| Go API readiness | Direct PostgreSQL + Redis + Fastify probes | SPA + Fastify readiness; Fastify owns DB/Redis detail |
| Go gateway credentials | PostgreSQL and Redis URLs | No shared-state credentials |
| Forwarding key | Env/file/bootstrap fallback chain | Required isolated file only |
| Production database ports | Published to localhost by default | Private Compose network only |
| Development database ports | Mixed into production Compose | Explicit `docker-compose.dev.yml` overlay |
| Backend templates | Default + copied Cloudflare template | One `.env.example` |

## Hard-deleted names

```text
GO_API_MODE
ALL_MAIL_ENV
ALL_MAIL_PUBLIC_BASE_URL
ALL_MAIL_SECRET_STATE_DIR
GO_JOBS_HEARTBEAT_SECONDS
GO_JOBS_HEARTBEAT_MAX_AGE_SECONDS
APP_INTERNAL_PORT
LEGACY_API_INTERNAL_PORT
POSTGRES_PUBLISH_HOST
POSTGRES_PORT
POSTGRES_INTERNAL_PORT
REDIS_PUBLISH_HOST
REDIS_PORT
REDIS_INTERNAL_PORT
.env.cloudflare.example
```

The names are not retained as aliases. Existing deployment env files must be reviewed and cleaned.

## Security invariants

- `legacy-api` is not host-published.
- Fastify trusts exactly one proxy hop.
- Go discards forwarding headers from untrusted peers.
- Trusted peers are configured by narrow CIDRs, never blanket trust.
- Go overwrites downstream forwarding identity.
- Public `app` has no PostgreSQL/Redis credentials.
- `worker-forwarding` has only the 32-character file secret.
- PostgreSQL and Redis remain private in production.

## Test evidence required before merge

- runtime contract suite;
- Go format/race/vet/build;
- untrusted and trusted proxy identity tests;
- Fastify one-hop `request.ip` test;
- production and development Compose model validation;
- Fastify, web, and Worker test/build gates;
- dependency audit;
- Docker full-stack smoke and release gate.

## Rollback

Deploy the previous known-good revision/image and restore its matching environment contract. The previous revision may depend on variables deliberately removed here.

## Next stacked PR

The administrator-bootstrap PR is based on this branch. It moves database administrator creation into `legacy-init`, removes administrator credentials from `legacy-api`, deletes environment-managed administrator 2FA and legacy `adminId=0` branches, and separates long-lived runtime secrets from the one-time bootstrap password.
