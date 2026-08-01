# Route ownership and telemetry

## Purpose

`config/route-ownership.json` is the canonical public route-and-method ownership contract. It decides which requests are handled by the public gateway, which are forwarded to the private Go service, and which stable route-family labels appear in metrics.

Ownership changes only through reviewed source control. There is no environment variable that can switch implementations.

## Owners

| Owner | Meaning |
| --- | --- |
| `go` | `app` handles system endpoints or the React SPA fallback directly. |
| `go-business-api` | `app` forwards the business route to the private Go service. |

There are no other active owners. The public `app` has no database URL, Redis URL, JWT secret, or encryption key.

## Manifest version 3

The manifest supports:

| Field | Meaning |
| --- | --- |
| `id` | Stable route-family identifier used in headers and metrics |
| `owner` | `go` or `go-business-api` |
| `match: exact` | Match only the declared path |
| `match: prefix` | Match the path and slash-separated descendants |
| `match: fallback` | Final `go`-owned SPA route |
| `methods` | Optional bounded HTTP method list; omitted means all methods |
| `migrationStage` | Must be `complete` for the active manifest |

Supported methods are:

```text
GET HEAD POST PUT PATCH DELETE OPTIONS
```

Exact routes win first, prefixes are evaluated longest-prefix-first, and fallback runs last. Routes may share a path only when method sets do not overlap. Every current entry is complete and has no `targetOwner`.

The loader rejects unsupported versions, unknown fields, invalid owners or methods, duplicate IDs, overlapping matchers, unsafe completed ownership, missing fallback, and trailing JSON.

## Current ownership

`go` owns:

```text
/health
/livez
/readyz
/metrics
React SPA fallback
```

`go-business-api` owns every business family, including:

```text
/admin/**
/api/**
/mail/api/**
/ingress/**
/oauth/**
```

This includes authentication, Dashboard operations, API keys, domains, aliases, mailboxes, users, messages, forwarding jobs, provider operations, OAuth, sending, signed ingress, and portal workflows. The migration is complete; there is no observation or pending stage.

## Runtime loading and inspection

The shared Go image contains the reviewed manifest at:

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

`/health` publishes manifest identity. `/readyz` reports route ownership and requires the built SPA plus `go-business-api` readiness.

## Response diagnostics

Every public response contains one canonical pair:

```text
X-All-Mail-Route-Owner: go | go-business-api
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

POST /ingress/domain-mail/receive
  owner: go-business-api
  family: ingress-domain-mail-receive

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

Methods are restricted to `GET POST PUT PATCH DELETE HEAD OPTIONS OTHER`; arbitrary methods collapse to `OTHER`. Status labels are bounded to classes. Raw paths, identities, addresses, API keys, request IDs, secrets, and error text never become labels.

Proxy errors identify the route family and single private upstream:

```text
allmail_business_proxy_errors_total{family="...",upstream="go-business-api"}
```

## Change requirements

A route-contract change must include:

1. the Go handler and data-access change;
2. equivalent authentication and authorization;
3. bounded validation and response-shape coverage;
4. transaction, cancellation, and failure tests where applicable;
5. audit and request-ID behavior;
6. a versioned manifest update when matching changes;
7. public-gateway smoke coverage;
8. readiness and secret-isolation checks;
9. upgrade and rollback impact.

There is no mutable dual writer, runtime owner switch, or alternate HTTP implementation to fall back to. Rollback deploys a complete compatible revision and, when required, restores its matching database and secret-volume backup.

## Historical boundary

Earlier manifest versions tracked a staged migration from a former Node API. That work is complete, and active documentation must not use those stages or owners as current topology. Historical plans remain under `docs/internal/archive/`.
