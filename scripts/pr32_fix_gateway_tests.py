#!/usr/bin/env python3
from pathlib import Path

path = Path("core/internal/httpapi/server_test.go")
content = path.read_text(encoding="utf-8")

replacements = [
    (
        '''\tif response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "business") {\n\t\tt.Fatalf("Dashboard write proxy response = %d %s", response.Code, response.Body.String())\n\t}\n\tassertRouteHeaders(t, response, "business-api", "admin-dashboard-log-delete")''',
        '''\tif response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "goBusiness") {\n\t\tt.Fatalf("Dashboard write proxy response = %d %s", response.Code, response.Body.String())\n\t}\n\tassertRouteHeaders(t, response, "go-business-api", "admin-dashboard-log-delete")''',
    ),
    (
        '''\t\t`allmail_route_requests_total{family="admin-dashboard-log-delete",owner="business-api",method="DELETE",status_class="2xx"} 1`,''',
        '''\t\t`allmail_route_requests_total{family="admin-dashboard-log-delete",owner="go-business-api",method="DELETE",status_class="2xx"} 1`,''',
    ),
    (
        '''\tfastifyWrite := httptest.NewRecorder()\n\tserver.Handler().ServeHTTP(fastifyWrite, httptest.NewRequest(http.MethodPost, "/admin/dashboard/logs/batch-delete", nil))\n\tif fastifyWrite.Code != http.StatusServiceUnavailable || !strings.Contains(fastifyWrite.Body.String(), "BUSINESS_API_NOT_CONFIGURED") {\n\t\tt.Fatalf("Fastify write response = %d %s", fastifyWrite.Code, fastifyWrite.Body.String())\n\t}\n\tassertRouteHeaders(t, fastifyWrite, "business-api", "admin-dashboard-log-batch-delete")''',
        '''\tgoWrite := httptest.NewRecorder()\n\tserver.Handler().ServeHTTP(goWrite, httptest.NewRequest(http.MethodPost, "/admin/dashboard/logs/batch-delete", nil))\n\tif goWrite.Code != http.StatusServiceUnavailable || !strings.Contains(goWrite.Body.String(), "GO_BUSINESS_API_NOT_CONFIGURED") {\n\t\tt.Fatalf("Go write response = %d %s", goWrite.Code, goWrite.Body.String())\n\t}\n\tassertRouteHeaders(t, goWrite, "go-business-api", "admin-dashboard-log-batch-delete")''',
    ),
]

for old, new in replacements:
    count = content.count(old)
    if count != 1:
        raise SystemExit(f"expected exactly one source block, found {count}: {old[:120]!r}")
    content = content.replace(old, new, 1)

path.write_text(content, encoding="utf-8")
