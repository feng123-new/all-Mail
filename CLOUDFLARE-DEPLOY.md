# all-Mail Cloudflare deployment guide

## Boundary

This is the Worker-specific deployment and troubleshooting guide for `cloudflare/workers/allmail-edge`.

- Use [`docs/DEPLOY.md`](docs/DEPLOY.md) for the main application.
- Use [`docs/RUNBOOK.md`](docs/RUNBOOK.md) for shared backend recovery.
- Use [`docs/RUNBOOK.md#cloudflare-tunnel-down-or-public-hostnames-return-530`](docs/RUNBOOK.md#cloudflare-tunnel-down-or-public-hostnames-return-530) for tunnel service and transport troubleshooting.
- Use [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md) for variable ownership.

This flow connects:

- Cloudflare Email Routing;
- the `allmail-edge` Worker;
- the public Go listener;
- the still-legacy Fastify ingress business handler behind the Go migration proxy;
- optional raw `.eml` persistence in R2.

## Current architecture

```text
Cloudflare Email Routing
          |
          v
allmail-edge Worker
          |
          | signed POST /ingress/domain-mail/receive
          v
Go app public listener
          |
          | legacy route proxy
          v
Fastify ingress module
          |
          +--> PostgreSQL
          +--> optional R2 object key metadata
```

| Component | Purpose | Repository location |
| --- | --- | --- |
| Go public listener | Receives the public request and proxies unmigrated ingress routes | `core/internal/httpapi/` |
| Fastify ingress API | Validates and stores the current ingress business payload | `server/src/modules/ingress/` |
| Ingress endpoint bootstrap | Ensures an active backend endpoint for `INGRESS_KEY_ID` | `server/scripts/ensure-ingress-endpoint.ts` |
| Cloudflare Worker | Normalizes inbound mail and signs the request | `cloudflare/workers/allmail-edge/src/` |
| Worker configuration | Declares vars, secrets and R2 binding | `cloudflare/workers/allmail-edge/wrangler.jsonc` |
| Worker helpers | Doctor and production deploy automation | `cloudflare/workers/allmail-edge/bin/` |

## Operator boundary

Repository automation can:

- run Worker checks;
- verify/create the configured R2 bucket;
- upload the Worker signing secret;
- deploy the Worker;
- perform Worker and backend health checks;
- verify the backend ingress endpoint record.

Cloudflare Dashboard work remains manual:

1. add and verify the domain;
2. enable Email Routing;
3. create or verify the public hostname that reaches the Go `app` listener;
4. configure a Worker subdomain/auth context;
5. bind the desired email address or catch-all rule to `allmail-edge`.

## Preconditions

### Backend

- the canonical Docker stack is healthy;
- public traffic reaches the Go `app` service, normally through a tunnel/reverse proxy;
- `INGRESS_SIGNING_SECRET` is set to a real shared secret;
- `POST /ingress/domain-mail/receive` is reachable through the Go proxy;
- the Fastify ingress endpoint record exists and its key hash matches the secret.

Use `.env.cloudflare.example` as the starting template and replace the placeholder before startup.

### Cloudflare

- the domain is hosted in Cloudflare;
- Email Routing is enabled;
- `npx wrangler whoami` succeeds;
- `CLOUDFLARE_API_TOKEN` is available for non-interactive deployment/R2 operations;
- a public HTTPS hostname can reach the backend.

### Workstation

- Node.js 20+;
- `curl`;
- dependencies installed for `cloudflare/workers/allmail-edge`.

## Required values

### Backend `.env`

```env
INGRESS_SIGNING_SECRET=<strong-shared-secret>
INGRESS_ALLOWED_SKEW_SECONDS=300
```

### Worker `.dev.vars`

```bash
cd cloudflare/workers/allmail-edge
cp .dev.vars.example .dev.vars
```

Fill:

```env
INGRESS_URL=https://edge.example.com/ingress/domain-mail/receive
INGRESS_KEY_ID=allmail-edge-main
INGRESS_PROVIDER=CLOUDFLARE_EMAIL_ROUTING
RAW_EMAIL_OBJECT_PREFIX=allmail-edge/raw
RAW_EMAIL_BUCKET_NAME=mail-eml
INGRESS_SIGNING_SECRET=<same-secret-as-backend>
```

| Variable | Required | Meaning |
| --- | --- | --- |
| `INGRESS_URL` | Yes | Public Go-listener URL for the ingress route; production should be HTTPS |
| `INGRESS_KEY_ID` | Yes | Identifier shared with the Fastify ingress endpoint record |
| `INGRESS_PROVIDER` | Yes | Provider label stored with ingress records |
| `RAW_EMAIL_OBJECT_PREFIX` | Yes | R2 object prefix for raw mail |
| `RAW_EMAIL_BUCKET_NAME` | Yes | R2 bucket checked/created by deployment automation |
| `INGRESS_SIGNING_SECRET` | Yes | Shared HMAC secret; must match backend exactly |

## Recommended deployment sequence

### 1. Start and validate the backend

```bash
cp .env.cloudflare.example .env
# Edit .env and replace all real deployment values/placeholders.
docker compose up -d --build --wait --wait-timeout 240
docker compose ps -a
curl --fail http://127.0.0.1:3002/health
curl --fail http://127.0.0.1:3002/readyz
```

The health response identifies `go-migration-bridge`; ingress business handling is still proxied to `legacy-api` during this migration phase.

### 2. Ensure the backend ingress endpoint exists

The endpoint utility belongs to the Fastify source tree. Run it with the same environment used by the deployed stack:

```bash
./scripts/sanitize-runtime-env.sh npm --prefix server run ingress:ensure
./scripts/sanitize-runtime-env.sh npm --prefix server run ingress:check
```

The check should report:

- an active endpoint;
- the expected `keyId`;
- `signingKeyHashMatchesEnv: true`.

### 3. Prepare Worker configuration

```bash
cd cloudflare/workers/allmail-edge
cp .dev.vars.example .dev.vars
# Edit .dev.vars with the final public HTTPS ingress URL and real secret.
```

Do not point production Worker traffic directly at the internal `legacy-api` container or port. The public contract enters through Go `app`.

### 4. Verify local configuration and auth

From the repository root:

```bash
npx wrangler whoami
./scripts/sanitize-runtime-env.sh npm --prefix cloudflare/workers/allmail-edge install
./scripts/sanitize-runtime-env.sh npm --prefix cloudflare/workers/allmail-edge run doctor
./scripts/sanitize-runtime-env.sh npm --prefix cloudflare/workers/allmail-edge run check
```

The doctor should verify required vars, Wrangler authentication, R2 access, backend reachability and endpoint alignment.

### 5. Deploy

Use the repository's Worker deployment script documented by its package scripts, for example:

```bash
./scripts/sanitize-runtime-env.sh npm --prefix cloudflare/workers/allmail-edge run deploy:prod
```

Review the exact command in `cloudflare/workers/allmail-edge/package.json` before execution if package scripts changed.

### 6. Configure Email Routing

In Cloudflare Dashboard:

1. select the target domain;
2. open Email Routing;
3. create or edit the destination/catch-all rule;
4. choose `Send to a Worker`;
5. select `allmail-edge`;
6. save and verify the route.

### 7. End-to-end validation

Send a real test message to the routed address, then inspect:

```bash
docker compose logs app --tail=200
docker compose logs legacy-api --tail=200
docker compose logs go-jobs --tail=200
```

Verify:

- Worker execution succeeded;
- the Go proxy returned a success status;
- the Fastify ingress module accepted the signature;
- an inbound message record was created;
- R2 contains the raw object when enabled;
- forwarding behavior matches mailbox configuration.

## R2 behavior

The deployment helper may create the bucket, but normal setup does not upload `.eml` files manually. The Worker writes raw email at runtime after real mail arrives.

An empty bucket immediately after deployment is normal.

## Common failures

### Backend returns 503

Check:

```bash
curl --fail http://127.0.0.1:3002/readyz
docker compose ps -a
docker compose logs app --tail=200
docker compose logs legacy-api --tail=200
```

The Go listener requires PostgreSQL, Redis and the legacy API to be ready in bridge mode.

### Signature mismatch / 401 or 403

- compare Worker and backend secrets without printing them to shared logs;
- run `ingress:check`;
- verify `INGRESS_KEY_ID`;
- confirm no placeholder secret remains;
- check clock skew and `INGRESS_ALLOWED_SKEW_SECONDS`.

### Worker cannot reach backend

- ensure `INGRESS_URL` is public HTTPS;
- check tunnel/DNS routing;
- verify the hostname points to the Go `app` port, not the internal legacy port;
- use the tunnel section in the runbook.

### R2 write failure

- verify binding and bucket name;
- confirm API token permissions;
- inspect Worker logs;
- do not change backend database code to compensate for a Worker-side R2 permission problem.

### Duplicate/replayed delivery

The current replay protection still belongs to the Fastify/Redis path. Confirm Redis health and inspect ingress logs before retrying messages manually.

## Rollback

Worker rollback options:

- deploy the previous Worker version;
- temporarily disable the Email Routing rule;
- point the rule to a known-good Worker;
- restore the previous backend revision when the public ingress contract changed.

Do not bypass signed ingress by exposing `legacy-api` directly. During the Go migration, rollback should preserve the public-listener boundary even while business route ownership remains in Fastify.

## Secret handling

- never commit `.dev.vars`;
- never paste live secrets into issues or PRs;
- rotate the shared ingress secret if it is exposed;
- update backend and Worker sides together;
- treat tunnel tokens and Cloudflare API tokens as separate secrets from the ingress HMAC key.
