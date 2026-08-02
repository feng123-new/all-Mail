#!/usr/bin/env bash
set -euo pipefail

env_file="${ALL_MAIL_ENV_FILE:-.env}"
compose=(docker compose --env-file "$env_file")

for service in app go-business-api worker-forwarding worker-retention postgres redis; do
  "${compose[@]}" ps --services --filter status=running | grep -qx "$service"
done

! "${compose[@]}" port go-business-api 3200
! "${compose[@]}" port postgres 5432
! "${compose[@]}" port redis 6379

"${compose[@]}" exec -T app sh -lc '
  test -z "${DATABASE_URL:-}"
  test -z "${REDIS_URL:-}"
  test -z "${JWT_SECRET_FILE:-}"
  test -z "${ENCRYPTION_KEY_FILE:-}"
  test -z "${REDIS_PASSWORD_FILE:-}"
'

"${compose[@]}" exec -T go-business-api sh -lc '
  test -r /var/lib/all-mail-secrets/jwt-secret
  test -r /var/lib/all-mail-encryption/encryption-key
  test -r /var/lib/all-mail-redis/redis-password
  test -r /var/lib/all-mail-database/api-url
  test "${DATABASE_URL_FILE:-}" = "/var/lib/all-mail-database/api-url"
  test -z "${DATABASE_URL:-}"
  test ! -e /var/lib/all-mail-state
  test -r /var/lib/all-mail/runtime-secrets.env
  ! grep -Eq "^(JWT_SECRET|ENCRYPTION_KEY|REDIS_PASSWORD|ADMIN_PASSWORD)=" /var/lib/all-mail/runtime-secrets.env
'

unauthenticated=$("${compose[@]}" exec -T redis redis-cli -p 6379 ping 2>&1 || true)
if [[ "$unauthenticated" == *PONG* ]] || [[ "$unauthenticated" != *NOAUTH* ]]; then
  printf 'Redis unauthenticated probe returned an unsafe result: %s\n' "$unauthenticated" >&2
  exit 1
fi
"${compose[@]}" exec -T redis sh -lc '
  REDISCLI_AUTH="$(cat /run/all-mail-secrets/redis-password)" \
    redis-cli --no-auth-warning -p 6379 ping
' | grep -qx PONG

compose_json="${RUNNER_TEMP:-/tmp}/all-mail-security-compose.json"
"${compose[@]}" config --format json > "$compose_json"
python3 - "$compose_json" <<'PY'
import json
import subprocess
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    model = json.load(handle)

expected = {
    "app": {"public-network", "app-network"},
    "go-business-api": {"app-network", "provider-network", "database-network", "cache-network"},
    "worker-forwarding": {"provider-network", "database-network"},
    "worker-retention": {"database-network"},
    "postgres": {"database-network"},
    "redis": {"cache-network"},
}

for service, expected_networks in expected.items():
    container_id = subprocess.check_output(
        ["docker", "compose", "ps", "-q", service],
        text=True,
    ).strip()
    if not container_id:
        raise AssertionError(f"missing running container for {service}")
    inspected = json.loads(
        subprocess.check_output(["docker", "inspect", container_id], text=True)
    )[0]
    actual = {
        name.rsplit("_", 1)[-1]
        for name in inspected["NetworkSettings"]["Networks"]
    }
    if actual != expected_networks:
        raise AssertionError(f"{service} networks = {sorted(actual)}, expected {sorted(expected_networks)}")

    mounts = inspected.get("Mounts", [])
    for mount in mounts:
        if mount.get("Destination") == "/var/lib/all-mail-state":
            raise AssertionError(f"{service} mounts initializer-only master state")

business_id = subprocess.check_output(
    ["docker", "compose", "ps", "-q", "go-business-api"], text=True
).strip()
business = json.loads(subprocess.check_output(["docker", "inspect", business_id], text=True))[0]
mounts = {mount["Destination"]: mount for mount in business.get("Mounts", [])}
for target in (
    "/var/lib/all-mail-secrets",
    "/var/lib/all-mail-encryption",
    "/var/lib/all-mail-redis",
    "/var/lib/all-mail-database",
):
    if target not in mounts or mounts[target].get("RW"):
        raise AssertionError(f"private API secret mount {target} is missing or writable")
if "/var/lib/all-mail" not in mounts or not mounts["/var/lib/all-mail"].get("RW"):
    raise AssertionError("bootstrap volume must be writable so rotation can delete plaintext")

for name in ("app-network", "database-network", "cache-network"):
    if not model["networks"][name].get("internal", False):
        raise AssertionError(f"{name} is not internal")
PY


# Database identities are login-only, non-owner roles with narrowly bounded grants.
"${compose[@]}" exec -T postgres psql -U "${POSTGRES_USER:-allmail}" -d "${POSTGRES_DB:-allmail}" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['allmail_api', 'allmail_forwarding', 'allmail_retention'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_roles
      WHERE rolname = role_name AND rolcanlogin AND NOT rolsuper AND NOT rolcreatedb
        AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls
    ) THEN
      RAISE EXCEPTION 'unsafe or missing runtime role: %', role_name;
    END IF;
  END LOOP;
END $$;

SELECT 1 / CASE WHEN has_table_privilege('allmail_api', 'admins', 'SELECT,INSERT,UPDATE,DELETE') THEN 1 ELSE 0 END;
SELECT 1 / CASE WHEN NOT has_schema_privilege('allmail_api', 'public', 'CREATE') THEN 1 ELSE 0 END;
SELECT 1 / CASE WHEN has_table_privilege('allmail_forwarding', 'mailbox_forward_jobs', 'SELECT,UPDATE') THEN 1 ELSE 0 END;
SELECT 1 / CASE WHEN has_table_privilege('allmail_forwarding', 'inbound_messages', 'SELECT,UPDATE') THEN 1 ELSE 0 END;
SELECT 1 / CASE WHEN NOT has_table_privilege('allmail_forwarding', 'admins', 'SELECT') THEN 1 ELSE 0 END;
SELECT 1 / CASE WHEN has_table_privilege('allmail_retention', 'api_logs', 'SELECT,DELETE') THEN 1 ELSE 0 END;
SELECT 1 / CASE WHEN NOT has_table_privilege('allmail_retention', 'admins', 'SELECT') THEN 1 ELSE 0 END;
SQL
