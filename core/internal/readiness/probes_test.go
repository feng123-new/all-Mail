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

func TestReadinessRequiresStaticAssetsAndBothBusinessAPIs(t *testing.T) {
	prober := Prober{
		BusinessAPI:   func(context.Context, string) error { return nil },
		GoBusinessAPI: func(context.Context, string) error { return nil },
	}
	cfg := config.APIConfig{StaticDir: t.TempDir()}
	report := prober.Check(context.Background(), cfg, "")
	if report.Ready {
		t.Fatal("readiness unexpectedly succeeded without required dependencies")
	}
	if report.Checks["staticAssets"] != "index.html unavailable" {
		t.Fatalf("staticAssets check = %q", report.Checks["staticAssets"])
	}
	if report.Checks["businessApi"] != "required-but-not-configured" {
		t.Fatalf("businessApi check = %q", report.Checks["businessApi"])
	}
	if report.Checks["goBusinessApi"] != "required-but-not-configured" {
		t.Fatalf("goBusinessApi check = %q", report.Checks["goBusinessApi"])
	}
}

func TestReadinessRunsBothPrivateProbes(t *testing.T) {
	directory := t.TempDir()
	if err := os.WriteFile(filepath.Join(directory, "index.html"), []byte("ok"), 0o600); err != nil {
		t.Fatal(err)
	}
	businessCalls := 0
	goCalls := 0
	prober := Prober{
		BusinessAPI:   func(context.Context, string) error { businessCalls++; return nil },
		GoBusinessAPI: func(context.Context, string) error { goCalls++; return nil },
	}
	report := prober.Check(context.Background(), config.APIConfig{
		StaticDir:      directory,
		BusinessAPIURL: "http://business-api:3100",
	}, "http://go-business-api:3200")
	if !report.Ready || businessCalls != 1 || goCalls != 1 {
		t.Fatalf("report = %#v, business calls = %d, Go calls = %d", report, businessCalls, goCalls)
	}
}

func TestServiceProbeRequiresProtocolValidPayload(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/readyz" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"success":true,"data":{"status":"ready"}}`))
	}))
	defer server.Close()
	if err := checkServiceReadiness(context.Background(), server.URL); err != nil {
		t.Fatal(err)
	}

	invalid := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"success":true,"data":{"status":"not-ready"}}`))
	}))
	defer invalid.Close()
	if err := checkServiceReadiness(context.Background(), invalid.URL); err == nil || !strings.Contains(err.Error(), "not-ready") {
		t.Fatalf("invalid readiness error = %v", err)
	}
}
