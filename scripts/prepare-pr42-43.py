#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[1]

core_path = Path(__file__).with_name("apply-pr42-43-core.py")
content = core_path.read_text(encoding="utf-8")
content = content.replace("'''len(first.CreatedKeys) != 2''',\n    '''len(first.CreatedKeys) != 5'''", "'''len(first.CreatedKeys) != 3''',\n    '''len(first.CreatedKeys) != 6'''")
marker = '''replace_once(\n    "core/internal/secretstate/secretstate_test.go",\n    ''' + "'''len(first.CreatedKeys) != 3'''" + ''',\n    ''' + "'''len(first.CreatedKeys) != 6'''" + ''',\n)\n'''
addition = marker + '''replace_once(\n    "core/internal/secretstate/secretstate_test.go",\n    ''' + "'''len(state.RedisPassword) != 64 || len(state.CreatedKeys) != 1 || state.CreatedKeys[0] != \"REDIS_PASSWORD\"'''" + ''',\n    ''' + "'''len(state.RedisPassword) != 64 || len(state.CreatedKeys) != 4 || state.CreatedKeys[0] != \"REDIS_PASSWORD\"'''" + ''',\n)\n'''
if marker not in content:
    raise SystemExit("updated secret test marker missing")
content = content.replace(marker, addition, 1)
core_path.write_text(content, encoding="utf-8")

# PR41's bootstrap smoke does not repeat the Redis file assertion in the second
# secret block. Apply the database-file checks directly and remove the older
# generator replacement that expected that exact line layout.
smoke_path = root / "scripts/bootstrap-admin-docker-smoke.sh"
smoke = smoke_path.read_text(encoding="utf-8")
needle = '  test -r /var/lib/all-mail-encryption/encryption-key\n  test "${JWT_SECRET_FILE:-}" = "/var/lib/all-mail-secrets/jwt-secret"'
replacement = '  test -r /var/lib/all-mail-encryption/encryption-key\n  test -r /var/lib/all-mail-database/api-url\n  test "${DATABASE_URL_FILE:-}" = "/var/lib/all-mail-database/api-url"\n  test -z "${DATABASE_URL:-}"\n  test "${JWT_SECRET_FILE:-}" = "/var/lib/all-mail-secrets/jwt-secret"'
if smoke.count(needle) != 1:
    raise SystemExit("bootstrap smoke insertion point missing")
smoke_path.write_text(smoke.replace(needle, replacement, 1), encoding="utf-8")

runtime_path = Path(__file__).with_name("apply-pr42-43-runtime.py")
runtime = runtime_path.read_text(encoding="utf-8")
start_marker = 'replace_once(\n    "scripts/bootstrap-admin-docker-smoke.sh",'
end_marker = '\n\n# Keep broad generated checks in CI aligned with file-backed credentials.'
start = runtime.find(start_marker)
end = runtime.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit("bootstrap smoke generator block missing")
runtime_path.write_text(runtime[:start] + runtime[end:], encoding="utf-8")
