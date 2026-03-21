#!/bin/sh
set -eu

ALL_MAIL_STATE_DIR=${ALL_MAIL_STATE_DIR:-/var/lib/all-mail}
mkdir -p "$ALL_MAIL_STATE_DIR"
eval "$(node /app/scripts/bootstrap-secrets.mjs --state-dir "$ALL_MAIL_STATE_DIR" --format shell)"

if [ -n "${ALL_MAIL_GENERATED_SECRETS:-}" ]; then
    printf '%s\n' "Generated bootstrap secrets in ${ALL_MAIL_BOOTSTRAP_SECRETS_FILE}"
    case ",${ALL_MAIL_GENERATED_SECRETS}," in
        *,ADMIN_PASSWORD,*)
            printf '%s\n' "Generated bootstrap admin password for ${ADMIN_USERNAME:-admin}: ${ADMIN_PASSWORD}"
            printf '%s\n' 'Change this password after the first successful admin login.'
            ;;
    esac
fi

set +e
migration_output=$(npm run db:migrate 2>&1)
migration_exit=$?
set -e

printf '%s\n' "$migration_output"

if [ "$migration_exit" -ne 0 ]; then
    case "$migration_output" in
        *P3005*)
            printf '%s\n' 'Prisma migrate deploy skipped for legacy non-empty database; falling back to db push.'
            npm run db:push -- --skip-generate
            ;;
        *)
            exit "$migration_exit"
            ;;
    esac
fi

exec node dist/index.js
