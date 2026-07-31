#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def patch(path: str, replacements: list[tuple[str, str]]) -> None:
    target = ROOT / path
    content = target.read_text(encoding="utf-8")
    original = content
    for old, new in replacements:
        if new in content:
            continue
        if old not in content:
            raise SystemExit(f"missing expected fragment in {path}: {old[:120]!r}")
        content = content.replace(old, new, 1)
    if content != original:
        target.write_text(content, encoding="utf-8")


patch("scripts/bootstrap-admin-docker-smoke.sh", [
    ("grep -qi '^X-All-Mail-Route-Owner: business-api' \"$write_headers\"",
     "grep -qi '^X-All-Mail-Route-Owner: go-business-api' \"$write_headers\""),
])

patch("core/internal/httpapi/server_test.go", [
    ('if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "business") {\n\t\tt.Fatalf("Dashboard write proxy response = %d %s", response.Code, response.Body.String())\n\t}\n\tassertRouteHeaders(t, response, "business-api", "admin-dashboard-log-delete")',
     'if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "goBusiness") {\n\t\tt.Fatalf("Dashboard write proxy response = %d %s", response.Code, response.Body.String())\n\t}\n\tassertRouteHeaders(t, response, "go-business-api", "admin-dashboard-log-delete")'),
    ('`allmail_route_requests_total{family="admin-dashboard-log-delete",owner="business-api",method="DELETE",status_class="2xx"} 1`,',
     '`allmail_route_requests_total{family="admin-dashboard-log-delete",owner="go-business-api",method="DELETE",status_class="2xx"} 1`,'),
    ('fastifyWrite := httptest.NewRecorder()\n\tserver.Handler().ServeHTTP(fastifyWrite, httptest.NewRequest(http.MethodPost, "/admin/dashboard/logs/batch-delete", nil))\n\tif fastifyWrite.Code != http.StatusServiceUnavailable || !strings.Contains(fastifyWrite.Body.String(), "BUSINESS_API_NOT_CONFIGURED") {\n\t\tt.Fatalf("Fastify write response = %d %s", fastifyWrite.Code, fastifyWrite.Body.String())\n\t}\n\tassertRouteHeaders(t, fastifyWrite, "business-api", "admin-dashboard-log-batch-delete")',
     'goWrite := httptest.NewRecorder()\n\tserver.Handler().ServeHTTP(goWrite, httptest.NewRequest(http.MethodPost, "/admin/dashboard/logs/batch-delete", nil))\n\tif goWrite.Code != http.StatusServiceUnavailable || !strings.Contains(goWrite.Body.String(), "GO_BUSINESS_API_NOT_CONFIGURED") {\n\t\tt.Fatalf("Go business write response = %d %s", goWrite.Code, goWrite.Body.String())\n\t}\n\tassertRouteHeaders(t, goWrite, "go-business-api", "admin-dashboard-log-batch-delete")'),
])

ci = ROOT / ".github/workflows/ci.yml"
ci_content = ci.read_text(encoding="utf-8")
ci_updated = ci_content.replace(
    "grep -qi '^X-All-Mail-Route-Owner: business-api' \"$write_headers\"",
    "grep -qi '^X-All-Mail-Route-Owner: go-business-api' \"$write_headers\"",
)
if ci_updated != ci_content:
    ci.write_text(ci_updated, encoding="utf-8")

changelog = ROOT / "CHANGELOG.md"
content = changelog.read_text(encoding="utf-8")
entry = "- moved Dashboard single and batch operation-log deletion to the private Go business service with bounded validation and transactionally coupled administrator audit records\n"
marker = "## [Unreleased]\n\n"
if entry not in content:
    if marker not in content:
        raise SystemExit("CHANGELOG Unreleased marker missing")
    changelog.write_text(content.replace(marker, marker + entry, 1), encoding="utf-8")
