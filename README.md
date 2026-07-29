# all-Mail

`all-Mail` is a self-hostable email control plane for operators who need one place to manage:

- external mailbox providers such as Outlook, Gmail, QQ and related IMAP/SMTP families;
- domain mailboxes, aliases and portal users;
- signed inbound ingress for domain mail flows;
- outbound sending and automation-facing mailbox APIs.

The repository is **Docker-first**. The current backend is an incremental Go migration:

- Go owns the public listener, React SPA, health/readiness, trusted-proxy normalization, request IDs and metrics;
- independent Go processes own mailbox forwarding and API-log retention;
- Fastify/Prisma remains an internal compatibility business API for routes not yet ported;
- PostgreSQL and Redis remain private shared state backends.

There is one implementation for each background state machine. The TypeScript jobs runtime and in-revision rollback writer have been removed.

## Product shape

`all-Mail` combines several operator workflows:

- **external mailbox control** — connect and operate provider mailboxes from one admin console;
- **domain mailbox control** — manage domains, mailboxes, aliases and portal access;
- **ingress control** — receive inbound mail through a signed Cloudflare Worker path;
- **outbound sending** — manage send configurations and delivery flows;
- **automation APIs** — expose script-friendly mailbox allocation and message retrieval endpoints.

## Screenshots

| Admin sign-in | Dashboard overview |
| --- | --- |
| ![all-Mail admin sign-in page](./docs/screenshots/login-page.png) | ![all-Mail dashboard overview](./docs/screenshots/dashboard-home.png) |

The screenshots are repository-tracked and sanitized for public documentation.

## Current runtime architecture

```mermaid
flowchart TD
    Operator[Operator] --> GoAPI[app: Go public gateway]
    Automation[Automation client] --> GoAPI
    Edge[Cloudflare Email Worker] --> GoAPI

    GoAPI --> SPA[React SPA]
    GoAPI --> Legacy[legacy-api: Fastify / Prisma business API]

    Legacy --> Postgres[(PostgreSQL)]
    Legacy --> Redis[(Redis)]
    Legacy --> Providers[Mailbox and sending providers]

    Forwarding[worker-forwarding] --> Postgres
    Forwarding --> Providers
    Retention[worker-retention] --> Postgres

    LegacyInit[legacy-init one-shot] --> Postgres
    LegacyInit --> Secrets[Persisted bootstrap secrets]
    GoMigrate[go-migrate one-shot] --> Postgres
    LegacyInit --> GoMigrate
    GoMigrate --> Legacy
    GoMigrate --> GoAPI
    GoMigrate --> Forwarding
    GoMigrate --> Retention
```

The Go gateway does not receive PostgreSQL or Redis credentials while it owns no native business route. Its readiness checks the built SPA and the internal compatibility API; Fastify's `/readyz` performs the database and Redis protocol checks.

### Long-running services

| Service | Responsibility |
| --- | --- |
| `app` | Go public gateway, React SPA, trusted-proxy boundary, readiness, metrics and compatibility API proxy |
| `worker-forwarding` | Go forwarding claim, send, retry, lease and terminal state transitions |
| `worker-retention` | Go API-log retention |
| `legacy-api` | Internal Fastify/Prisma business API for routes not yet ported |
| `postgres` | Application and runtime state; private to the Compose network |
| `redis` | OAuth state, rate-limit, replay and cache support; private to the Compose network |

### One-shot services

| Service | Responsibility |
| --- | --- |
| `legacy-init` | Generate/persist bootstrap secrets, export only the forwarding encryption key and apply Prisma business migrations |
| `go-migrate` | Apply checksummed additive Go migrations through one direct `pgx` transaction |

## Provider support

| Provider family | Typical auth path | Inbox read | Junk read | Clear mailbox | Send |
| --- | --- | --- | --- | --- | --- |
| Outlook | Microsoft OAuth | Yes | Yes | Yes | Yes |
| Gmail | Google OAuth / App Password | Yes | Yes | Google OAuth only | Yes |
| QQ | IMAP / SMTP auth code | Yes | Yes | No | Yes |
| 163 / 126 | IMAP / SMTP auth code | Yes | Yes | No | Yes |
| iCloud / Yahoo / Zoho / Aliyun | IMAP / SMTP app password | Yes | Yes | No | Yes |
| Fastmail / AOL / GMX / Mail.com / Yandex | IMAP / SMTP password or app password | Yes | Yes | No | Yes |
| Amazon WorkMail | IMAP / SMTP password plus region-specific host | Yes | Yes | No | Yes |
| Custom IMAP / SMTP | User-defined server settings | Yes | Yes | No | Yes |

## Quick start

### 1. Create the single production environment file

```bash
cp .env.example .env
```

For Cloudflare Email Routing, edit the same file and set `INGRESS_SIGNING_SECRET`, `INGRESS_ALLOWED_SKEW_SECONDS`, and the appropriate `TRUSTED_PROXY_CIDRS` for the reverse proxy directly connected to `app`. There is no second copied Cloudflare backend template.

### 2. Start the canonical stack

```bash
docker compose up -d --build --wait --wait-timeout 240
docker compose ps -a
```

Expected behavior:

- `legacy-init` exits successfully after bootstrap and Prisma migration work;
- `go-migrate` exits successfully after Go migrations;
- `app`, `worker-forwarding`, `worker-retention`, `legacy-api`, `postgres` and `redis` remain healthy;
- PostgreSQL and Redis are not published to the host by the production Compose file.

### 3. Probe health

```bash
curl http://127.0.0.1:3002/health
curl --fail http://127.0.0.1:3002/readyz

docker compose exec -T app allmail doctor api
docker compose exec -T worker-forwarding allmail doctor worker forwarding
docker compose exec -T worker-retention allmail doctor worker retention
```

Example Go health response:

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "runtime": "go-gateway",
    "compatibilityApiConfigured": true
  }
}
```

### 4. Retrieve a generated first-login password

`JWT_SECRET`, `ENCRYPTION_KEY` and `ADMIN_PASSWORD` may be blank on first boot. `legacy-init` generates missing values and persists them in the legacy runtime volume.

The password is not printed by default:

```bash
docker compose exec legacy-api sh -lc \
  "grep '^ADMIN_PASSWORD=' /var/lib/all-mail/bootstrap-secrets.env | cut -d= -f2-"
```

Set `ALL_MAIL_PRINT_BOOTSTRAP_PASSWORD=true` only for short-lived recovery in a controlled terminal. Change a generated password immediately after first login.

## Trusted proxy contract

The Go listener discards incoming `Forwarded`, `X-Forwarded-*`, `X-Real-IP`, and `CF-Connecting-IP` values from untrusted socket peers. Only peers listed in the comma-separated `TRUSTED_PROXY_CIDRS` may supply a client IP or forwarded protocol. Go then overwrites the downstream headers with one canonical client identity, and the internal Fastify service trusts exactly one hop.

Do not use a blanket trust setting. Keep `legacy-api` internal-only and list only the reverse proxy or tunnel peers that connect directly to `app`.

## Local development infrastructure

Production keeps PostgreSQL and Redis private. Local Fastify development explicitly publishes them through the overlay:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis
```

Equivalent helper:

```bash
./bin/all-mail deps up
```

The overlay defaults to PostgreSQL `127.0.0.1:15433` and Redis `127.0.0.1:6380`.

## Rollback policy

The current revision does not contain a second Node writer. This prevents silent state-machine drift and accidental concurrent ownership.

Rollback means deploying the previous known-good Git revision or image together with the data state that revision expects:

```bash
docker compose down
git switch <known-good-tag-or-commit>
docker compose up -d --build --wait --wait-timeout 240
```

Before a risky migration or upgrade, back up PostgreSQL and the legacy bootstrap-secret volume. Do not run binaries from two revisions against the same forwarding state machine at the same time.

## Development and verification entrypoints

| Command | Purpose |
| --- | --- |
| `npm run dev:api` | Run only the Fastify compatibility API for local development |
| `npm run dev:web` | Run the Vite frontend development server |
| `./bin/all-mail deps up` | Start PostgreSQL and Redis through the development overlay |
| `./bin/all-mail doctor` | Check local env resolution, infrastructure reachability and build artifacts |
| `./bin/all-mail check` | Full repository lint/test/build/worker/audit gate |
| `npm run test:runtime` | Runtime and environment-contract tests |

The repository CLI deliberately does not expose a parallel Node production topology. Production startup remains Docker Compose.

## Documentation map

| Need | Canonical document |
| --- | --- |
| Deploy, update, smoke check and rollback | [`docs/DEPLOY.md`](docs/DEPLOY.md) |
| Day-2 operations and recovery | [`docs/RUNBOOK.md`](docs/RUNBOOK.md) |
| Environment variables and template ownership | [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md) |
| Current Go/Fastify ownership and migration rules | [`docs/GO-MIGRATION.md`](docs/GO-MIGRATION.md) |
| Local API/frontend development | [`docs/advanced-runtime.md`](docs/advanced-runtime.md) |
| Remaining vertical business-route ports | [`docs/internal/rewrite/runtime-consolidation-plan.md`](docs/internal/rewrite/runtime-consolidation-plan.md) |
| External mailbox operations | [`docs/external-email-management-guide.md`](docs/external-email-management-guide.md) |
| Cloudflare ingress | [`CLOUDFLARE-DEPLOY.md`](CLOUDFLARE-DEPLOY.md) |
| Contribution workflow | [`CONTRIBUTING.md`](CONTRIBUTING.md) |

## Repository layout

```text
├── core/                            # Go gateway, workers, migrations and runtime contracts
├── server/                          # Compatibility Fastify/Prisma business API
├── web/                             # React admin console and mailbox portal UI
├── cloudflare/workers/allmail-edge/ # Signed inbound email Worker
├── docker/                          # Compatibility API bootstrap entrypoint
├── scripts/                         # Verification and bootstrap helpers
├── docs/                            # Public operator docs and internal migration notes
├── Dockerfile                       # Go runtime plus built React SPA
├── Dockerfile.legacy                # Compatibility Fastify API runtime
├── docker-compose.yml               # Canonical production topology
└── docker-compose.dev.yml           # Local PostgreSQL/Redis host-port overlay
```

## Remaining migration boundary

Fastify/Prisma still owns admin and mailbox-portal authentication, OAuth, API keys, domain/mailbox management, provider mailbox operations, ingress business handling and the existing business-schema migration history.

Those capabilities must move to Go as vertical slices with authorization, validation, transaction, parity and failure-injection tests. They are intentionally not replaced by one unreviewable all-at-once rewrite.

## License

This repository is released under the custom **all-Mail Non-Commercial License**.

- non-commercial use, study, modification and redistribution are allowed under the license terms;
- commercial use is not allowed without prior written permission;
- contact the repository owner to discuss commercial licensing.
