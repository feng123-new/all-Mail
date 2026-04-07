# allmail-edge Worker

Thin Cloudflare Email Worker for the all-Mail domain-mail ingress.

> Main deployment guide: `CLOUDFLARE-DEPLOY.md` in the repository root.
> Use the root guide for the full production runbook: prerequisites, `.dev.vars` meaning, Cloudflare Dashboard binding steps, validation, troubleshooting, and rollback.

## Purpose

- receive inbound email from Cloudflare Email Routing
- optionally persist raw `.eml` content to R2
- normalize the envelope/body into the backend ingress payload
- sign and `POST` it to `/ingress/domain-mail/receive`

The Worker does **not** own mailbox business logic. Domain resolution, alias handling, catch-all behavior, portal visibility, and storage all stay in the Fastify backend.

## Files

- `wrangler.jsonc` — Worker config and non-secret vars
- `.dev.vars.example` — local/dev template
- `src/index.ts` — Worker entrypoints
- `scripts/post-signed-fixture.mjs` — signed ingress smoke helper

## Backend preflight

Before deploying the Worker:

1. make sure the backend has `INGRESS_SIGNING_SECRET`
2. run `./scripts/sanitize-runtime-env.sh npm --prefix server run ingress:ensure`
3. confirm the backend can receive `POST /ingress/domain-mail/receive`

## Secrets and vars

### Secret

```bash
export CLOUDFLARE_API_TOKEN=your-cloudflare-api-token
npx wrangler secret put INGRESS_SIGNING_SECRET
```

### Vars

Edit `wrangler.jsonc` or `.dev.vars` with your own values:

- `INGRESS_URL`
- `INGRESS_KEY_ID`
- `INGRESS_PROVIDER`
- `RAW_EMAIL_OBJECT_PREFIX`
- `RAW_EMAIL_BUCKET_NAME`

## Local verification

```bash
./scripts/sanitize-runtime-env.sh npm --prefix cloudflare/workers/allmail-edge install
./scripts/sanitize-runtime-env.sh npm --prefix cloudflare/workers/allmail-edge run check
```

Signed payload smoke against a local backend ingress:

```bash
INGRESS_URL=http://127.0.0.1:3002/ingress/domain-mail/receive \
INGRESS_KEY_ID=allmail-edge-main \
INGRESS_SIGNING_SECRET=replace-me \
MATCHED_ADDRESS=inbox@example.com \
node scripts/post-signed-fixture.mjs
```

## Deploy

```bash
./scripts/sanitize-runtime-env.sh npm --prefix cloudflare/workers/allmail-edge install
./scripts/sanitize-runtime-env.sh npm --prefix cloudflare/workers/allmail-edge run doctor
./scripts/sanitize-runtime-env.sh npm --prefix cloudflare/workers/allmail-edge run deploy:prod
```

After deploy, finish the Email Routing address/worker binding in the Cloudflare Dashboard and run:

```bash
./scripts/sanitize-runtime-env.sh npm --prefix cloudflare/workers/allmail-edge run doctor -- --postdeploy
```

If your shell exports `NODE_USE_ENV_PROXY` or `HTTP[S]_PROXY`, keep using the wrapped commands above. They sanitize those startup flags before Node/npm bootstraps, which avoids noisy `UNDICI-EHPA` warnings during worker operations.

## Public repo hygiene

- do not commit `.dev.vars`
- do not store live account state, screenshots, or tunnel logs in this directory
- keep production domains in private operator notes, not in repository examples
