# Operator Runbook

## Boundary

This document is the authoritative day-2 operations and recovery guide for `all-Mail`.

- Use this file for troubleshooting, recovery, and operator checklists.
- Use [`docs/DEPLOY.md`](./DEPLOY.md) for deployment and rollback entry.
- Use [`docs/ENVIRONMENT.md`](./ENVIRONMENT.md) for variable meaning and template ownership.
- Use [`CLOUDFLARE-DEPLOY.md`](../CLOUDFLARE-DEPLOY.md) for worker-specific troubleshooting beyond the shared ingress prerequisites listed here.

## Healthy baseline

### Scope and symptoms

A healthy default Docker deployment has four expected services:

- `app`
- `jobs`
- `postgres`
- `redis`

Quick baseline commands:

```bash
docker compose ps
docker compose logs app --tail=100
docker compose logs jobs --tail=100
```

Healthy signs:

- `app` serves `/health`
- `jobs` stays running and reports healthy via the heartbeat-based Docker healthcheck
- `postgres` passes `pg_isready`
- `redis` responds to `PING`

Concrete checks:

```bash
curl http://127.0.0.1:3002/health
docker compose exec postgres pg_isready -U ${POSTGRES_USER:-allmail} -p ${POSTGRES_INTERNAL_PORT:-5432}
docker compose exec redis redis-cli -p ${REDIS_INTERNAL_PORT:-6379} ping
```

If you use the Cloudflare worker path, also verify the backend ingress secret is aligned with worker config before treating the ingress lane as healthy.

## Jobs not processing

### Scope and symptoms

- background forwarding work stops moving
- scheduled cleanup/backfill work stalls
- `jobs` exits or loops while `app` still looks healthy

### Preconditions and safety checks

- Confirm `postgres` and `redis` are healthy first.
- Confirm only `app` owns migrations; `jobs` is expected to run with `ALL_MAIL_RUN_MIGRATIONS=0`.

### Response steps

1. Inspect jobs logs:

```bash
docker compose logs jobs --tail=200
```

2. Confirm the container is running:

```bash
docker compose ps jobs
```

Healthy jobs should eventually show a healthy status, not just `Up`.

3. If the container is down, restart only that service after confirming infra health:

```bash
docker compose up -d jobs
```

4. If logs indicate database or Redis connectivity issues, resolve those dependencies before restarting jobs repeatedly.

### Validation

- `jobs` remains up after restart and reaches a healthy state
- repeated errors stop appearing in `docker compose logs jobs`

### Escalation / rollback

- If `jobs` fails again with the same error after infra is healthy, capture logs and stop repeated restarts until the underlying cause is understood.

## Redis degraded / local fallback implications

### Scope and symptoms

- Redis healthcheck fails
- rate limiting or queue-backed behavior degrades
- app or jobs logs report Redis connection failures

### Preconditions and safety checks

- `ALLOW_LOCAL_RATE_LIMIT_FALLBACK` defaults to `false`.
- Do not assume degraded Redis is safe just because the API still responds.

### Response steps

1. Check Redis health:

```bash
docker compose ps redis
docker compose logs redis --tail=200
docker compose exec redis redis-cli -p ${REDIS_INTERNAL_PORT:-6379} ping
```

2. If Redis is unhealthy, restart the service:

```bash
docker compose up -d redis
```

3. Re-check app and jobs logs after Redis recovery:

```bash
docker compose logs app --tail=100
docker compose logs jobs --tail=100
```

### Validation

- Redis returns `PONG`
- dependent services stop logging connection failures

### Escalation / rollback

- If Redis data integrity or persistence is in doubt, stop before forcing repeated restarts and recover from your platform backup strategy.

## Failed migration / Prisma `P3009`

### Scope and symptoms

- `app` startup fails during migration
- Prisma reports `P3009`

### Preconditions and safety checks

- `P3005` and `P3009` are different cases.
- The repo only auto-falls back to a targeted legacy repair plus `db push` for `P3005`.
- `P3009` requires manual operator action.

### Response steps

1. Inspect the failing app logs:

```bash
docker compose logs app --tail=200
```

2. If the error is `P3005`, the runtime should already apply the legacy repair step and then fall back automatically. If it did not, inspect the exact output before retrying.

3. If the error is `P3009`, stop and inspect Prisma migration state before another restart. Do not keep bouncing the container.

4. On a fresh disposable install where no PostgreSQL data must be preserved, the clean reset path is:

```bash
docker compose down -v
docker compose up -d --build
```

5. If data must be preserved, resolve the failed migration intentionally before restarting the app.

### Validation

- app startup completes
- `/health` returns success
- repeated migration errors disappear from logs

### Escalation / rollback

- For non-disposable data, treat `P3009` as a database recovery event, not as a normal restart issue.

## Bootstrap/admin secret confusion

### Scope and symptoms

- operator is unsure where generated secrets were stored
- first login URL/password were missed on first boot
- bootstrap admin flow is blocked by stale assumptions about blank secrets

### Preconditions and safety checks

- Blank `JWT_SECRET`, `ENCRYPTION_KEY`, and `ADMIN_PASSWORD` are allowed on first boot.
- Docker persists generated values under `/var/lib/all-mail/bootstrap-secrets.env`.
- Source runtime defaults to `.all-mail-runtime/bootstrap-secrets.env`; if `ALL_MAIL_STATE_DIR` was exported before startup, inspect that directory instead.
- Setting `ALL_MAIL_STATE_DIR` only inside the env file does not move the initial bootstrap-secret write performed by `scripts/start-all-mail.mjs`.
- Generated admin passwords are only printed once when newly created.
- First-login URL output prefers `PUBLIC_BASE_URL`, then `ALL_MAIL_PUBLIC_BASE_URL`, then the first `CORS_ORIGIN`, and only falls back to localhost when none of those are set.

### Response steps

1. Decide which runtime you are using.
2. Inspect the persisted bootstrap-secret file for that runtime:

```bash
# Docker runtime
docker compose exec app sh -lc 'ls -l /var/lib/all-mail && cat /var/lib/all-mail/bootstrap-secrets.env'

# Source runtime
ls -l "${ALL_MAIL_STATE_DIR:-.all-mail-runtime}"
cat "${ALL_MAIL_STATE_DIR:-.all-mail-runtime}/bootstrap-secrets.env"
```

3. Confirm the active admin username from env or startup output. If you used the default bootstrap path and did not override it, the admin username is usually `ADMIN_USERNAME` or `admin`.
4. If the temporary admin password was generated and used once, complete the password-change flow before expecting normal admin access.

### Validation

- operator can identify the correct persisted secret file
- bootstrap login URL and admin username are known
- admin account can complete the required password update flow

### Escalation / rollback

- The repo provides bootstrap generation and persistence, not a general secret-rotation runbook. Treat broader secret rotation as a planned change with backups first.

## Cloudflare tunnel down / public hostnames returning 530

### Scope and symptoms

- Cloudflare Dashboard → Tunnel overview shows `Status: Down`
- `Active replicas` is `0`
- the published hostnames (for example `console.example.com` and `edge.example.com`) return `HTTP 530`
- local `app` still looks healthy, so the break is between Cloudflare and the backend rather than inside `all-Mail`

### Preconditions and safety checks

- Treat the tunnel token as a secret. Do not commit it, paste it into repo files, or leave it in shell history unnecessarily.
- Confirm the backend is healthy before rotating or reinstalling the connector. A healthy tunnel pointing at a dead backend does not close the loop.
- Prefer a long-running OS-managed connector on the Windows host that owns the tunnel.
- For this repo, the expected published routes are:
- `https://console.example.com`
- `https://edge.example.com`

### Response steps

1. Confirm the local backend is healthy:

```bash
docker compose ps
curl http://127.0.0.1:3002/health
```

Expected baseline:

- `app`, `jobs`, `postgres`, and `redis` are `healthy`
- `/health` returns `{"success":true,"data":{"status":"ok"}}`

2. Open the tunnel in Cloudflare Dashboard and verify the operator-facing state:

- `Status`
- `Active replicas`
- published routes
- any token-rotation warning banners

For this tunnel, the canonical dashboard path is the named tunnel under **Networking → Tunnels**.

3. On the Windows host that should own the connector, inspect the current service state in an elevated shell:

```powershell
Get-Service cloudflared
sc query cloudflared
```

If the service is missing, you have two supported install paths:

- **Fastest recovery:** use the Cloudflare Dashboard-provided token install command.
- **Preferred long-term path when you need transport pinning (for example `http2`):** use a named-tunnel `config.yml` under the Windows system profile.

Dashboard-token install path:

```powershell
cloudflared.exe service install <tunnel-token-from-dashboard>
Start-Service cloudflared
```

Config-file service path:

```powershell
mkdir C:\Windows\System32\config\systemprofile\.cloudflared
notepad C:\Windows\System32\config\systemprofile\.cloudflared\config.yml
cloudflared.exe service install
Start-Service cloudflared
```

When you use this path, keep the Cloudflare-generated named-tunnel config and credentials material under `C:\Windows\System32\config\systemprofile\.cloudflared\` and pin `protocol: http2` there if QUIC is unreliable on that host network.

If the service already exists but is unhealthy or stale:

```powershell
Restart-Service cloudflared
Get-Service cloudflared
```

4. If the dashboard still shows `Down`, run a foreground connector check on the host to separate service problems from edge-connectivity problems:

```powershell
cloudflared.exe tunnel run --token <tunnel-token-from-dashboard>
```

Healthy signs include log lines like:

- `Registered tunnel connection`
- `Updated to new configuration`

5. If foreground startup repeatedly stalls on QUIC handshakes, retry with HTTP/2 explicitly:

```powershell
cloudflared.exe tunnel run --protocol http2 --token <tunnel-token-from-dashboard>
```

This repo was verified successfully with HTTP/2 after repeated QUIC handshake timeouts. If `http2` succeeds and plain startup does not, move the host to the config-file service path above and pin `protocol: http2` there instead of repeatedly bouncing a failing QUIC path.

6. Re-check the published hostnames from an operator shell after the replica is up:

```bash
curl https://console.example.com/health
curl https://edge.example.com/health
```

Expected output:

```json
{"success":true,"data":{"status":"ok"}}
```

### Validation

- Cloudflare Dashboard shows `Status: Healthy`
- `Active replicas` is at least `1`
- published routes still point at the intended hostnames
- public `/health` checks return the same success payload as the local backend

### Token rotation / planned maintenance

Use this when the dashboard token was rotated or the connector host was rebuilt.

1. In Cloudflare Dashboard, rotate the tunnel token.
2. On every host running this tunnel, stop the old connector.
3. Update the host according to the mode it uses:

- **Dashboard-token service mode:** reinstall with the new token.
- **Config-file mode:** replace the token/credentials material referenced by `config.yml`, then restart the service.

Dashboard-token service example:

```powershell
Stop-Service cloudflared
cloudflared.exe service uninstall
cloudflared.exe service install <new-tunnel-token-from-dashboard>
Start-Service cloudflared
```

4. If you need to inspect the service after rotation:

```powershell
Get-Service cloudflared
sc query cloudflared
```

5. Re-run the validation steps above before calling the rotation complete.

### Escalation / rollback

- If the local backend is healthy but the tunnel remains `Down`, treat it as a connector/egress problem first.
- If QUIC fails and HTTP/2 succeeds, keep service traffic on the working transport until network policy is fixed.
- If neither transport can register a tunnel connection, capture the connector logs and stop rotating tokens or rebuilding the backend blindly.
- If the tunnel is healthy but the public hostnames still fail, move to route/DNS inspection in Cloudflare before changing the app.

## Backup / restore starting point

### Scope and symptoms

Use this entry before risky upgrades, before manual migration recovery, or after an operator decides application rollback alone is insufficient.

### Preconditions and safety checks

- The default Docker deployment persists PostgreSQL in `postgres_data` and runtime state in `app_runtime_data`.
- The repo does not provide built-in backup orchestration.

### Response steps

1. Stop and identify which data must be preserved.
2. Snapshot at least:
   - PostgreSQL data (`postgres_data`)
   - runtime state / generated bootstrap secrets (`app_runtime_data`)
3. If you use external PostgreSQL, Redis, or object storage, use the platform-native backup process for those services.
4. Before restore, stop the stack and make sure the target app revision matches the data you plan to restore.

### Validation

- the backup includes both database state and runtime state when applicable
- the restored stack passes the same health checks used in deployment

### Escalation / rollback

- If you cannot explain which persisted state changed during the failed release, stop and preserve the current volumes before any destructive recovery attempt.
