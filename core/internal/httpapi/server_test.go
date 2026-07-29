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

func TestHealthAndCompatibilityProxy(t *testing.T) {
	legacy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/readyz" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"success":true,"data":{"status":"ready"}}`)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"legacy":true}`)
	}))
	defer legacy.Close()

	staticDir := writeStaticIndex(t)
	cfg := config.APIConfig{
		StaticDir:       staticDir,
		LegacyAPIURL:    legacy.URL,
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
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "go-gateway") {
		t.Fatalf("health response = %d %s", response.Code, response.Body.String())
	}

	request = httptest.NewRequest(http.MethodGet, "/admin/test", nil)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "legacy") {
		t.Fatalf("proxy response = %d %s", response.Code, response.Body.String())
	}
	if response.Header().Get("X-All-Mail-Migration-Bridge") != "go" {
		t.Fatal("proxy response is missing migration bridge marker")
	}
}

func TestReadinessRequiresStaticAssetsAndCompatibilityAPI(t *testing.T) {
	cfg := config.APIConfig{StaticDir: t.TempDir(), ReadyTimeout: time.Second}
	server, err := newWithProber(cfg, discardLogger(), readiness.Prober{
		Legacy: func(context.Context, string) error { return nil },
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
}

func TestReadinessUsesCompatibilityProbe(t *testing.T) {
	cfg := config.APIConfig{
		StaticDir:       writeStaticIndex(t),
		LegacyAPIURL:    "http://legacy-api:3100",
		ReadyTimeout:    time.Second,
		ShutdownTimeout: time.Second,
	}
	called := 0
	server, err := newWithProber(cfg, discardLogger(), readiness.Prober{
		Legacy: func(context.Context, string) error { called++; return nil },
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

func TestMissingCompatibilityAPIReturnsExplicitError(t *testing.T) {
	cfg := config.APIConfig{StaticDir: writeStaticIndex(t), ReadyTimeout: time.Second}
	server, err := New(cfg, discardLogger())
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/admin/emails", nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "COMPATIBILITY_API_NOT_CONFIGURED") {
		t.Fatalf("response = %d %s", response.Code, response.Body.String())
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

func TestProxyRejectsSpoofedForwardingHeadersFromUntrustedPeer(t *testing.T) {
	captured := make(chan http.Header, 1)
	legacy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured <- r.Header.Clone()
		w.WriteHeader(http.StatusNoContent)
	}))
	defer legacy.Close()

	server, err := New(config.APIConfig{
		StaticDir:       writeStaticIndex(t),
		LegacyAPIURL:    legacy.URL,
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
}

func TestProxyAcceptsCanonicalClientIPOnlyFromTrustedPeer(t *testing.T) {
	type capturedRequest struct {
		header http.Header
		host   string
	}
	captured := make(chan capturedRequest, 1)
	legacy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured <- capturedRequest{header: r.Header.Clone(), host: r.Host}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer legacy.Close()

	server, err := New(config.APIConfig{
		StaticDir:         writeStaticIndex(t),
		LegacyAPIURL:      legacy.URL,
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
