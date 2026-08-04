#!/usr/bin/env bash
set -euo pipefail

failures=0

report_failure() {
  printf 'preflight: %s\n' "$1" >&2
  failures=$((failures + 1))
}

require_command() {
  local name="$1"
  local hint="$2"
  if ! command -v "$name" >/dev/null 2>&1; then
    report_failure "missing ${name}; ${hint}"
    return 1
  fi
  return 0
}

if ((BASH_VERSINFO[0] < 4)); then
  report_failure "Bash 4 or newer is required; found ${BASH_VERSION}"
else
  printf 'bash=%s\n' "$BASH_VERSION"
fi

if require_command git 'install Git before selecting an immutable release tag'; then
  printf 'git=%s\n' "$(git --version | awk '{print $3}')"
fi

if require_command python3 'install Python 3 for resolved Compose model validation'; then
  python3 - <<'PY'
import sys
if sys.version_info < (3, 9):
    raise SystemExit(f"preflight: Python 3.9 or newer is required; found {sys.version.split()[0]}")
print(f"python={sys.version.split()[0]}")
PY
fi

if require_command openssl 'install OpenSSL for operator-generated PostgreSQL passwords'; then
  printf 'openssl=%s\n' "$(openssl version | awk '{print $2}')"
fi

if require_command docker 'install Docker Engine with the Compose v2 plugin'; then
  docker_version="$(docker version --format '{{.Client.Version}}' 2>/dev/null || true)"
  if [[ -z "$docker_version" ]]; then
    report_failure 'Docker client is present but its version could not be resolved'
  else
    printf 'docker-client=%s\n' "$docker_version"
  fi

  compose_version="$(docker compose version --short 2>/dev/null || true)"
  if [[ -z "$compose_version" ]]; then
    report_failure 'Docker Compose v2 plugin is required (`docker compose`)'
  else
    printf 'docker-compose=%s\n' "$compose_version"
  fi

  if [[ "${ALL_MAIL_PREFLIGHT_SKIP_DAEMON:-0}" != "1" ]]; then
    if ! docker info >/dev/null 2>&1; then
      report_failure 'Docker daemon is unavailable to the current user'
    else
      printf 'docker-daemon=available\n'
    fi
  fi
fi

if ((failures > 0)); then
  printf 'preflight failed with %d issue(s)\n' "$failures" >&2
  exit 1
fi

printf 'all-Mail production host preflight passed\n'
