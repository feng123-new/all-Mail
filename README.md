# all-Mail

`all-Mail` is a self-hostable email control plane for operators who need one place to manage **external mailbox providers**, **domain mailboxes**, **portal users**, **inbound ingress**, and **automation-facing mail APIs**.

It is designed for the gray area between a simple automation inbox helper and a full mail platform: one backend, one admin console, and one deployment shape that can cover Outlook / Gmail / QQ connectors, domain mailboxes, Cloudflare-based inbound routing, outbound sending, and script-friendly retrieval workflows.

> Current repository focus: multi-provider mailbox connectivity, domain-mail closed loop, portal access, outbound sending, Docker deployment, and a clean public-facing repository boundary.

## Why this project exists

Most mailbox tools stop at one narrow slice:

- a narrow automation inbox helper for scripts
- a temporary-email style inbox tool
- a domain mailbox panel with no external provider support
- an inbound-only worker without operator workflows

`all-Mail` tries to combine those concerns into a single operator-facing system:

- **external provider accounts** for Outlook / Gmail / QQ
- **domain mailbox operations** for hosted mailboxes and aliases
- **portal users** who can log in and work with assigned mailboxes
- **inbound ingress** for Cloudflare Email Routing and signed delivery
- **outbound sending** and send-history management
- **automation APIs** for script-driven mailbox retrieval and allocation scenarios

## Product shape

### Control planes in one repository

1. **External mailbox control**  
   Connect and operate Outlook, Gmail, and QQ accounts from one admin console.

2. **Domain mailbox control**  
   Manage domains, domain mailboxes, mailbox users, and message visibility.

3. **Edge ingress control**  
   Receive inbound mail through a Cloudflare Worker and deliver it into the backend through a signed ingress path.

4. **Outbound message control**  
   Manage send configs, outbound messages, and mailbox-originated sending flows.

5. **Automation control**  
   Expose API-key-protected retrieval and allocation APIs for script or verification workflows.

## Key capabilities

| Area | What it does |
|---|---|
| Multi-provider mailbox management | Connect Outlook / Gmail / QQ with OAuth or app-password style flows |
| Unified admin console | One React UI for mailbox, domain, API key, portal, ingress, and send operations |
| Domain mailbox workflows | Create domains, mailboxes, mailbox users, aliases, and message views |
| Portal access | Let mailbox users sign in and work with assigned mailboxes |
| Signed inbound ingress | Accept Cloudflare-routed mail through a dedicated worker + backend ingress path |
| Outbound sending | Send and track outbound messages through configured mailbox/domain paths |
| Automation-facing APIs | Script-friendly mailbox allocation, message reading, and access-scoped automation workflows |

## Provider support

| Provider | Access model | Inbox read | Junk read | Clear mailbox | Send |
|---|---|---|---|---|---|
| Outlook | Microsoft OAuth | Yes | Yes | Yes | Yes |
| Gmail | Google OAuth / App Password | Yes | Yes | Google OAuth only | Yes |
| QQ | IMAP / SMTP auth code | Yes | Yes | No | Yes |

## Screenshots

This private sanitized push intentionally omits repository screenshots until all UI captures have been reviewed and redacted for real mailbox addresses, tenant/application identifiers, and operator-side metadata.

## Repository strengths that already stand on their own

These areas already give `all-Mail` a stronger identity than a generic mailbox automation project:

- **domain mailbox management** — `server/src/modules/domain/*`, `server/src/modules/domain-mailbox/*`, `web/src/pages/domains/index.tsx`, `web/src/pages/domain-mailboxes/index.tsx`
- **mailbox portal users** — `server/src/modules/mailbox-user/*`, `web/src/pages/mail-portal/*`
- **domain message browsing and ingress** — `server/src/modules/message/*`, `server/src/modules/ingress/*`, `cloudflare/workers/allmail-edge/src/index.ts`
- **outbound sending** — `server/src/modules/send/*`, `web/src/pages/sending-configs/index.tsx`
- **multi-provider provider abstraction** — `server/src/modules/mail/providers/*`
- **operational deployment docs** — `CLOUDFLARE-DEPLOY.md`, `docs/*`, worker README, security/support docs

## Architecture

- **Frontend**: React + Ant Design + Vite
- **Backend**: Fastify 5 + TypeScript + Prisma 6
- **Database**: PostgreSQL
- **Cache**: Redis
- **Edge ingress**: Cloudflare Worker (`cloudflare/workers/allmail-edge`)
- **Deployment**: Docker + docker compose

## Repository layout

```text
├── server/                              # Fastify + Prisma backend
├── web/                                 # React admin console
├── cloudflare/workers/allmail-edge/     # Signed inbound mail worker
├── gmail_oauth/                         # Gmail OAuth helper tooling
├── oauth-temp/                          # Outlook OAuth helper tooling
├── docs/                                # supporting design / naming / release docs
├── docker-compose.yml
└── Dockerfile
```

## Quick start

### 1. Prepare environment values

Set secrets outside the repository:

```bash
export JWT_SECRET="replace-with-at-least-32-char-random-secret"
export ENCRYPTION_KEY="replace-with-32-character-secret-key"
export ADMIN_PASSWORD="replace-with-strong-password"
```

Copy the example environment file:

```bash
cp .env.example .env
```

Default local ports:

- `APP_PORT=3002`
- `REDIS_PORT=6380`
- `POSTGRES_PORT=15433`

### 2. Start the stack

```bash
docker compose up -d --build
docker compose ps
```

### 3. Health check

```bash
curl http://localhost:3002/health
```

Expected response:

```json
{"success":true,"data":{"status":"ok"}}
```

## OAuth and provider onboarding

### Recommended path

- **Gmail OAuth**: configure callback URI + client secret JSON in the admin UI, generate the auth link, complete Google authorization in a signed-in browser
- **Outlook OAuth**: configure callback URI, client ID / secret, tenant, and scopes in the admin UI, then complete Microsoft authorization
- **QQ / Gmail App Password**: enter provider auth credentials manually in the console

### Outlook OAuth default scope note

The default Outlook OAuth scope bundle is now **Graph-only**. It covers:

- mailbox read/write through Microsoft Graph
- direct sending support
- mailbox settings / contacts / calendar extensions

`https://outlook.office.com/IMAP.AccessAsUser.All` is **not** included in the same default scope string, because it belongs to a different resource than the `https://graph.microsoft.com/*` scopes and cannot be mixed into one Microsoft authorization request.

If you explicitly need Outlook IMAP OAuth, request the IMAP scope in a separate authorization flow or use a dedicated IMAP-oriented scope override.

## API surfaces

### Admin APIs

- `/admin/auth/*`
- `/admin/dashboard/*`
- `/admin/emails/*`
- `/admin/email-groups/*`
- `/admin/domains/*`
- `/admin/domain-mailboxes/*`
- `/admin/domain-messages/*`
- `/admin/mailbox-users/*`
- `/admin/send/*`
- `/admin/api-keys/*`

### External automation APIs

All external APIs use API-key-based access control.

Current compatibility endpoints include mailbox allocation, latest-message access, text extraction, mailbox listing, and allocation-reset flows. The public documentation now uses the new resource-oriented path families; legacy script paths remain as compatibility aliases during migration.

Example:

```bash
curl "http://localhost:3002/api/messages/text?email=example@gmail.com&match=\\d{6}" \
  -H "X-API-Key: sk_xxx"
```

## Quality gates

```bash
# web
cd web
npm run lint
npm run build

# server
cd ../server
npm run lint
npm run build
npm run test

# worker
cd ../cloudflare/workers/allmail-edge
npm run check
```

## Security posture

- secrets should stay in environment variables, not tracked files
- runtime OAuth outputs and helper artifacts should never be committed
- screenshots intended for the public repo should be sanitized first
- current production dependency trees for `web`, `server`, and `allmail-edge` are expected to pass `npm audit --omit=dev`

## Open-source release status

From a technical perspective, the repository can now pass lint/build/test and production dependency audit checks.  
From a release-governance perspective, public release still depends on confirming provenance and redistribution rights for any historically derived areas.

If you plan to publish this repository, review:

- `PROVENANCE.md`
- `docs/open-source-release-checklist.md`
- `docs/gongxi-rewrite-boundary-checklist.md`

## Provenance and release note

This repository acknowledges earlier projects that informed parts of its evolution, but the main product narrative, docs, naming, deployment path, and current scope are centered on `all-Mail` itself.

That said, if you intend to make the repository public, provenance is not just a courtesy issue — it is also a release-governance issue. Resolve that first, then publish.

## Related docs

- `PROVENANCE.md` — project origin and acknowledgement boundary
- `docs/open-source-release-checklist.md` — release closure checklist for going public
- `docs/gongxi-rewrite-boundary-checklist.md` — which areas should be rewritten first if you want stronger independence from GongXi-Mail-like flows
- `MULTI_PROVIDER_CLOSED_LOOP.md` — multi-provider design notes
- `CLOUDFLARE-DEPLOY.md` — Cloudflare deployment entrypoint
- `docs/external-email-management-guide.md` — provider operation guide
- `docs/naming-conventions.md` — all-Mail naming rules
- `CONTRIBUTING.md`, `SECURITY.md`, `SUPPORT.md`, `CHANGELOG.md`

## License

MIT
