#!/bin/sh
set -eu

set +e
migration_output=$(npx prisma migrate deploy 2>&1)
migration_exit=$?
set -e

printf '%s\n' "$migration_output"

if [ "$migration_exit" -ne 0 ]; then
    case "$migration_output" in
        *P3005*)
            printf '%s\n' 'Prisma migrate deploy skipped for legacy non-empty database; falling back to db push.'
            npx prisma db push --skip-generate
            ;;
        *)
            exit "$migration_exit"
            ;;
    esac
fi

exec node dist/index.js
