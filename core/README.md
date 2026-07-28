# all-Mail Go core

This directory contains the Go migration control plane for all-Mail.

It is introduced as a **strangler bridge** rather than pretending that every existing Fastify route has already been rewritten:

- Go owns the public HTTP listener, SPA delivery, health/readiness and request IDs.
- Existing API paths are proxied to `LEGACY_API_URL` until each module is moved.
- Go owns API-log retention through the `go-jobs` runtime.
- The legacy Node `jobs` runtime continues to own forwarding.
- Go defines the durable synchronization, delivery, attempt and outbox tables for subsequent ports.

## Commands

```bash
test -z "$(gofmt -l .)"
go test -race ./...
go vet ./...
go build -trimpath -o ./allmail ./cmd/allmail

./allmail api
./allmail jobs
./allmail migrate
./allmail doctor api
./allmail doctor jobs
```

## Runtime ownership

`API_LOG_RETENTION_OWNER` is the explicit single-writer switch for API-log cleanup:

```text
API_LOG_RETENTION_OWNER=go      # Go cleaner enabled, legacy cleaner disabled
API_LOG_RETENTION_OWNER=legacy  # rollback to the Node cleaner
```

Read `docs/GO-MIGRATION.md` before changing service ownership or editing an applied migration.
