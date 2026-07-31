package businessapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAdministratorSessionVersionMismatchRevokesToken(t *testing.T) {
	store := &fakeStore{
		admin: Admin{
			ID:             7,
			Username:       "admin",
			Role:           "SUPER_ADMIN",
			Status:         "ACTIVE",
			SessionVersion: 2,
		},
	}
	server := testServer(store)
	request := authenticatedRequest(t, http.MethodGet, "/admin/dashboard/stats", adminJWTAudience)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), `"code":"INVALID_TOKEN"`) {
		t.Fatalf("stale-session response = %d %s", response.Code, response.Body.String())
	}
}

func TestAdministratorJWTRequiresIssuerAndSessionVersion(t *testing.T) {
	now := testServer(&fakeStore{}).now()
	valid := signTestJWT(t, 7, adminJWTAudience, now.AddDate(0, 0, 1))
	claims, err := verifyAdminJWT(valid, testJWTSecret, now)
	if err != nil {
		t.Fatal(err)
	}
	if claims.AdminID != 7 || claims.SessionVersion != 1 {
		t.Fatalf("claims = %#v", claims)
	}
}
