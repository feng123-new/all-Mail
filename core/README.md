# all-Mail Go core

This directory contains the canonical Go runtime for `all-Mail`.

Current ownership:

- `allmail api` owns the public listener, React SPA, request IDs, trusted-proxy normalization, readiness and metrics;
- `allmail business-api` owns every private business route, including authentication, administration, mailbox, domain, ingress, provider, sending, portal, and external API families;
- `allmail worker forwarding` owns mailbox forwarding;
- `allmail worker retention` owns API-log retention;
- `allmail init` owns runtime-secret migration, complete schema adoption/migration, ciphertext verification, durable import, and first-administrator bootstrap;
- `allmail migrate` owns schema-only adoption and migration through the same canonical ledger.

The public Go gateway deliberately receives no PostgreSQL URL, Redis URL, JWT secret, or encryption key. The separate private Go business process receives PostgreSQL, Redis, and read-only JWT/encryption files; gateway readiness verifies this single private upstream.

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
./allmail business-api
./allmail worker forwarding
./allmail worker retention
./allmail init
./allmail migrate
./allmail doctor api
./allmail doctor business-api
./allmail doctor worker forwarding
./allmail doctor worker retention
```

## Proxy boundary

`TRUSTED_PROXY_CIDRS` is a comma-separated list of reverse-proxy peers directly connected to the Go listener. Forwarded client-IP and protocol headers are ignored unless the socket peer belongs to this list. The gateway overwrites downstream forwarding headers with one canonical client identity before calling `go-business-api`.

The private Go business service is not published to the host in the production Compose topology.

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

The schema runner embeds the immutable Prisma history, verifies its raw SHA-256 checksums, adopts known Prisma or ledgerless-final databases, executes the numbered Go runtime migrations, and records both histories in `allmail_schema_migrations`. Its final PostgreSQL catalog fingerprint covers owned columns, defaults, constraints, indexes, enums, session functions, and triggers. It does not require Node, Prisma, or `psql`.

Never edit an applied migration in either embedded history. Add a new migration and preserve the existing checksum history. Read [`../docs/GO-MIGRATION.md`](../docs/GO-MIGRATION.md) before changing route ownership, worker state machines, schema contracts, or applied migrations.
