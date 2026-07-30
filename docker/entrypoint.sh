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

export_secret_file() {
    target_file=$1
    secret_value=$2
    export_directory=$(dirname "$target_file")
    mkdir -p "$export_directory"
    if [ "$(id -u)" -eq 0 ]; then
        chown 10001:10001 "$export_directory"
    fi
    temporary_file="${target_file}.tmp.$$"
    umask 077
    printf '%s\n' "$secret_value" > "$temporary_file"
    if [ "$(id -u)" -eq 0 ]; then
        chown 10001:10001 "$temporary_file"
    fi
    chmod 600 "$temporary_file"
    mv -f "$temporary_file" "$target_file"
}

prepare_runtime_state
export ALL_MAIL_RUNTIME_ROLE="$runtime_role"
run_as_allmail "$sanitize_runtime_env" node /app/scripts/validate-production-config.mjs

bootstrap_mode=require-existing
if [ "$runtime_role" = "init" ]; then
    bootstrap_mode=init
fi

bootstrap_lock_file="$ALL_MAIL_STATE_DIR/.bootstrap-secrets.lock"
run_as_allmail sh -c 'umask 077; : >> "$1"; chmod 600 "$1"' sh "$bootstrap_lock_file"
bootstrap_exports=$(run_as_allmail flock -w 30 "$bootstrap_lock_file" "$sanitize_runtime_env" node /app/scripts/bootstrap-secrets.mjs --mode "$bootstrap_mode" --state-dir "$ALL_MAIL_STATE_DIR" --format shell)
eval "$bootstrap_exports"

if [ -n "${ALL_MAIL_GENERATED_RUNTIME_SECRETS:-}" ]; then
    printf '%s\n' "Generated runtime secrets in ${ALL_MAIL_RUNTIME_SECRETS_FILE}."
fi

if [ "$runtime_role" = "init" ]; then
    if [ -n "${ALL_MAIL_EXPORT_ENCRYPTION_KEY_FILE:-}" ] && [ -n "${ENCRYPTION_KEY:-}" ]; then
        export_secret_file "$ALL_MAIL_EXPORT_ENCRYPTION_KEY_FILE" "$ENCRYPTION_KEY"
    fi
    if [ -n "${ALL_MAIL_EXPORT_JWT_SECRET_FILE:-}" ] && [ -n "${JWT_SECRET:-}" ]; then
        export_secret_file "$ALL_MAIL_EXPORT_JWT_SECRET_FILE" "$JWT_SECRET"
    fi
fi

run_business_migrations() {
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
            if is_true "${ALL_MAIL_ALLOW_PRISMA_P3005_REPAIR:-false}"; then
                printf '%s\n' 'P3005 detected; running the explicitly enabled Prisma repair and db push path.'
                run_as_allmail "$sanitize_runtime_env" npm run db:repair:p3005
                run_as_allmail "$sanitize_runtime_env" npm run db:push -- --skip-generate
                return 0
            fi
            printf '%s\n' 'Prisma reported P3005 for a non-empty existing database.' >&2
            printf '%s\n' 'The automatic db push fallback is disabled for production safety.' >&2
            printf '%s\n' 'Review the database, then run business-init once with ALL_MAIL_ALLOW_PRISMA_P3005_REPAIR=true only when the documented repair path is intended.' >&2
            return "$migration_exit"
            ;;
        *)
            return "$migration_exit"
            ;;
    esac
}

if [ "$runtime_role" = "init" ]; then
    run_business_migrations
    run_as_allmail "$sanitize_runtime_env" npm run config:import-env
    run_as_allmail "$sanitize_runtime_env" node dist/runtime/bootstrapAdmin.js
    printf '%s\n' 'Runtime secrets, Prisma migrations, durable configuration import, administrator bootstrap, and private Go secret export completed.'
    exit 0
fi

exec_as_allmail "$sanitize_runtime_env" node "$runtime_entry" "$@"
