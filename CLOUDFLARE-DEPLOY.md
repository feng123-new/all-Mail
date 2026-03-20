# all-Mail Cloudflare Deployment Guide

This guide documents the public-safe deployment path for the `cloudflare/workers/allmail-edge` worker.

## What this covers

- preparing the Worker vars and secret
- validating the Worker locally
- deploying with Wrangler
- connecting Cloudflare Email Routing to `allmail-edge`

## What still requires manual confirmation

These steps intentionally stay manual because they are account/domain specific:

1. add your domain to Cloudflare
2. enable Email Routing for that domain
3. create the public hostname / tunnel path that reaches your backend ingress
4. point the Email Routing rule to `worker: allmail-edge`

## Expected deployment flow

```bash
export CLOUDFLARE_API_TOKEN=your-cloudflare-api-token
cd cloudflare/workers/allmail-edge
cp .dev.vars.example .dev.vars   # first time only
npm install                      # first time only
npm run deploy:prod
```

`npm run deploy:prod` will:

1. validate `.dev.vars`
2. run Worker lint / typecheck / tests
3. ensure the backend ingress endpoint exists
4. check or create the configured R2 bucket
5. upload `INGRESS_SIGNING_SECRET` to Cloudflare
6. deploy the Worker
7. run a post-deploy health check against the generated `workers.dev` URL

## Required values

### Shell environment

- `CLOUDFLARE_API_TOKEN`

### `.dev.vars`

```env
INGRESS_URL=https://edge.example.com/ingress/domain-mail/receive
INGRESS_KEY_ID=allmail-edge-main
INGRESS_PROVIDER=CLOUDFLARE_EMAIL_ROUTING
RAW_EMAIL_OBJECT_PREFIX=allmail-edge/raw
RAW_EMAIL_BUCKET_NAME=mail-eml
INGRESS_SIGNING_SECRET=replace-with-the-same-secret-used-by-server
```

### Backend prerequisites

The backend must expose `/ingress/domain-mail/receive` and use the same `INGRESS_SIGNING_SECRET` as the Worker.

Useful checks:

```bash
cd server
npm run ingress:ensure
npm run ingress:check
```

## Suggested first deployment sequence

1. prepare backend env and start the app
2. run `npm run ingress:ensure` in `server/`
3. copy `.dev.vars.example` to `.dev.vars`
4. fill in your Cloudflare-facing values
5. run `npm run doctor`
6. run `npm run deploy:prod`
7. in Cloudflare Dashboard, connect Email Routing to `worker: allmail-edge`
8. send a test message through your own domain to verify ingress end-to-end

## Notes

- Do not commit `.dev.vars`, real tokens, or live account state snapshots.
- Keep production domains and account IDs out of public docs; use placeholders such as `example.com`.
- If you need host-specific tunnel or browser-operation notes, keep them in a private operator runbook rather than this repository.
