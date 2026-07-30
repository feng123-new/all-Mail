# Route ownership and migration telemetry

## Purpose

`config/route-ownership.json` is the canonical public route-family ownership contract for `all-Mail`.

It answers four operational questions without reading implementation details:

1. which runtime owns a request today;
2. which stable route-family label is used in metrics;
3. which route families are complete, pending, or under observation for migration;
4. which owner a pending route will move to next.

Ownership is changed through reviewed source control. There is no environment switch that can silently move a production route between Go and Fastify.

## Owners

| Owner | Meaning |
| --- | --- |
| `go` | The public Go gateway handles the route directly, including the React SPA fallback and gateway health endpoints. |
| `business-api` | The Go gateway forwards the route to the private Fastify/Prisma business API. |

The current manifest keeps all database-backed business route families on `business-api`. The first observed migration candidate is `admin-dashboard`.

## Match semantics

The manifest supports three bounded match kinds:

| Match | Behavior |
| --- | --- |
| `exact` | Matches only the declared path. Used for `/health`, `/livez`, `/readyz`, and `/metrics`. |
| `prefix` | Matches the declared path and descendants separated by `/`. `/admin` does not match `/administrator`. |
| `fallback` | Final route when no exact or prefix family matches. The only fallback is the Go-owned React SPA. |

Exact routes win first. Prefix routes are evaluated longest-prefix-first. This lets `/admin/dashboard` be observed separately while `/admin` continues to catch unknown administrator endpoints and prevents them from being mistaken for SPA routes.

## Migration states

| State | Meaning |
| --- | --- |
| `complete` | The route is Go-owned and has no future target owner. |
| `observing` | Traffic and behavior are being measured before implementation and cutover. |
| `pending` | The route remains on `business-api` and is not yet the active migration slice. |

A pending or observing route must declare `targetOwner: go`. The Go loader rejects invalid owners, duplicate IDs, duplicate matchers, missing fallback routes, unsupported schema versions, unsafe completed ownership, trailing JSON, and unknown fields.

## Runtime loading

The Go image contains the exact repository manifest at:

```text
/app/config/route-ownership.json
```

The internal runtime variable is:

```text
ALL_MAIL_ROUTE_OWNERSHIP_FILE=/app/config/route-ownership.json
```

The process fails during startup if the file is missing or invalid. The public gateway also refuses a manifest that does not declare the four gateway system endpoints as exact Go routes or the SPA as the Go fallback.

For local source tests, the loader finds the repository copy. `ALL_MAIL_ROUTE_OWNERSHIP_FILE` may be set explicitly for isolated tests, but it is not an operator-facing route switch.

## Inspect the active contract

Inside the running Go container:

```bash
docker compose exec -T app allmail routes
```

The command prints:

```json
{
  "version": 1,
  "sha256": "...",
  "description": "...",
  "routes": []
}
```

The SHA-256 identifies the exact file loaded by the process. `/health` publishes the manifest version, digest, and route count. `/readyz` reports `routeOwnership=ok` after successful startup validation.

## Response diagnostics

Every response includes bounded ownership headers:

```text
X-All-Mail-Route-Owner: go | business-api
X-All-Mail-Route-Family: <stable-family-id>
```

These replace the migration-era `X-All-Mail-Migration-Bridge` header. They identify the committed route family without exposing database credentials, secrets, or internal service addresses.

Examples:

```text
GET /health
  owner: go
  family: system-health

GET /admin/dashboard/stats
  owner: business-api
  family: admin-dashboard

GET /settings/domains
  owner: go
  family: spa
```

## Prometheus metrics

The Go `/metrics` endpoint exports a bounded label set based on manifest route IDs rather than raw paths.

### Manifest and declared ownership

```text
allmail_route_manifest_info
allmail_route_owner_info
```

`allmail_route_owner_info` exposes the route family, current owner, match kind, declared path, migration state, and target owner. It emits one sample for every family even when traffic is zero.

### Traffic and latency

```text
allmail_route_inflight_requests
allmail_route_requests_total
allmail_route_request_duration_seconds
```

Completed request labels are limited to:

```text
family
owner
method
status_class
```

`status_class` is one of `1xx`, `2xx`, `3xx`, `4xx`, `5xx`, or `other`. Raw request paths, user IDs, domains, mailbox addresses, API keys, request IDs, and exact error messages are never metric labels.

### Proxy failures

```text
allmail_business_proxy_errors_total
```

This counter identifies failures between the Go gateway and Fastify by stable route family. A non-zero rate is a dependency or cutover blocker even when the public gateway itself is alive.

## Dashboard migration decision

`admin-dashboard` is marked `observing` because the first intended vertical port is:

```text
GET /admin/dashboard/stats
GET /admin/dashboard/api-trend
GET /admin/dashboard/logs
```

The delete routes remain part of the same family but will not move until authorization, validation, audit behavior, and database transaction ownership are implemented and tested together.

Before changing `admin-dashboard.owner` to `go`, collect enough production evidence to answer:

1. request volume by method and status class;
2. p50/p95/p99 latency from the histogram;
3. proxy error rate;
4. actual use of the read and delete endpoints;
5. timeout and payload-size behavior;
6. required administrator authentication and password-change restrictions;
7. parity requirements for dates, bigint conversion, pagination, and empty-day trend rows.

## Cutover procedure for a route family

A migration PR must include all of the following:

1. Go handler and data-access implementation;
2. the same authentication and authorization boundary;
3. request validation and response-shape parity fixtures;
4. database transaction and failure-injection tests;
5. audit and request-ID behavior;
6. manifest owner change for only the migrated family;
7. Docker smoke coverage through the public gateway;
8. a revision rollback path that restores the prior owner;
9. an observation window proving business-API proxy traffic for that family remains zero before deleting the Fastify implementation.

Do not add environment-controlled dual ownership. A rollback changes the deployed revision, not a mutable production flag.

## Adding or changing a Fastify prefix

Any change to `server/src/routes/prefixes.ts` must update `config/route-ownership.json` in the same PR. Repository tests reject a Fastify prefix that is not represented in the manifest.

When adding a specific route family beneath an existing namespace, add the more specific prefix and retain the namespace catch-all. Longest-prefix matching will produce separate metrics while preserving unknown-route behavior.

## Remaining deletion gate

The manifest and telemetry make Fastify removal measurable, but they do not make Fastify redundant by themselves. `business-api`, `business-init`, Prisma, and `Dockerfile.server` remain required until:

- every business route family is Go-owned;
- proxy request and proxy error metrics remain zero for the agreed observation period;
- Go owns business-schema migrations;
- encrypted historical fields remain readable;
- fresh install, in-place upgrade, backup restore, and rollback no longer require Node or Prisma;
- the final image and SBOM contain neither runtime.
