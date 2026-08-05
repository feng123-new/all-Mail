# all-Mail v2 deployment guide

This is the canonical installation and deployment guide for the stable Go-only release. Upgrades and rollback are covered by [`UPGRADE.md`](./UPGRADE.md); state protection and recovery are covered by [`BACKUP-RESTORE.md`](./BACKUP-RESTORE.md).

## Supported production topology

Docker Compose on a single Linux host is the supported production topology. The long-running service set is exactly:

```text
app
go-business-api
worker-forwarding
worker-retention
postgres
redis
```

`./scripts/compose-up.sh` launches a temporary `app init` container before the long-running services. There is no initializer service and no Node/Fastify/Prisma production runtime.

Only `app` is published to the host. The public gateway serves the React SPA, health endpoints, metrics, and the business proxy. It receives no PostgreSQL, Redis, JWT, encryption, OAuth, ingress-signing, provider, bootstrap, or runtime database-role credential.

Active-active replicas, Kubernetes, multi-region operation, automatic PostgreSQL/Redis failover, and concurrent revisions against one persisted state are not currently supported deployment modes.

## Requirements

The production helper uses Linux shell and host tooling as part of the supported deployment contract:

- a supported Linux host with Bash 4 or newer;
- Python 3.9 or newer for resolved Compose model processing;
- Git for source checkout and immutable tag selection;
- OpenSSL for operator-generated PostgreSQL passwords;
- Docker Engine with the Docker Compose v2 plugin (`docker compose`);
- permission for the current user to access the Docker daemon;
- Redis-compatible Linux memory policy with `vm.overcommit_memory=1`;
- at least 1 GiB of currently available memory, 4 GiB of free space on the selected filesystem, and 10,000 free inodes; 2 GiB or more memory is recommended when building locally;
- the selected application listener, `127.0.0.1:3002` by default, either free for a fresh install or confirmed to belong to the currently running all-Mail revision during an upgrade;
- enough additional storage for PostgreSQL growth, Redis AOF, images, logs, and verified backups;
- Go 1.26.5 and Node.js 24 only when developing or building outside Docker.

Run the non-secret host capability check before creating `.env`:

```bash
bash scripts/host-preflight.sh
```

The preflight does not source `.env` or inspect passwords, tokens, database URLs, or generated runtime secrets. It verifies Linux, Bash/Python/Git/OpenSSL/Docker/Compose, Docker daemon access and storage driver, Redis memory-overcommit policy, available memory, free disk space, free inodes, and the default application port. An occupied port is a warning rather than an automatic failure because a verified in-place upgrade may still have the previous all-Mail revision running.

The default hard thresholds are 1 GiB available memory, 4 GiB free disk, and 10,000 free inodes. These non-secret command-only controls may be used for a larger host policy or isolated CI fixture:

```text
ALL_MAIL_PREFLIGHT_MIN_MEMORY_MIB
ALL_MAIL_PREFLIGHT_MIN_DISK_MIB
ALL_MAIL_PREFLIGHT_MIN_INODES
ALL_MAIL_PREFLIGHT_APP_HOST
ALL_MAIL_PREFLIGHT_APP_PORT
ALL_MAIL_PREFLIGHT_CHECK_PATH
```

`ALL_MAIL_PREFLIGHT_SKIP_DAEMON=1`, `ALL_MAIL_PREFLIGHT_SKIP_KERNEL=1`, and `ALL_MAIL_PREFLIGHT_SKIP_PORT=1` exist only for isolated contract testing or a manually verified upgrade condition. Do not use them to conceal an unknown production-host state.

To persist the Redis kernel requirement on a systemd Linux host:

```bash
printf 'vm.overcommit_memory = 1\n' | sudo tee /etc/sysctl.d/99-all-mail.conf
sudo sysctl --system
```

## 1. Select the release

```bash
git fetch --tags --prune
git switch --detach v2.1.2
cat VERSION
bash scripts/host-preflight.sh
```

`VERSION` must print `2.1.2`.

## 2. Create the environment

```bash
cp .env.example .env
openssl rand -hex 24
chmod 0600 .env
```

Set the generated value as `POSTGRES_PASSWORD`. Configure a real `PUBLIC_BASE_URL`, narrowly scoped `TRUSTED_PROXY_CIDRS`, and provider/ingress one-shot values only when those features are used.

JWT signing, encryption, Redis authentication, and runtime PostgreSQL-role passwords are initializer-managed. Do not add generated values or generated database URLs to `.env`.

`ADMIN_USERNAME` and `ADMIN_PASSWORD` are temporary initializer inputs. Leave `ADMIN_PASSWORD` blank to generate a strong one-time password, then remove populated one-shot values from `.env` after verification.

## 3. Choose image mode

### Build from source

```bash
./scripts/compose-up.sh
```

The helper injects `VERSION`, the current Git commit, and the commit timestamp into the binary and OCI labels.

### Pull the published image

```bash
ALL_MAIL_USE_PUBLISHED_IMAGE=1 \
ALL_MAIL_GO_IMAGE=ghcr.io/feng123-new/all-mail \
ALL_MAIL_IMAGE_TAG=2.1.2 \
./scripts/compose-up.sh
```

Keep the `v2.1.2` checkout: Compose, migration files, environment contracts, frontend assets, and operational scripts are part of the release.

## 4. Understand startup

The helper:

1. validates `.env` and `VERSION`;
2. resolves release metadata;
3. starts and waits for PostgreSQL;
4. builds or pulls the shared Go image;
5. resolves the master, bootstrap, secret-export, database-export, and Redis volumes;
6. runs one temporary privileged `app init` container;
7. validates/adopts/migrates schema history;
8. generates or reuses durable secrets;
9. reconciles `allmail_api`, `allmail_forwarding`, and `allmail_retention` privileges;
10. exports least-privilege read-only files;
11. starts and waits for all six services;
12. prints JSON release identity from all four Go processes.

Startup fails closed on unknown schema state, secret conflicts, missing required credentials, unsafe proxy trust, stale migration checksums, or unhealthy dependencies.

## 5. Verify release identity

```bash
for service in app go-business-api worker-forwarding worker-retention; do
  docker compose exec -T "$service" allmail version --json
done
```

For an official image, every service must report:

```json
{
  "version": "2.1.2",
  "commit": "<release commit>",
  "buildDate": "<UTC RFC3339 timestamp>",
  "goVersion": "go1.26.5"
}
```

Inspect OCI labels without printing secrets:

```bash
docker image inspect \
  "${ALL_MAIL_GO_IMAGE:-all-mail-go}:${ALL_MAIL_IMAGE_TAG:-local}" \
  --format '{{json .Config.Labels}}'
```

## 6. Verify health and boundaries

```bash
docker compose config --quiet
docker compose ps -a
curl --fail http://127.0.0.1:3002/health
curl --fail http://127.0.0.1:3002/livez
curl --fail http://127.0.0.1:3002/readyz

docker compose exec -T app allmail doctor api
docker compose exec -T go-business-api allmail doctor business-api
docker compose exec -T worker-forwarding allmail doctor worker forwarding
docker compose exec -T worker-retention allmail doctor worker retention
```

Private ports must remain unpublished:

```bash
! docker compose port go-business-api 3200
! docker compose port postgres 5432
! docker compose port redis 6379
```

Unauthenticated Redis access must fail:

```bash
! docker compose exec -T redis redis-cli -p 6379 ping
```

## 7. Verify the Frontend V3 surfaces

Use synthetic, non-secret test data:

1. log in as an administrator and confirm the grouped navigation and current route context;
2. confirm Dashboard shows direct risk counts rather than a `/100` client score;
3. resize to a narrow viewport and confirm the navigation drawer remains usable;
4. log in as a mailbox user and confirm the default landing route is `/mail/inbox`;
5. confirm a mailbox user with `mustChangePassword` is still redirected to `/mail/settings`.

The release-required CI already runs these administrator and portal flows in desktop and mobile Chromium, but deployment verification must still confirm the published image serves the matching SPA.

## 8. Complete first login

Retrieve the one-time credential only from the private API container:

```bash
docker compose exec go-business-api sh -lc \
  "grep '^ADMIN_USERNAME=' /var/lib/all-mail/bootstrap-admin.env && \
   grep '^ADMIN_PASSWORD=' /var/lib/all-mail/bootstrap-admin.env"
```

Log in through `app`, change the password, then verify plaintext retirement:

```bash
docker compose exec -T go-business-api \
  sh -lc 'test ! -e /var/lib/all-mail/bootstrap-admin.env'
```

The initializer never prints the password to logs. Browser code never stores or prefills portal passwords.

## Network and secret ownership

- `app`: `public-network`, `app-network`.
- `go-business-api`: `app-network`, `provider-network`, `database-network`, `cache-network`.
- `worker-forwarding`: `provider-network`, `database-network`.
- `worker-retention`: `database-network` only.
- `postgres`: `database-network` only.
- `redis`: `cache-network` only.

The initializer-only master secret file is stored on the preserved physical volume `${COMPOSE_PROJECT_NAME}_legacy_runtime_data`. Long-running services receive only their matching read-only exports. See [`ENVIRONMENT.md`](./ENVIRONMENT.md) and [`SECURITY-BOUNDARIES.md`](./SECURITY-BOUNDARIES.md).

## External R2 state

When Cloudflare raw-message persistence is enabled, the R2 bucket is part of the recovery state but is not managed by Docker Compose. Configure its lifecycle and include it in backup/restore rehearsals as described in [`BACKUP-RESTORE.md`](./BACKUP-RESTORE.md).

## Next operations

- Before changing revision or configuration: [`BACKUP-RESTORE.md`](./BACKUP-RESTORE.md).
- To upgrade or roll back: [`UPGRADE.md`](./UPGRADE.md).
- For incidents and diagnosis: [`RUNBOOK.md`](./RUNBOOK.md).
- For Cloudflare signed ingress: [`../CLOUDFLARE-DEPLOY.md`](../CLOUDFLARE-DEPLOY.md).

Never run `docker compose down -v` during normal deployment, upgrade, or recovery.
