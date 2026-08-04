# Observability and metrics

`all-Mail` exposes health, readiness, runtime doctors, bounded Prometheus metrics, worker heartbeats, and structured JSON logs. These signals are intentionally split across trust boundaries so the public gateway never receives PostgreSQL, Redis, provider, JWT, or encryption credentials.

## Metrics access boundary

The public Go gateway serves `/metrics`, but production access is controlled by the direct TCP peer address in `METRICS_ALLOWED_CIDRS`.

```env
METRICS_ALLOWED_CIDRS=127.0.0.1/32,::1/128
```

The default allows only local scrapes. Add the smallest internal collector CIDR only when a dedicated monitoring system connects directly to `app`.

Rules:

- forwarded identity headers are ignored for metrics authorization;
- `X-Forwarded-For`, `X-Real-IP`, and `CF-Connecting-IP` cannot grant access;
- `0.0.0.0/0` and `::/0` are rejected at startup;
- malformed or unauthorized peers receive `404` without route-ownership metadata;
- the allowlist is independent from `TRUSTED_PROXY_CIDRS`.

When a reverse proxy scrapes metrics, authorize the proxy's directly connected address, not an external client address supplied in forwarding headers.

## Prometheus signals

The gateway exports bounded-cardinality metrics only:

- `allmail_go_uptime_seconds` — gateway process uptime;
- `allmail_go_http_requests_total` — all requests observed by the gateway;
- `allmail_route_manifest_info` — active route-manifest version and digest;
- `allmail_route_owner_info` — declared owner and migration state for each bounded route family;
- `allmail_route_inflight_requests` — in-flight work by route family and owner;
- `allmail_route_requests_total` — completed requests by route family, owner, bounded method, and status class;
- `allmail_route_request_duration_seconds` — bounded route-family latency histogram;
- `allmail_business_proxy_errors_total` — gateway failures reaching the private business API.

Labels never include mailbox addresses, message identifiers, subjects, recipients, API keys, request query strings, provider tokens, or arbitrary user-controlled paths. Route families come from the canonical ownership manifest.

The route-family metrics cover administrator, portal, ingress, public automation, OAuth, provider, sending, and mailbox operations as they pass through the gateway. The gateway deliberately does not connect directly to PostgreSQL or Redis merely to export metrics.

## Dependency and worker signals

Use the existing least-privilege probes for process-specific state:

```bash
curl --fail http://127.0.0.1:3002/health
curl --fail http://127.0.0.1:3002/readyz

docker compose exec -T app allmail doctor api
docker compose exec -T go-business-api allmail doctor business-api
docker compose exec -T worker-forwarding allmail doctor worker forwarding
docker compose exec -T worker-retention allmail doctor worker retention
```

- `readyz` aggregates the public gateway's static-asset and private-business-API readiness.
- `doctor business-api` verifies PostgreSQL and authenticated Redis from the private service that owns those credentials.
- worker doctors verify bounded heartbeat age and successful execution state without exposing database credentials.
- Cloudflare Worker `/health` reports whether ingress bindings are configured, without returning their values.

This separation preserves the production network and secret model instead of copying sensitive credentials into a central metrics process.

## Logging and privacy

All Go processes log structured JSON to standard output. Use Docker log collection or a host log driver and redact before sharing diagnostics.

Do not add or export:

- complete request/response bodies;
- mailbox addresses or raw messages as metric labels;
- credentials, refresh tokens, session cookies, API keys, ingress signatures, or database URLs;
- unbounded paths, errors, provider messages, or request IDs as Prometheus labels.

Request IDs are suitable for log correlation, not metric labels.

## Initial alert guidance

Start with low-cardinality alerts:

- `/readyz` unavailable for several consecutive checks;
- rising `allmail_business_proxy_errors_total`;
- sustained 5xx growth in `allmail_route_requests_total`;
- route-family latency above the operational provider timeout budget;
- failed worker doctor or stale heartbeat;
- repeated ingress 4xx/5xx responses in structured logs;
- PostgreSQL or Redis failure from `doctor business-api`.

Tune thresholds from real traffic. A personal deployment should avoid high-frequency scraping and alerts on individual mailbox identities.
