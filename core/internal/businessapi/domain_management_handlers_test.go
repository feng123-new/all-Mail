package businessapi

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type fakeDomainManagementStore struct {
	*fakeStore

	createInput       domainCreateInput
	createAdminID     int64
	createCanApprove  bool
	createCalls       int
	listInput         domainListInput
	updateInput       domainUpdateInput
	updateCanApprove  bool
	cloudflareTarget  domainCloudflareValidationTarget
	cloudflareSaved   domainCloudflareValidationResult
	cloudflareVersion string
	aliasCreateInput  domainAliasCreateInput
	aliasUpdateStatus *string
	storeErr          error
}

func newFakeDomainManagementStore() *fakeDomainManagementStore {
	return &fakeDomainManagementStore{
		fakeStore: &fakeStore{admin: Admin{ID: 7, Username: "admin", Role: "SUPER_ADMIN", Status: "ACTIVE"}},
		cloudflareTarget: domainCloudflareValidationTarget{
			DomainName:        "mail.example.com",
			CanReceive:        true,
			IsCatchAllEnabled: true,
			APIToken:          "cloudflare-token-1234567890",
			ZoneID:            "zone_12345678",
			ConfigFingerprint: "config-version-1",
		},
	}
}

func (s *fakeDomainManagementStore) ListDomains(_ context.Context, input domainListInput) (domainListResult, error) {
	s.listInput = input
	return domainListResult{List: []domainSummary{}, Page: 1, PageSize: 20}, s.storeErr
}

func (s *fakeDomainManagementStore) GetDomain(context.Context, int64) (domainDetail, error) {
	return domainDetail{ID: 9, Name: "example.com", Mailboxes: []domainMailboxSummary{}, SendingConfigs: []domainSendingConfig{}}, s.storeErr
}

func (s *fakeDomainManagementStore) CreateDomain(_ context.Context, input domainCreateInput, adminID int64, canApprove bool) (domainSummary, error) {
	s.createCalls++
	s.createInput = input
	s.createAdminID = adminID
	s.createCanApprove = canApprove
	return domainSummary{ID: 9, Name: input.Name, Status: "PENDING", CreatedBy: domainCreator{ID: adminID, Username: "admin"}}, s.storeErr
}

func (s *fakeDomainManagementStore) UpdateDomain(_ context.Context, _ int64, input domainUpdateInput, canApprove bool) (domainSummary, error) {
	s.updateInput = input
	s.updateCanApprove = canApprove
	return domainSummary{ID: 9, Name: "example.com", Status: "ACTIVE", CreatedBy: domainCreator{ID: 7, Username: "admin"}}, s.storeErr
}

func (s *fakeDomainManagementStore) ConfigureDomainVerification(context.Context, int64, *string) (domainVerificationResult, error) {
	return domainVerificationResult{ID: 9, Name: "example.com", VerificationToken: "verification-token"}, s.storeErr
}

func (s *fakeDomainManagementStore) SaveDomainCloudflareConfig(context.Context, int64, domainCloudflareConfigInput, string) (domainCloudflareConfigResult, error) {
	return domainCloudflareConfigResult{ID: 9}, s.storeErr
}

func (s *fakeDomainManagementStore) LoadDomainCloudflareValidation(context.Context, int64, string) (domainCloudflareValidationTarget, error) {
	return s.cloudflareTarget, s.storeErr
}

func (s *fakeDomainManagementStore) SaveDomainCloudflareValidation(_ context.Context, _ int64, fingerprint string, result domainCloudflareValidationResult) (domainCloudflareConfigResult, error) {
	s.cloudflareVersion = fingerprint
	s.cloudflareSaved = result
	return domainCloudflareConfigResult{ID: 9, CloudflareValidation: domainCloudflareValidationView{LastValidation: &result}}, s.storeErr
}

func (s *fakeDomainManagementStore) ConfigureDomainCatchAll(context.Context, int64, domainCatchAllInput) (domainCatchAllResult, error) {
	return domainCatchAllResult{ID: 9, Name: "example.com"}, s.storeErr
}

func (s *fakeDomainManagementStore) SaveDomainSendingConfig(context.Context, int64, domainSendingConfigInput, string) (domainSendingConfig, error) {
	return domainSendingConfig{ID: 3, Provider: "RESEND", Status: "ACTIVE"}, s.storeErr
}

func (s *fakeDomainManagementStore) ListDomainAliases(context.Context, int64, *int64) ([]domainAlias, error) {
	return []domainAlias{}, s.storeErr
}

func (s *fakeDomainManagementStore) CreateDomainAlias(_ context.Context, _ int64, input domainAliasCreateInput) (domainAlias, error) {
	s.aliasCreateInput = input
	return domainAlias{ID: 4, MailboxID: input.MailboxID, AliasLocalPart: input.AliasLocalPart, AliasAddress: input.AliasLocalPart + "@example.com", Status: "ACTIVE"}, s.storeErr
}

func (s *fakeDomainManagementStore) UpdateDomainAlias(_ context.Context, _ int64, _ int64, status *string) (domainAlias, error) {
	s.aliasUpdateStatus = status
	return domainAlias{ID: 4, MailboxID: 2, AliasLocalPart: "sales", AliasAddress: "sales@example.com", Status: "ACTIVE"}, s.storeErr
}

func (s *fakeDomainManagementStore) DeleteDomainAlias(context.Context, int64, int64) error {
	return s.storeErr
}

func (s *fakeDomainManagementStore) DeleteDomain(context.Context, int64) error {
	return s.storeErr
}

func TestDomainManagementRegistersCompleteFastifyRouteFamily(t *testing.T) {
	server := domainManagementTestServer(newFakeDomainManagementStore())
	handler := registeredDomainManagementHandler(server)
	routes := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/admin/domains"},
		{http.MethodGet, "/admin/domains/9"},
		{http.MethodPost, "/admin/domains"},
		{http.MethodPatch, "/admin/domains/9"},
		{http.MethodDelete, "/admin/domains/9"},
		{http.MethodPost, "/admin/domains/9/verify"},
		{http.MethodPost, "/admin/domains/9/cloudflare-config"},
		{http.MethodPost, "/admin/domains/9/cloudflare-validate"},
		{http.MethodPost, "/admin/domains/9/catch-all"},
		{http.MethodPost, "/admin/domains/9/sending-config"},
		{http.MethodGet, "/admin/domains/9/aliases"},
		{http.MethodPost, "/admin/domains/9/aliases"},
		{http.MethodPatch, "/admin/domains/9/aliases/4"},
		{http.MethodDelete, "/admin/domains/9/aliases/4"},
	}

	for _, route := range routes {
		t.Run(route.method+" "+route.path, func(t *testing.T) {
			request := httptest.NewRequest(route.method, route.path, nil)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), `"code":"UNAUTHORIZED"`) {
				t.Fatalf("route response = %d %s", response.Code, response.Body.String())
			}
		})
	}
}

func TestCreateDomainNormalizesDefaultsAndRequiresSendApproval(t *testing.T) {
	store := newFakeDomainManagementStore()
	server := domainManagementTestServer(store)
	handler := registeredDomainManagementHandler(server)

	response := serveAuthenticatedDomainRequest(t, handler, http.MethodPost, "/admin/domains", `{"name":"  Mail.Example.COM  ","displayName":"  Primary  "}`)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"name":"mail.example.com"`) {
		t.Fatalf("create response = %d %s", response.Code, response.Body.String())
	}
	if store.createCalls != 1 || store.createAdminID != 7 || !store.createCanApprove {
		t.Fatalf("create call = count %d admin %d approve %v", store.createCalls, store.createAdminID, store.createCanApprove)
	}
	if store.createInput.Name != "mail.example.com" || store.createInput.DisplayName == nil || *store.createInput.DisplayName != "Primary" || !store.createInput.CanReceive || store.createInput.CanSend || store.createInput.IsCatchAllEnabled {
		t.Fatalf("create input = %#v", store.createInput)
	}

	store.fakeStore.admin.Role = "ADMIN"
	response = serveAuthenticatedDomainRequest(t, handler, http.MethodPost, "/admin/domains", `{"name":"send.example.com","canSend":true}`)
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), `"code":"DOMAIN_SEND_APPROVAL_REQUIRED"`) {
		t.Fatalf("send approval response = %d %s", response.Code, response.Body.String())
	}
	if store.createCalls != 1 {
		t.Fatalf("unauthorized send approval reached store: %d calls", store.createCalls)
	}
}

func TestDomainManagementValidationPreservesOptionalAndNullableContracts(t *testing.T) {
	store := newFakeDomainManagementStore()
	handler := registeredDomainManagementHandler(domainManagementTestServer(store))
	tests := []struct {
		name   string
		method string
		path   string
		body   string
	}{
		{name: "short domain", method: http.MethodPost, path: "/admin/domains", body: `{"name":"ab"}`},
		{name: "null create boolean", method: http.MethodPost, path: "/admin/domains", body: `{"name":"example.com","canReceive":null}`},
		{name: "unsupported status", method: http.MethodPatch, path: "/admin/domains/9", body: `{"status":"BROKEN"}`},
		{name: "short verification", method: http.MethodPost, path: "/admin/domains/9/verify", body: `{"verificationToken":"short"}`},
		{name: "short cloudflare token", method: http.MethodPost, path: "/admin/domains/9/cloudflare-config", body: `{"apiToken":"short"}`},
		{name: "missing catch all flag", method: http.MethodPost, path: "/admin/domains/9/catch-all", body: `{}`},
		{name: "invalid reply to", method: http.MethodPost, path: "/admin/domains/9/sending-config", body: `{"apiKey":"resend-key","replyToDefault":"invalid"}`},
		{name: "empty reply to", method: http.MethodPost, path: "/admin/domains/9/sending-config", body: `{"apiKey":"resend-key","replyToDefault":""}`},
		{name: "missing alias mailbox", method: http.MethodPost, path: "/admin/domains/9/aliases", body: `{"aliasLocalPart":"sales"}`},
		{name: "null alias status", method: http.MethodPatch, path: "/admin/domains/9/aliases/4", body: `{"status":null}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response := serveAuthenticatedDomainRequest(t, handler, test.method, test.path, test.body)
			if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), `"code":"VALIDATION_ERROR"`) {
				t.Fatalf("validation response = %d %s", response.Code, response.Body.String())
			}
		})
	}

	response := serveAuthenticatedDomainRequest(t, handler, http.MethodPost, "/admin/domains/9/aliases", `{"mailboxId":"0x2","aliasLocalPart":"  SALES  "}`)
	if response.Code != http.StatusOK || store.aliasCreateInput.MailboxID != 2 || store.aliasCreateInput.AliasLocalPart != "sales" {
		t.Fatalf("coerced alias response = %d %s, input %#v", response.Code, response.Body.String(), store.aliasCreateInput)
	}
}

func TestDomainListCoercesPaginationLikeTheFastifySchema(t *testing.T) {
	store := newFakeDomainManagementStore()
	handler := registeredDomainManagementHandler(domainManagementTestServer(store))

	response := serveAuthenticatedDomainRequest(t, handler, http.MethodGet, "/admin/domains?page=1.0&pageSize=2e1", "")
	if response.Code != http.StatusOK || store.listInput.Page != 1 || store.listInput.PageSize != 20 {
		t.Fatalf("coerced pagination response = %d %s, input %#v", response.Code, response.Body.String(), store.listInput)
	}
	response = serveAuthenticatedDomainRequest(t, handler, http.MethodGet, "/admin/domains?page=", "")
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), `"code":"VALIDATION_ERROR"`) {
		t.Fatalf("empty pagination response = %d %s", response.Code, response.Body.String())
	}
	response = serveAuthenticatedDomainRequest(t, handler, http.MethodGet, "/admin/domains?page=1000001", "")
	if response.Code != http.StatusOK || store.listInput.Page != 1_000_001 {
		t.Fatalf("unbounded pagination response = %d %s, input %#v", response.Code, response.Body.String(), store.listInput)
	}
}

func TestDomainStoreNormalizesBlankGeneratedSecrets(t *testing.T) {
	blank := "   "
	token, err := resolveDomainVerificationToken(&blank)
	if err != nil || len(token) != 24 || strings.TrimSpace(token) == "" {
		t.Fatalf("generated verification token = %q, %v", token, err)
	}
	provided := "  verification-token  "
	token, err = resolveDomainVerificationToken(&provided)
	if err != nil || token != "verification-token" {
		t.Fatalf("provided verification token = %q, %v", token, err)
	}
}

func TestDomainManagementMapsStoreErrorsWithoutLeakingCauses(t *testing.T) {
	store := newFakeDomainManagementStore()
	store.storeErr = managementConflict("DOMAIN_EXISTS", io.ErrUnexpectedEOF)
	handler := registeredDomainManagementHandler(domainManagementTestServer(store))
	response := serveAuthenticatedDomainRequest(t, handler, http.MethodPost, "/admin/domains", `{"name":"example.com"}`)
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), `"code":"DOMAIN_EXISTS"`) || strings.Contains(response.Body.String(), "unexpected EOF") {
		t.Fatalf("conflict response = %d %s", response.Code, response.Body.String())
	}
}

func domainManagementTestServer(store Store) *Server {
	server := testServer(store)
	server.cfg.EncryptionKey = "test-encryption-key-1234567890ab"
	server.cfg.ProviderTimeout = 5 * time.Second
	return server
}

func registeredDomainManagementHandler(server *Server) http.Handler {
	mux := http.NewServeMux()
	server.registerDomainManagementRoutes(mux)
	mux.HandleFunc("/", server.notFound)
	return server.withRequestMetadata(mux)
}

func serveAuthenticatedDomainRequest(t *testing.T, handler http.Handler, method, target, body string) *httptest.ResponseRecorder {
	t.Helper()
	request := authenticatedRequest(t, method, target, adminJWTAudience)
	if body != "" {
		request.Body = io.NopCloser(strings.NewReader(body))
		request.ContentLength = int64(len(body))
		request.Header.Set("Content-Type", "application/json")
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}
