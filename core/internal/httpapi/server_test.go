package httpapi

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/config"
	"github.com/feng123-new/all-Mail/core/internal/readiness"
)

func TestHealthAndLegacyProxy(t *testing.T) {
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

	staticDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(staticDir, "index.html"), []byte("<html>ok</html>"), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg := config.APIConfig{
		Mode:            config.APIModeBridge,
		StaticDir:       staticDir,
		LegacyAPIURL:    legacy.URL,
		ReadyTimeout:    time.Second,
		ShutdownTimeout: time.Second,
	}
	server, err := New(cfg, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodGet, "/health", nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("health code = %d", response.Code)
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

func TestReadinessRejectsMissingBridgeDependencies(t *testing.T) {
	cfg := config.APIConfig{
		Mode:         config.APIModeBridge,
		StaticDir:    t.TempDir(),
		ReadyTimeout: time.Second,
	}
	server, err := newWithProber(cfg, discardLogger(), readiness.Prober{
		Postgres: func(context.Context, string) error { return nil },
		Redis:    func(context.Context, string) error { return nil },
		Legacy:   func(context.Context, string) error { return nil },
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
	if !strings.Contains(response.Body.String(), "required-but-not-configured") {
		t.Fatalf("readiness body = %s", response.Body.String())
	}
}

func TestReadinessUsesInjectedProtocolProbes(t *testing.T) {
	cfg := config.APIConfig{
		Mode:            config.APIModeBridge,
		StaticDir:       t.TempDir(),
		DatabaseURL:     "postgresql://user:pass@postgres/database",
		RedisURL:        "redis://redis:6379/0",
		LegacyAPIURL:    "http://legacy-api:3100",
		ReadyTimeout:    time.Second,
		ShutdownTimeout: time.Second,
	}
	server, err := newWithProber(cfg, discardLogger(), readiness.Prober{
		Postgres: func(context.Context, string) error { return nil },
		Redis:    func(context.Context, string) error { return nil },
		Legacy:   func(context.Context, string) error { return nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("readiness response = %d %s", response.Code, response.Body.String())
	}
}

func TestMissingLegacyReturnsExplicitError(t *testing.T) {
	cfg := config.APIConfig{
		Mode:            config.APIModeStatic,
		StaticDir:       t.TempDir(),
		ReadyTimeout:    time.Second,
		ShutdownTimeout: time.Second,
	}
	server, err := New(cfg, discardLogger())
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/admin/emails", nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("code = %d, want %d", response.Code, http.StatusServiceUnavailable)
	}
}

func TestInvalidIncomingRequestIDIsReplaced(t *testing.T) {
	staticDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(staticDir, "index.html"), []byte("ok"), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg := config.APIConfig{Mode: config.APIModeStatic, StaticDir: staticDir, ReadyTimeout: time.Second}
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

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}
