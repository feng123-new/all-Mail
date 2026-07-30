# Runtime retirement review checklist

Review this branch in the following order:

1. `docker-compose.yml` and `core/cmd/allmail/main.go` — independent runtime ownership;
2. `core/internal/jobs/runner.go` and worker doctors — scheduling, timeout and health semantics;
3. `core/internal/migrate/migrate.go` — direct pgx migration transaction and checksum behavior;
4. `core/internal/jobs/forwarding_integration_test.go` — PostgreSQL state-machine evidence;
5. deleted `server/src/jobs/*`, `server/src/worker.ts`, static hosting and source-launcher files;
6. CI, environment templates, operator documentation and rollback instructions.

Merge only after the full CI release gate and a local Docker smoke run succeed.
