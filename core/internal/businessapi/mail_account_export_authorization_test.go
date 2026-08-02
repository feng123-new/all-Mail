package businessapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMailAccountExportRequiresSuperAdministrator(t *testing.T) {
	store := &fakeStore{
		admin: Admin{
			ID:             7,
			Username:       "operator",
			Role:           "ADMIN",
			Status:         "ACTIVE",
			SessionVersion: 1,
		},
	}
	server := testServer(store)

	request := authenticatedRequest(t, http.MethodGet, "/admin/emails/export", "admin-console")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), `"code":"FORBIDDEN"`) {
		t.Fatalf("regular administrator export response = %d %s", response.Code, response.Body.String())
	}

	store.admin.Role = "SUPER_ADMIN"
	request = authenticatedRequest(t, http.MethodGet, "/admin/emails/export", "admin-console")
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), `"code":"MANAGEMENT_STORE_UNAVAILABLE"`) {
		t.Fatalf("super administrator export authorization response = %d %s", response.Code, response.Body.String())
	}
}
