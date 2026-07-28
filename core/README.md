# all-Mail Go core

This directory contains the Go public runtime, independent background workers and additive migration runner for all-Mail.

The migration remains a strangler architecture rather than claiming that every Fastify route has moved:

- Go owns the public HTTP listener, React SPA, health/readiness, metrics and request IDs.
- Unported API paths are proxied to `LEGACY_API_URL`.
- `worker-forwarding` owns forwarding claim/send/retry/terminal transitions.
- `worker-retention` owns API-log cleanup.
- Go defines durable synchronization, delivery, attempt and outbox contracts for later vertical ports.

## Verification

```bash
test -z "$(gofmt -l .)"
go test -race ./...
go vet ./...
go build -trimpath -o ./allmail ./cmd/allmail
```

## Commands

```bash
./allmail api
./allmail worker forwarding
./allmail worker retention
./allmail migrate

./allmail doctor api
./allmail doctor worker forwarding
./allmail doctor worker retention
```

Each command loads only its own configuration surface. There is no combined jobs process and no runtime-owner switch.

## Worker state

The workers publish independent atomic heartbeat files under their own service state volumes:

```text
worker-forwarding-heartbeat.json
worker-retention-heartbeat.json
```

Each doctor validates process identity, heartbeat freshness, active-run duration and the latest completion result.

## Migration rules

The migration runner uses a direct `pgx` connection and one transaction with an advisory lock and SHA-256 checksums. It does not require the `psql` executable.

Never edit an applied numbered migration. Add a new migration and preserve the existing checksum history.

Read [`../docs/GO-MIGRATION.md`](../docs/GO-MIGRATION.md) before changing route ownership, worker state machines or applied migrations.
