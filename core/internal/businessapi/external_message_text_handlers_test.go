package businessapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestExternalMessageTextRoutesRegisterBothAllMethodAliases(t *testing.T) {
	server := testBusinessServer(&fakeAPIKeyStore{}, &fakeDomainMailboxStore{}, &fakeRateLimiter{count: 1})
	for _, route := range []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/messages/text?email=pool@example.org"},
		{http.MethodPut, "/api/messages/text"},
		{http.MethodGet, "/api/mail_text?email=pool@example.org"},
		{http.MethodDelete, "/api/mail_text"},
	} {
		t.Run(route.method+" "+route.path, func(t *testing.T) {
			request := httptest.NewRequest(route.method, route.path, nil)
			response := httptest.NewRecorder()
			server.Handler().ServeHTTP(response, request)
			if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), `"code":"UNAUTHORIZED"`) {
				t.Fatalf("route response = %d %s", response.Code, response.Body.String())
			}
		})
	}
}

func TestMessageTextMatchUsesFirstCaptureThenFullMatch(t *testing.T) {
	matched, found, err := matchMessageText("prefix code=123456 suffix", `code=(\d+)`, true)
	if err != nil || !found || matched != "123456" {
		t.Fatalf("captured match = %q, %t, %v", matched, found, err)
	}

	matched, found, err = matchMessageText("prefix 654321 suffix", `\d{6}`, true)
	if err != nil || !found || matched != "654321" {
		t.Fatalf("full match = %q, %t, %v", matched, found, err)
	}
}

func TestMessageTextMatchSupportsJavaScriptLookaroundAndBackreferences(t *testing.T) {
	matched, found, err := matchMessageText("prefix code=123456 suffix", `(?<=code=)\d{6}(?= suffix)`, false)
	if err != nil || !found || matched != "123456" {
		t.Fatalf("lookaround match = %q, %t, %v", matched, found, err)
	}

	matched, found, err = matchMessageText("token AB-AB", `([A-Z]{2})-\1`, false)
	if err != nil || !found || matched != "AB-AB" {
		t.Fatalf("backreference match = %q, %t, %v", matched, found, err)
	}
}

func TestMessageTextMatchBoundsPathologicalBacktracking(t *testing.T) {
	started := time.Now()
	_, _, err := matchMessageText(strings.Repeat("a", 100_000)+"!", `^(a+)+$`, false)
	if err == nil {
		t.Fatal("pathological expression did not reach the match limit")
	}
	if elapsed := time.Since(started); elapsed > 2*time.Second {
		t.Fatalf("pathological expression ran for %s", elapsed)
	}
}
