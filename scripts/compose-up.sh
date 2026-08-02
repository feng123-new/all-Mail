#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${ALL_MAIL_ENV_FILE:-.env}"
wait_timeout="${ALL_MAIL_WAIT_TIMEOUT:-300}"
version_file="${ALL_MAIL_VERSION_FILE:-$repo_root/VERSION}"

if [[ ! -f "$env_file" ]]; then
  printf 'environment file not found: %s\n' "$env_file" >&2
  exit 1
fi
if [[ ! -f "$version_file" ]]; then
  printf 'version file not found: %s\n' "$version_file" >&2
  exit 1
fi

base_version="$(tr -d '[:space:]' < "$version_file")"
if [[ ! "$base_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
  printf 'invalid VERSION value: %s\n' "$base_version" >&2
  exit 1
fi

if [[ -z "${ALL_MAIL_VERSION:-}" ]]; then
  if git -C "$repo_root" describe --tags --exact-match --match "v$base_version" HEAD >/dev/null 2>&1; then
    ALL_MAIL_VERSION="$base_version"
  else
    ALL_MAIL_VERSION="${base_version}-dev"
  fi
fi
if [[ -z "${ALL_MAIL_COMMIT:-}" ]]; then
  ALL_MAIL_COMMIT="$(git -C "$repo_root" rev-parse HEAD 2>/dev/null || printf unknown)"
fi
if [[ -z "${ALL_MAIL_BUILD_DATE:-}" ]]; then
  ALL_MAIL_BUILD_DATE="$(git -C "$repo_root" show -s --format=%cI HEAD 2>/dev/null || date -u +'%Y-%m-%dT%H:%M:%SZ')"
fi
export ALL_MAIL_VERSION ALL_MAIL_COMMIT ALL_MAIL_BUILD_DATE

echo "Building all-Mail ${ALL_MAIL_VERSION} (${ALL_MAIL_COMMIT})"

compose=(docker compose --env-file "$env_file")
initializer_compose=(
  docker compose --env-file "$env_file"
  -f docker-compose.yml
  -f docker-compose.init.yml
)

"${compose[@]}" up -d --wait --wait-timeout "$wait_timeout" postgres
if [[ "${ALL_MAIL_USE_PUBLISHED_IMAGE:-0}" == "1" ]]; then
  "${compose[@]}" pull app
else
  "${compose[@]}" build app
fi

mapfile -t volumes < <(
  "${compose[@]}" config --format json | python3 -c '
import json
import sys

model = json.load(sys.stdin)
project_name = model["name"]
# runtime_secrets_data is intentionally not mounted by any declared long-running
# service, so Compose may omit it from the rendered model. Its physical name is
# an explicit compatibility contract and is derived from the resolved project.
print(f"{project_name}_legacy_runtime_data")
for name in (
    "bootstrap_admin_data",
    "forwarding_runtime_data",
    "go_business_runtime_data",
    "redis_runtime_data",
    "database_runtime_data",
):
    print(model["volumes"][name]["name"])
'
)

if [[ "${#volumes[@]}" -ne 6 ]]; then
  printf 'failed to resolve Compose volume names\n' >&2
  exit 1
fi

initializer_env=(--env-from-file "$env_file")
for name in \
  POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB \
  JWT_SECRET ENCRYPTION_KEY ADMIN_USERNAME ADMIN_PASSWORD PUBLIC_BASE_URL \
  SEND_ENABLED_DOMAINS INGRESS_SIGNING_SECRET INGRESS_IMPORT_KEY_ID \
  GOOGLE_OAUTH_CLIENT_ID GOOGLE_OAUTH_CLIENT_SECRET GOOGLE_OAUTH_REDIRECT_URI GOOGLE_OAUTH_SCOPES \
  MICROSOFT_OAUTH_CLIENT_ID MICROSOFT_OAUTH_CLIENT_SECRET MICROSOFT_OAUTH_REDIRECT_URI \
  MICROSOFT_OAUTH_TENANT MICROSOFT_OAUTH_SCOPES; do
  if [[ -v "$name" ]]; then
    initializer_env+=(-e "$name")
  fi
done

"${initializer_compose[@]}" run --rm --no-deps --user 0:0 \
  --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER \
  "${initializer_env[@]}" \
  -e DATABASE_URL= \
  -e NODE_ENV=production \
  -e ALL_MAIL_STATE_DIR=/var/lib/all-mail-state \
  -e ALL_MAIL_MIGRATION_DIR=/app/migrations \
  -e BOOTSTRAP_ADMIN_SECRET_FILE=/var/lib/all-mail/bootstrap-admin.env \
  -e ALL_MAIL_EXPORT_ENCRYPTION_KEY_FILE=/var/lib/all-mail-forwarding/encryption-key \
  -e ALL_MAIL_EXPORT_JWT_SECRET_FILE=/var/lib/all-mail-go-business/jwt-secret \
  -e ALL_MAIL_EXPORT_REDIS_PASSWORD_FILE=/var/lib/all-mail-redis/redis-password \
  -e ALL_MAIL_EXPORT_API_DATABASE_URL_FILE=/var/lib/all-mail-database/api-url \
  -e ALL_MAIL_EXPORT_FORWARDING_DATABASE_URL_FILE=/var/lib/all-mail-database/forwarding-url \
  -e ALL_MAIL_EXPORT_RETENTION_DATABASE_URL_FILE=/var/lib/all-mail-database/retention-url \
  -v "${volumes[0]}:/var/lib/all-mail-state" \
  -v "${volumes[1]}:/var/lib/all-mail" \
  -v "${volumes[2]}:/var/lib/all-mail-forwarding" \
  -v "${volumes[3]}:/var/lib/all-mail-go-business" \
  -v "${volumes[4]}:/var/lib/all-mail-redis" \
  -v "${volumes[5]}:/var/lib/all-mail-database" \
  app init

"${compose[@]}" up -d --wait --wait-timeout "$wait_timeout"

for service in app go-business-api worker-forwarding worker-retention; do
  "${compose[@]}" exec -T "$service" allmail version --json
done
