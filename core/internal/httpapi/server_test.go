package httpapi

import (
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
)

func TestHealthAndLegacyProxy(t *testing.T) {
	legacy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.WriteHeader(http.StatusOK)
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
	cfg := config.Config{
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
}

func TestMissingLegacyReturnsExplicitError(t *testing.T) {
	cfg := config.Config{StaticDir: t.TempDir(), ReadyTimeout: time.Second, ShutdownTimeout: time.Second}
	server, err := New(cfg, slog.New(slog.NewTextHandler(io.Discard, nil)))
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
