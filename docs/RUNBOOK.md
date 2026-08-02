# Operations runbook

This runbook assumes the stable Go-only topology. Preserve evidence and state before changing configuration, deleting containers, rotating secrets, or attempting restore.

## First response

```bash
date -u +'%Y-%m-%dT%H:%M:%SZ'
docker compose ps -a
docker compose logs --no-color --timestamps --tail=300 \
  app go-business-api worker-forwarding worker-retention postgres redis
curl -i http://127.0.0.1:3002/health
curl -i http://127.0.0.1:3002/readyz
```

Record release identity:

```bash
for service in app go-business-api worker-forwarding worker-retention; do
  docker compose exec -T "$service" allmail version --json
done
```

Run all doctors:

```bash
docker compose exec -T app allmail doctor api
docker compose exec -T go-business-api allmail doctor business-api
docker compose exec -T worker-forwarding allmail doctor worker forwarding
docker compose exec -T worker-retention allmail doctor worker retention
```

Do not post unredacted logs publicly. Database URLs, tokens, secrets, mailbox addresses, subjects, and message bodies must be removed.

## Release identity mismatch

Symptoms include different versions across services, `dev` in an expected release image, or a commit that does not match the deployed tag.

```bash
docker compose images
docker image inspect \
  "${ALL_MAIL_GO_IMAGE:-all-mail-go}:${ALL_MAIL_IMAGE_TAG:-local}" \
  --format '{{json .Config.Labels}}'
```

Stop the rollout. Do not mix images. Rebuild from the exact checkout or pull the exact published tag, then restart the full four-process Go set together.

## Public readiness failure

`/readyz` requires the built React assets and healthy private `go-business-api`.

```bash
docker compose logs --tail=300 app go-business-api
docker compose exec -T app allmail doctor api
docker compose exec -T go-business-api allmail doctor business-api
```

Confirm `app` can reach `go-business-api` only on `app-network`; do not publish the private API as a workaround.

## PostgreSQL failure

```bash
docker compose ps postgres
docker compose logs --tail=300 postgres
docker compose exec -T postgres \
  pg_isready -U "${POSTGRES_USER:-allmail}" -p 5432
```

Do not delete `postgres_data`, change the owner password, or rerun arbitrary SQL. Confirm the exact release, `.env`, and backup state. Use [`BACKUP-RESTORE.md`](./BACKUP-RESTORE.md) when data recovery is required.

## Runtime database-role failure

The owner credential belongs only to PostgreSQL and the temporary initializer. Long-running services read:

```text
/var/lib/all-mail-database/api-url
/var/lib/all-mail-database/forwarding-url
/var/lib/all-mail-database/retention-url
```

Check file presence without printing content. Rerunning the matching `./scripts/compose-up.sh` safely revokes stale grants, reapplies the canonical table policy, and refreshes exports. Never copy `POSTGRES_PASSWORD` into a runtime service.

## Redis failure

```bash
docker compose ps redis
docker compose logs --tail=300 redis
docker compose exec -T redis sh -lc '
  test -r /run/all-mail-secrets/redis-password
  REDISCLI_AUTH="$(cat /run/all-mail-secrets/redis-password)" \
    redis-cli --no-auth-warning -p 6379 ping
'
```

Unauthenticated access must fail:

```bash
! docker compose exec -T redis redis-cli -p 6379 ping
```

Do not print or copy the password into `.env`. Restore `runtime_secrets_data` and `redis_runtime_data` together when recovery is required.

## Secret or bootstrap failure

The private API should have readable JWT, encryption, Redis, and database URL exports but must not mount `/var/lib/all-mail-state`.

```bash
docker compose exec -T go-business-api sh -lc '
  test -r /var/lib/all-mail-secrets/jwt-secret
  test -r /var/lib/all-mail-encryption/encryption-key
  test -r /var/lib/all-mail-redis/redis-password
  test -r /var/lib/all-mail-database/api-url
  test ! -e /var/lib/all-mail-state
'
```

A bootstrap conflict is intentionally fatal. Preserve both sources, compare their provenance without publishing contents, and restore a known-consistent backup rather than choosing a plaintext password arbitrarily.

## Network boundary incident

Expected networks:

- `app`: `public-network`, `app-network`;
- `go-business-api`: `app-network`, `provider-network`, `database-network`, `cache-network`;
- `worker-forwarding`: `provider-network`, `database-network`;
- `worker-retention`: `database-network`;
- `postgres`: `database-network`;
- `redis`: `cache-network`.

```bash
for service in app go-business-api worker-forwarding worker-retention postgres redis; do
  docker inspect "$(docker compose ps -q "$service")" \
    --format "$service {{json .NetworkSettings.Networks}}"
done
```

Any public gateway membership in database, cache, or provider networks is a security incident and release blocker.

## Worker failure

```bash
docker compose logs --tail=300 worker-forwarding worker-retention
docker compose exec -T worker-forwarding allmail doctor worker forwarding
docker compose exec -T worker-retention allmail doctor worker retention
```

Confirm process identity, heartbeat freshness, database URL export, lease/run/shutdown timeout relationships, provider availability, and last error. Do not delete heartbeat files or manually rewrite queue state while the worker is running.

## OAuth or provider failure

- Confirm the configured OAuth profile is intentional (`minimal`, `send`, `manage`, or `full`).
- Verify redirect URI, tenant, provider console configuration, and system clock.
- Do not fall back to arbitrary server-path JSON files or broaden scopes without documenting the operator requirement.
- Use synthetic mailboxes and redact tokens and addresses.

A provider callback or refresh-token problem is not fixed by disabling Redis or bypassing OAuth state validation.

## Browser or session incident

Current releases reject cross-site unsafe requests, deny framing, and never persist portal passwords. When upgrading a browser that used an affected historical release:

1. deploy the fixed stable release;
2. reload admin and portal pages once so historical storage keys are removed;
3. clear site data manually when browser policy blocks cleanup;
4. rotate credentials potentially exposed to extensions, shared profiles, or XSS;
5. verify old JWTs are rejected after password, role, status, or 2FA change.

## Upgrade failure and rollback

Stop all application and worker processes before deciding:

```bash
docker compose down --remove-orphans
```

Use the decision table in [`UPGRADE.md`](./UPGRADE.md). After any migration, secret reconciliation, role reconciliation, or v2 data write, restore the complete pre-upgrade state before starting the old revision. Never perform image-only rollback by default.

## Backup or restore incident

Follow [`BACKUP-RESTORE.md`](./BACKUP-RESTORE.md). A database without matching encryption/JWT state can make ciphertext unreadable or sessions invalid. A master volume without matching database state can be equally unsafe. Preserve the entire failed restore for investigation before retrying.

Never use `docker compose down -v` unless deliberate permanent destruction has been approved and a verified backup exists.
