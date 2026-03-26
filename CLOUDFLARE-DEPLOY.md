# all-Mail Cloudflare Deployment Guide

This runbook covers the production-facing deployment path for the `cloudflare/workers/allmail-edge` worker that receives Cloudflare Email Routing traffic and forwards signed ingress payloads into the all-Mail backend.

Use this guide when you want all of the following to work together:

- Cloudflare Email Routing
- the `allmail-edge` Worker
- the all-Mail backend ingress endpoint at `/ingress/domain-mail/receive`
- optional raw `.eml` persistence into R2

## Scope and operator boundary

This document covers the repo-controlled parts of the flow:

- backend prerequisites for signed ingress
- worker vars and secrets
- Wrangler-based deployment
- worker health and post-deploy validation
- common failure modes and rollback options

These account-specific actions still require manual confirmation in the Cloudflare Dashboard:

1. add and verify your domain in Cloudflare
2. enable Email Routing for that domain
3. create or verify the public hostname that reaches your backend ingress URL
4. bind the target Email Routing address or catch-all rule to `worker: allmail-edge`

## Architecture map

| Component | Purpose | Repo location |
| --- | --- | --- |
| all-Mail backend | Receives signed ingress payloads and stores/processes them | `server/` |
| ingress endpoint bootstrap | Ensures the backend has an active ingress endpoint keyed by `INGRESS_KEY_ID` | `server/scripts/ensure-ingress-endpoint.ts` |
| Cloudflare Worker | Normalizes inbound email and POSTs it to the backend ingress URL | `cloudflare/workers/allmail-edge/src/index.ts` |
| Worker config | Declares public vars and R2 binding template | `cloudflare/workers/allmail-edge/wrangler.jsonc` |
| Worker doctor/deploy helpers | Verify auth/config and automate deploy steps | `cloudflare/workers/allmail-edge/bin/doctor.js`, `bin/deploy-prod.js` |

## Preconditions

Before you deploy the worker, make sure all of the following are true.

### Backend preconditions

- the backend is already reachable from the public internet
- `INGRESS_SIGNING_SECRET` is configured on the backend
- the backend can accept `POST /ingress/domain-mail/receive`
- if you want raw email persistence, the backend object-storage settings are already configured

Relevant backend env values live in root `.env`, `server/.env`, or `.env.cloudflare.example`.

### Cloudflare preconditions

- the target domain is hosted in Cloudflare
- Email Routing is enabled for the domain
- your Cloudflare account already has a `workers.dev` subdomain or can create one during Email Worker setup
- `npx wrangler whoami` succeeds for the operator performing the deploy
- `CLOUDFLARE_API_TOKEN` is exported before using repo automation that touches R2 or deploys non-interactively

### Local workstation preconditions

- Node.js 20+
- `npm install` already works inside `cloudflare/workers/allmail-edge`
- `curl` is available for the health checks used by the repo doctor/deploy helpers

## Values you must prepare

### Backend-side values

At minimum, the backend must have:

```env
INGRESS_SIGNING_SECRET=replace-with-a-shared-secret
```

If you want `.eml` persistence end-to-end, also configure the backend object-storage env values described in `.env.cloudflare.example`.

### Worker-side values

Create `cloudflare/workers/allmail-edge/.dev.vars` from the example file:

```bash
cd cloudflare/workers/allmail-edge
cp .dev.vars.example .dev.vars
```

Then fill these values:

```env
INGRESS_URL=https://edge.example.com/ingress/domain-mail/receive
INGRESS_KEY_ID=allmail-edge-main
INGRESS_PROVIDER=CLOUDFLARE_EMAIL_ROUTING
RAW_EMAIL_OBJECT_PREFIX=allmail-edge/raw
RAW_EMAIL_BUCKET_NAME=mail-eml
INGRESS_SIGNING_SECRET=replace-with-the-same-secret-used-by-server
```

### What each worker value means

| Key | Required | Meaning |
| --- | --- | --- |
| `INGRESS_URL` | Yes | Public backend ingress URL that the Worker POSTs to. `src/config.ts` requires `https` unless the hostname is `127.0.0.1` or `localhost`. |
| `INGRESS_KEY_ID` | Yes | Key identifier used by the Worker and by `server/scripts/ensure-ingress-endpoint.ts`. The default repo automation expects `allmail-edge-main`. |
| `INGRESS_PROVIDER` | Yes | Stored provider label for ingress records. Default is `CLOUDFLARE_EMAIL_ROUTING`. |
| `RAW_EMAIL_OBJECT_PREFIX` | Yes | Prefix used when writing raw email objects to R2. The Worker normalizes leading/trailing slashes. |
| `RAW_EMAIL_BUCKET_NAME` | Yes | R2 bucket name that `bin/deploy-prod.js` checks or creates before deploy. |
| `INGRESS_SIGNING_SECRET` | Yes | Secret uploaded to Cloudflare and used to sign ingress requests. It must exactly match the backend `INGRESS_SIGNING_SECRET`. |

## Recommended deployment sequence

Follow the steps in order. Each step is independently executable.

### Step 1: Start and validate the backend

For a Docker-based Cloudflare-ready backend:

```bash
cp .env.cloudflare.example .env
docker compose up -d --build
curl http://127.0.0.1:3002/health
```

Expected health output:

```json
{"success":true,"data":{"status":"ok"}}
```

If your backend is not local-only, verify the public hostname that will back `INGRESS_URL` can reach the same all-Mail instance.

### Step 2: Ensure the backend ingress endpoint exists

From the repo root:

```bash
cd server
npm run ingress:ensure
npm run ingress:check
```

`npm run ingress:check` should report an active endpoint whose `keyId` matches your intended `INGRESS_KEY_ID`, and `signingKeyHashMatchesEnv` should be `true` when `INGRESS_SIGNING_SECRET` is configured.

### Step 3: Prepare worker config

```bash
cd ../cloudflare/workers/allmail-edge
cp .dev.vars.example .dev.vars
```

Fill `.dev.vars` with real values. Use the final public backend ingress URL here, not a placeholder.

If you are still testing locally, `http://127.0.0.1:3002/...` is accepted, but production deploys should point to an `https` hostname because `src/config.ts` rejects non-local plaintext URLs.

### Step 4: Confirm Wrangler auth and local config

```bash
npx wrangler whoami
npm install
npm run doctor
```

`npm run doctor` checks:

- `.dev.vars` exists
- `wrangler.jsonc` exists
- required worker env keys are present
- Wrangler auth works
- `CLOUDFLARE_API_TOKEN` is present for non-interactive deploy/R2 checks
- the configured R2 bucket exists
- the backend ingress health endpoint responds
- the backend ingress endpoint check passes

If you want an additional local smoke test against the backend ingress signer path, run:

```bash
INGRESS_URL=http://127.0.0.1:3002/ingress/domain-mail/receive \
INGRESS_KEY_ID=allmail-edge-main \
INGRESS_SIGNING_SECRET=replace-me \
MATCHED_ADDRESS=inbox@example.com \
node scripts/post-signed-fixture.mjs
```

### Step 5: Run worker quality gates

```bash
npm run check
```

This runs TypeScript, ESLint, and the worker tests before any deploy is attempted.

### Step 6: Export Cloudflare API token

`bin/deploy-prod.js` requires `CLOUDFLARE_API_TOKEN` when it checks R2 and deploys non-interactively:

```bash
export CLOUDFLARE_API_TOKEN=your-cloudflare-api-token
```

### Step 7: Deploy with repo automation

```bash
npm run deploy:prod
```

What `npm run deploy:prod` does in this repo:

1. validates `.dev.vars`
2. runs `wrangler whoami`
3. runs `npm run check`
4. runs `server/scripts/ensure-ingress-endpoint.ts` for the configured key ID
5. checks or creates the configured R2 bucket
6. uploads `INGRESS_SIGNING_SECRET` with `wrangler secret put`
7. builds a temporary deploy config from `wrangler.jsonc` + `.dev.vars`
8. runs `wrangler deploy`
9. attempts a post-deploy health check against the inferred `workers.dev` URL

## Cloudflare Dashboard steps after deploy

After the Worker deploys, finish the Cloudflare-side setup manually:

1. open **Cloudflare Dashboard → Email Routing**
2. if Email Routing is not enabled yet, complete the domain onboarding there first
3. create or edit the target custom address / route
4. bind the route to **Worker: `allmail-edge`**
5. if you use a catch-all route, confirm it points to the same Worker intentionally
6. confirm the backend hostname referenced by `INGRESS_URL` resolves and reaches the live all-Mail backend

Cloudflare's official Email Worker onboarding references:

- Email Routing overview: <https://developers.cloudflare.com/email-routing/>
- Email Workers: <https://developers.cloudflare.com/email-routing/email-workers/>
- Enable Email Workers: <https://developers.cloudflare.com/email-routing/email-workers/enable-email-workers/>
- Email Worker runtime API: <https://developers.cloudflare.com/email-routing/email-workers/runtime-api/>
- Email Routing addresses/rules: <https://developers.cloudflare.com/email-routing/setup/email-routing-addresses/>

## Post-deploy validation

### 1. Check the Worker health endpoint

If you know your `workers.dev` subdomain, run:

```bash
curl https://allmail-edge.<your-subdomain>.workers.dev/health
```

Expected shape:

```json
{
  "success": true,
  "data": {
    "worker": "allmail-edge",
    "ingressUrl": "https://edge.example.com/ingress/domain-mail/receive",
    "ingressKeyId": "allmail-edge-main",
    "ingressProvider": "CLOUDFLARE_EMAIL_ROUTING",
    "rawEmailBucketBound": true,
    "rawEmailObjectPrefix": "allmail-edge/raw"
  }
}
```

If the Worker is not configured correctly, `/health` returns `503` with `WORKER_NOT_CONFIGURED`.

### 2. Run the post-deploy doctor

```bash
npm run doctor -- --postdeploy
```

This re-checks the local config and also verifies the deployed `workers.dev` health endpoint when Wrangler can infer your subdomain.

### 3. Send a live email through Email Routing

Send a real message to the exact custom address or catch-all route bound to `allmail-edge`.

Success signals:

- Cloudflare Email Routing shows the event as processed
- the Worker does not reject the email
- the all-Mail backend receives the message through `/ingress/domain-mail/receive`
- if R2 is enabled, a raw `.eml` object is written using the configured prefix

## Troubleshooting

### `WORKER_NOT_CONFIGURED` on `/health`

Cause: one or more required worker values are missing.

Check:

```bash
npm run doctor
```

Most common fixes:

- missing `INGRESS_URL`
- missing `INGRESS_KEY_ID`
- missing `INGRESS_SIGNING_SECRET`
- wrong or missing R2 binding/bucket

### `INGRESS_URL must use https unless targeting localhost`

Cause: `src/config.ts` rejects non-local plaintext URLs.

Fix: change `INGRESS_URL` to an `https://` hostname for any non-local deployment.

### `wrangler whoami` fails

Cause: Wrangler is not authenticated, or your token/session is invalid.

Fix:

- re-authenticate Wrangler
- export a valid `CLOUDFLARE_API_TOKEN`
- rerun `npx wrangler whoami`

### R2 bucket check fails

Cause: `RAW_EMAIL_BUCKET_NAME` is wrong, the bucket does not exist, or the token cannot list/create R2 buckets.

Fix:

- verify the bucket name in `.dev.vars`
- rerun `npm run doctor`
- if needed, let `npm run deploy:prod` create the bucket after exporting a valid token

### `npm run ingress:check` fails

Cause: the backend cannot find an active ingress endpoint or the backend secret hash does not match the Worker secret.

Fix:

- verify backend `INGRESS_SIGNING_SECRET`
- rerun `cd server && npm run ingress:ensure`
- ensure `INGRESS_KEY_ID` matches on both sides

### Worker health passes but real email never arrives

Cause is usually outside the Worker runtime itself.

Check:

- Email Routing is actually enabled for the domain
- the target address or catch-all rule is bound to `worker: allmail-edge`
- the public hostname in `INGRESS_URL` really reaches the live backend
- backend ingress logs do not show signature rejection or upstream failures

## Rollback and safe recovery

If a fresh deploy breaks live mail handling:

1. temporarily remove or change the Email Routing binding away from `worker: allmail-edge`
2. redeploy the previous known-good Worker configuration or select the previous Worker version in Cloudflare if you use dashboard rollback/version controls
3. rerun:

```bash
npm run doctor -- --postdeploy
curl https://allmail-edge.<your-subdomain>.workers.dev/health
```

4. only rebind Email Routing to the Worker after the health check and ingress validation succeed again

## Additional official references

- Workers best practices: <https://developers.cloudflare.com/workers/best-practices/workers-best-practices/>
- Wrangler general commands: <https://developers.cloudflare.com/workers/wrangler/commands/general/>
- Local development for Email Workers: <https://developers.cloudflare.com/email-routing/email-workers/local-development/>
- Email Routing limits: <https://developers.cloudflare.com/email-routing/limits/>
