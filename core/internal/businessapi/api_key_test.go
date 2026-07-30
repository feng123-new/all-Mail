package businessapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/config"
)

type fakeAPIKeyStore struct {
	principal       APIKeyPrincipal
	findErr         error
	touchErr        error
	listResult      APIKeyList
	createdResult   APIKeyCreated
	updatedResult   APIKeyUpdated
	detailsResult   APIKeyDetails
	allocation      EmailAllocation
	externalList    ExternalMailboxList
	allocationStats AllocationStats
	assigned        []AssignedEmail
	updateAssigned  AssignedEmailUpdate
	lastHash        string
	touched         int
	createdInput    APIKeyCreateInput
	createdBy       int64
	updatedID       int64
	updatedInput    APIKeyUpdateInput
	deletedID       int64
	logged          []loggedAPICall
}

type loggedAPICall struct {
	action       string
	apiKeyID     *int64
	emailID      *int64
	responseCode int
	requestID    string
}

func (s *fakeAPIKeyStore) ListAPIKeys(context.Context, APIKeyListInput) (APIKeyList, error) {
	return s.listResult, nil
}
func (s *fakeAPIKeyStore) CreateAPIKey(_ context.Context, input APIKeyCreateInput, createdBy int64) (APIKeyCreated, error) {
	s.createdInput, s.createdBy = input, createdBy
	return s.createdResult, nil
}
func (s *fakeAPIKeyStore) GetAPIKey(context.Context, int64) (APIKeyDetails, error) {
	return s.detailsResult, nil
}
func (s *fakeAPIKeyStore) UpdateAPIKey(_ context.Context, id int64, input APIKeyUpdateInput) (APIKeyUpdated, error) {
	s.updatedID, s.updatedInput = id, input
	return s.updatedResult, nil
}
func (s *fakeAPIKeyStore) DeleteAPIKey(_ context.Context, id int64) error {
	s.deletedID = id
	return nil
}
func (s *fakeAPIKeyStore) FindAPIKeyByHash(_ context.Context, hash string) (APIKeyPrincipal, error) {
	s.lastHash = hash
	return s.principal, s.findErr
}
func (s *fakeAPIKeyStore) TouchAPIKey(context.Context, int64, time.Time) error {
	s.touched++
	return s.touchErr
}
func (s *fakeAPIKeyStore) EmailAllocationStats(context.Context, int64, string) (AllocationStats, error) {
	return s.allocationStats, nil
}
func (s *fakeAPIKeyStore) ResetEmailAllocations(context.Context, int64, string) error { return nil }
func (s *fakeAPIKeyStore) AssignedEmails(context.Context, int64, *int64) ([]AssignedEmail, error) {
	return s.assigned, nil
}
func (s *fakeAPIKeyStore) UpdateAssignedEmails(context.Context, int64, []int64, *int64) (AssignedEmailUpdate, error) {
	return s.updateAssigned, nil
}
func (s *fakeAPIKeyStore) AllocateEmail(context.Context, int64, string) (EmailAllocation, error) {
	return s.allocation, nil
}
func (s *fakeAPIKeyStore) ListExternalMailboxes(context.Context, int64, string) (ExternalMailboxList, error) {
	return s.externalList, nil
}
func (s *fakeAPIKeyStore) LogAPICall(_ context.Context, action string, apiKeyID, emailID *int64, _ string, responseCode int, _ int64, requestID string) error {
	call := loggedAPICall{action: action, responseCode: responseCode, requestID: requestID}
	if apiKeyID != nil {
		value := *apiKeyID
		call.apiKeyID = &value
	}
	if emailID != nil {
		value := *emailID
		call.emailID = &value
	}
	s.logged = append(s.logged, call)
	return nil
}

type fakeDomainMailboxStore struct {
	allocation DomainMailboxAllocation
	list       DomainMailboxList
	stats      AllocationStats
	deleted    int64
	messages   DomainMessageList
	selector   DomainSelector
	email      string
	limit      int
}

func (s *fakeDomainMailboxStore) AllocateDomainMailbox(_ context.Context, _ int64, selector DomainSelector) (DomainMailboxAllocation, error) {
	s.selector = selector
	return s.allocation, nil
}
func (s *fakeDomainMailboxStore) ListDomainMailboxes(_ context.Context, _ int64, selector DomainSelector) (DomainMailboxList, error) {
	s.selector = selector
	return s.list, nil
}
func (s *fakeDomainMailboxStore) DomainMailboxAllocationStats(_ context.Context, _ int64, selector DomainSelector) (AllocationStats, error) {
	s.selector = selector
	return s.stats, nil
}
func (s *fakeDomainMailboxStore) ResetDomainMailboxAllocations(_ context.Context, _ int64, selector DomainSelector) (int64, error) {
	s.selector = selector
	return s.deleted, nil
}
func (s *fakeDomainMailboxStore) ListDomainMessages(_ context.Context, _ int64, email string, limit int) (DomainMessageList, error) {
	s.email, s.limit = email, limit
	return s.messages, nil
}

type fakeRateLimiter struct {
	count   int64
	err     error
	pingErr error
	calls   int
	lastKey string
	lastTTL time.Duration
	closed  bool
}

func (l *fakeRateLimiter) Ping(context.Context) error { return l.pingErr }
func (l *fakeRateLimiter) Increment(_ context.Context, key string, ttl time.Duration) (int64, error) {
	l.calls++
	l.lastKey, l.lastTTL = key, ttl
	return l.count, l.err
}
func (l *fakeRateLimiter) Close() { l.closed = true }

func TestAdminAPIKeyRoutesPreserveValidationAndOneTimeKeyResponse(t *testing.T) {
	apiKeys := &fakeAPIKeyStore{
		listResult:     APIKeyList{Total: 1, Page: 1, PageSize: 10, List: []APIKeyListItem{{ID: 4, Name: "automation"}}},
		createdResult:  APIKeyCreated{ID: 5, Name: "new", Key: "sk_secret", Status: "ACTIVE"},
		updatedResult:  APIKeyUpdated{ID: 5, Name: "updated", Status: "DISABLED"},
		updateAssigned: AssignedEmailUpdate{Success: true, Count: 2, Added: 1},
	}
	server := testBusinessServer(apiKeys, &fakeDomainMailboxStore{}, &fakeRateLimiter{count: 1})

	request := authenticatedRequest(t, http.MethodGet, "/admin/api-keys?page=1&pageSize=10", "admin-console")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"name":"automation"`) {
		t.Fatalf("list response = %d %s", response.Code, response.Body.String())
	}

	request = authenticatedJSONRequest(t, http.MethodPost, "/admin/api-keys", `{
		"name":"new","rateLimit":120,
		"permissions":{"get_email":true},
		"allowedEmailIds":[3,3,7]
	}`)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"key":"sk_secret"`) {
		t.Fatalf("create response = %d %s", response.Code, response.Body.String())
	}
	if apiKeys.createdBy != 7 || apiKeys.createdInput.RateLimit != 120 {
		t.Fatalf("create input = %#v, createdBy=%d", apiKeys.createdInput, apiKeys.createdBy)
	}
	if !apiKeys.createdInput.Permissions[actionExternalAllocateMailbox] {
		t.Fatalf("permissions were not normalized: %#v", apiKeys.createdInput.Permissions)
	}
	if len(apiKeys.createdInput.AllowedEmailIDs) != 2 {
		t.Fatalf("allowed email ids = %#v", apiKeys.createdInput.AllowedEmailIDs)
	}

	request = authenticatedJSONRequest(t, http.MethodPost, "/admin/api-keys", `{"name":"bad","permissions":{"unknown":true}}`)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), `"code":"VALIDATION_ERROR"`) {
		t.Fatalf("unknown permission response = %d %s", response.Code, response.Body.String())
	}

	request = authenticatedJSONRequest(t, http.MethodPut, "/admin/api-keys/5", `{"status":"DISABLED","allowedDomainIds":[]}`)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || apiKeys.updatedID != 5 || !apiKeys.updatedInput.AllowedDomainIDsSet {
		t.Fatalf("update response=%d %s, input=%#v", response.Code, response.Body.String(), apiKeys.updatedInput)
	}

	request = authenticatedJSONRequest(t, http.MethodPut, "/admin/api-keys/5/assigned-mailboxes", `{"emailIds":[2,3],"groupId":4}`)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"data":{"success":true,"count":2`) {
		t.Fatalf("assigned response = %d %s", response.Code, response.Body.String())
	}
}

func TestScopeValidationRejectsInputsThatWouldBroadenAccess(t *testing.T) {
	apiKeys := &fakeAPIKeyStore{principal: APIKeyPrincipal{
		ID: 12, Status: "ACTIVE", RateLimit: 60, Permissions: map[string]bool{"*": true},
	}}
	server := testBusinessServer(apiKeys, &fakeDomainMailboxStore{}, &fakeRateLimiter{count: 1})

	for _, body := range []string{
		`{"name":"bad-group","allowedGroupIds":[0]}`,
		`{"name":"bad-email","allowedEmailIds":[-1]}`,
		`{"name":"bad-domain","allowedDomainIds":[0]}`,
		`{"name":"null-permissions","permissions":null}`,
		`{"name":"null-groups","allowedGroupIds":null}`,
		`{"name":"null-emails","allowedEmailIds":null}`,
		`{"name":"null-domains","allowedDomainIds":null}`,
		`{"name":"conflict","permissions":{"get_email":true,"external_allocate_mailbox":false}}`,
	} {
		request := authenticatedJSONRequest(t, http.MethodPost, "/admin/api-keys", body)
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("create body %s response = %d %s", body, response.Code, response.Body.String())
		}
	}

	for _, tc := range []struct {
		method string
		path   string
		body   string
	}{
		{http.MethodGet, "/api/domain-mail/mailboxes?domain=", ""},
		{http.MethodPost, "/api/domain-mail/reset-pool", ""},
		{http.MethodPost, "/api/domain-mail/reset-pool", `null`},
		{http.MethodPost, "/api/domain-mail/reset-pool", `{"domain":""}`},
		{http.MethodPost, "/api/domain-mail/reset-pool", `{"domainId":null}`},
		{http.MethodPost, "/api/domain-mail/reset-pool", `{"batchTag":""}`},
	} {
		request := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
		request.Header.Set("X-API-Key", "sk_external")
		if tc.body != "" {
			request.Header.Set("Content-Type", "application/json")
		}
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("%s %s response = %d %s", tc.method, tc.path, response.Code, response.Body.String())
		}
	}

	for _, body := range []string{
		``,
		`null`,
		`{"emailIds":[],"groupId":null}`,
		`{"emailIds":null}`,
	} {
		request := authenticatedJSONRequest(t, http.MethodPut, "/admin/api-keys/5/assigned-mailboxes", body)
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("assigned body %s response = %d %s", body, response.Code, response.Body.String())
		}
	}

	for _, body := range []string{"", "null"} {
		request := authenticatedJSONRequest(t, http.MethodPost, "/admin/api-keys/5/allocation-reset", body)
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("allocation reset body %q response = %d %s", body, response.Code, response.Body.String())
		}
	}
}

func TestAPIKeyAuthenticationPreservesRateUsageAndPermissionOrdering(t *testing.T) {
	now := time.Date(2026, 7, 30, 12, 0, 0, 0, time.UTC)
	rawKey := "sk_example"
	digest := sha256.Sum256([]byte(rawKey))
	apiKeys := &fakeAPIKeyStore{principal: APIKeyPrincipal{
		ID: 9, Name: "key", Status: "ACTIVE", RateLimit: 2,
		Permissions: map[string]bool{actionExternalListMailboxes: false},
	}}
	limiter := &fakeRateLimiter{count: 1}
	server := testBusinessServer(apiKeys, &fakeDomainMailboxStore{}, limiter)
	server.now = func() time.Time { return now }

	request := httptest.NewRequest(http.MethodGet, "/api/list-emails", nil)
	request.Header.Set("X-API-Key", rawKey)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), `"code":"FORBIDDEN_PERMISSION"`) {
		t.Fatalf("permission response = %d %s", response.Code, response.Body.String())
	}
	if apiKeys.lastHash != hex.EncodeToString(digest[:]) || apiKeys.touched != 1 || limiter.calls != 1 {
		t.Fatalf("authentication ordering: hash=%q touched=%d limiter=%d", apiKeys.lastHash, apiKeys.touched, limiter.calls)
	}
	if !strings.Contains(limiter.lastKey, "rate_limit:api_key:9:") || limiter.lastTTL != time.Minute {
		t.Fatalf("limiter call = %q %s", limiter.lastKey, limiter.lastTTL)
	}

	apiKeys.principal.Permissions = map[string]bool{"*": true}
	limiter.count = 3
	request = httptest.NewRequest(http.MethodGet, "/api/list-emails", nil)
	request.Header.Set("Authorization", "Bearer "+rawKey)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusTooManyRequests || !strings.Contains(response.Body.String(), `"code":"RATE_LIMIT_EXCEEDED"`) {
		t.Fatalf("rate response = %d %s", response.Code, response.Body.String())
	}
	if apiKeys.touched != 1 {
		t.Fatalf("rate-limited request updated usage: %d", apiKeys.touched)
	}

	limiter.count = 1
	limiter.err = errors.New("redis down")
	request = httptest.NewRequest(http.MethodGet, "/api/list-emails", nil)
	request.Header.Set("X-API-Key", rawKey)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), `"code":"RATE_LIMIT_BACKEND_UNAVAILABLE"`) {
		t.Fatalf("Redis failure response = %d %s", response.Code, response.Body.String())
	}

	limiter.err = nil
	expired := now.Add(-time.Second)
	apiKeys.principal.ExpiresAt = &expired
	callsBefore := limiter.calls
	request = httptest.NewRequest(http.MethodGet, "/api/list-emails", nil)
	request.Header.Set("X-API-Key", rawKey)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), `"code":"API_KEY_EXPIRED"`) {
		t.Fatalf("expired response = %d %s", response.Code, response.Body.String())
	}
	if limiter.calls != callsBefore {
		t.Fatal("expired key reached Redis")
	}
}

func TestDatabaseBackedExternalRoutesUseGoStoresAndAudit(t *testing.T) {
	apiKeys := &fakeAPIKeyStore{
		principal:    APIKeyPrincipal{ID: 12, Name: "external", Status: "ACTIVE", RateLimit: 60, Permissions: map[string]bool{"all": true}},
		allocation:   EmailAllocation{ID: 44, Email: "allocated@example.com"},
		externalList: ExternalMailboxList{Total: 1, Emails: []ExternalMailbox{{Email: "allocated@example.com", Provider: "GMAIL", Status: "ACTIVE"}}},
	}
	domains := &fakeDomainMailboxStore{
		allocation: DomainMailboxAllocation{ID: 51, Email: "pool@example.org", DomainID: 2, DomainName: "example.org"},
		messages:   DomainMessageList{Email: "pool@example.org", Count: 1, Messages: []DomainMessage{{ID: "99", Subject: "hello"}}},
	}
	server := testBusinessServer(apiKeys, domains, &fakeRateLimiter{count: 1})

	for _, tc := range []struct {
		path     string
		expected string
	}{
		{"/api/get-email?group=primary", `"email":"allocated@example.com"`},
		{"/api/list-emails", `"provider":"GMAIL"`},
		{"/api/domain-mail/get-mailbox?domain=example.org", `"email":"pool@example.org"`},
		{"/api/domain-mail/messages/latest?email=pool@example.org", `"subject":"hello"`},
	} {
		request := httptest.NewRequest(http.MethodGet, tc.path, nil)
		request.Header.Set("X-API-Key", "sk_external")
		request.Header.Set("X-Request-Id", "external-test")
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), tc.expected) {
			t.Fatalf("%s response = %d %s", tc.path, response.Code, response.Body.String())
		}
	}
	if len(apiKeys.logged) != 4 {
		t.Fatalf("API logs = %#v", apiKeys.logged)
	}
	for _, entry := range apiKeys.logged {
		if entry.apiKeyID == nil || *entry.apiKeyID != 12 || entry.responseCode != http.StatusOK || entry.requestID != "external-test" {
			t.Fatalf("API log = %#v", entry)
		}
	}
	if domains.selector.Domain != "example.org" || domains.email != "pool@example.org" || domains.limit != 1 {
		t.Fatalf("domain inputs = selector=%#v email=%q limit=%d", domains.selector, domains.email, domains.limit)
	}
}

func TestGoBusinessReadinessFailsClosedOnRedis(t *testing.T) {
	store := &fakeStore{}
	limiter := &fakeRateLimiter{pingErr: errors.New("redis unavailable")}
	server := newWithDependencies(testBusinessConfig(), discardBusinessLogger(), store, &fakeAPIKeyStore{}, &fakeDomainMailboxStore{}, limiter)
	request := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), `"redis":"unavailable"`) {
		t.Fatalf("readiness response = %d %s", response.Code, response.Body.String())
	}
}

func TestPermissionNormalizationMatchesFastifyAliases(t *testing.T) {
	permissions, err := normalizePermissions(map[string]bool{
		"get-email":  true,
		"pool_reset": false,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !permissionAllowed(permissions, actionExternalAllocateMailbox) {
		t.Fatalf("normalized permissions = %#v", permissions)
	}
	if permissionAllowed(permissions, actionExternalMailboxAllocationReset) {
		t.Fatalf("explicit deny was ignored: %#v", permissions)
	}
	if _, err := normalizePermissions(map[string]bool{"unknown": true}); err == nil {
		t.Fatal("normalizePermissions accepted an unknown key")
	}
	if _, err := normalizePermissions(map[string]bool{
		"get_email":                   true,
		actionExternalAllocateMailbox: false,
	}); err == nil {
		t.Fatal("normalizePermissions accepted conflicting aliases")
	}
	legacy := decodeJSONPermissions([]byte(`{"get_email":true,"unknown":true}`))
	if !permissionAllowed(legacy, actionExternalAllocateMailbox) {
		t.Fatalf("legacy permissions were not normalized: %#v", legacy)
	}
}

func testBusinessServer(apiKeys APIKeyStore, domains DomainMailboxStore, limiter RateLimiter) *Server {
	store := &fakeStore{admin: Admin{ID: 7, Username: "admin", Role: "SUPER_ADMIN", Status: "ACTIVE"}}
	server := newWithDependencies(testBusinessConfig(), discardBusinessLogger(), store, apiKeys, domains, limiter)
	server.now = func() time.Time { return time.Date(2026, 7, 30, 0, 0, 0, 0, time.UTC) }
	return server
}

func testBusinessConfig() config.GoBusinessAPIConfig {
	return config.GoBusinessAPIConfig{
		Port:            3200,
		JWTSecret:       testJWTSecret,
		ReadyTimeout:    time.Second,
		QueryTimeout:    time.Second,
		ShutdownTimeout: time.Second,
	}
}

func discardBusinessLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func authenticatedJSONRequest(t *testing.T, method, target, body string) *http.Request {
	t.Helper()
	request := authenticatedRequest(t, method, target, "admin-console")
	request.Body = io.NopCloser(strings.NewReader(body))
	request.ContentLength = int64(len(body))
	request.Header.Set("Content-Type", "application/json")
	return request
}
