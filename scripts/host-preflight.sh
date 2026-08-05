#!/usr/bin/env bash
set -euo pipefail

failures=0
warnings=0

report_failure() {
  printf 'preflight: %s\n' "$1" >&2
  failures=$((failures + 1))
}

report_warning() {
  printf 'preflight warning: %s\n' "$1" >&2
  warnings=$((warnings + 1))
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

require_non_negative_integer() {
  local name="$1"
  local value="$2"
  if [[ ! "$value" =~ ^[0-9]+$ ]]; then
    report_failure "${name} must be a non-negative integer; found ${value}"
    return 1
  fi
  return 0
}

proc_root="${ALL_MAIL_PREFLIGHT_PROC_ROOT:-/proc}"
check_path="${ALL_MAIL_PREFLIGHT_CHECK_PATH:-.}"
minimum_memory_mib="${ALL_MAIL_PREFLIGHT_MIN_MEMORY_MIB:-1024}"
minimum_disk_mib="${ALL_MAIL_PREFLIGHT_MIN_DISK_MIB:-4096}"
minimum_inodes="${ALL_MAIL_PREFLIGHT_MIN_INODES:-10000}"
app_host="${ALL_MAIL_PREFLIGHT_APP_HOST:-127.0.0.1}"
app_port="${ALL_MAIL_PREFLIGHT_APP_PORT:-3002}"

for pair in \
  "ALL_MAIL_PREFLIGHT_MIN_MEMORY_MIB:$minimum_memory_mib" \
  "ALL_MAIL_PREFLIGHT_MIN_DISK_MIB:$minimum_disk_mib" \
  "ALL_MAIL_PREFLIGHT_MIN_INODES:$minimum_inodes" \
  "ALL_MAIL_PREFLIGHT_APP_PORT:$app_port"; do
  name="${pair%%:*}"
  value="${pair#*:}"
  if ! require_non_negative_integer "$name" "$value"; then
    case "$name" in
      ALL_MAIL_PREFLIGHT_MIN_MEMORY_MIB) minimum_memory_mib=0 ;;
      ALL_MAIL_PREFLIGHT_MIN_DISK_MIB) minimum_disk_mib=0 ;;
      ALL_MAIL_PREFLIGHT_MIN_INODES) minimum_inodes=0 ;;
      ALL_MAIL_PREFLIGHT_APP_PORT) app_port=0 ;;
    esac
  fi
done
if ((app_port < 1 || app_port > 65535)); then
  report_failure "ALL_MAIL_PREFLIGHT_APP_PORT must be between 1 and 65535; found ${app_port}"
fi

if ((BASH_VERSINFO[0] < 4)); then
  report_failure "Bash 4 or newer is required; found ${BASH_VERSION}"
else
  printf 'bash=%s\n' "$BASH_VERSION"
fi

if require_command uname 'install standard Linux userland tools'; then
  host_os="$(uname -s 2>/dev/null || true)"
  if [[ "$host_os" != "Linux" ]]; then
    report_failure "the supported production host is Linux; found ${host_os:-unknown}"
  else
    printf 'host-os=linux\n'
  fi
fi

if require_command git 'install Git before selecting an immutable release tag'; then
  printf 'git=%s\n' "$(git --version | awk '{print $3}')"
fi

python_available=0
if require_command python3 'install Python 3 for resolved Compose model validation'; then
  python_available=1
  if ! python3 - <<'PY'
import sys
if sys.version_info < (3, 9):
    raise SystemExit(f"preflight: Python 3.9 or newer is required; found {sys.version.split()[0]}")
print(f"python={sys.version.split()[0]}")
PY
  then
    failures=$((failures + 1))
  fi
fi

if require_command openssl 'install OpenSSL for operator-generated PostgreSQL passwords'; then
  printf 'openssl=%s\n' "$(openssl version | awk '{print $2}')"
fi

require_command awk 'install standard Linux text-processing tools' || true
require_command df 'install standard Linux filesystem tools' || true

if [[ "${ALL_MAIL_PREFLIGHT_SKIP_KERNEL:-0}" != "1" ]]; then
  overcommit_file="$proc_root/sys/vm/overcommit_memory"
  if [[ ! -r "$overcommit_file" ]]; then
    report_failure "cannot read ${overcommit_file}; vm.overcommit_memory must be verified on the Linux host"
  else
    overcommit_value="$(tr -d '[:space:]' < "$overcommit_file")"
    if [[ "$overcommit_value" != "1" ]]; then
      report_failure "vm.overcommit_memory must be 1 for reliable Redis background persistence; found ${overcommit_value}. Persist 'vm.overcommit_memory = 1' under /etc/sysctl.d and apply it with sysctl --system"
    else
      printf 'vm.overcommit_memory=1\n'
    fi
  fi

  meminfo_file="$proc_root/meminfo"
  if [[ ! -r "$meminfo_file" ]]; then
    report_failure "cannot read ${meminfo_file}; available memory could not be verified"
  elif command -v awk >/dev/null 2>&1; then
    available_kib="$(awk '
      /^MemAvailable:/ { print $2; found = 1; exit }
      /^MemFree:/ { free = $2 }
      /^Buffers:/ { buffers = $2 }
      /^Cached:/ { cached = $2 }
      END { if (!found && free != "") print free + buffers + cached }
    ' "$meminfo_file")"
    if [[ ! "$available_kib" =~ ^[0-9]+$ ]]; then
      report_failure "available memory could not be parsed from ${meminfo_file}"
    else
      available_memory_mib=$((available_kib / 1024))
      printf 'memory-available-mib=%s\n' "$available_memory_mib"
      if ((available_memory_mib < minimum_memory_mib)); then
        report_failure "available memory is ${available_memory_mib} MiB; at least ${minimum_memory_mib} MiB is required"
      fi
    fi
  fi
else
  printf 'kernel-checks=skipped\n'
fi

if command -v df >/dev/null 2>&1 && command -v awk >/dev/null 2>&1; then
  if [[ ! -e "$check_path" ]]; then
    report_failure "filesystem check path does not exist: ${check_path}"
  else
    available_disk_kib="$(df -Pk "$check_path" 2>/dev/null | awk 'END { print $4 }')"
    available_inodes="$(df -Pi "$check_path" 2>/dev/null | awk 'END { print $4 }')"
    if [[ ! "$available_disk_kib" =~ ^[0-9]+$ ]]; then
      report_failure "available disk space could not be resolved for ${check_path}"
    else
      available_disk_mib=$((available_disk_kib / 1024))
      printf 'disk-available-mib=%s\n' "$available_disk_mib"
      if ((available_disk_mib < minimum_disk_mib)); then
        report_failure "available disk space is ${available_disk_mib} MiB; at least ${minimum_disk_mib} MiB is required"
      fi
    fi
    if [[ ! "$available_inodes" =~ ^[0-9]+$ ]]; then
      report_failure "available inode count could not be resolved for ${check_path}"
    else
      printf 'inodes-available=%s\n' "$available_inodes"
      if ((available_inodes < minimum_inodes)); then
        report_failure "available inode count is ${available_inodes}; at least ${minimum_inodes} is required"
      fi
    fi
  fi
fi

if ((python_available == 1)) && [[ "${ALL_MAIL_PREFLIGHT_SKIP_PORT:-0}" != "1" ]]; then
  if python3 - "$app_host" "$app_port" <<'PY'
import socket
import sys

host = sys.argv[1]
port = int(sys.argv[2])
errors = []
for family, socktype, proto, _, address in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM):
    sock = socket.socket(family, socktype, proto)
    try:
        sock.bind(address)
        sock.close()
        print(f"app-port={host}:{port}:available")
        break
    except OSError as error:
        errors.append(str(error))
        sock.close()
else:
    raise SystemExit("; ".join(errors) or "no bindable address")
PY
  then
    :
  else
    report_warning "${app_host}:${app_port} is already bound. For a fresh installation free the port; during an upgrade confirm the running all-Mail revision owns it or set ALL_MAIL_PREFLIGHT_SKIP_PORT=1 after that manual check"
  fi
elif [[ "${ALL_MAIL_PREFLIGHT_SKIP_PORT:-0}" == "1" ]]; then
  printf 'app-port-check=skipped\n'
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
      storage_driver="$(docker info --format '{{.Driver}}' 2>/dev/null || true)"
      if [[ -n "$storage_driver" ]]; then
        printf 'docker-storage-driver=%s\n' "$storage_driver"
      fi
    fi
  else
    printf 'docker-daemon-check=skipped\n'
  fi
fi

if ((failures > 0)); then
  printf 'preflight failed with %d issue(s) and %d warning(s)\n' "$failures" "$warnings" >&2
  exit 1
fi

if ((warnings > 0)); then
  printf 'all-Mail production host preflight passed with %d warning(s)\n' "$warnings"
else
  printf 'all-Mail production host preflight passed\n'
fi
