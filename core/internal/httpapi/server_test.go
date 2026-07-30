package httpapi

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/config"
	"github.com/feng123-new/all-Mail/core/internal/readiness"
)

func TestHealthAndBusinessProxyUseCanonicalRouteOwnership(t *testing.T) {
	business := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/readyz" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"success":true,"data":{"status":"ready"}}`)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set(routeOwnerHeader, "forged-upstream-owner")
		w.Header().Set(routeFamilyHeader, "forged-upstream-family")
		_, _ = io.WriteString(w, `{"business":true}`)
	}))
	defer business.Close()

	staticDir := writeStaticIndex(t)
	cfg := config.APIConfig{
		StaticDir:       staticDir,
		BusinessAPIURL:  business.URL,
		ReadyTimeout:    time.Second,
		ShutdownTimeout: time.Second,
	}
	server, err := New(cfg, discardLogger())
	if err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodGet, "/health", nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "routeManifestSHA256") {
		t.Fatalf("health response = %d %s", response.Code, response.Body.String())
	}
	assertRouteHeaders(t, response, "go", "system-health")

	request = httptest.NewRequest(http.MethodGet, "/admin/test", nil)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "business") {
		t.Fatalf("proxy response = %d %s", response.Code, response.Body.String())
	}
	assertRouteHeaders(t, response, "business-api", "admin-other")
	if response.Header().Get("X-All-Mail-Migration-Bridge") != "" {
		t.Fatal("retired migration bridge header remains exposed")
	}

	request = httptest.NewRequest(http.MethodGet, "/admin/dashboard/stats", nil)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	assertRouteHeaders(t, response, "business-api", "admin-dashboard")

	request = httptest.NewRequest(http.MethodGet, "/metrics", nil)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	metrics := response.Body.String()
	for _, expected := range []string{
		`allmail_route_owner_info{family="admin-dashboard",owner="business-api"`,
		`allmail_route_requests_total{family="admin-other",owner="business-api",method="GET",status_class="2xx"} 1`,
		`allmail_route_requests_total{family="system-health",owner="go",method="GET",status_class="2xx"} 1`,
	} {
		if !strings.Contains(metrics, expected) {
			t.Fatalf("metrics are missing %q:\n%s", expected, metrics)
		}
	}
}

func TestRouteManifestKeepsNamespaceBoundariesOutOfTheSPA(t *testing.T) {
	server, err := New(config.APIConfig{
		StaticDir:       writeStaticIndex(t),
		ReadyTimeout:    time.Second,
		ShutdownTimeout: time.Second,
	}, discardLogger())
	if err != nil {
		t.Fatal(err)
	}

	backend := httptest.NewRecorder()
	server.Handler().ServeHTTP(backend, httptest.NewRequest(http.MethodGet, "/api/unknown", nil))
	if backend.Code != http.StatusServiceUnavailable || !strings.Contains(backend.Body.String(), "BUSINESS_API_NOT_CONFIGURED") {
		t.Fatalf("backend namespace response = %d %s", backend.Code, backend.Body.String())
	}
	assertRouteHeaders(t, backend, "business-api", "external-api")

	spa := httptest.NewRecorder()
	server.Handler().ServeHTTP(spa, httptest.NewRequest(http.MethodGet, "/administrator", nil))
	if spa.Code != http.StatusOK || !strings.Contains(spa.Body.String(), "<html>ok</html>") {
		t.Fatalf("SPA response = %d %s", spa.Code, spa.Body.String())
	}
	assertRouteHeaders(t, spa, "go", "spa")
}

func TestReadinessRequiresStaticAssetsAndBusinessAPI(t *testing.T) {
	cfg := config.APIConfig{StaticDir: t.TempDir(), ReadyTimeout: time.Second}
	server, err := newWithProber(cfg, discardLogger(), readiness.Prober{
		BusinessAPI: func(context.Context, string) error { return nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("readiness code = %d, want %d", response.Code, http.StatusServiceUnavailable)
	}
	if !strings.Contains(response.Body.String(), "required-but-not-configured") || !strings.Contains(response.Body.String(), "index.html unavailable") {
		t.Fatalf("readiness body = %s", response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"routeOwnership":"ok"`) {
		t.Fatalf("readiness omits manifest status: %s", response.Body.String())
	}
}

func TestReadinessUsesBusinessProbe(t *testing.T) {
	cfg := config.APIConfig{
		StaticDir:       writeStaticIndex(t),
		BusinessAPIURL:  "http://business-api:3100",
		ReadyTimeout:    time.Second,
		ShutdownTimeout: time.Second,
	}
	called := 0
	server, err := newWithProber(cfg, discardLogger(), readiness.Prober{
		BusinessAPI: func(context.Context, string) error { called++; return nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || called != 1 {
		t.Fatalf("readiness response = %d %s, calls=%d", response.Code, response.Body.String(), called)
	}
}

func TestInvalidIncomingRequestIDIsReplaced(t *testing.T) {
	cfg := config.APIConfig{StaticDir: writeStaticIndex(t), ReadyTimeout: time.Second}
	server, err := New(cfg, discardLogger())
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.Header.Set("X-Request-Id", "bad\nrequest")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if got := response.Header().Get("X-Request-Id"); got == "" || got == "bad\nrequest" {
		t.Fatalf("request id = %q", got)
	}
}

func TestProxyRejectsSpoofedForwardingAndOwnershipHeadersFromUntrustedPeer(t *testing.T) {
	captured := make(chan http.Header, 1)
	business := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured <- r.Header.Clone()
		w.WriteHeader(http.StatusNoContent)
	}))
	defer business.Close()

	server, err := New(config.APIConfig{
		StaticDir:       writeStaticIndex(t),
		BusinessAPIURL:  business.URL,
		ReadyTimeout:    time.Second,
		ShutdownTimeout: time.Second,
	}, discardLogger())
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "http://mail.example/admin/test", nil)
	request.RemoteAddr = "192.0.2.44:43123"
	request.Header.Set("X-Forwarded-For", "203.0.113.9")
	request.Header.Set("X-Real-IP", "203.0.113.10")
	request.Header.Set("CF-Connecting-IP", "203.0.113.11")
	request.Header.Set("X-Forwarded-Proto", "https")
	request.Header.Set(routeOwnerHeader, "go")
	request.Header.Set(routeFamilyHeader, "system-health")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("proxy response = %d %s", response.Code, response.Body.String())
	}
	header := <-captured
	if got := header.Get("X-Forwarded-For"); got != "192.0.2.44" {
		t.Fatalf("X-Forwarded-For = %q", got)
	}
	if got := header.Get("X-Real-IP"); got != "192.0.2.44" {
		t.Fatalf("X-Real-IP = %q", got)
	}
	if got := header.Get("X-Forwarded-Proto"); got != "http" {
		t.Fatalf("X-Forwarded-Proto = %q", got)
	}
	if got := header.Get("CF-Connecting-IP"); got != "" {
		t.Fatalf("CF-Connecting-IP leaked downstream: %q", got)
	}
	if got := header.Get(routeOwnerHeader); got != "" {
		t.Fatalf("route owner header leaked downstream: %q", got)
	}
	if got := header.Get(routeFamilyHeader); got != "" {
		t.Fatalf("route family header leaked downstream: %q", got)
	}
	assertRouteHeaders(t, response, "business-api", "admin-other")
}

func TestProxyAcceptsCanonicalClientIPOnlyFromTrustedPeer(t *testing.T) {
	type capturedRequest struct {
		header http.Header
		host   string
	}
	captured := make(chan capturedRequest, 1)
	business := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured <- capturedRequest{header: r.Header.Clone(), host: r.Host}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer business.Close()

	server, err := New(config.APIConfig{
		StaticDir:         writeStaticIndex(t),
		BusinessAPIURL:    business.URL,
		TrustedProxyCIDRs: []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")},
		ReadyTimeout:      time.Second,
		ShutdownTimeout:   time.Second,
	}, discardLogger())
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "http://mail.example/admin/test", nil)
	request.RemoteAddr = "10.10.0.5:43123"
	request.Header.Set("CF-Connecting-IP", "198.51.100.22")
	request.Header.Set("X-Forwarded-For", "203.0.113.9, 10.10.0.5")
	request.Header.Set("X-Forwarded-Proto", "https")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("proxy response = %d %s", response.Code, response.Body.String())
	}
	got := <-captured
	if got.header.Get("X-Forwarded-For") != "198.51.100.22" || got.header.Get("X-Real-IP") != "198.51.100.22" {
		t.Fatalf("canonical client headers = %#v", got.header)
	}
	if got.header.Get("X-Forwarded-Proto") != "https" || got.header.Get("X-Forwarded-Host") != "mail.example" {
		t.Fatalf("forwarded origin headers = %#v", got.header)
	}
	if got.host != "mail.example" {
		t.Fatalf("proxied Host = %q", got.host)
	}
}

func assertRouteHeaders(t *testing.T, response *httptest.ResponseRecorder, owner, family string) {
	t.Helper()
	ownerValues := response.Result().Header.Values(routeOwnerHeader)
	if len(ownerValues) != 1 || ownerValues[0] != owner {
		t.Fatalf("route owner headers = %#v, want [%q]", ownerValues, owner)
	}
	familyValues := response.Result().Header.Values(routeFamilyHeader)
	if len(familyValues) != 1 || familyValues[0] != family {
		t.Fatalf("route family headers = %#v, want [%q]", familyValues, family)
	}
}

func writeStaticIndex(t *testing.T) string {
	t.Helper()
	staticDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(staticDir, "index.html"), []byte("<html>ok</html>"), 0o600); err != nil {
		t.Fatal(err)
	}
	return staticDir
}

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}
