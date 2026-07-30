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
		"version":1,
		"description":"test",
		"routes":[
			{"id":"admin-dashboard","owner":"business-api","match":"prefix","path":"/admin/dashboard","migrationStage":"observing","targetOwner":"go"},
			{"id":"spa","owner":"go","match":"fallback","path":"/","migrationStage":"complete"}
		]
	}`))
	if err != nil {
		t.Fatal(err)
	}
	metrics := newRouteMetrics(manifest)
	admin := manifest.Match("/admin/dashboard/stats")
	spa := manifest.Match("/settings")

	metrics.begin(admin)
	metrics.observe(admin, "get", 204, 12*time.Millisecond)
	metrics.begin(spa)
	metrics.observe(spa, "GET", 404, 2*time.Second)
	metrics.proxyError(admin)

	var output bytes.Buffer
	metrics.writePrometheus(&output)
	text := output.String()
	for _, expected := range []string{
		`allmail_route_manifest_info{version="1",sha256="`,
		`allmail_route_owner_info{family="admin-dashboard",owner="business-api",match="prefix",path="/admin/dashboard",migration_stage="observing",target_owner="go"} 1`,
		`allmail_route_requests_total{family="admin-dashboard",owner="business-api",method="GET",status_class="2xx"} 1`,
		`allmail_route_requests_total{family="spa",owner="go",method="GET",status_class="4xx"} 1`,
		`allmail_route_request_duration_seconds_count{family="admin-dashboard",owner="business-api"} 1`,
		`allmail_business_proxy_errors_total{family="admin-dashboard"} 1`,
	} {
		if !strings.Contains(text, expected) {
			t.Fatalf("metrics output is missing %q:\n%s", expected, text)
		}
	}
	if strings.Count(text, `family="admin-dashboard",owner="business-api",method="GET",status_class="2xx"`) != 1 {
		t.Fatalf("request metric has unstable duplicate labels:\n%s", text)
	}
}

func TestStatusClassBoundsCardinality(t *testing.T) {
	cases := map[int]string{
		0:   "other",
		99:  "other",
		100: "1xx",
		204: "2xx",
		302: "3xx",
		404: "4xx",
		503: "5xx",
		600: "other",
	}
	for status, expected := range cases {
		if got := statusClass(status); got != expected {
			t.Fatalf("statusClass(%d) = %q, want %q", status, got, expected)
		}
	}
}
