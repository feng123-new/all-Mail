# Route ownership and migration telemetry

## Purpose

`config/route-ownership.json` is the canonical public route-and-method ownership contract for `all-Mail`. It determines which runtime owns a request, which stable route-family label appears in metrics, and which private upstream receives migrated or remaining business traffic.

Ownership changes only through reviewed source control. There is no environment flag that can silently move production traffic between implementations.

## Owners

| Owner | Meaning |
| --- | --- |
| `go` | The public Go gateway handles the route directly, including system endpoints and the React SPA fallback. |
| `go-business-api` | The public gateway forwards the route to the private Go business service. |
| `business-api` | The public gateway forwards the route to the private Fastify/Prisma business API. |

The public `app` has no database URL, Redis URL, JWT secret, or encryption key. Database-backed Go handlers live in `go-business-api`, not in the Internet-facing gateway.

## Method-aware match semantics

Manifest version 2 supports:

| Field | Meaning |
| --- | --- |
| `match: exact` | Match only the declared path. |
| `match: prefix` | Match the path and slash-separated descendants; `/admin` does not match `/administrator`. |
| `match: fallback` | Final Go-owned SPA route when no exact or prefix route matches. |
| `methods` | Optional bounded list of HTTP methods. Omitted means all methods. |

Supported method values are:

```text
GET HEAD POST PUT PATCH DELETE OPTIONS
```

Matching uses the request method plus path. Exact routes win first, prefix routes are evaluated longest-prefix-first, and the SPA fallback runs last. Two routes may share the same path only when their method sets do not overlap.

This allows a read-only vertical cutover without accidentally moving writes. For example:

```text
GET    /admin/dashboard/logs      -> go-business-api
DELETE /admin/dashboard/logs/:id  -> business-api
POST   /admin/dashboard/logs/batch-delete -> business-api
```

## Migration states

| State | Meaning |
| --- | --- |
| `complete` | A route is owned by `go` or `go-business-api` and has no target owner. |
| `observing` | A route remains Fastify-owned while behavior and traffic are measured. |
| `pending` | A route remains Fastify-owned and targets a Go owner later. |

The loader rejects unsupported versions, unknown fields, invalid owners or methods, duplicate IDs, overlapping path/method matchers, missing fallback routes, unsafe completed ownership, invalid target owners, and trailing JSON.

## Current Dashboard split

The first database-backed Go cutover is complete for these reads:

```text
GET /admin/dashboard/stats
GET /admin/dashboard/api-trend
GET /admin/dashboard/logs
```

They are owned by `go-business-api`. The private service:

- verifies the existing HS256 administrator token;
- requires audience `admin-console`;
- reloads the administrator from PostgreSQL;
- rejects missing or disabled administrators;
- preserves `mustChangePassword` enforcement;
- validates query parameters;
- queries PostgreSQL in UTC;
- preserves the existing success/error envelope and request ID.

These writes remain on Fastify until audit and transaction parity is implemented:

```text
DELETE /admin/dashboard/logs/:id
POST   /admin/dashboard/logs/batch-delete
```

The old Fastify read handlers remain temporarily for revision rollback. Do not delete them until production metrics prove their Fastify proxy traffic is zero for the agreed observation window.

## Runtime loading and inspection

The Go image contains the exact manifest at:

```text
/app/config/route-ownership.json
```

The internal path is selected by:

```text
ALL_MAIL_ROUTE_OWNERSHIP_FILE=/app/config/route-ownership.json
```

The process fails before listening if the file is missing or unsafe. Inspect the loaded version and SHA-256 digest with:

```bash
docker compose exec -T app allmail routes
```

`/health` publishes the manifest version, digest, and route count. `/readyz` reports `routeOwnership=ok` and requires both private business upstreams to be ready.

## Response diagnostics

Every public response includes exactly one canonical pair:

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
  owner: business-api
  family: admin-dashboard-log-delete

GET /settings/domains
  owner: go
  family: spa
```

## Prometheus metrics

The public Go `/metrics` endpoint exports bounded route-family metrics:

```text
allmail_route_manifest_info
allmail_route_owner_info
allmail_route_inflight_requests
allmail_route_requests_total
allmail_route_request_duration_seconds
allmail_business_proxy_errors_total
```

`allmail_route_owner_info` includes the committed method list. Request method labels are restricted to:

```text
GET POST PUT PATCH DELETE HEAD OPTIONS OTHER
```

Unknown client method strings collapse to `OTHER`, preventing unbounded time series and memory growth. Status labels are limited to `1xx`, `2xx`, `3xx`, `4xx`, `5xx`, and `other`. Raw paths, user IDs, domains, mailbox addresses, API keys, request IDs, secrets, and error text never become metric labels.

Proxy error metrics identify both the stable family and private upstream:

```text
allmail_business_proxy_errors_total{family="...",upstream="go-business-api|business-api"}
```

A non-zero rate blocks deletion or further cutover for that route family.

## Cutover requirements

A route/method migration PR must include:

1. a private Go handler and data-access implementation;
2. the same authentication and authorization boundary;
3. bounded validation and response-shape parity fixtures;
4. database timeout, cancellation, transaction, and failure tests as applicable;
5. audit and request-ID behavior;
6. the method-aware manifest owner change;
7. Docker smoke through the public gateway;
8. private-service readiness and Secret isolation checks;
9. a revision rollback path;
10. an observation window proving old-upstream traffic and errors remain zero before deleting the Fastify handler.

Rollback is revision-based. Never introduce an environment-controlled dual writer or mutable ownership switch.

## Adding or changing a Fastify prefix

Any change to `server/src/routes/prefixes.ts` must update `config/route-ownership.json` in the same PR. Repository tests reject uncovered prefixes. A specific method-aware route may be added beneath an existing namespace while retaining the namespace catch-all for all other methods and unknown paths.

## Final deletion gate

`business-api`, `business-init`, Prisma, `server/`, and `Dockerfile.server` remain required until:

- every public path and method is Go-owned;
- Fastify proxy requests and errors remain zero for the agreed observation period;
- Go owns the complete business schema and migration ledger;
- encrypted historical fields remain readable;
- fresh install, in-place upgrade, backup restore, and rollback no longer require Node or Prisma;
- the final image and SBOM contain neither runtime.
