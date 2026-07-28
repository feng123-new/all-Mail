#!/bin/sh
set -eu

runtime_role=${1:-api}

if [ "$#" -gt 0 ]; then
    shift
fi

case "$runtime_role" in
    init)
        runtime_entry=""
        ;;
    api)
        runtime_entry="dist/index.js"
        ;;
    *)
        exec "$runtime_role" "$@"
        ;;
esac

ALL_MAIL_STATE_DIR=${ALL_MAIL_STATE_DIR:-/var/lib/all-mail}
sanitize_runtime_env=/app/scripts/sanitize-runtime-env.sh

case "$ALL_MAIL_STATE_DIR" in
    /)
        printf '%s\n' "Refusing unsafe ALL_MAIL_STATE_DIR=${ALL_MAIL_STATE_DIR}" >&2
        exit 1
        ;;
esac

is_true() {
    case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
        1|true|yes|on)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

run_as_allmail() {
    if [ "$(id -u)" -eq 0 ]; then
        gosu allmail "$@"
    else
        "$@"
    fi
}

exec_as_allmail() {
    if [ "$(id -u)" -eq 0 ]; then
        exec gosu allmail "$@"
    fi
    exec "$@"
}

prepare_runtime_state() {
    if [ "$(id -u)" -eq 0 ]; then
        mkdir -p "$ALL_MAIL_STATE_DIR"
        chown -R 10001:10001 "$ALL_MAIL_STATE_DIR"
    else
        mkdir -p "$ALL_MAIL_STATE_DIR"
    fi
}

prepare_runtime_state

eval "$(run_as_allmail "$sanitize_runtime_env" node /app/scripts/bootstrap-secrets.mjs --state-dir "$ALL_MAIL_STATE_DIR" --format shell)"

if [ "$runtime_role" = "init" ] && [ -n "${ALL_MAIL_EXPORT_ENCRYPTION_KEY_FILE:-}" ] && [ -n "${ENCRYPTION_KEY:-}" ]; then
    export_directory=$(dirname "$ALL_MAIL_EXPORT_ENCRYPTION_KEY_FILE")
    mkdir -p "$export_directory"
    if [ "$(id -u)" -eq 0 ]; then
        chown 10001:10001 "$export_directory"
    fi
    temporary_key_file="${ALL_MAIL_EXPORT_ENCRYPTION_KEY_FILE}.tmp.$$"
    umask 077
    printf '%s\n' "$ENCRYPTION_KEY" > "$temporary_key_file"
    if [ "$(id -u)" -eq 0 ]; then
        chown 10001:10001 "$temporary_key_file"
    fi
    chmod 600 "$temporary_key_file"
    mv -f "$temporary_key_file" "$ALL_MAIL_EXPORT_ENCRYPTION_KEY_FILE"
fi

if [ -n "${ALL_MAIL_GENERATED_SECRETS:-}" ]; then
    printf '%s\n' "Generated bootstrap secrets in ${ALL_MAIL_BOOTSTRAP_SECRETS_FILE}"
fi

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
        if is_true "${ALL_MAIL_PRINT_BOOTSTRAP_PASSWORD:-false}"; then
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
                    printf '%s\n' "Example: docker compose exec legacy-api sh -lc \"grep '^ADMIN_PASSWORD=' ${ALL_MAIL_BOOTSTRAP_SECRETS_FILE} | cut -d= -f2-\""
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

run_legacy_migrations() {
    set +e
    migration_output=$(run_as_allmail "$sanitize_runtime_env" npm run db:migrate 2>&1)
    migration_exit=$?
    set -e

    printf '%s\n' "$migration_output"
    if [ "$migration_exit" -eq 0 ]; then
        return 0
    fi

    case "$migration_output" in
        *P3005*)
            if is_true "${ALL_MAIL_ALLOW_LEGACY_DB_PUSH_REPAIR:-false}"; then
                printf '%s\n' 'P3005 detected; running the explicitly enabled legacy repair and db push path.'
                run_as_allmail "$sanitize_runtime_env" npm run db:repair:legacy-p3005
                run_as_allmail "$sanitize_runtime_env" npm run db:push -- --skip-generate
                return 0
            fi
            printf '%s\n' 'Prisma reported P3005 for a non-empty legacy database.' >&2
            printf '%s\n' 'The automatic db push fallback is disabled for production safety.' >&2
            printf '%s\n' 'Review the database, then run legacy-init once with ALL_MAIL_ALLOW_LEGACY_DB_PUSH_REPAIR=true only when the documented repair path is intended.' >&2
            return "$migration_exit"
            ;;
        *)
            return "$migration_exit"
            ;;
    esac
}

if [ "$runtime_role" = "init" ]; then
    run_legacy_migrations
    printf '%s\n' 'Legacy bootstrap and Prisma migrations completed.'
    exit 0
fi

exec_as_allmail "$sanitize_runtime_env" node "$runtime_entry" "$@"
