package httpapi

import (
	"bytes"
	"strings"
	"testing"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/routeownership"
)

func TestRouteMetricsExposeBoundedOwnershipTelemetry(t *testing.T) {
	manifest, err := routeownership.Parse([]byte(`{
		"version":3,
		"description":"test",
		"routes":[
			{"id":"admin-dashboard-read","owner":"go-business-api","match":"prefix","path":"/admin/dashboard","methods":["GET"],"migrationStage":"complete"},
			{"id":"spa","owner":"go","match":"fallback","path":"/","migrationStage":"complete"}
		]
	}`))
	if err != nil {
		t.Fatal(err)
	}
	metrics := newRouteMetrics(manifest)
	admin := manifest.Match("GET", "/admin/dashboard/stats")
	spa := manifest.Match("GET", "/settings")

	metrics.begin(admin)
	metrics.observe(admin, "get", 204, 12*time.Millisecond)
	metrics.begin(admin)
	metrics.observe(admin, "METHOD-WITH-UNBOUNDED-CARDINALITY", 200, time.Millisecond)
	metrics.begin(spa)
	metrics.observe(spa, "GET", 404, 2*time.Second)
	metrics.proxyError(admin)

	var output bytes.Buffer
	metrics.writePrometheus(&output)
	text := output.String()
	for _, expected := range []string{
		`allmail_route_manifest_info{version="3",sha256="`,
		`allmail_route_owner_info{family="admin-dashboard-read",owner="go-business-api",match="prefix",path="/admin/dashboard",methods="GET",migration_stage="complete"} 1`,
		`allmail_route_requests_total{family="admin-dashboard-read",owner="go-business-api",method="GET",status_class="2xx"} 1`,
		`allmail_route_requests_total{family="admin-dashboard-read",owner="go-business-api",method="OTHER",status_class="2xx"} 1`,
		`allmail_route_requests_total{family="spa",owner="go",method="GET",status_class="4xx"} 1`,
		`allmail_route_request_duration_seconds_count{family="admin-dashboard-read",owner="go-business-api"} 2`,
		`allmail_business_proxy_errors_total{family="admin-dashboard-read",upstream="go-business-api"} 1`,
	} {
		if !strings.Contains(text, expected) {
			t.Fatalf("metrics output is missing %q:\n%s", expected, text)
		}
	}
	if strings.Contains(text, "METHOD-WITH-UNBOUNDED-CARDINALITY") {
		t.Fatalf("unbounded method leaked into metric labels:\n%s", text)
	}
}

func TestStatusAndMethodClassesBoundCardinality(t *testing.T) {
	statusCases := map[int]string{
		0:   "other",
		99:  "other",
		100: "1xx",
		204: "2xx",
		302: "3xx",
		404: "4xx",
		503: "5xx",
		600: "other",
	}
	for status, expected := range statusCases {
		if got := statusClass(status); got != expected {
			t.Fatalf("statusClass(%d) = %q, want %q", status, got, expected)
		}
	}

	methodCases := map[string]string{
		"get":      "GET",
		" PATCH ":  "PATCH",
		"CONNECT":  "OTHER",
		"CUSTOM-1": "OTHER",
		"":         "OTHER",
	}
	for method, expected := range methodCases {
		if got := normalizeMetricMethod(method); got != expected {
			t.Fatalf("normalizeMetricMethod(%q) = %q, want %q", method, got, expected)
		}
	}
}
