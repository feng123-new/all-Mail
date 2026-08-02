# Security boundaries

This document records the production trust boundaries enforced by code and runtime contract tests.

## Public gateway

`app` is the only host-published service. It serves the React SPA, health/readiness/metrics endpoints, request identity, proxy normalization, and route ownership. It has no direct PostgreSQL, Redis, provider, JWT, encryption, or bootstrap credential.

## Private business service

`go-business-api` is reachable from `app` only on the internal `app-network`. It receives separate read-only JWT, encryption, and Redis password files. It receives the writable one-time bootstrap volume only so successful forced password rotation can delete the plaintext credential.

The initializer-only master volume is never mounted into a long-running service.

## Data and cache segmentation

PostgreSQL exists only on `database-network`. Redis exists only on `cache-network`. The public gateway is attached to neither. Provider egress is isolated to `go-business-api` and `worker-forwarding`; `worker-retention`, PostgreSQL, and Redis have no provider network.

Redis authentication is mandatory in production. The initializer generates the password, Redis reads it from a dedicated read-only volume, and the private API loads it from a file. The raw value is not an operator environment variable.

## Browser credentials

Portal usernames may be included in a login link. Portal passwords must never be placed in a URL or browser storage. Current pages remove historical `all-mail:portal-login:` entries and explicitly clear the password field when applying a username prefill.

## Upgrade behavior

The physical master secret volume name remains stable. On the first isolated startup, the initializer migrates an unconsumed bootstrap credential into its dedicated volume, rejects conflicts, creates the Redis credential if missing, and exports least-privilege files. JWT and encryption keys are not rotated by this boundary migration.

## Enforcement

The following tests are release gates:

```text
scripts/security-boundary.test.mjs
scripts/portal-credential-security.test.mjs
core/internal/initialize/bootstrap_secret_test.go
core/internal/secretstate/secretstate_test.go
core/internal/config/business_api_test.go
```

## Database identities

The PostgreSQL owner is initializer-only. `go-business-api`, forwarding, and retention use independent generated login roles through read-only URL files. The initializer revokes stale runtime grants and reapplies the canonical CRUD, forwarding-table, or retention-table policy after schema migration.

## Browser request integrity

Unsafe browser requests are rejected when `Origin` does not match the gateway-normalized scheme and host or when `Sec-Fetch-Site` reports `cross-site`. The gateway emits `X-Frame-Options: DENY` and CSP `frame-ancestors 'none'`. Non-browser API clients without browser origin headers remain supported.

## OAuth configuration

Google client-secret documents are accepted only as uploaded or pasted JSON; the API cannot read administrator-selected server paths. OAuth scopes are canonical `minimal`, `send`, `manage`, or `full` profiles. Fresh configuration defaults to `minimal`; wider profiles require an explicit saved choice.
