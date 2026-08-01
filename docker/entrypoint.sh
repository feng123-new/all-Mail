#!/bin/sh
set -eu

runtime_role=${1:-api}

if [ "$#" -gt 0 ]; then
    shift
fi

case "$runtime_role" in
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
export ALL_MAIL_RUNTIME_ROLE="$runtime_role"
run_as_allmail "$sanitize_runtime_env" node /app/scripts/validate-production-config.mjs

bootstrap_lock_file="$ALL_MAIL_STATE_DIR/.bootstrap-secrets.lock"
run_as_allmail sh -c 'umask 077; : >> "$1"; chmod 600 "$1"' sh "$bootstrap_lock_file"
bootstrap_exports=$(run_as_allmail flock -w 30 "$bootstrap_lock_file" "$sanitize_runtime_env" node /app/scripts/bootstrap-secrets.mjs --mode require-existing --state-dir "$ALL_MAIL_STATE_DIR" --format shell)
eval "$bootstrap_exports"

if [ -n "${ALL_MAIL_GENERATED_RUNTIME_SECRETS:-}" ]; then
    printf '%s\n' "Generated runtime secrets in ${ALL_MAIL_RUNTIME_SECRETS_FILE}."
fi

exec_as_allmail "$sanitize_runtime_env" node "$runtime_entry" "$@"
