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

print_bootstrap_password=0
case "$(printf '%s' "${ALL_MAIL_PRINT_BOOTSTRAP_PASSWORD:-}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on)
        print_bootstrap_password=1
        ;;
esac

admin_password_source=""
case ",${ALL_MAIL_GENERATED_SECRETS:-}," in
    *,ADMIN_PASSWORD,*)
        admin_password_source="generated"
        ;;
    *)
        case ",${ALL_MAIL_MANAGED_BOOTSTRAP_SECRETS:-}," in
            *,ADMIN_PASSWORD,*)
                admin_password_source="state-file"
                ;;
            *)
                if [ -n "${ADMIN_PASSWORD:-}" ]; then
                    admin_password_source="env"
                fi
                ;;
        esac
        ;;
esac

if [ "${ALL_MAIL_CREATED_STATE_FILE:-0}" = "1" ] || [ -n "${ALL_MAIL_GENERATED_SECRETS:-}" ]; then
    printf '%s\n' "First login URL: ${ALL_MAIL_LOGIN_URL}"
    case "${ALL_MAIL_LOGIN_URL}" in
        http://127.0.0.1:*|http://localhost:*|https://127.0.0.1:*|https://localhost:*)
            printf '%s\n' 'NOTE: 127.0.0.1/localhost only works on the same machine. Replace it with your cloud server public IP, domain, or the correct local address when accessing remotely.'
            ;;
    esac
    printf '%s\n' "Bootstrap admin username: ${ADMIN_USERNAME:-admin}"
    if [ -n "${ADMIN_PASSWORD:-}" ]; then
        if [ "$print_bootstrap_password" = "1" ]; then
            case "$admin_password_source" in
                generated)
                    printf '%s\n' "Temporary admin password: ${ADMIN_PASSWORD}"
                    ;;
                *)
                    printf '%s\n' "Bootstrap admin password: ${ADMIN_PASSWORD}"
                    ;;
            esac
            printf '%s\n' 'WARNING: Startup logs may retain this password. Disable ALL_MAIL_PRINT_BOOTSTRAP_PASSWORD after recovery.'
            if [ "$admin_password_source" = "generated" ]; then
                printf '%s\n' 'You must log in and change it immediately before using the rest of the application.'
                printf '%s\n' 'After the password is changed, this temporary password will no longer be valid.'
            fi
        else
            case "$admin_password_source" in
                generated|state-file)
                    printf '%s\n' "Bootstrap admin password is stored in ${ALL_MAIL_BOOTSTRAP_SECRETS_FILE}."
                    printf '%s\n' 'Retrieve it from the runtime state file instead of startup logs.'
                    printf '%s\n' "Example: docker compose exec app sh -lc \"grep '^ADMIN_PASSWORD=' ${ALL_MAIL_BOOTSTRAP_SECRETS_FILE} | cut -d= -f2-\""
                    if [ "$admin_password_source" = "generated" ]; then
                        printf '%s\n' 'You must log in and change this temporary password immediately before using the rest of the application.'
                    fi
                    ;;
                env)
                    printf '%s\n' 'Bootstrap admin password is configured via the container environment and is not echoed to startup logs.'
                    printf '%s\n' 'Review ADMIN_PASSWORD in the env source used for this runtime.'
                    printf '%s\n' 'Set ALL_MAIL_PRINT_BOOTSTRAP_PASSWORD=true only if you explicitly want startup password output.'
                    ;;
            esac
        fi
    fi
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
