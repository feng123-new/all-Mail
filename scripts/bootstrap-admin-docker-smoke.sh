#!/usr/bin/env bash
set -euo pipefail

: "${RUNNER_TEMP:=/tmp}"
BASE_URL="${BASE_URL:-http://127.0.0.1:${APP_PORT:-3002}}"

json_body() {
  python3 - "$@" <<'PY'
import json, sys
print(json.dumps(json.loads(sys.argv[1])))
PY
}

# Secret and process isolation.
docker compose exec -T go-business-api sh -lc '
  test -r /var/lib/all-mail/runtime-secrets.env
  test -r /var/lib/all-mail/bootstrap-admin.env
  test ! -e /var/lib/all-mail/bootstrap-secrets.env
  test -z "${ADMIN_USERNAME:-}"
  test -z "${ADMIN_PASSWORD:-}"
  test -z "${DOMAIN_BOOTSTRAP_ADMIN_USERNAME:-}"
  test -z "${DOMAIN_BOOTSTRAP_ADMIN_PASSWORD:-}"
  test -z "${ADMIN_2FA_SECRET:-}"
  test -n "${BOOTSTRAP_ADMIN_SECRET_FILE:-}"
'
docker compose exec -T go-business-api sh -lc \
  '! grep -Eq "^(ADMIN_USERNAME|ADMIN_PASSWORD)=" /var/lib/all-mail/runtime-secrets.env'
docker compose exec -T go-business-api sh -lc '
  test -r /var/lib/all-mail-secrets/jwt-secret
  test -r /var/lib/all-mail-encryption/encryption-key
  test "${JWT_SECRET_FILE:-}" = "/var/lib/all-mail-secrets/jwt-secret"
  test "${ENCRYPTION_KEY_FILE:-}" = "/var/lib/all-mail-encryption/encryption-key"
  test -z "${JWT_SECRET:-}"
  test -z "${ENCRYPTION_KEY:-}"
  test "${REDIS_URL:-}" = "redis://redis:6379"
'
docker compose exec -T app sh -lc '
  test -z "${DATABASE_URL:-}"
  test -z "${JWT_SECRET:-}"
  test -z "${JWT_SECRET_FILE:-}"
  test -z "${REDIS_URL:-}"
'
test "$(docker compose exec -T postgres psql -U allmail -d allmail -Atqc 'SELECT count(*) FROM admins')" = "1"
test "$(docker compose exec -T postgres psql -U allmail -d allmail -Atqc 'SELECT must_change_password FROM admins LIMIT 1')" = "t"
initial_session_version=$(docker compose exec -T postgres psql -U allmail -d allmail -Atqc 'SELECT session_version FROM admins LIMIT 1')
test "$initial_session_version" -ge 1

username=$(docker compose exec -T go-business-api sh -lc \
  "grep '^ADMIN_USERNAME=' /var/lib/all-mail/bootstrap-admin.env | cut -d= -f2-")
password=$(docker compose exec -T go-business-api sh -lc \
  "grep '^ADMIN_PASSWORD=' /var/lib/all-mail/bootstrap-admin.env | cut -d= -f2-")
test -n "$username"
test -n "$password"

login_headers="$RUNNER_TEMP/login-headers.txt"
login_body="$RUNNER_TEMP/login-body.json"
curl --fail --silent --show-error \
  -D "$login_headers" -o "$login_body" \
  -H 'Content-Type: application/json' \
  --data "$(python3 -c 'import json,sys; print(json.dumps({"username":sys.argv[1],"password":sys.argv[2]}))' "$username" "$password")" \
  "$BASE_URL/admin/auth/login"
python3 - "$login_body" <<'PY'
import json, sys
with open(sys.argv[1], encoding='utf-8') as handle:
    payload = json.load(handle)
assert payload['success'] is True
assert payload['data']['admin']['mustChangePassword'] is True
PY
old_token=$(tr -d '\r' < "$login_headers" | sed -n 's/^[Ss]et-[Cc]ookie: token=\([^;]*\).*/\1/p' | head -n1)
test -n "$old_token"

blocked_headers="$RUNNER_TEMP/dashboard-blocked-headers.txt"
blocked_body="$RUNNER_TEMP/dashboard-blocked.json"
blocked_status=$(curl --silent --show-error \
  -D "$blocked_headers" -o "$blocked_body" -w '%{http_code}' \
  -H "Cookie: token=$old_token" \
  "$BASE_URL/admin/dashboard/stats")
test "$blocked_status" = "403"
grep -qi '^X-All-Mail-Route-Owner: go-business-api' "$blocked_headers"
grep -q 'PASSWORD_CHANGE_REQUIRED' "$blocked_body"

rotated='Rotated-Password-123!'
rotate_headers="$RUNNER_TEMP/rotate-headers.txt"
rotate_body="$RUNNER_TEMP/rotate-body.json"
curl --fail --silent --show-error \
  -D "$rotate_headers" -o "$rotate_body" \
  -H 'Content-Type: application/json' \
  -H "Cookie: token=$old_token" \
  --data "$(python3 -c 'import json,sys; print(json.dumps({"oldPassword":sys.argv[1],"newPassword":sys.argv[2]}))' "$password" "$rotated")" \
  "$BASE_URL/admin/auth/change-password"
python3 - "$rotate_body" <<'PY'
import json, sys
with open(sys.argv[1], encoding='utf-8') as handle:
    payload = json.load(handle)
assert payload['success'] is True
PY
new_token=$(tr -d '\r' < "$rotate_headers" | sed -n 's/^[Ss]et-[Cc]ookie: token=\([^;]*\).*/\1/p' | head -n1)
test -n "$new_token"
test "$new_token" != "$old_token"

current_session_version=$(docker compose exec -T postgres psql -U allmail -d allmail -Atqc 'SELECT session_version FROM admins LIMIT 1')
test "$current_session_version" -gt "$initial_session_version"
docker compose exec -T go-business-api sh -lc 'test ! -e /var/lib/all-mail/bootstrap-admin.env'
test "$(docker compose exec -T postgres psql -U allmail -d allmail -Atqc 'SELECT must_change_password FROM admins LIMIT 1')" = "f"

stale_headers="$RUNNER_TEMP/stale-session-headers.txt"
stale_body="$RUNNER_TEMP/stale-session.json"
stale_status=$(curl --silent --show-error \
  -D "$stale_headers" -o "$stale_body" -w '%{http_code}' \
  -H "Cookie: token=$old_token" \
  "$BASE_URL/admin/dashboard/stats")
test "$stale_status" = "401"
grep -qi '^X-All-Mail-Route-Owner: go-business-api' "$stale_headers"
grep -q 'INVALID_TOKEN' "$stale_body"

token="$new_token"
for route in \
  '/admin/dashboard/stats' \
  '/admin/dashboard/api-trend?days=7' \
  '/admin/dashboard/logs?page=1&pageSize=20'; do
  dashboard_headers="$RUNNER_TEMP/$(printf '%s' "$route" | tr '/?=&' '____').headers"
  dashboard_body="$RUNNER_TEMP/$(printf '%s' "$route" | tr '/?=&' '____').json"
  curl --fail --silent --show-error \
    -D "$dashboard_headers" -o "$dashboard_body" \
    -H "Cookie: token=$token" \
    "$BASE_URL$route"
  grep -qi '^X-All-Mail-Route-Owner: go-business-api' "$dashboard_headers"
  python3 - "$dashboard_body" <<'PY'
import json, sys
with open(sys.argv[1], encoding='utf-8') as handle:
    payload = json.load(handle)
assert payload['success'] is True
PY
done

write_headers="$RUNNER_TEMP/dashboard-write-headers.txt"
for route in \
  '/admin/admins?page=1&pageSize=10' \
  '/admin/email-groups' \
  '/admin/domain-mailboxes?page=1&pageSize=20' \
  '/admin/mailbox-users?page=1&pageSize=20'; do
  management_headers="$RUNNER_TEMP/$(printf '%s' "$route" | tr '/?=&' '____').management.headers"
  management_body="$RUNNER_TEMP/$(printf '%s' "$route" | tr '/?=&' '____').management.json"
  curl --fail --silent --show-error -D "$management_headers" -o "$management_body" \
    -H "Cookie: token=$token" "$BASE_URL$route"
  grep -qi '^X-All-Mail-Route-Owner: go-business-api' "$management_headers"
  python3 - "$management_body" <<'PY'
import json, sys
with open(sys.argv[1], encoding='utf-8') as handle:
    payload = json.load(handle)
assert payload['success'] is True
PY
done

write_headers="$RUNNER_TEMP/dashboard-write-headers.txt"
write_status=$(curl --silent --show-error \
  -D "$write_headers" -o /dev/null -w '%{http_code}' \
  -X DELETE -H "Cookie: token=$token" \
  "$BASE_URL/admin/dashboard/logs/999999999")
test "$write_status" = "200"
grep -qi '^X-All-Mail-Route-Owner: go-business-api' "$write_headers"

ingress_headers="$RUNNER_TEMP/ingress-headers.txt"
ingress_body="$RUNNER_TEMP/ingress-body.json"
ingress_status=$(curl --silent --show-error \
  -D "$ingress_headers" -o "$ingress_body" -w '%{http_code}' \
  -H 'Content-Type: application/json' --data '{}' \
  "$BASE_URL/ingress/domain-mail/receive")
test "$ingress_status" = "401"
grep -qi '^X-All-Mail-Route-Owner: go-business-api' "$ingress_headers"
grep -q 'INGRESS_SIGNATURE_REQUIRED' "$ingress_body"

admin_id=$(docker compose exec -T postgres psql -U allmail -d allmail -Atqc 'SELECT id FROM admins ORDER BY id LIMIT 1')
group_id=$(docker compose exec -T postgres psql -U allmail -d allmail -Atqc \
  "INSERT INTO email_groups (name, updated_at) VALUES ('ci-primary', CURRENT_TIMESTAMP) RETURNING id")
email_id=$(docker compose exec -T postgres psql -U allmail -d allmail -Atqc \
  "INSERT INTO email_accounts (email, provider, auth_type, status, group_id, updated_at) VALUES ('pool-ci@example.com', 'GMAIL', 'GOOGLE_OAUTH', 'ACTIVE', $group_id, CURRENT_TIMESTAMP) RETURNING id")
domain_id=$(docker compose exec -T postgres psql -U allmail -d allmail -Atqc \
  "INSERT INTO domains (name, status, can_receive, can_send, send_approved, send_approved_at, send_approval_source, created_by_admin_id, updated_at) VALUES ('ci.example', 'ACTIVE', TRUE, TRUE, TRUE, CURRENT_TIMESTAMP, 'ci-smoke', $admin_id, CURRENT_TIMESTAMP) RETURNING id")
mailbox_id=$(docker compose exec -T postgres psql -U allmail -d allmail -Atqc \
  "INSERT INTO domain_mailboxes (domain_id, local_part, address, status, provisioning_mode, batch_tag, updated_at) VALUES ($domain_id, 'pool', 'pool@ci.example', 'ACTIVE', 'API_POOL', 'ci-batch', CURRENT_TIMESTAMP) RETURNING id")
docker compose exec -T postgres psql -U allmail -d allmail -v ON_ERROR_STOP=1 -c \
  "INSERT INTO inbound_messages (domain_id, mailbox_id, matched_address, final_address, delivery_key, from_address, to_address, subject, text_preview, received_at, updated_at) VALUES ($domain_id, $mailbox_id, 'pool@ci.example', 'pool@ci.example', 'ci-delivery', 'sender@example.net', 'pool@ci.example', 'CI verification 654321', 'verification code 654321', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"

create_key_body=$(python3 -c 'import json,sys; print(json.dumps({"name":"ci-go-key","rateLimit":100,"permissions":{"all":True},"allowedGroupIds":[int(sys.argv[1])],"allowedEmailIds":[int(sys.argv[2])],"allowedDomainIds":[int(sys.argv[3])]}))' "$group_id" "$email_id" "$domain_id")
api_key_headers="$RUNNER_TEMP/api-key-create-headers.txt"
api_key_body="$RUNNER_TEMP/api-key-create.json"
curl --fail --silent --show-error -D "$api_key_headers" -o "$api_key_body" \
  -H 'Content-Type: application/json' -H "Cookie: token=$token" \
  --data "$create_key_body" "$BASE_URL/admin/api-keys"
grep -qi '^X-All-Mail-Route-Owner: go-business-api' "$api_key_headers"
raw_api_key=$(python3 - "$api_key_body" <<'PY'
import json, sys
with open(sys.argv[1], encoding='utf-8') as handle:
    payload = json.load(handle)
assert payload['success'] is True
print(payload['data']['key'])
PY
)
test -n "$raw_api_key"

for route in \
  '/api/get-email?group=ci-primary' \
  '/api/list-emails?group=ci-primary' \
  '/api/pool-stats?group=ci-primary' \
  '/api/domain-mail/get-mailbox?domain=ci.example&batchTag=ci-batch' \
  '/api/domain-mail/messages/latest?email=pool@ci.example'; do
  api_headers="$RUNNER_TEMP/$(printf '%s' "$route" | tr '/?=&@' '_____').headers"
  api_body="$RUNNER_TEMP/$(printf '%s' "$route" | tr '/?=&@' '_____').json"
  curl --fail --silent --show-error -D "$api_headers" -o "$api_body" \
    -H "X-API-Key: $raw_api_key" "$BASE_URL$route"
  grep -qi '^X-All-Mail-Route-Owner: go-business-api' "$api_headers"
  python3 - "$api_body" <<'PY'
import json, sys
with open(sys.argv[1], encoding='utf-8') as handle:
    payload = json.load(handle)
assert payload['success'] is True
PY
done

regex_headers="$RUNNER_TEMP/domain-regex-headers.txt"
curl --globoff --fail --silent --show-error -D "$regex_headers" -o /dev/null \
  -H "X-API-Key: $raw_api_key" \
  "$BASE_URL/api/domain-mail/messages/text?email=pool@ci.example&match=([0-9]{6})"
grep -qi '^X-All-Mail-Route-Owner: go-business-api' "$regex_headers"

denied_body="$RUNNER_TEMP/denied-key-create.json"
curl --fail --silent --show-error -o "$denied_body" \
  -H 'Content-Type: application/json' -H "Cookie: token=$token" \
  --data '{"name":"ci-denied-key","rateLimit":20,"permissions":{"list_emails":true}}' \
  "$BASE_URL/admin/api-keys"
denied_key=$(python3 - "$denied_body" <<'PY'
import json, sys
print(json.load(open(sys.argv[1], encoding='utf-8'))['data']['key'])
PY
)
denied_headers="$RUNNER_TEMP/denied-call-headers.txt"
denied_response="$RUNNER_TEMP/denied-call.json"
denied_status=$(curl --silent --show-error -D "$denied_headers" -o "$denied_response" -w '%{http_code}' \
  -H "X-API-Key: $denied_key" "$BASE_URL/api/get-email")
test "$denied_status" = "403"
grep -qi '^X-All-Mail-Route-Owner: go-business-api' "$denied_headers"
grep -q 'FORBIDDEN_PERMISSION' "$denied_response"

limited_body="$RUNNER_TEMP/limited-key-create.json"
curl --fail --silent --show-error -o "$limited_body" \
  -H 'Content-Type: application/json' -H "Cookie: token=$token" \
  --data '{"name":"ci-limited-key","rateLimit":1,"permissions":{"list_emails":true}}' \
  "$BASE_URL/admin/api-keys"
limited_key=$(python3 - "$limited_body" <<'PY'
import json, sys
print(json.load(open(sys.argv[1], encoding='utf-8'))['data']['key'])
PY
)
curl --fail --silent --show-error -o /dev/null -H "X-API-Key: $limited_key" \
  "$BASE_URL/api/list-emails"
limited_response="$RUNNER_TEMP/limited-call.json"
limited_status=$(curl --silent --show-error -o "$limited_response" -w '%{http_code}' \
  -H "X-API-Key: $limited_key" "$BASE_URL/api/list-emails")
test "$limited_status" = "429"
grep -q 'RATE_LIMIT_EXCEEDED' "$limited_response"
test "$(docker compose exec -T postgres psql -U allmail -d allmail -Atqc "SELECT COUNT(*) FROM api_logs WHERE api_key_id = (SELECT id FROM api_keys WHERE name = 'ci-go-key')")" -ge 5

# Initializer reruns remain idempotent after the credential has been retired.
./scripts/compose-up.sh
test "$(docker compose exec -T postgres psql -U allmail -d allmail -Atqc 'SELECT count(*) FROM admins')" = "1"
docker compose exec -T go-business-api sh -lc 'test ! -e /var/lib/all-mail/bootstrap-admin.env'
docker compose exec -T go-business-api sh -lc 'test -r /var/lib/all-mail/runtime-secrets.env'
docker compose exec -T go-business-api sh -lc 'test -r /var/lib/all-mail-secrets/jwt-secret'
docker compose exec -T go-business-api sh -lc 'test ! -e /var/lib/all-mail-state'
project_name=$(docker compose config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["name"])')
legacy_volume="${project_name}_legacy_runtime_data"
test "$(docker run --rm -v "${legacy_volume}:/state:ro" postgres:16-alpine cat /state/pre-rename-volume-marker)" = "preserved"

docker compose exec -T app allmail doctor api
docker compose exec -T go-business-api allmail doctor business-api
docker compose exec -T worker-forwarding allmail doctor worker forwarding
docker compose exec -T worker-retention allmail doctor worker retention
