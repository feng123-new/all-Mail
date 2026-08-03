# Backup and restore guide

A usable `all-Mail` backup is a **consistent state set**, not only a PostgreSQL dump. Database rows may depend on encryption keys, session keys, Redis authentication, bootstrap state, and generated runtime database credentials stored in Docker volumes.

Use a restricted directory, encrypt backups at rest, and never attach backup archives to public issues.

## State inventory

| State | Required | Purpose |
| --- | --- | --- |
| PostgreSQL custom-format dump | Yes | Application data, migration ledgers, encrypted configuration, audit state |
| `.env` | Yes | Operator configuration and PostgreSQL owner password |
| Exact Git tag/commit and resolved Compose model | Yes | Runtime/schema/volume contract |
| `runtime_secrets_data` | Yes | Master JWT, encryption, Redis, and runtime database-role secrets |
| `bootstrap_admin_data` | Yes when present; otherwise preserve the empty volume | One-time administrator credential and non-secret file references |
| `forwarding_runtime_data` | Yes | Forwarding encryption-key export |
| `go_business_runtime_data` | Yes | Private API JWT-secret export |
| `redis_runtime_data` | Yes | Redis-password export |
| `database_runtime_data` | Yes | API, forwarding, and retention database URL exports |
| `redis_data` | Recommended | OAuth state, replay protection, lockouts, rate-limit continuity, append-only persistence |
| Cloudflare R2 raw-message bucket | Required when raw persistence is enabled and raw `.eml` recovery matters | Full RFC 822 messages referenced by `inbound_messages.raw_object_key`; this state is outside Docker volumes |
| `postgres_data` | Not in the canonical online backup | Use the logical dump; a cold physical copy is optional only with PostgreSQL fully stopped |

## Backup preparation

Choose a timestamped destination outside the repository:

```bash
backup_dir="$HOME/all-mail-backups/$(date -u +'%Y%m%dT%H%M%SZ')"
mkdir -p "$backup_dir/volumes"
chmod 0700 "$backup_dir"
```

Record release identity and configuration without printing secrets:

```bash
git rev-parse HEAD > "$backup_dir/revision.txt"
git describe --tags --always --dirty > "$backup_dir/tag.txt"
cp .env "$backup_dir/all-mail.env"
docker compose config > "$backup_dir/compose.resolved.yml"
docker compose images --format json > "$backup_dir/images.json"
chmod 0600 "$backup_dir/all-mail.env"
```

## PostgreSQL logical backup

Resolve the database identity inside the container and stream a custom-format dump to the host:

```bash
db_user="$(docker compose exec -T postgres printenv POSTGRES_USER | tr -d '\r')"
db_name="$(docker compose exec -T postgres printenv POSTGRES_DB | tr -d '\r')"
docker compose exec -T postgres \
  pg_dump -U "$db_user" -d "$db_name" \
    --format=custom --compress=9 --no-owner --no-privileges \
  > "$backup_dir/postgres.dump"
```

Verify the archive can be listed:

```bash
docker compose exec -T postgres pg_restore --list < "$backup_dir/postgres.dump" > /dev/null
```

## Resolve and archive Docker volumes

Create a volume manifest from the resolved Compose model. The master volume uses its preserved physical compatibility name.

```bash
docker compose config --format json > "$backup_dir/compose.json"
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
```

Archive each volume read-only:

```bash
backup_abs="$(cd "$backup_dir" && pwd)"
while IFS= read -r volume; do
  docker volume inspect "$volume" > /dev/null
  docker run --rm --read-only \
    -v "$volume:/source:ro" \
    -v "$backup_abs:/backup" \
    alpine:3.20 sh -eu -c \
      'cd /source && tar -czf "/backup/volumes/'"$volume"'.tar.gz" .'
done < "$backup_dir/volumes.txt"
```

For the most consistent Redis archive, pause writes briefly or stop the application services before archiving `redis_data`. PostgreSQL consistency comes from `pg_dump`; do not copy a live `postgres_data` directory as the primary backup.

## Cloudflare R2 raw-message backup

When the Worker has `RAW_EMAIL_BUCKET` bound, PostgreSQL stores object keys while R2 stores the complete `.eml`. A database and Docker-volume backup alone therefore does **not** guarantee raw-message recovery.

Use an R2 S3 API credential restricted to the selected bucket and an encrypted backup destination. One example with an S3-compatible client is:

```bash
export CLOUDFLARE_ACCOUNT_ID=<account-id>
export R2_BUCKET=mail-eml
mkdir -p "$backup_dir/r2/$R2_BUCKET"
aws s3 sync           "s3://$R2_BUCKET" "$backup_dir/r2/$R2_BUCKET"           --endpoint-url "https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com"
find "$backup_dir/r2/$R2_BUCKET" -type f -print0           | sort -z           | xargs -0 sha256sum > "$backup_dir/r2-$R2_BUCKET.SHA256SUMS"
```

Keep R2 access keys outside the backup directory. Configure an explicit bucket lifecycle in Cloudflare for the retention period required by your privacy and recovery policy; an unbounded bucket is not a retention policy. If raw `.eml` objects are intentionally disposable, record that decision in the backup manifest and expect restored records to retain previews and metadata without a recoverable raw object.

## Checksums and backup acceptance

```bash
(
  cd "$backup_dir"
  find . -type f ! -name SHA256SUMS -print0 \
    | sort -z \
    | xargs -0 sha256sum > SHA256SUMS
  sha256sum --check SHA256SUMS
)
```

A backup is accepted only when:

- the dump lists successfully;
- every expected volume archive exists and is non-empty;
- checksums pass;
- `revision.txt`, `tag.txt`, `.env`, and the resolved Compose model are present;
- a restore rehearsal has succeeded recently on isolated infrastructure;
- when R2 raw persistence is in scope, the bucket export and its object checksums are present and verified.

## In-place restore

These steps are destructive to the selected Compose project. Confirm the project name and backup twice.

### 1. Verify and select the exact revision

```bash
cd "$backup_dir"
sha256sum --check SHA256SUMS
revision="$(cat revision.txt)"
cd /path/to/all-Mail
git fetch --tags --prune
git switch --detach "$revision"
cp "$backup_dir/all-mail.env" .env
chmod 0600 .env
```

### 2. Stop the stack without deleting volumes automatically

```bash
docker compose down --remove-orphans
```

Never use `docker compose down -v` as a recovery shortcut.

### 3. Recreate and restore secret/data volumes

```bash
backup_abs="$(cd "$backup_dir" && pwd)"
while IFS= read -r volume; do
  docker volume rm "$volume" 2>/dev/null || true
  docker volume create "$volume" > /dev/null
  docker run --rm \
    -v "$volume:/target" \
    -v "$backup_abs:/backup:ro" \
    alpine:3.20 sh -eu -c \
      'cd /target && tar -xzf "/backup/volumes/'"$volume"'.tar.gz"'
done < "$backup_dir/volumes.txt"
```

### 4. Recreate PostgreSQL and restore the dump

Resolve the physical PostgreSQL volume name from the restored revision:

```bash
postgres_volume="$(docker compose config --format json | python3 -c '
import json, sys
print(json.load(sys.stdin)["volumes"]["postgres_data"]["name"])
')"
docker volume rm "$postgres_volume" 2>/dev/null || true
docker volume create "$postgres_volume" > /dev/null

docker compose up -d --wait postgres
db_user="$(docker compose exec -T postgres printenv POSTGRES_USER | tr -d '\r')"
db_name="$(docker compose exec -T postgres printenv POSTGRES_DB | tr -d '\r')"
docker compose exec -T postgres \
  pg_restore -U "$db_user" -d "$db_name" \
    --clean --if-exists --no-owner --no-privileges \
  < "$backup_dir/postgres.dump"
```

### 5. Reconcile and start the matching revision

```bash
./scripts/compose-up.sh
```

The initializer validates migration history, reuses the restored master secrets, recreates read-only exports when necessary, and reconciles runtime database roles.

### 6. Restore the R2 raw-message bucket when it is in scope

Restore to the bucket bound by the matching Worker revision before reconnecting real Email Routing:

```bash
export CLOUDFLARE_ACCOUNT_ID=<account-id>
export R2_BUCKET=mail-eml
sha256sum --check "$backup_dir/r2-$R2_BUCKET.SHA256SUMS"
aws s3 sync           "$backup_dir/r2/$R2_BUCKET" "s3://$R2_BUCKET"           --endpoint-url "https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com"
```

Sample several restored `raw_object_key` values from PostgreSQL and confirm the corresponding R2 objects exist. Do not reconnect production ingress until the database revision, encryption state, Worker binding, and bucket contents agree.

## Restore verification

```bash
docker compose ps -a
for service in app go-business-api worker-forwarding worker-retention; do
  docker compose exec -T "$service" allmail version --json
done

docker compose exec -T app allmail doctor api
docker compose exec -T go-business-api allmail doctor business-api
docker compose exec -T worker-forwarding allmail doctor worker forwarding
docker compose exec -T worker-retention allmail doctor worker retention
curl --fail http://127.0.0.1:3002/readyz
```

Then verify with synthetic data:

- administrator login and required session rotation;
- mailbox portal login;
- decryption of an existing provider credential;
- provider mailbox read;
- signed ingress, persisted message retrieval, and raw R2 object retrieval when configured;
- forwarding and outbound sending;
- API-key permission enforcement;
- retention worker health.

Do not declare recovery complete until the exact revision, four binary version outputs, database, secrets, and application behavior agree.

## Restore rehearsal

Run rehearsals under a separate host or isolated Docker context. Never connect the rehearsal deployment to real inbound routes, production provider callbacks, or production sending credentials. Record the rehearsal date, backup identifier, restore duration, checks performed, and any manual step that should be automated before the next release.
