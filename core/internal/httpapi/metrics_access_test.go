package httpapi

import (
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/config"
)

func TestMetricsAllowlistUsesDirectPeerAndIgnoresForwardedHeaders(t *testing.T) {
	server := mustGateway(t, config.APIConfig{
		StaticDir:           writeStaticIndex(t),
		MetricsAllowedCIDRs: []netip.Prefix{netip.MustParsePrefix("10.40.0.0/16")},
		ReadyTimeout:        time.Second,
		ShutdownTimeout:     time.Second,
	}, "")

	denied := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	denied.RemoteAddr = "192.0.2.44:43123"
	denied.Header.Set("X-Forwarded-For", "10.40.1.8")
	denied.Header.Set("X-Real-IP", "10.40.1.9")
	denied.Header.Set("CF-Connecting-IP", "10.40.1.10")
	deniedResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(deniedResponse, denied)
	if deniedResponse.Code != http.StatusNotFound {
		t.Fatalf("denied metrics response = %d %s", deniedResponse.Code, deniedResponse.Body.String())
	}
	if deniedResponse.Header().Get(routeOwnerHeader) != "" || deniedResponse.Header().Get(routeFamilyHeader) != "" {
		t.Fatalf("denied metrics leaked route metadata: %v", deniedResponse.Header())
	}

	allowed := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	allowed.RemoteAddr = "10.40.1.8:43123"
	allowedResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(allowedResponse, allowed)
	if allowedResponse.Code != http.StatusOK || !strings.Contains(allowedResponse.Body.String(), "allmail_go_uptime_seconds") {
		t.Fatalf("allowed metrics response = %d %s", allowedResponse.Code, allowedResponse.Body.String())
	}
	assertRouteHeaders(t, allowedResponse, "go", "system-metrics")
}

func TestMetricsAllowlistRejectsMalformedRemoteAddress(t *testing.T) {
	server := mustGateway(t, config.APIConfig{
		StaticDir:           writeStaticIndex(t),
		MetricsAllowedCIDRs: []netip.Prefix{netip.MustParsePrefix("127.0.0.1/32")},
		ReadyTimeout:        time.Second,
		ShutdownTimeout:     time.Second,
	}, "")
	request := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	request.RemoteAddr = "not-an-address"
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusNotFound {
		t.Fatalf("malformed peer metrics response = %d %s", response.Code, response.Body.String())
	}
}
