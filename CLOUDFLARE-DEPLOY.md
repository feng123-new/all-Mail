# all-Mail Cloudflare Deployment Guide

## Boundary

This document is the worker-specific deployment and runbook entry for `cloudflare/workers/allmail-edge`.

- Use [`docs/DEPLOY.md`](docs/DEPLOY.md) for the main app deployment path.
- Use [`docs/RUNBOOK.md`](docs/RUNBOOK.md) for shared backend recovery flows.
- Use [`docs/RUNBOOK.md`](docs/RUNBOOK.md#cloudflare-tunnel-down--public-hostnames-returning-530) for long-term tunnel service operation, token rotation, and connector transport troubleshooting.
- Use [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md) for backend and worker variable ownership.
- Use this file when you specifically need Cloudflare Email Routing, the worker deploy flow, or worker-side ingress troubleshooting.

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

For the default Docker-first backend path, keep these values in root `.env` or start from `.env.cloudflare.example`.

`server/.env` remains valid only for the advanced source-runtime path documented in `docs/advanced-runtime.md`.

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

If you want `.eml` persistence end-to-end, make sure the Worker-side R2 bucket values in `.dev.vars` are set correctly. The backend only stores the resulting `rawObjectKey` and does not need a second object-storage env block for this flow.

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
| `RAW_EMAIL_BUCKET_NAME` | Yes | R2 bucket name that `bin/deploy-prod.js` checks or creates before deploy. You do not need to pre-upload email files into this bucket. |
| `INGRESS_SIGNING_SECRET` | Yes | Secret uploaded to Cloudflare and used to sign ingress requests. It must exactly match the backend `INGRESS_SIGNING_SECRET`. |

## What is automatic vs. manual

This is the exact operator boundary for the all-Mail Cloudflare flow.

### Automatic once local config is ready

After your local `.dev.vars`, backend env, and Cloudflare auth are correct, the repo commands can do all of the following for you:

- run worker quality checks
- verify or create the configured R2 bucket
- upload `INGRESS_SIGNING_SECRET` to Cloudflare as a Worker secret
- deploy the Worker with the values derived from `.dev.vars`
- run post-deploy Worker health checks
- verify the backend ingress endpoint configuration

### Manual in Cloudflare

These actions still require a real Cloudflare account/domain decision and are not completed by the wrapped Worker deploy command:

1. add and verify the domain in Cloudflare
2. enable Email Routing for that domain
3. create or verify the `workers.dev` subdomain / Wrangler auth context
4. if you use Tunnel, create the Tunnel and publish the backend hostname
5. create or edit the Email Routing address/catch-all rule and bind it to `worker: allmail-edge`

### R2 clarification

The bucket may be created automatically by the repo deploy helper, but the email objects inside it are **not** something you upload manually during normal setup.

The Worker writes raw `.eml` content into R2 at runtime via `rawEmailBucket.put(...)` after it receives real inbound mail. A newly created bucket being empty right after deploy is normal.

Manual object upload into R2 is only useful for your own debugging or ad-hoc inspection workflows; it is not a required deployment step for all-Mail.

Official Cloudflare R2 references:

- Create buckets: <https://developers.cloudflare.com/r2/buckets/create-buckets/>
- Upload objects manually: <https://developers.cloudflare.com/r2/objects/upload-objects/>
- Workers R2 API usage: <https://developers.cloudflare.com/r2/api/workers/workers-api-usage/>

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
./scripts/sanitize-runtime-env.sh npm --prefix server run ingress:ensure
./scripts/sanitize-runtime-env.sh npm --prefix server run ingress:check
```

The ingress check should report an active endpoint whose `keyId` matches your intended `INGRESS_KEY_ID`, and `signingKeyHashMatchesEnv` should be `true` when `INGRESS_SIGNING_SECRET` is configured.

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
./scripts/sanitize-runtime-env.sh npm --prefix cloudflare/workers/allmail-edge install
./scripts/sanitize-runtime-env.sh npm --prefix cloudflare/workers/allmail-edge run doctor
```

The worker doctor command checks:

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
./scripts/sanitize-runtime-env.sh npm --prefix cloudflare/workers/allmail-edge run check
```

This runs TypeScript, ESLint, and the worker tests before any deploy is attempted.

### Step 6: Export Cloudflare API token

`bin/deploy-prod.js` requires `CLOUDFLARE_API_TOKEN` when it checks R2 and deploys non-interactively:

```bash
export CLOUDFLARE_API_TOKEN=your-cloudflare-api-token
```

### Step 7: Deploy with repo automation

```bash
./scripts/sanitize-runtime-env.sh npm --prefix cloudflare/workers/allmail-edge run deploy:prod
```

What the wrapped `deploy:prod` command does in this repo:

1. validates `.dev.vars`
2. runs `wrangler whoami`
3. runs the worker quality gate
4. runs `server/scripts/ensure-ingress-endpoint.ts` for the configured key ID
5. checks or creates the configured R2 bucket
6. uploads `INGRESS_SIGNING_SECRET` with `wrangler secret put`
7. builds a temporary deploy config from `wrangler.jsonc` + `.dev.vars`
8. runs `wrangler deploy`
9. attempts a post-deploy health check against the inferred `workers.dev` URL

If the Cloudflare account/domain prerequisites are already complete, this is the point where local command-based deployment is usually enough. The remaining manual work is mainly Email Routing rule binding (or later route changes) inside the Cloudflare Dashboard.

## Cloudflare Dashboard steps after deploy

After the Worker deploys, finish the Cloudflare-side setup manually:

1. open **Cloudflare Dashboard → Email Routing**
2. if Email Routing is not enabled yet, complete the domain onboarding there first
3. create or edit the target custom address / route
4. bind the route to **Worker: `allmail-edge`**
5. if you use a catch-all route, confirm it points to the same Worker intentionally
6. confirm the backend hostname referenced by `INGRESS_URL` resolves and reaches the live all-Mail backend

If your shell exports `NODE_USE_ENV_PROXY` or `HTTP[S]_PROXY`, keep using the wrapped commands above. They sanitize those startup flags before Node/npm bootstraps, which avoids noisy `UNDICI-EHPA` warnings during worker operations.

If you have already done these Cloudflare-side actions once and your domain/tunnel topology is stable, later Worker updates usually only require the same wrapped local commands plus a quick post-deploy validation.

## Cloudflare Dashboard click-path checklist

Use this section when you want the UI path spelled out instead of only seeing the conceptual steps. Menu names can shift slightly across Cloudflare UI revisions, but the flow below matches the March 2026 layout family.

### A. Domain onboarding

If the domain is not in Cloudflare yet:

1. Cloudflare Dashboard
2. **Websites**
3. **Add a site**
4. complete the domain onboarding and nameserver verification

If the domain is already in Cloudflare, open that domain directly from **Websites**.

### B. Enable Email Routing

1. open the target domain
2. left navigation: **Email**
3. open **Email Routing**
4. click **Get started** / **Enable Email Routing** if it has not been enabled yet
5. complete any required destination-address verification steps Cloudflare requests

This is still a manual Cloudflare step. The wrapped `deploy:prod` command does not enable Email Routing for you.

### C. Confirm Worker / workers.dev context

1. Cloudflare Dashboard home
2. left navigation: **Workers & Pages**
3. open the Workers overview for the account
4. if Cloudflare asks you to create a `workers.dev` subdomain, complete it once

This needs to exist before the post-deploy `workers.dev` health URL becomes useful.

### D. Optional manual R2 bucket creation

You usually do **not** need to create the bucket manually because the wrapped `deploy:prod` command can create it for you.

If you still want to verify or create it in the UI:

1. Cloudflare Dashboard home
2. left navigation: **R2**
3. open **Overview**
4. click **Create bucket**
5. enter the same value you plan to use for `RAW_EMAIL_BUCKET_NAME`

Again: bucket creation can be manual or automatic, but uploading the actual `.eml` objects is not a required manual step for all-Mail.

### E. Tunnel setup for a cloud server backend

Only do this section if the backend is not exposed directly and you want Cloudflare Tunnel in front of it.

1. Cloudflare Dashboard home
2. left navigation: **Zero Trust** (or **Cloudflare One** entrypoint)
3. **Networks**
4. **Tunnels**
5. **Create a tunnel**
6. choose the `cloudflared` connector path
7. install and authenticate `cloudflared` on the cloud server
8. in the tunnel configuration, open **Public Hostnames**
9. add a hostname such as `edge.example.com`
10. point it to the backend service URL, for example `http://127.0.0.1:3002`

After this, set:

```env
INGRESS_URL=https://edge.example.com/ingress/domain-mail/receive
```

in `cloudflare/workers/allmail-edge/.dev.vars`.

### F. Bind Email Routing to the Worker

After the Worker is deployed successfully:

1. open the target domain
2. left navigation: **Email**
3. open **Email Routing**
4. go to the address/rule management area
5. create or edit the target custom address or catch-all rule
6. choose the destination/action that routes the email to a Worker
7. select **`allmail-edge`**
8. save the rule

This binding step is the most common reason a deployment looks healthy while real email never reaches the backend.

### G. What you can do locally after the dashboard work is done

Once sections A-F are already in place and stable, later updates are mostly local-command driven:

```bash
./scripts/sanitize-runtime-env.sh npm --prefix cloudflare/workers/allmail-edge run doctor
./scripts/sanitize-runtime-env.sh npm --prefix cloudflare/workers/allmail-edge run check
./scripts/sanitize-runtime-env.sh npm --prefix cloudflare/workers/allmail-edge run deploy:prod
./scripts/sanitize-runtime-env.sh npm --prefix cloudflare/workers/allmail-edge run doctor -- --postdeploy
```

In that steady-state workflow, you usually only need to return to the Cloudflare Dashboard when:

- changing the domain
- changing the Email Routing rule shape
- changing the Worker binding target
- changing Tunnel topology / public hostname
- verifying account-level setup after a Cloudflare-side change

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
./scripts/sanitize-runtime-env.sh npm --prefix cloudflare/workers/allmail-edge run doctor -- --postdeploy
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
./scripts/sanitize-runtime-env.sh npm --prefix cloudflare/workers/allmail-edge run doctor
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
- rerun the wrapped worker doctor command
- if needed, let the wrapped `deploy:prod` command create the bucket after exporting a valid token

### ingress endpoint check fails

Cause: the backend cannot find an active ingress endpoint or the backend secret hash does not match the Worker secret.

Fix:

- verify backend `INGRESS_SIGNING_SECRET`
- rerun `./scripts/sanitize-runtime-env.sh npm --prefix server run ingress:ensure`
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
./scripts/sanitize-runtime-env.sh npm --prefix cloudflare/workers/allmail-edge run doctor -- --postdeploy
curl https://allmail-edge.<your-subdomain>.workers.dev/health
```

4. only rebind Email Routing to the Worker after the health check and ingress validation succeed again

## 中文操作摘要

如果你只是想快速完成一次可用部署，可以按下面的顺序做：

1. 在云服务器上先把 all-Mail 后端跑起来，确认：

   ```bash
   curl http://127.0.0.1:3002/health
   ```

2. 在后端 `.env` 里配置好 `INGRESS_SIGNING_SECRET`，然后执行：

   ```bash
   ./scripts/sanitize-runtime-env.sh npm --prefix server run ingress:ensure
   ./scripts/sanitize-runtime-env.sh npm --prefix server run ingress:check
   ```

3. 在 `cloudflare/workers/allmail-edge/.dev.vars` 里填写：
   - `INGRESS_URL`
   - `INGRESS_KEY_ID`
   - `INGRESS_PROVIDER`
   - `RAW_EMAIL_OBJECT_PREFIX`
   - `RAW_EMAIL_BUCKET_NAME`
   - `INGRESS_SIGNING_SECRET`

4. 在仓库根目录执行 Worker 预检：

   ```bash
   ./scripts/sanitize-runtime-env.sh npm --prefix cloudflare/workers/allmail-edge install
   ./scripts/sanitize-runtime-env.sh npm --prefix cloudflare/workers/allmail-edge run doctor
   ./scripts/sanitize-runtime-env.sh npm --prefix cloudflare/workers/allmail-edge run check
   ```

5. 导出 Cloudflare API Token 后部署：

   ```bash
   export CLOUDFLARE_API_TOKEN=your-cloudflare-api-token
   ./scripts/sanitize-runtime-env.sh npm --prefix cloudflare/workers/allmail-edge run deploy:prod
   ```

6. 到 Cloudflare Dashboard 的 **Email Routing** 里，把目标地址或 catch-all 规则绑定到 `worker: allmail-edge`

7. 最后执行：

   ```bash
   ./scripts/sanitize-runtime-env.sh npm --prefix cloudflare/workers/allmail-edge run doctor -- --postdeploy
   curl https://allmail-edge.<your-subdomain>.workers.dev/health
   ```

8. 发送一封真实邮件到绑定地址，确认：
   - Cloudflare Email Routing 显示已处理
   - Worker 没有 reject
   - all-Mail 后端收到了 `/ingress/domain-mail/receive` 请求
   - 如果启用了 R2，原始 `.eml` 已写入对应前缀

## Example: cloud server + Cloudflare Tunnel + Email Routing

Use this example when your all-Mail backend runs on a cloud server and you want Cloudflare to reach it through a Tunnel-managed hostname instead of exposing the backend port directly.

### Topology

```text
Inbound email
  -> Cloudflare Email Routing
  -> Worker: allmail-edge
  -> fetch(INGRESS_URL)
  -> Cloudflare Tunnel public hostname
  -> cloudflared on your server
  -> all-Mail backend :3002
```

### Step A: keep all-Mail local on the server

On the cloud server, keep the backend listening locally or on a private interface. You do not need to open `3002` publicly if Tunnel is the only ingress path.

Example local check on the server:

```bash
curl http://127.0.0.1:3002/health
```

### Step B: create the Tunnel

Cloudflare official references:

- Tunnel overview: <https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/>
- Tunnel setup: <https://developers.cloudflare.com/tunnel/setup/>
- Route public hostnames to Tunnel: <https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/>

Recommended operator path:

1. In Cloudflare Dashboard, open **Networks → Tunnels**
2. Create a named Tunnel
3. Install `cloudflared` on the cloud server
4. Authenticate and install it as a persistent service

Typical commands on the server:

```bash
cloudflared tunnel login
cloudflared tunnel create allmail-ingress
cloudflared service install
```

Use a persistent service/systemd-style run mode. One-off `cloudflared tunnel run` sessions are fine for testing, but not for production.

### Step C: publish the backend hostname

In the Tunnel configuration, publish a hostname such as:

- public hostname: `edge.example.com`
- service: `http://127.0.0.1:3002`

That gives the Worker a stable backend target without exposing the backend port directly on the public internet.

Then set:

```env
INGRESS_URL=https://edge.example.com/ingress/domain-mail/receive
```

in `cloudflare/workers/allmail-edge/.dev.vars`.

### Step D: deploy the Worker against the Tunnel hostname

After the Tunnel hostname works, run the normal Worker deployment flow:

```bash
./scripts/sanitize-runtime-env.sh npm --prefix cloudflare/workers/allmail-edge run doctor
./scripts/sanitize-runtime-env.sh npm --prefix cloudflare/workers/allmail-edge run deploy:prod
```

### Step E: bind Email Routing to the Worker

In Cloudflare Email Routing:

1. enable Email Routing for the domain
2. create the target custom address or catch-all rule
3. bind that route to `worker: allmail-edge`

At runtime the Worker still receives the email first. The Tunnel is only the path that lets the Worker reach your backend `INGRESS_URL` safely.

### Common Tunnel-specific mistakes

- `INGRESS_URL` still points to `127.0.0.1` or a private LAN IP instead of the Tunnel hostname
- `cloudflared` is not running persistently on the cloud server
- the Tunnel hostname routes to the wrong port or wrong protocol
- the backend health check works locally but the Tunnel hostname does not actually reach the same backend instance
- Email Routing is enabled, but the route was not bound to `worker: allmail-edge`

### Tunnel-specific validation

From a machine outside the server, verify the public hostname first:

```bash
curl https://edge.example.com/health
```

Then verify the Worker itself:

```bash
curl https://allmail-edge.<your-subdomain>.workers.dev/health
```

Only after both pass should you send a real email through Email Routing.

## Additional official references

- Workers best practices: <https://developers.cloudflare.com/workers/best-practices/workers-best-practices/>
- Wrangler general commands: <https://developers.cloudflare.com/workers/wrangler/commands/general/>
- Local development for Email Workers: <https://developers.cloudflare.com/email-routing/email-workers/local-development/>
- Email Routing limits: <https://developers.cloudflare.com/email-routing/limits/>
- Cloudflare Tunnel overview: <https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/>
- Cloudflare Tunnel setup: <https://developers.cloudflare.com/tunnel/setup/>
- Cloudflare Tunnel public hostname routing: <https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/>
