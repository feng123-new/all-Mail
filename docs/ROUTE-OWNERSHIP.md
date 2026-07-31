# Route ownership and migration telemetry

## Purpose

`config/route-ownership.json` is the canonical public route-and-method ownership contract. It decides which runtime handles a request, which stable route-family label appears in metrics, and which private upstream receives business traffic.

Ownership changes only through reviewed source control. There is no environment variable that can silently switch implementations.

## Owners

| Owner | Meaning |
| --- | --- |
| `go` | The public gateway handles the route directly, including system endpoints and the React SPA fallback. |
| `go-business-api` | The public gateway forwards to the private migrated Go business service. |
| `business-api` | The public gateway forwards to the remaining Fastify/Prisma service. |

The public `app` has no database URL, Redis URL, JWT secret, or encryption key.

## Method-aware matching

Manifest version 2 supports:

| Field | Meaning |
| --- | --- |
| `match: exact` | Match only the declared path. |
| `match: prefix` | Match the path and slash-separated descendants. |
| `match: fallback` | Final Go-owned SPA route. |
| `methods` | Optional bounded HTTP method list; omitted means all methods. |

Supported methods are:

```text
GET HEAD POST PUT PATCH DELETE OPTIONS
```

Exact routes win first, prefixes are evaluated longest-prefix-first, and fallback runs last. Routes may share a path only when their method sets do not overlap.

## Migration states

| State | Meaning |
| --- | --- |
| `complete` | The route is owned by Go and has no target owner. |
| `observing` | Fastify still owns the route while behavior or traffic is measured. |
| `pending` | Fastify owns the route and a later Go owner is declared. |

The loader rejects unsupported versions, unknown fields, invalid owners or methods, duplicate IDs, overlapping path/method matchers, unsafe completed ownership, missing fallback, invalid targets, and trailing JSON.

## Current Dashboard ownership

All implemented Dashboard operations are now Go-owned:

```text
GET    /admin/dashboard/stats
GET    /admin/dashboard/api-trend
GET    /admin/dashboard/logs
DELETE /admin/dashboard/logs/:id
POST   /admin/dashboard/logs/batch-delete
```

The private `go-business-api`:

- verifies HS256 tokens with issuer `all-mail` and audience `admin-console`;
- compares durable administrator session versions;
- reloads the administrator from PostgreSQL;
- rejects missing, disabled, stale-session, or mandatory-password-change accounts;
- bounds query and batch parameters;
- preserves the response envelope and request ID;
- deletes logs transactionally;
- writes an administrator audit record in the same transaction.

The general `/admin/dashboard` catch-all remains Fastify-owned for unknown or future methods. Fastify Dashboard handlers remain as revision rollback code and receive no traffic for methods explicitly owned by Go.

## API-key and database external routes

`go-business-api` owns the complete administrator API-key surface, explicit fail-closed permissions, hash authentication, status and expiry checks, Redis limiting, usage accounting, resource scopes, allocation state, and request auditing.

It also owns the complete external mailbox account, OAuth configuration/state, and sending administration prefixes:

```text
/admin/emails/**
/admin/oauth/**
/admin/send/**
/oauth
```

Database-only external routes are also exact Go-owned entries:

```text
/api/get-email and /api/mailboxes/allocate
/api/list-emails and /api/mailboxes
/api/pool-stats and /api/mailboxes/allocation-stats
/api/reset-pool and /api/mailboxes/allocation-reset
/api/mail_new and /api/messages/latest
/api/mail_all and /api/messages
/api/process-mailbox and /api/mailboxes/clear
/api/domain-mail/get-mailbox and /api/domain-mail/mailboxes/allocate
/api/domain-mail/messages/latest and /api/domain-mail/mail_new
/api/domain-mail/messages and /api/domain-mail/mail_all
/api/domain-mail/list-mailboxes and /api/domain-mail/mailboxes
/api/domain-mail/pool-stats and /api/domain-mail/mailboxes/allocation-stats
/api/domain-mail/reset-pool and /api/domain-mail/mailboxes/allocation-reset
```

Provider-dependent Gmail, Graph, IMAP, SMTP, OAuth, and Resend operations are Go-owned with a provider timeout separate from the database query timeout. JavaScript regular-expression text extraction remains on `business-api`; exact entries for `/api/domain-mail/messages/text` and `/api/domain-mail/mail_text` prevent broader Go message routes from taking those compatibility endpoints.

## Runtime loading and inspection

The Go image contains the reviewed manifest at:

```text
/app/config/route-ownership.json
```

Selected by:

```text
ALL_MAIL_ROUTE_OWNERSHIP_FILE=/app/config/route-ownership.json
```

The process fails before listening if the manifest is missing or unsafe. Inspect the active version, digest, and route set with:

```bash
docker compose exec -T app allmail routes
```

`/health` publishes the manifest version, digest, and route count. `/readyz` reports `routeOwnership=ok` and requires both private business upstreams to be ready.

## Response diagnostics

Every public response contains one canonical pair:

```text
X-All-Mail-Route-Owner: go | go-business-api | business-api
X-All-Mail-Route-Family: <stable-family-id>
```

Client-supplied values are stripped and upstream-forged values are overwritten.

Examples:

```text
GET /health
  owner: go
  family: system-health

GET /admin/dashboard/stats
  owner: go-business-api
  family: admin-dashboard-stats-read

DELETE /admin/dashboard/logs/42
  owner: go-business-api
  family: admin-dashboard-log-delete

POST /admin/dashboard/logs/batch-delete
  owner: go-business-api
  family: admin-dashboard-log-batch-delete

GET /api/domain-mail/messages/text
  owner: business-api
  family: domain-message-text

GET /settings/domains
  owner: go
  family: spa
```

## Prometheus metrics

The public `/metrics` endpoint exports bounded route-family metrics:

```text
allmail_route_manifest_info
allmail_route_owner_info
allmail_route_inflight_requests
allmail_route_requests_total
allmail_route_request_duration_seconds
allmail_business_proxy_errors_total
```

Request methods are restricted to `GET POST PUT PATCH DELETE HEAD OPTIONS OTHER`; arbitrary methods collapse to `OTHER`. Status labels are bounded to classes. Raw paths, identities, addresses, API keys, request IDs, secrets, and error text never become labels.

Proxy errors identify both family and private upstream:

```text
allmail_business_proxy_errors_total{family="...",upstream="go-business-api|business-api"}
```

Non-zero Fastify traffic or errors block deletion of a rollback handler.

## Cutover requirements

A route migration must include:

1. a private Go handler and data-access implementation;
2. equivalent authentication and authorization;
3. bounded validation and response-shape parity;
4. transaction, cancellation, and failure tests where applicable;
5. audit and request-ID behavior;
6. the method-aware owner change;
7. public-gateway Docker smoke;
8. readiness and secret-isolation checks;
9. a revision rollback path;
10. a later observation window before deleting the Fastify handler.

Rollback is revision-based. Never introduce a mutable dual writer or environment-controlled owner switch.

## Final deletion gate

`business-api`, `business-init`, Prisma, `server/`, and `Dockerfile.server` remain required until every public method is Go-owned, Fastify traffic is zero for the agreed period, Go owns the complete schema and migration ledger, historical ciphertext remains readable, and install/upgrade/restore/rollback no longer need Node. The final image and SBOM must contain neither Node nor Prisma.
