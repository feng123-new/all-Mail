#!/bin/sh
set -eu

runtime_role=${1:-api}

if [ "$#" -gt 0 ]; then
    shift
fi

case "$runtime_role" in
    api)
        runtime_entry="dist/index.js"
        run_migrations=${ALL_MAIL_RUN_MIGRATIONS:-1}
        ;;
    jobs)
        runtime_entry="dist/worker.js"
        run_migrations=${ALL_MAIL_RUN_MIGRATIONS:-0}
        ;;
    *)
        exec "$runtime_role" "$@"
        ;;
esac

ALL_MAIL_STATE_DIR=${ALL_MAIL_STATE_DIR:-/var/lib/all-mail}
mkdir -p "$ALL_MAIL_STATE_DIR"
sanitize_runtime_env=/app/scripts/sanitize-runtime-env.sh
eval "$("$sanitize_runtime_env" node /app/scripts/bootstrap-secrets.mjs --state-dir "$ALL_MAIL_STATE_DIR" --format shell)"

if [ -n "${ALL_MAIL_GENERATED_SECRETS:-}" ]; then
    printf '%s\n' "Generated bootstrap secrets in ${ALL_MAIL_BOOTSTRAP_SECRETS_FILE}"
fi

if [ "${ALL_MAIL_CREATED_STATE_FILE:-0}" = "1" ] || [ -n "${ALL_MAIL_GENERATED_SECRETS:-}" ]; then
    printf '%s\n' "First login URL: ${ALL_MAIL_LOGIN_URL}"
    case "${ALL_MAIL_LOGIN_URL}" in
        http://127.0.0.1:*|http://localhost:*|https://127.0.0.1:*|https://localhost:*)
            printf '%s\n' 'NOTE: 127.0.0.1/localhost only works on the same machine. Replace it with your cloud server public IP, domain, or the correct local address when accessing remotely.'
            ;;
    esac
    printf '%s\n' "Bootstrap admin username: ${ADMIN_USERNAME:-admin}"
    case ",${ALL_MAIL_GENERATED_SECRETS}," in
        *,ADMIN_PASSWORD,*)
            printf '%s\n' "Temporary admin password: ${ADMIN_PASSWORD}"
            printf '%s\n' 'IMPORTANT: This password is shown only once.'
            printf '%s\n' 'You must log in and change it immediately before using the rest of the application.'
            printf '%s\n' 'After the password is changed, this temporary password will no longer be valid.'
            ;;
        *)
            if [ -n "${ADMIN_PASSWORD:-}" ]; then
                printf '%s\n' "Bootstrap admin password: ${ADMIN_PASSWORD}"
            fi
            ;;
    esac
fi

if [ "$run_migrations" = "1" ]; then
    set +e
    migration_output=$("$sanitize_runtime_env" npm run db:migrate 2>&1)
    migration_exit=$?
    set -e

    printf '%s\n' "$migration_output"

    if [ "$migration_exit" -ne 0 ]; then
        case "$migration_output" in
            *P3005*)
                printf '%s\n' 'Prisma migrate deploy skipped for legacy non-empty database; falling back to db push.'
                "$sanitize_runtime_env" npm run db:repair:legacy-p3005
                "$sanitize_runtime_env" npm run db:push -- --skip-generate
                ;;
            *)
                exit "$migration_exit"
                ;;
        esac
    fi
fi

exec "$sanitize_runtime_env" node "$runtime_entry"
