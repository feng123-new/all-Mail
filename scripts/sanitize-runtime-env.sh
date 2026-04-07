#!/bin/sh
set -eu

unset NODE_USE_ENV_PROXY

if [ -n "${NODE_OPTIONS:-}" ]; then
    sanitized_node_options=""
    for node_option in $NODE_OPTIONS; do
        case "$node_option" in
            --use-env-proxy|--use-env-proxy=1|--use-env-proxy=true)
                ;;
            *)
                if [ -z "$sanitized_node_options" ]; then
                    sanitized_node_options="$node_option"
                else
                    sanitized_node_options="$sanitized_node_options $node_option"
                fi
                ;;
        esac
    done

    if [ -n "$sanitized_node_options" ]; then
        export NODE_OPTIONS="$sanitized_node_options"
    else
        unset NODE_OPTIONS
    fi
fi

exec "$@"
