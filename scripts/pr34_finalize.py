#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    content = read(path)
    if new in content:
        return
    if old not in content:
        raise SystemExit(f"missing marker in {path}: {old[:160]!r}")
    write(path, content.replace(old, new, 1))


def insert_after(path: str, marker: str, addition: str) -> None:
    content = read(path)
    if addition.strip() in content:
        return
    if marker not in content:
        raise SystemExit(f"missing marker in {path}: {marker[:160]!r}")
    write(path, content.replace(marker, marker + addition, 1))


replace_once(
    "core/internal/businessapi/server.go",
    "\ts.registerIngressRoutes(mux)\n",
    "\ts.registerIngressRoutes(mux)\n"
    "\ts.registerAdminManagementRoutes(mux)\n"
    "\ts.registerEmailGroupManagementRoutes(mux)\n"
    "\ts.registerDomainMailboxManagementRoutes(mux)\n"
    "\ts.registerMailboxUserManagementRoutes(mux)\n",
)

manifest_path = ROOT / "config/route-ownership.json"
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
completed_ids = {
    "admin-administrators",
    "admin-email-groups",
    "admin-domain-mailboxes",
    "admin-mailbox-users",
}
found = set()
for route in manifest["routes"]:
    if route["id"] in completed_ids:
        route["owner"] = "go-business-api"
        route["migrationStage"] = "complete"
        route.pop("targetOwner", None)
        found.add(route["id"])
if found != completed_ids:
    raise SystemExit(f"missing manifest routes: {sorted(completed_ids - found)}")
manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

insert_after(
    "core/internal/routeownership/manifest_test.go",
    '\t\t"API key admin":           {method: "POST", path: "/admin/api-keys", id: "admin-api-keys", owner: OwnerGoBusinessAPI},\n',
    '\t\t"administrator management": {method: "GET", path: "/admin/admins", id: "admin-administrators", owner: OwnerGoBusinessAPI},\n'
    '\t\t"email group management":   {method: "POST", path: "/admin/email-groups", id: "admin-email-groups", owner: OwnerGoBusinessAPI},\n'
    '\t\t"domain mailbox management": {method: "PATCH", path: "/admin/domain-mailboxes/42", id: "admin-domain-mailboxes", owner: OwnerGoBusinessAPI},\n'
    '\t\t"mailbox user management":  {method: "DELETE", path: "/admin/mailbox-users/42", id: "admin-mailbox-users", owner: OwnerGoBusinessAPI},\n',
)
insert_after(
    "core/internal/routeownership/manifest_test.go",
    '\t\tmanifest.Match("POST", "/ingress/domain-mail/receive"),\n',
    '\t\tmanifest.Match("GET", "/admin/admins"),\n'
    '\t\tmanifest.Match("POST", "/admin/email-groups"),\n'
    '\t\tmanifest.Match("PATCH", "/admin/domain-mailboxes/42"),\n'
    '\t\tmanifest.Match("DELETE", "/admin/mailbox-users/42"),\n',
)

insert_after(
    "scripts/route-ownership.test.mjs",
    '\t\t"admin-dashboard-log-batch-delete",\n',
    '\t\t"admin-administrators",\n'
    '\t\t"admin-email-groups",\n'
    '\t\t"admin-domain-mailboxes",\n'
    '\t\t"admin-mailbox-users",\n',
)

insert_after(
    "scripts/bootstrap-admin-docker-smoke.sh",
    'done\n\nwrite_headers="$RUNNER_TEMP/dashboard-write-headers.txt"\n',
    '''for route in \\
  '/admin/admins?page=1&pageSize=10' \\
  '/admin/email-groups' \\
  '/admin/domain-mailboxes?page=1&pageSize=20' \\
  '/admin/mailbox-users?page=1&pageSize=20'; do
  management_headers="$RUNNER_TEMP/$(printf '%s' "$route" | tr '/?=&' '____').management.headers"
  management_body="$RUNNER_TEMP/$(printf '%s' "$route" | tr '/?=&' '____').management.json"
  curl --fail --silent --show-error -D "$management_headers" -o "$management_body" \\
    -H "Cookie: token=$token" "http://127.0.0.1:3002$route"
  grep -qi '^X-All-Mail-Route-Owner: go-business-api' "$management_headers"
  python3 - "$management_body" <<'PY'
import json, sys
with open(sys.argv[1], encoding='utf-8') as handle:
    payload = json.load(handle)
assert payload['success'] is True
PY
done

write_headers="$RUNNER_TEMP/dashboard-write-headers.txt"
''',
)

insert_after(
    "CHANGELOG.md",
    "## [Unreleased]\n\n",
    "- moved administrator, email-group, domain-mailbox, and mailbox-user management to the private Go business service with bcrypt-compatible passwords and PostgreSQL transactions\n",
)

insert_after(
    "docs/GO-MIGRATION.md",
    "- signed ingress authentication, encrypted endpoint-secret reads, Redis replay protection, mailbox resolution, inbound persistence, and forwarding-job creation;\n",
    "- administrator, email-group, domain-mailbox, and mailbox-user management, including batch mailbox transactions and membership synchronization;\n",
)
insert_after(
    "docs/GO-MIGRATION.md",
    "POST /ingress/domain-mail/receive              -> go-business-api\n",
    "\n/admin/admins/**                                -> go-business-api\n"
    "/admin/email-groups/**                         -> go-business-api\n"
    "/admin/domain-mailboxes/**                     -> go-business-api\n"
    "/admin/mailbox-users/**                        -> go-business-api\n",
)

insert_after(
    "docs/internal/runtime-migration-roadmap.md",
    "### Signed ingress and raw-message lifecycle\n",
    "\n### Database administration surfaces\n\n"
    "Administrator, email-group, domain-mailbox, and mailbox-user management are owned by `go-business-api`. Password mutations emit bcrypt cost-10 hashes compatible with existing sessions. Mailbox creation, membership replacement, batch creation/deletion, API-key domain-scope updates, catch-all cleanup, and user deletion use PostgreSQL transactions.\n\n",
)
