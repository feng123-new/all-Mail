package businessapi

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/feng123-new/all-Mail/core/internal/config"
)

func TestBrowserOriginProtectionRejectsCrossSiteWrites(t *testing.T) {
	server := newWithStore(config.GoBusinessAPIConfig{}, slog.New(slog.NewTextHandler(io.Discard, nil)), nil)
	for _, configure := range []func(*http.Request){
		func(request *http.Request) { request.Header.Set("Origin", "https://evil.example") },
		func(request *http.Request) { request.Header.Set("Sec-Fetch-Site", "cross-site") },
	} {
		request := httptest.NewRequest(http.MethodPost, "http://mail.example/admin/auth/login", strings.NewReader(`{}`))
		request.Header.Set("Content-Type", "application/json")
		configure(request)
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), "CSRF_ORIGIN_INVALID") {
			t.Fatalf("cross-site response = %d %s", response.Code, response.Body.String())
		}
	}
}

func TestBrowserOriginProtectionAllowsSameOriginAndNonBrowserClients(t *testing.T) {
	server := newWithStore(config.GoBusinessAPIConfig{}, slog.New(slog.NewTextHandler(io.Discard, nil)), nil)
	for _, origin := range []string{"https://mail.example", ""} {
		request := httptest.NewRequest(http.MethodPost, "http://internal/admin/auth/login", strings.NewReader(`{}`))
		request.Host = "mail.example"
		request.Header.Set("X-Forwarded-Proto", "https")
		request.Header.Set("X-Forwarded-Host", "mail.example")
		request.Header.Set("Content-Type", "application/json")
		if origin != "" {
			request.Header.Set("Origin", origin)
		}
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code == http.StatusForbidden {
			t.Fatalf("allowed client was rejected: %s", response.Body.String())
		}
	}
}
