# all-Mail Cloudflare deployment guide

## Boundary

This document covers the Cloudflare-specific ingress path for `cloudflare/workers/allmail-edge`.

- Use [`docs/DEPLOY.md`](docs/DEPLOY.md) for the main stack.
- Use [`docs/RUNBOOK.md`](docs/RUNBOOK.md) for backend recovery.
- Use [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md) for variable ownership.

The Worker receives Cloudflare Email Routing traffic and forwards a signed payload through the public Go gateway to the private Go business API.

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
go-business-api: POST /ingress/domain-mail/receive
          |
          v
PostgreSQL + Redis
```

## Backend preparation

Create the production environment file:

```bash
cp .env.example .env
```

Set at least:

```env
INGRESS_SIGNING_SECRET=<strong-random-secret>
INGRESS_IMPORT_KEY_ID=allmail-edge-main
INGRESS_ALLOWED_SKEW_SECONDS=300
PUBLIC_BASE_URL=https://mail.example.com
TRUSTED_PROXY_CIDRS=<cidrs-of-the-tunnel-or-proxy-directly-connected-to-app>
```

`INGRESS_SIGNING_SECRET` and `INGRESS_IMPORT_KEY_ID` are one-shot initializer inputs. The temporary initializer encrypts the secret into the endpoint selected by the key ID. `go-business-api` receives neither value in its environment and decrypts the stored endpoint secret through its read-only encryption-key file.

`TRUSTED_PROXY_CIDRS` must contain the direct peer of `app`, not arbitrary public client networks. Never use `0.0.0.0/0` or `::/0`, and do not expose `go-business-api`.

Start with the canonical helper:

```bash
./scripts/compose-up.sh
curl --fail http://127.0.0.1:3002/readyz
docker compose exec -T app allmail doctor api
docker compose exec -T go-business-api allmail doctor business-api
docker compose exec -T worker-forwarding allmail doctor worker forwarding
docker compose exec -T worker-retention allmail doctor worker retention
```

Public readiness requires the SPA and `go-business-api`; private readiness checks PostgreSQL and Redis.

Confirm the imported endpoint without exposing secret material:

```bash
docker compose exec postgres psql \
  -U "${POSTGRES_USER:-allmail}" \
  -d "${POSTGRES_DB:-allmail}" \
  -c "SELECT key_id, status, signing_secret_encrypted IS NOT NULL AS configured FROM ingress_endpoints WHERE key_id = 'allmail-edge-main'"
```

After verification, remove populated one-shot import values from the production `.env` backup policy as described in [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md). Keep the Worker secret in Cloudflare secret storage.

## Worker configuration

```bash
cd cloudflare/workers/allmail-edge
cp .dev.vars.example .dev.vars
```

Use `.dev.vars` for local Worker execution. Set the corresponding non-secret production values in `wrangler.jsonc` before deployment; `npm run deploy` reads `wrangler.jsonc`.

Fill:

```env
INGRESS_URL=https://mail.example.com/ingress/domain-mail/receive
INGRESS_KEY_ID=allmail-edge-main
INGRESS_PROVIDER=CLOUDFLARE_EMAIL_ROUTING
RAW_EMAIL_OBJECT_PREFIX=allmail-edge/raw
RAW_EMAIL_BUCKET_NAME=mail-eml
MAX_RAW_EMAIL_BYTES=15728640
WORKER_HEALTH_URL=https://edge.example.com/health
INGRESS_SIGNING_SECRET=<same-secret-imported-by-the-backend>
```

| Variable | Meaning |
| --- | --- |
| `INGRESS_URL` | Public `app` URL for the ingress route |
| `INGRESS_KEY_ID` | Identifier matching the encrypted backend endpoint |
| `INGRESS_PROVIDER` | Provider label stored with ingress records |
| `RAW_EMAIL_OBJECT_PREFIX` | R2 prefix for raw `.eml` files |
| `RAW_EMAIL_BUCKET_NAME` | R2 bucket used by the Worker |
| `MAX_RAW_EMAIL_BYTES` | In-memory parsing limit; default 15 MiB, hard ceiling 25 MiB |
| `WORKER_HEALTH_URL` | Optional custom HTTPS route for post-deploy checks |
| `INGRESS_SIGNING_SECRET` | HMAC secret uploaded through Wrangler secret storage |

Do not commit `.dev.vars` or leave `replace-with-*` placeholders.

## Validate and deploy

```bash
cd cloudflare/workers/allmail-edge
npm ci
npm run check
npm run types
export CLOUDFLARE_API_TOKEN=<scoped-token>
npx wrangler secret put INGRESS_SIGNING_SECRET
npm run deploy
```

The secret entered into Wrangler must match the value imported into the backend endpoint. The committed Worker configuration enables `nodejs_compat`, disables the public `workers.dev` endpoint, and exposes only a minimal health response.

Cloudflare Dashboard work remains manual where account or domain decisions are required:

1. enable Email Routing;
2. create or verify the Worker route/subdomain;
3. create or verify the tunnel/public hostname that reaches `app`;
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
docker compose logs go-business-api --tail=200
docker compose logs worker-forwarding --tail=200
```

4. Confirm the inbound record exists.
5. Confirm the R2 object exists when raw persistence is enabled.
6. Confirm forwarding transitions when the mailbox has forwarding enabled.

A newly created empty R2 bucket is normal; objects are written only when real email arrives.

## Client-IP validation

After configuring the tunnel, perform a controlled request and confirm login/audit state records the real client address supplied by the trusted direct peer.

Send a direct request with forged headers from an untrusted peer:

```bash
curl -H 'X-Forwarded-For: 203.0.113.99' \
  -H 'CF-Connecting-IP: 203.0.113.100' \
  http://127.0.0.1:3002/health
```

Those values must not be accepted as client identity.

## Troubleshooting

### Backend returns 401 or 403

Check:

- the Worker secret matches the encrypted endpoint secret;
- `INGRESS_KEY_ID` maps to an active configured endpoint;
- the request body is unchanged after signing;
- clocks fit `INGRESS_ALLOWED_SKEW_SECONDS`;
- `INGRESS_URL` reaches `app`, not the private service.

```bash
docker compose logs app --tail=200
docker compose logs go-business-api --tail=300
```

### Backend returns 502 or 503

```bash
curl -i https://mail.example.com/readyz
docker compose exec -T app allmail doctor api
docker compose exec -T go-business-api allmail doctor business-api
docker compose logs app --tail=200
docker compose logs go-business-api --tail=200
```

A 502 usually means the private API is unavailable. A 503 from readiness can indicate unavailable SPA assets, PostgreSQL, or Redis; inspect the corresponding readiness payload and private logs.

### Real client IP is missing

- Confirm the tunnel/proxy is the socket peer directly connected to `app`.
- Add only that peer CIDR to `TRUSTED_PROXY_CIDRS`.
- Confirm the proxy emits `CF-Connecting-IP`, `X-Real-IP`, or `X-Forwarded-For`.
- Rerun `./scripts/compose-up.sh` after changing `.env`.
- Never compensate with blanket proxy trust.

### Signature mismatch after secret change

The initializer accepts repeated imports only when the encrypted database value matches. It is not a secret-rotation interface and conflicting values fail closed. Restore the matching Worker secret or follow a reviewed backend endpoint-rotation procedure, then update Wrangler secret storage and deploy the Worker without a long mismatch window.

### R2 write failure

Check the bucket binding, API token permissions, Wrangler environment, object prefix, and Worker logs. An R2 error is separate from a forwarding worker error.

## Rollback

- Worker: deploy the previous known-good Worker version and restore its matching secret and variables.
- Backend: stop the stack, restore the matching database and secret volumes when required, select the compatible repository revision, and run `./scripts/compose-up.sh`.

Never expose or commit Worker secrets, tunnel tokens, or account credentials.
