package businessapi

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestGmailLoginDetailsRequiresAdministratorStepUp(t *testing.T) {
	admin := Admin{ID: 7, Status: "ACTIVE", TwoFactorEnabled: true, SessionVersion: 1}
	store := &fakeStore{admin: admin}
	server := testServer(store)
	grant, _, err := signAdminRevealGrant(admin, testJWTSecret, server.now())
	if err != nil {
		t.Fatal(err)
	}
	expired, _, err := signAdminRevealGrant(admin, testJWTSecret, server.now().Add(-time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, method, body, origin, audience string
		no2FA                                bool
		status                               int
	}{
		{name: "anonymous", method: http.MethodPost, body: `{}`, status: 401},
		{name: "portal cookie", method: http.MethodPost, body: `{}`, audience: "mailbox-portal", status: 401},
		{name: "missing grant", method: http.MethodPost, body: `{}`, audience: adminJWTAudience, status: 401},
		{name: "expired grant", method: http.MethodPost, body: `{"grantToken":"` + expired + `"}`, audience: adminJWTAudience, status: 401},
		{name: "disabled 2FA", method: http.MethodPost, body: `{"grantToken":"` + grant + `"}`, audience: adminJWTAudience, no2FA: true, status: 403},
		{name: "cross origin", method: http.MethodPatch, body: `{"grantToken":"` + grant + `","notes":"private"}`, audience: adminJWTAudience, origin: "https://elsewhere.example.test", status: 403},
		{name: "requires the correct account address", method: http.MethodPost, body: `{"grantToken":"` + grant + `"}`, audience: adminJWTAudience, status: 400},
		{name: "rejects six-digit code as a setup key", method: http.MethodPatch, body: `{"grantToken":"` + grant + `","email":"google@example.test","totpSecret":"123456"}`, audience: adminJWTAudience, status: 400},
		{name: "does not accept a replacement with unknown fields", method: http.MethodPatch, body: `{"grantToken":"` + grant + `","oauthToken":"fixture"}`, audience: adminJWTAudience, status: 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store.admin.TwoFactorEnabled = !tc.no2FA
			const path = "/admin/emails/10/login-details"
			req := httptest.NewRequest(tc.method, path, strings.NewReader(tc.body))
			if tc.audience != "" {
				req = authenticatedRequest(t, tc.method, path, tc.audience)
				req.Body = io.NopCloser(strings.NewReader(tc.body))
			}
			req.Header.Set("Origin", tc.origin)
			response := httptest.NewRecorder()
			server.Handler().ServeHTTP(response, req)
			if response.Code != tc.status || response.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("response = %d %s, want %d and no-store", response.Code, response.Body.String(), tc.status)
			}
		})
	}
}
