#!/usr/bin/env bash
set -euo pipefail

: "${RUNNER_TEMP:=/tmp}"

if [[ "${ALL_MAIL_ALLOW_DESTRUCTIVE_REHEARSAL:-0}" != "1" ]]; then
  printf 'restore rehearsal requires ALL_MAIL_ALLOW_DESTRUCTIVE_REHEARSAL=1\n' >&2
  exit 1
fi
if [[ "${CI:-}" != "true" ]]; then
  printf 'restore rehearsal is restricted to an isolated CI deployment\n' >&2
  exit 1
fi

compose=(docker compose)
backup_dir="${ALL_MAIL_REHEARSAL_DIR:-$RUNNER_TEMP/all-mail-restore-rehearsal}"
rm -rf "$backup_dir"
mkdir -p "$backup_dir/volumes"
chmod 0700 "$backup_dir"

"${compose[@]}" config --format json > "$backup_dir/compose.json"
project_name="$(python3 - "$backup_dir/compose.json" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as handle:
    print(json.load(handle)["name"])
PY
)"
case "$project_name" in
  *rehearsal*) ;;
  *)
    printf 'restore rehearsal refuses non-rehearsal Compose project: %s\n' "$project_name" >&2
    exit 1
    ;;
esac

python3 - "$backup_dir/compose.json" <<'PY' > "$backup_dir/volumes.txt"
import json
import sys
with open(sys.argv[1], encoding="utf-8") as handle:
    model = json.load(handle)
project = model["name"]
print(f"{project}_legacy_runtime_data")
for name in (
    "bootstrap_admin_data",
    "forwarding_runtime_data",
    "go_business_runtime_data",
    "redis_runtime_data",
    "database_runtime_data",
    "redis_data",
):
    print(model["volumes"][name]["name"])
PY
postgres_volume="$(python3 - "$backup_dir/compose.json" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as handle:
    print(json.load(handle)["volumes"]["postgres_data"]["name"])
PY
)"

for volume in $(cat "$backup_dir/volumes.txt"); do
  docker volume inspect "$volume" >/dev/null
done
docker volume inspect "$postgres_volume" >/dev/null

git rev-parse HEAD > "$backup_dir/revision.txt"
git describe --tags --always --dirty > "$backup_dir/tag.txt"

db_user="$("${compose[@]}" exec -T postgres printenv POSTGRES_USER | tr -d '\r')"
db_name="$("${compose[@]}" exec -T postgres printenv POSTGRES_DB | tr -d '\r')"
"${compose[@]}" exec -T postgres \
  pg_dump -U "$db_user" -d "$db_name" \
    --format=custom --compress=9 --no-owner --no-privileges \
  > "$backup_dir/postgres.dump"
"${compose[@]}" exec -T postgres pg_restore --list \
  < "$backup_dir/postgres.dump" > "$backup_dir/postgres.list"
test -s "$backup_dir/postgres.dump"
test -s "$backup_dir/postgres.list"

"${compose[@]}" exec -T postgres psql -U "$db_user" -d "$db_name" -AtF '|' -c '
SELECT
  (SELECT count(*) FROM admins),
  (SELECT count(*) FROM domains WHERE name = '\''ci.example'\''),
  (SELECT count(*) FROM inbound_messages WHERE delivery_key = '\''ci-delivery'\''),
  (SELECT count(*) FROM api_keys WHERE name IN ('\''ci-go-key'\'', '\''ci-denied-key'\'', '\''ci-limited-key'\''));
' > "$backup_dir/expected-counts.txt"
grep -Eq '^[0-9]+\|1\|1\|3$' "$backup_dir/expected-counts.txt"

jwt_before="$("${compose[@]}" exec -T go-business-api sha256sum /var/lib/all-mail-secrets/jwt-secret | awk '{print $1}')"
encryption_before="$("${compose[@]}" exec -T go-business-api sha256sum /var/lib/all-mail-encryption/encryption-key | awk '{print $1}')"
test -n "$jwt_before"
test -n "$encryption_before"
printf '%s\n' "$jwt_before" > "$backup_dir/jwt.sha256"
printf '%s\n' "$encryption_before" > "$backup_dir/encryption.sha256"

"${compose[@]}" stop app go-business-api worker-forwarding worker-retention redis
backup_abs="$(cd "$backup_dir" && pwd)"
while IFS= read -r volume; do
  test -n "$volume"
  docker run --rm --read-only \
    -v "$volume:/source:ro" \
    -v "$backup_abs:/backup" \
    alpine:3.20 sh -eu -c \
      'cd /source && tar -czf "/backup/volumes/'"$volume"'.tar.gz" .'
done < "$backup_dir/volumes.txt"

(
  cd "$backup_dir"
  find . -type f ! -name SHA256SUMS -print0 \
    | sort -z \
    | xargs -0 sha256sum > SHA256SUMS
  sha256sum --check SHA256SUMS
)

"${compose[@]}" down --remove-orphans
while IFS= read -r volume; do
  test -n "$volume"
  docker volume rm "$volume" >/dev/null
  docker volume create "$volume" >/dev/null
  docker run --rm \
    -v "$volume:/target" \
    -v "$backup_abs:/backup:ro" \
    alpine:3.20 sh -eu -c \
      'cd /target && tar -xzf "/backup/volumes/'"$volume"'.tar.gz"'
done < "$backup_dir/volumes.txt"

docker volume rm "$postgres_volume" >/dev/null
docker volume create "$postgres_volume" >/dev/null
"${compose[@]}" up -d --wait postgres
"${compose[@]}" exec -T postgres \
  pg_restore -U "$db_user" -d "$db_name" \
    --clean --if-exists --no-owner --no-privileges \
  < "$backup_dir/postgres.dump"

./scripts/compose-up.sh

for service in app go-business-api worker-forwarding worker-retention; do
  "${compose[@]}" exec -T "$service" allmail version --json
done
"${compose[@]}" exec -T app allmail doctor api
"${compose[@]}" exec -T go-business-api allmail doctor business-api
"${compose[@]}" exec -T worker-forwarding allmail doctor worker forwarding
"${compose[@]}" exec -T worker-retention allmail doctor worker retention
curl --fail --silent --show-error "http://127.0.0.1:${APP_PORT:-3002}/readyz" >/dev/null

actual_counts="$("${compose[@]}" exec -T postgres psql -U "$db_user" -d "$db_name" -AtF '|' -c '
SELECT
  (SELECT count(*) FROM admins),
  (SELECT count(*) FROM domains WHERE name = '\''ci.example'\''),
  (SELECT count(*) FROM inbound_messages WHERE delivery_key = '\''ci-delivery'\''),
  (SELECT count(*) FROM api_keys WHERE name IN ('\''ci-go-key'\'', '\''ci-denied-key'\'', '\''ci-limited-key'\''));
' | tr -d '\r')"
expected_counts="$(tr -d '\r\n' < "$backup_dir/expected-counts.txt")"
test "$actual_counts" = "$expected_counts"

jwt_after="$("${compose[@]}" exec -T go-business-api sha256sum /var/lib/all-mail-secrets/jwt-secret | awk '{print $1}')"
encryption_after="$("${compose[@]}" exec -T go-business-api sha256sum /var/lib/all-mail-encryption/encryption-key | awk '{print $1}')"
test "$jwt_after" = "$jwt_before"
test "$encryption_after" = "$encryption_before"
"${compose[@]}" exec -T go-business-api sh -lc 'test ! -e /var/lib/all-mail/bootstrap-admin.env'
test "$(docker run --rm -v "${project_name}_legacy_runtime_data:/state:ro" alpine:3.20 cat /state/pre-rename-volume-marker)" = "preserved"

cat > "$backup_dir/restore-rehearsal-report.txt" <<REPORT
project=${project_name}
revision=$(cat "$backup_dir/revision.txt")
expected-counts=${expected_counts}
restored-counts=${actual_counts}
jwt-secret-preserved=true
encryption-key-preserved=true
bootstrap-credential-retired=true
postgres-dump-verified=true
volume-checksums-verified=true
result=success
REPORT

printf 'all-Mail isolated backup and restore rehearsal passed\n'
