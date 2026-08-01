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

func TestHealthAndGoBusinessProxyUseCanonicalRouteOwnership(t *testing.T) {
	fastify := testReadyUpstream(t, `{"business":true}`)
	goBusiness := testReadyUpstream(t, `{"goBusiness":true}`)

	server := mustGateway(t, config.APIConfig{
		StaticDir:       writeStaticIndex(t),
		BusinessAPIURL:  fastify.URL,
		ReadyTimeout:    time.Second,
		ShutdownTimeout: time.Second,
	}, goBusiness.URL)

	request := httptest.NewRequest(http.MethodGet, "/health", nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"goBusinessApiConfigured":true`) {
		t.Fatalf("health response = %d %s", response.Code, response.Body.String())
	}
	assertRouteHeaders(t, response, "go", "system-health")

	request = httptest.NewRequest(http.MethodGet, "/admin/test", nil)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "goBusiness") {
		t.Fatalf("Go business catch-all response = %d %s", response.Code, response.Body.String())
	}
	assertRouteHeaders(t, response, "go-business-api", "admin-other")

	request = httptest.NewRequest(http.MethodGet, "/admin/dashboard/stats", nil)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "goBusiness") {
		t.Fatalf("Go business proxy response = %d %s", response.Code, response.Body.String())
	}
	assertRouteHeaders(t, response, "go-business-api", "admin-dashboard-stats-read")

	request = httptest.NewRequest(http.MethodDelete, "/admin/dashboard/logs/42", nil)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "goBusiness") {
		t.Fatalf("Dashboard write proxy response = %d %s", response.Code, response.Body.String())
	}
	assertRouteHeaders(t, response, "go-business-api", "admin-dashboard-log-delete")

	request = httptest.NewRequest(http.MethodGet, "/metrics", nil)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	metrics := response.Body.String()
	for _, expected := range []string{
		`allmail_route_owner_info{family="admin-dashboard-stats-read",owner="go-business-api"`,
		`allmail_route_requests_total{family="admin-other",owner="go-business-api",method="GET",status_class="2xx"} 1`,
		`allmail_route_requests_total{family="admin-dashboard-stats-read",owner="go-business-api",method="GET",status_class="2xx"} 1`,
		`allmail_route_requests_total{family="admin-dashboard-log-delete",owner="go-business-api",method="DELETE",status_class="2xx"} 1`,
	} {
		if !strings.Contains(metrics, expected) {
			t.Fatalf("metrics are missing %q:\n%s", expected, metrics)
		}
	}
}

func TestRouteManifestKeepsMethodAndNamespaceBoundaries(t *testing.T) {
	server := mustGateway(t, config.APIConfig{
		StaticDir:       writeStaticIndex(t),
		ReadyTimeout:    time.Second,
		ShutdownTimeout: time.Second,
	}, "")

	goRead := httptest.NewRecorder()
	server.Handler().ServeHTTP(goRead, httptest.NewRequest(http.MethodGet, "/admin/dashboard/logs", nil))
	if goRead.Code != http.StatusServiceUnavailable || !strings.Contains(goRead.Body.String(), "GO_BUSINESS_API_NOT_CONFIGURED") {
		t.Fatalf("Go business route response = %d %s", goRead.Code, goRead.Body.String())
	}
	assertRouteHeaders(t, goRead, "go-business-api", "admin-dashboard-logs-read")

	goWrite := httptest.NewRecorder()
	server.Handler().ServeHTTP(goWrite, httptest.NewRequest(http.MethodPost, "/admin/dashboard/logs/batch-delete", nil))
	if goWrite.Code != http.StatusServiceUnavailable || !strings.Contains(goWrite.Body.String(), "GO_BUSINESS_API_NOT_CONFIGURED") {
		t.Fatalf("Go write response = %d %s", goWrite.Code, goWrite.Body.String())
	}
	assertRouteHeaders(t, goWrite, "go-business-api", "admin-dashboard-log-batch-delete")

	backend := httptest.NewRecorder()
	server.Handler().ServeHTTP(backend, httptest.NewRequest(http.MethodGet, "/api/unknown", nil))
	if backend.Code != http.StatusServiceUnavailable || !strings.Contains(backend.Body.String(), "GO_BUSINESS_API_NOT_CONFIGURED") {
		t.Fatalf("Go business namespace response = %d %s", backend.Code, backend.Body.String())
	}
	assertRouteHeaders(t, backend, "go-business-api", "external-api")

	spa := httptest.NewRecorder()
	server.Handler().ServeHTTP(spa, httptest.NewRequest(http.MethodGet, "/administrator", nil))
	if spa.Code != http.StatusOK || !strings.Contains(spa.Body.String(), "<html>ok</html>") {
		t.Fatalf("SPA response = %d %s", spa.Code, spa.Body.String())
	}
	assertRouteHeaders(t, spa, "go", "spa")
}

func TestReadinessRequiresStaticAssetsAndBothBusinessAPIs(t *testing.T) {
	cfg := config.APIConfig{StaticDir: t.TempDir(), ReadyTimeout: time.Second}
	server, err := newWithProber(cfg, "", discardLogger(), readiness.Prober{
		BusinessAPI:   func(context.Context, string) error { return nil },
		GoBusinessAPI: func(context.Context, string) error { return nil },
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
	for _, expected := range []string{"required-but-not-configured", "index.html unavailable", `"routeOwnership":"ok"`} {
		if !strings.Contains(response.Body.String(), expected) {
			t.Fatalf("readiness body is missing %q: %s", expected, response.Body.String())
		}
	}
}

func TestReadinessUsesBothPrivateProbes(t *testing.T) {
	cfg := config.APIConfig{
		StaticDir:       writeStaticIndex(t),
		BusinessAPIURL:  "http://business-api:3100",
		ReadyTimeout:    time.Second,
		ShutdownTimeout: time.Second,
	}
	fastifyCalls := 0
	goCalls := 0
	server, err := newWithProber(cfg, "http://go-business-api:3200", discardLogger(), readiness.Prober{
		BusinessAPI:   func(context.Context, string) error { fastifyCalls++; return nil },
		GoBusinessAPI: func(context.Context, string) error { goCalls++; return nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || fastifyCalls != 1 || goCalls != 1 {
		t.Fatalf("readiness response = %d %s, Fastify=%d Go=%d", response.Code, response.Body.String(), fastifyCalls, goCalls)
	}
}

func TestInvalidIncomingRequestIDIsReplaced(t *testing.T) {
	server := mustGateway(t, config.APIConfig{
		StaticDir:       writeStaticIndex(t),
		ReadyTimeout:    time.Second,
		ShutdownTimeout: time.Second,
	}, "")
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
	fastify := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured <- r.Header.Clone()
		w.Header().Set(routeOwnerHeader, "forged-upstream-owner")
		w.Header().Set(routeFamilyHeader, "forged-upstream-family")
		w.WriteHeader(http.StatusNoContent)
	}))
	defer fastify.Close()

	server := mustGateway(t, config.APIConfig{
		StaticDir:       writeStaticIndex(t),
		ReadyTimeout:    time.Second,
		ShutdownTimeout: time.Second,
	}, fastify.URL)
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
	assertRouteHeaders(t, response, "go-business-api", "admin-other")
}

func TestProxyAcceptsCanonicalClientIPOnlyFromTrustedPeer(t *testing.T) {
	type capturedRequest struct {
		header http.Header
		host   string
	}
	captured := make(chan capturedRequest, 1)
	fastify := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured <- capturedRequest{header: r.Header.Clone(), host: r.Host}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer fastify.Close()

	server := mustGateway(t, config.APIConfig{
		StaticDir:         writeStaticIndex(t),
		TrustedProxyCIDRs: []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")},
		ReadyTimeout:      time.Second,
		ShutdownTimeout:   time.Second,
	}, fastify.URL)
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

func testReadyUpstream(t *testing.T, body string) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/readyz" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"success":true,"data":{"status":"ready"}}`)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set(routeOwnerHeader, "forged-upstream-owner")
		w.Header().Set(routeFamilyHeader, "forged-upstream-family")
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(server.Close)
	return server
}

func mustGateway(t *testing.T, cfg config.APIConfig, goBusinessAPIURL string) *Server {
	t.Helper()
	server, err := newWithProber(cfg, goBusinessAPIURL, discardLogger(), readiness.Prober{
		BusinessAPI:   func(context.Context, string) error { return nil },
		GoBusinessAPI: func(context.Context, string) error { return nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	return server
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
