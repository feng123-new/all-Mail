package businessapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPermissionV2RequiresAtLeastOneEnabledPermission(t *testing.T) {
	if permissionAllowed(nil, actionExternalListMailboxes) {
		t.Fatal("missing permissions unexpectedly allowed an action")
	}
	if permissionAllowed(map[string]bool{}, actionExternalListMailboxes) {
		t.Fatal("empty permissions unexpectedly allowed an action")
	}
	for _, input := range []map[string]bool{
		{},
		{"all": false},
		{actionExternalListMailboxes: false},
	} {
		if _, err := normalizePermissions(input); err == nil {
			t.Fatalf("normalizePermissions(%#v) expected an error", input)
		}
	}
	normalized, err := normalizePermissions(map[string]bool{"list_emails": true})
	if err != nil {
		t.Fatal(err)
	}
	if !permissionAllowed(normalized, actionExternalListMailboxes) {
		t.Fatalf("normalized permissions did not allow the configured action: %#v", normalized)
	}
}

func TestPermissionV2RejectsImplicitOrEmptyManagementRequests(t *testing.T) {
	apiKeys := &fakeAPIKeyStore{createdResult: APIKeyCreated{ID: 1, Key: "sk_unused"}}
	server := testBusinessServer(apiKeys, &fakeDomainMailboxStore{}, &fakeRateLimiter{count: 1})

	for _, body := range []string{
		`{"name":"missing"}`,
		`{"name":"empty","permissions":{}}`,
		`{"name":"disabled","permissions":{"all":false}}`,
		`{"name":"null","permissions":null}`,
	} {
		request := authenticatedJSONRequest(t, http.MethodPost, "/admin/api-keys", body)
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("create body %s response = %d %s", body, response.Code, response.Body.String())
		}
	}
	if apiKeys.createdBy != 0 {
		t.Fatalf("invalid request reached the store: createdBy=%d", apiKeys.createdBy)
	}

	request := authenticatedJSONRequest(t, http.MethodPut, "/admin/api-keys/8", `{"permissions":{}}`)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), `"code":"VALIDATION_ERROR"`) {
		t.Fatalf("empty update response = %d %s", response.Code, response.Body.String())
	}
}
