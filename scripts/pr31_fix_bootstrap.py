#!/usr/bin/env python3
from pathlib import Path

path = Path('.github/workflows/bootstrap-admin-security.yml')
content = path.read_text(encoding='utf-8')
old = '''          rotated='Rotated-Password-123!'
          rotate_body="$RUNNER_TEMP/rotate-body.json"
          curl --fail --silent --show-error \\
            -o "$rotate_body" \\
            -H 'Content-Type: application/json' \\
            -H "Cookie: token=$token" \\
            --data "$(python3 -c 'import json,sys; print(json.dumps({\"oldPassword\":sys.argv[1],\"newPassword\":sys.argv[2]}))' "$password" "$rotated")" \\
            http://127.0.0.1:3002/admin/auth/change-password
          python3 - "$rotate_body" <<'PY'
          import json, sys
          with open(sys.argv[1], encoding='utf-8') as handle:
              payload = json.load(handle)
          assert payload['success'] is True
          PY
          docker compose exec -T business-api sh -lc 'test ! -e /var/lib/all-mail/bootstrap-admin.env'
          test "$(docker compose exec -T postgres psql -U allmail -d allmail -Atqc 'SELECT must_change_password FROM admins LIMIT 1')" = "f"
'''
new = '''          rotated='Rotated-Password-123!'
          old_token="$token"
          rotate_headers="$RUNNER_TEMP/rotate-headers.txt"
          rotate_body="$RUNNER_TEMP/rotate-body.json"
          curl --fail --silent --show-error \\
            -D "$rotate_headers" -o "$rotate_body" \\
            -H 'Content-Type: application/json' \\
            -H "Cookie: token=$old_token" \\
            --data "$(python3 -c 'import json,sys; print(json.dumps({\"oldPassword\":sys.argv[1],\"newPassword\":sys.argv[2]}))' "$password" "$rotated")" \\
            http://127.0.0.1:3002/admin/auth/change-password
          python3 - "$rotate_body" <<'PY'
          import json, sys
          with open(sys.argv[1], encoding='utf-8') as handle:
              payload = json.load(handle)
          assert payload['success'] is True
          PY
          rotated_token=$(tr -d '\\r' < "$rotate_headers" | sed -n 's/^[Ss]et-[Cc]ookie: token=\\([^;]*\\).*/\\1/p' | head -n1)
          test -n "$rotated_token"
          test "$rotated_token" != "$old_token"

          stale_headers="$RUNNER_TEMP/stale-session-headers.txt"
          stale_body="$RUNNER_TEMP/stale-session.json"
          stale_status=$(curl --silent --show-error \\
            -D "$stale_headers" -o "$stale_body" -w '%{http_code}' \\
            -H "Cookie: token=$old_token" \\
            http://127.0.0.1:3002/admin/dashboard/stats)
          test "$stale_status" = "401"
          grep -qi '^X-All-Mail-Route-Owner: go-business-api' "$stale_headers"
          grep -q 'INVALID_TOKEN' "$stale_body"
          token="$rotated_token"

          docker compose exec -T business-api sh -lc 'test ! -e /var/lib/all-mail/bootstrap-admin.env'
          test "$(docker compose exec -T postgres psql -U allmail -d allmail -Atqc 'SELECT must_change_password FROM admins LIMIT 1')" = "f"
'''
if new in content:
    raise SystemExit('bootstrap verification already updated')
if old not in content:
    raise SystemExit('expected bootstrap rotation block not found')
path.write_text(content.replace(old, new, 1), encoding='utf-8')
