# all-Mail Cloudflare deployment guide

## Boundary

This document covers the Cloudflare-specific ingress path for `cloudflare/workers/allmail-edge`.

- Use [`docs/DEPLOY.md`](docs/DEPLOY.md) for the main stack.
- Use [`docs/RUNBOOK.md`](docs/RUNBOOK.md) for shared backend recovery.
- Use [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md) for variable ownership.

The Worker receives Cloudflare Email Routing traffic and forwards a signed payload to the **Go public gateway**. Go normalizes trusted client identity, then proxies the unported ingress business route to the internal Fastify API.

```text
Cloudflare Email Routing
          |
          v
allmail-edge Worker
          |
          | HTTPS + HMAC signature
          v
trusted tunnel / reverse proxy
          |
          v
app: Go public gateway
          |
          v
legacy-api: /ingress/domain-mail/receive
          |
          v
PostgreSQL
```

## Backend preparation

There is one backend production template:

```bash
cp .env.example .env
```

Set at least:

```env
INGRESS_SIGNING_SECRET=<strong-random-secret>
INGRESS_ALLOWED_SKEW_SECONDS=300
PUBLIC_BASE_URL=https://mail.example.com
TRUSTED_PROXY_CIDRS=<cidrs-of-the-tunnel-or-proxy-directly-connected-to-app>
```

`TRUSTED_PROXY_CIDRS` must contain the direct peer of the Go listener, not arbitrary public client networks. The Go gateway rejects externally supplied forwarded-IP headers from any other peer and writes one canonical client address downstream.

Do not use `0.0.0.0/0` or `::/0`, and do not expose `legacy-api` directly.

Start and validate:

```bash
docker compose up -d --build --wait --wait-timeout 240
curl --fail http://127.0.0.1:3002/readyz
docker compose exec -T app allmail doctor api
docker compose exec -T worker-forwarding allmail doctor worker forwarding
docker compose exec -T worker-retention allmail doctor worker retention
```

The Go gateway no longer carries PostgreSQL or Redis credentials. Its readiness validates the SPA and Fastify `/readyz`; Fastify performs PostgreSQL and Redis protocol checks.

## Worker configuration

```bash
cd cloudflare/workers/allmail-edge
cp .dev.vars.example .dev.vars
```

Fill:

```env
INGRESS_URL=https://mail.example.com/ingress/domain-mail/receive
INGRESS_KEY_ID=allmail-edge-main
INGRESS_PROVIDER=CLOUDFLARE_EMAIL_ROUTING
RAW_EMAIL_OBJECT_PREFIX=allmail-edge/raw
RAW_EMAIL_BUCKET_NAME=mail-eml
INGRESS_SIGNING_SECRET=<same-secret-as-backend>
```

| Variable | Meaning |
| --- | --- |
| `INGRESS_URL` | Public Go gateway URL for the ingress route |
| `INGRESS_KEY_ID` | Identifier shared with the backend endpoint record |
| `INGRESS_PROVIDER` | Provider label stored with ingress records |
| `RAW_EMAIL_OBJECT_PREFIX` | R2 prefix for raw `.eml` files |
| `RAW_EMAIL_BUCKET_NAME` | R2 bucket used by the Worker |
| `INGRESS_SIGNING_SECRET` | HMAC secret uploaded as a Worker secret |

Do not keep `replace-with-*` placeholders or commit `.dev.vars`.

## Ensure the backend endpoint

From the repository root, with the active backend environment:

```bash
./scripts/sanitize-runtime-env.sh npm --prefix server run ingress:ensure
./scripts/sanitize-runtime-env.sh npm --prefix server run ingress:check
```

The check should report:

- an active endpoint;
- the expected `INGRESS_KEY_ID`;
- `signingKeyHashMatchesEnv: true`.

These scripts administer the current Fastify business schema. Normal inbound traffic still enters through Go.

## Validate and deploy

```bash
cd cloudflare/workers/allmail-edge
npm ci
npm run check
npm run doctor
npm run deploy:prod
```

Cloudflare Dashboard work remains manual where account/domain decisions are required:

1. enable Email Routing;
2. create or verify the Worker route/subdomain;
3. create or verify the Tunnel/public hostname that reaches `app`;
4. bind an address or catch-all rule to `allmail-edge`.

## End-to-end validation

1. Verify the public gateway:

```bash
curl --fail https://mail.example.com/health
curl --fail https://mail.example.com/readyz
```

2. Send a real message through the configured Email Routing address.
3. Inspect the owning services:

```bash
docker compose logs app --tail=200
docker compose logs legacy-api --tail=200
docker compose logs worker-forwarding --tail=200
```

4. Confirm the inbound record exists.
5. Confirm the R2 object exists when raw persistence is enabled.
6. Confirm forwarding transitions when the mailbox has forwarding enabled.

A newly created empty R2 bucket is normal; objects are written only when real email arrives.

## Client-IP validation

After the tunnel is configured, perform an admin login or a controlled request and confirm the Fastify audit/login IP is the real client address supplied by the trusted tunnel.

Also send a direct request with forged headers from an untrusted peer:

```bash
curl -H 'X-Forwarded-For: 203.0.113.99' \
  -H 'CF-Connecting-IP: 203.0.113.100' \
  http://127.0.0.1:3002/health
```

Those values must not be accepted as client identity.

## Troubleshooting

### Backend returns 401/403

Check:

- backend and Worker HMAC secrets match;
- `INGRESS_KEY_ID` maps to an active endpoint;
- request body is not modified after signing;
- clocks fit `INGRESS_ALLOWED_SKEW_SECONDS`;
- `INGRESS_URL` reaches `app`, not `legacy-api`.

```bash
docker compose logs app --tail=200
docker compose logs legacy-api --tail=300
./scripts/sanitize-runtime-env.sh npm --prefix server run ingress:check
```

### Backend returns 502/503

```bash
curl -i https://mail.example.com/readyz
docker compose exec -T app allmail doctor api
docker compose logs app --tail=200
docker compose logs legacy-api --tail=200
```

A 502 usually means the compatibility API is unavailable. The Go readiness response reports SPA or compatibility API failure; database/Redis detail remains inside Fastify readiness.

### Real client IP is missing

- confirm the tunnel/proxy is the socket peer directly connected to `app`;
- add only that peer CIDR to `TRUSTED_PROXY_CIDRS`;
- confirm the proxy emits `CF-Connecting-IP`, `X-Real-IP`, or `X-Forwarded-For`;
- recreate `app` after changing `.env`;
- never compensate by enabling blanket proxy trust in Fastify.

### Signature mismatch after rotation

1. update the backend `.env`;
2. recreate `legacy-api` as needed;
3. upload the same secret to the Worker;
4. redeploy;
5. run `ingress:check` and a real delivery test.

The current global-secret model does not provide overlapping key versions; avoid a long mismatch window.

### R2 write failure

Check the bucket binding, API token permissions, Wrangler environment, object prefix, and Worker logs. An R2 error is separate from a forwarding worker error; diagnose the owning component.

## Rollback

- Worker: deploy the previous known-good Worker version and restore matching vars/secrets.
- Backend: deploy the previous repository revision/image with its matching `.env` contract.

Never expose or commit Worker secrets, Tunnel tokens, or account credentials.
