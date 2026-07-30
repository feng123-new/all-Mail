# all-Mail Go core

This directory contains the canonical Go runtime for `all-Mail`.

Current ownership:

- `allmail api` owns the public listener, React SPA, request IDs, trusted-proxy normalization, readiness and metrics;
- unmigrated business paths are proxied to the internal Fastify business API;
- `allmail worker forwarding` owns mailbox forwarding;
- `allmail worker retention` owns API-log retention;
- `allmail migrate` owns checksummed additive Go migrations.

The Go gateway deliberately does not receive PostgreSQL or Redis credentials while it owns no native business route. Its readiness verifies built static assets plus the business API's protocol-backed `/readyz` response.

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

## Proxy boundary

`TRUSTED_PROXY_CIDRS` is a comma-separated list of reverse-proxy peers directly connected to the Go listener. Forwarded client-IP and protocol headers are ignored unless the socket peer belongs to this list. The gateway overwrites downstream forwarding headers with one canonical client identity before calling Fastify.

The internal Fastify service trusts exactly one proxy hop and is not published to the host in the production Compose topology.

## Worker state and secrets

The workers publish independent atomic heartbeat files under the ephemeral state directory `/tmp/all-mail` in the canonical Compose topology:

```text
/tmp/all-mail/worker-forwarding-heartbeat.json
/tmp/all-mail/worker-retention-heartbeat.json
```

The forwarding worker accepts only:

```text
ENCRYPTION_KEY_FILE=/var/lib/all-mail-secrets/encryption-key
```

It no longer reads `ENCRYPTION_KEY`, `ALL_MAIL_SECRET_STATE_DIR`, or the legacy bootstrap-secret bundle.

## Migration rules

The migration runner uses a direct `pgx` connection and one transaction with an advisory lock and SHA-256 checksums. It does not require the `psql` executable.

Never edit an applied numbered migration. Add a new migration and preserve the existing checksum history. Read [`../docs/GO-MIGRATION.md`](../docs/GO-MIGRATION.md) before changing route ownership, worker state machines or applied migrations.
