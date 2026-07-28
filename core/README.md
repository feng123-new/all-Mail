# all-Mail Go core

This directory contains the Go migration control plane for all-Mail.

It is intentionally introduced as a **strangler bridge** rather than pretending
that every existing Fastify route has already been rewritten:

- Go owns the public HTTP listener, SPA delivery, health/readiness and request IDs.
- Existing API paths are proxied to `LEGACY_API_URL` until each module is moved.
- Go defines the durable synchronization, delivery, attempt and outbox tables.
- `allmail jobs` currently provides a supervised heartbeat runtime; the legacy
  worker remains enabled by Docker Compose until job handlers are migrated.

## Commands

```bash
go test ./...
go vet ./...
go build ./cmd/allmail

./allmail api
./allmail jobs
./allmail migrate
./allmail doctor api
./allmail doctor jobs
```

Read `docs/GO-MIGRATION.md` before changing service ownership.
