package readiness

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/feng123-new/all-Mail/core/internal/config"
)

func TestReadinessRequiresStaticAssetsAndCompatibilityAPI(t *testing.T) {
	prober := Prober{Legacy: func(context.Context, string) error { return nil }}
	cfg := config.APIConfig{StaticDir: t.TempDir()}
	report := prober.Check(context.Background(), cfg)
	if report.Ready {
		t.Fatal("readiness unexpectedly succeeded without required dependencies")
	}
	if report.Checks["staticAssets"] != "index.html unavailable" {
		t.Fatalf("staticAssets check = %q", report.Checks["staticAssets"])
	}
	if report.Checks["compatibilityApi"] != "required-but-not-configured" {
		t.Fatalf("compatibilityApi check = %q", report.Checks["compatibilityApi"])
	}
}

func TestReadinessRunsCompatibilityProbe(t *testing.T) {
	directory := t.TempDir()
	if err := os.WriteFile(filepath.Join(directory, "index.html"), []byte("ok"), 0o600); err != nil {
		t.Fatal(err)
	}
	called := 0
	prober := Prober{Legacy: func(context.Context, string) error { called++; return nil }}
	report := prober.Check(context.Background(), config.APIConfig{
		StaticDir:    directory,
		LegacyAPIURL: "http://legacy-api:3100",
	})
	if !report.Ready || called != 1 {
		t.Fatalf("report = %#v, calls = %d", report, called)
	}
}

func TestCompatibilityProbeRequiresProtocolValidPayload(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/readyz" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"success":true,"data":{"status":"ready"}}`))
	}))
	defer server.Close()
	if err := checkLegacy(context.Background(), server.URL); err != nil {
		t.Fatal(err)
	}

	invalid := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"success":true,"data":{"status":"not-ready"}}`))
	}))
	defer invalid.Close()
	if err := checkLegacy(context.Background(), invalid.URL); err == nil || !strings.Contains(err.Error(), "not-ready") {
		t.Fatalf("invalid readiness error = %v", err)
	}
}
