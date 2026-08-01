#!/usr/bin/env bash
set -euo pipefail

env_file="${ALL_MAIL_ENV_FILE:-.env}"
wait_timeout="${ALL_MAIL_WAIT_TIMEOUT:-300}"

if [[ ! -f "$env_file" ]]; then
  printf 'environment file not found: %s\n' "$env_file" >&2
  exit 1
fi

compose=(docker compose --env-file "$env_file")

"${compose[@]}" up -d --wait --wait-timeout "$wait_timeout" postgres
"${compose[@]}" build app

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
):
    print(model["volumes"][name]["name"])
'
)

if [[ "${#volumes[@]}" -ne 5 ]]; then
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

"${compose[@]}" run --rm --no-deps --user 0:0 \
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
  -v "${volumes[0]}:/var/lib/all-mail-state" \
  -v "${volumes[1]}:/var/lib/all-mail" \
  -v "${volumes[2]}:/var/lib/all-mail-forwarding" \
  -v "${volumes[3]}:/var/lib/all-mail-go-business" \
  -v "${volumes[4]}:/var/lib/all-mail-redis" \
  app init

"${compose[@]}" up -d --wait --wait-timeout "$wait_timeout"
