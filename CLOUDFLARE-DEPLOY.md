# all-Mail Cloudflare deployment guide

## Boundary

This document covers the Cloudflare-specific ingress path for `cloudflare/workers/allmail-edge`.

- Use [`docs/DEPLOY.md`](docs/DEPLOY.md) for the main application stack.
- Use [`docs/RUNBOOK.md`](docs/RUNBOOK.md) for shared backend recovery.
- Use [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md) for variable ownership.
- Use this file for Cloudflare Email Routing, Worker variables, R2, Wrangler deployment and ingress troubleshooting.

The Worker receives Cloudflare Email Routing traffic and forwards a signed payload to the **Go public listener**. Go then proxies the unported ingress business route to the internal Fastify compatibility API.

```text
Cloudflare Email Routing
          |
          v
allmail-edge Worker
          |
          | HTTPS + HMAC signature
          v
app: Go public listener
          |
          v
legacy-api: /ingress/domain-mail/receive
          |
          v
PostgreSQL
```

## Repository components

| Component | Purpose | Location |
| --- | --- | --- |
| Go public listener | Public ingress endpoint, request IDs and readiness | `core/` |
| Compatibility ingress handler | Validates and stores the current business payload | `server/` |
| Endpoint bootstrap script | Creates/checks the active ingress key record | `server/scripts/ensure-ingress-endpoint.ts` |
| Cloudflare Worker | Parses email and sends signed ingress payloads | `cloudflare/workers/allmail-edge/` |
| Worker configuration | Vars, secret and R2 binding template | `cloudflare/workers/allmail-edge/wrangler.jsonc` |

## Preconditions

### Backend

Confirm the canonical Docker stack is healthy:

```bash
cp .env.cloudflare.example .env
# Replace the ingress placeholder in .env before startup.
docker compose up -d --build --wait --wait-timeout 240
curl --fail http://127.0.0.1:3002/readyz
docker compose exec -T app allmail doctor api
docker compose exec -T worker-forwarding allmail doctor worker forwarding
docker compose exec -T worker-retention allmail doctor worker retention
```

The backend must expose a public HTTPS hostname that reaches the Go `app` service.

### Cloudflare

- the target domain is active in Cloudflare;
- Email Routing is enabled;
- a `workers.dev` subdomain or custom Worker route is available;
- `npx wrangler whoami` succeeds;
- `CLOUDFLARE_API_TOKEN` is available for non-interactive deployment/R2 operations when required.

### Local workstation

- Node.js 20+;
- dependencies installed in `cloudflare/workers/allmail-edge`;
- `curl` available for backend and post-deploy checks.

## Required shared secret

The backend and Worker must use exactly the same secret:

```env
INGRESS_SIGNING_SECRET=<strong-random-secret>
```

Do not keep `replace-with-*` placeholders. Backend startup rejects a shipped placeholder.

## Worker configuration

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

| Variable | Meaning |
| --- | --- |
| `INGRESS_URL` | Public Go listener URL for the ingress route; production should use HTTPS |
| `INGRESS_KEY_ID` | Key identifier shared with the backend endpoint record |
| `INGRESS_PROVIDER` | Provider label stored with ingress records |
| `RAW_EMAIL_OBJECT_PREFIX` | R2 object prefix for raw `.eml` files |
| `RAW_EMAIL_BUCKET_NAME` | R2 bucket checked or created by deployment tooling |
| `INGRESS_SIGNING_SECRET` | HMAC secret uploaded as a Worker secret |

## Ensure the backend ingress endpoint

From the repository root, with the active backend env available:

```bash
./scripts/sanitize-runtime-env.sh npm --prefix server run ingress:ensure
./scripts/sanitize-runtime-env.sh npm --prefix server run ingress:check
```

The check should report:

- an active endpoint;
- the expected `INGRESS_KEY_ID`;
- `signingKeyHashMatchesEnv: true`.

These are administrative scripts for the compatibility business API. Normal inbound traffic still enters through the Go public listener.

## Validate and deploy the Worker

```bash
cd cloudflare/workers/allmail-edge
npm ci
npm run check
npm run doctor
npm run deploy:prod
```

Depending on the helper configuration, deployment can:

- validate required vars;
- verify Wrangler authentication;
- create or verify the R2 bucket;
- upload `INGRESS_SIGNING_SECRET` as a Worker secret;
- deploy the Worker;
- run post-deploy health checks.

Cloudflare Dashboard actions remain manual where account/domain decisions are required:

1. enable Email Routing;
2. create or verify the Worker route/subdomain;
3. create or verify a Tunnel/public hostname for the backend when used;
4. bind an Email Routing address or catch-all rule to `allmail-edge`.

## R2 behavior

A newly created bucket being empty is normal. Raw `.eml` objects are written at runtime when real messages arrive. Manual object uploads are not part of normal deployment.

The backend stores the resulting object key; it does not need a second copy of the raw email body.

## End-to-end validation

1. Verify the local/public backend:

```bash
curl --fail https://edge.example.com/health
curl --fail https://edge.example.com/readyz
```

2. Verify Worker health using the deployed URL/helper.
3. Send a real test message through the configured Cloudflare Email Routing address.
4. Inspect runtime logs:

```bash
docker compose logs app --tail=200
docker compose logs legacy-api --tail=200
docker compose logs worker-forwarding --tail=200
```

5. Confirm the inbound record exists and, when configured, the R2 object key is present.
6. If the mailbox is configured for forwarding, confirm `worker-forwarding` advances the forwarding job independently.

## Troubleshooting

### Backend returns 401/403 for ingress

Check:

- backend and Worker secrets match;
- `INGRESS_KEY_ID` matches an active endpoint;
- Worker system time and backend allowed skew;
- request body is not modified after signing;
- the public URL reaches `app`, not an unrelated service.

Backend inspection:

```bash
docker compose logs app --tail=200
docker compose logs legacy-api --tail=300
./scripts/sanitize-runtime-env.sh npm --prefix server run ingress:check
```

### Backend returns 502/503

```bash
curl -i https://edge.example.com/readyz
docker compose exec -T app allmail doctor api
docker compose logs app --tail=200
docker compose logs legacy-api --tail=200
```

A Go readiness failure identifies PostgreSQL, Redis or compatibility API failure. A proxy 502 usually means `legacy-api` is unavailable.

### Worker cannot reach the backend

Verify DNS/Tunnel routing and TLS first. The Worker must call a public HTTPS URL; Docker-internal names such as `legacy-api` are not reachable from Cloudflare.

### Signature mismatch after secret rotation

Rotate deliberately:

1. update the backend `.env`;
2. recreate `legacy-api`/`app` as needed;
3. upload the same new secret to the Worker;
4. redeploy the Worker;
5. run `ingress:check` and a real delivery test.

Avoid leaving backend and Worker on different secrets during an active delivery window.

### R2 write failure

Check:

- bucket name and binding;
- API token permissions;
- Wrangler environment selection;
- object prefix normalization;
- Worker logs for the exact R2 exception.

A forwarding-worker error is separate from an R2 ingress-write error; diagnose the owning service rather than restarting the whole stack.

## Rollback

Worker rollback:

- deploy the previous known-good Worker version;
- restore the matching vars/secrets;
- verify the backend ingress endpoint still accepts that contract.

Backend rollback uses the previous known-good repository revision/image as documented in `docs/DEPLOY.md`. The current revision contains no hidden Node jobs writer.

Never expose or commit Worker secrets, Tunnel tokens or account credentials.
