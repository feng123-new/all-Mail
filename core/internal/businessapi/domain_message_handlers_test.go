package businessapi

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

type fakeAdminDomainMessageStore struct {
	*fakeStore
	listInput    adminDomainMessageListInput
	listResult   adminDomainMessageListResult
	detailID     int64
	detailResult map[string]any
	deletedIDs   []int64
	deleteResult adminDomainMessageDeleteResult
	storeErr     error
}

func newFakeAdminDomainMessageStore() *fakeAdminDomainMessageStore {
	return &fakeAdminDomainMessageStore{
		fakeStore: &fakeStore{admin: Admin{ID: 7, Username: "admin", Role: "SUPER_ADMIN", Status: "ACTIVE"}},
		listResult: adminDomainMessageListResult{
			List: []map[string]any{}, Page: 1, PageSize: 20,
		},
	}
}

func (s *fakeAdminDomainMessageStore) ListAdminDomainMessages(_ context.Context, input adminDomainMessageListInput) (adminDomainMessageListResult, error) {
	s.listInput = input
	return s.listResult, s.storeErr
}

func (s *fakeAdminDomainMessageStore) GetAdminDomainMessage(_ context.Context, id int64) (map[string]any, error) {
	s.detailID = id
	return s.detailResult, s.storeErr
}

func (s *fakeAdminDomainMessageStore) DeleteAdminDomainMessages(_ context.Context, ids []int64) (adminDomainMessageDeleteResult, error) {
	s.deletedIDs = append([]int64(nil), ids...)
	return s.deleteResult, s.storeErr
}

func TestDomainMessageRoutesRegisterCompleteFastifyFamily(t *testing.T) {
	handler := registeredDomainMessageHandler(testServer(newFakeAdminDomainMessageStore()))
	for _, route := range []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/admin/domain-messages"},
		{http.MethodGet, "/admin/domain-messages/42"},
		{http.MethodDelete, "/admin/domain-messages/42"},
		{http.MethodPost, "/admin/domain-messages/batch-delete"},
	} {
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

func TestAdminDomainMessageListPreservesFiltersVisibilityAndPagination(t *testing.T) {
	store := newFakeAdminDomainMessageStore()
	store.listResult = adminDomainMessageListResult{
		List: []map[string]any{{
			"id": "91", "isRead": false, "portalState": "FORWARDED_HIDDEN",
		}},
		Total: 1, Page: 2, PageSize: 20,
	}
	handler := registeredDomainMessageHandler(testServer(store))
	response := serveAuthenticatedDomainMessageRequest(
		t,
		handler,
		http.MethodGet,
		"/admin/domain-messages?page=2.0&pageSize=2e1&domainId=7&mailboxId=8&unreadOnly=true",
		"",
	)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"portalState":"FORWARDED_HIDDEN"`) {
		t.Fatalf("list response = %d %s", response.Code, response.Body.String())
	}
	if store.listInput.Page != 2 || store.listInput.PageSize != 20 || !store.listInput.UnreadOnly ||
		store.listInput.DomainID == nil || *store.listInput.DomainID != 7 ||
		store.listInput.MailboxID == nil || *store.listInput.MailboxID != 8 {
		t.Fatalf("list input = %#v", store.listInput)
	}

	for _, target := range []string{
		"/admin/domain-messages?page=",
		"/admin/domain-messages?pageSize=101",
		"/admin/domain-messages?domainId=0",
		"/admin/domain-messages?mailboxId=nope",
		"/admin/domain-messages?unreadOnly=nope",
	} {
		response = serveAuthenticatedDomainMessageRequest(t, handler, http.MethodGet, target, "")
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), `"code":"VALIDATION_ERROR"`) {
			t.Fatalf("validation response for %s = %d %s", target, response.Code, response.Body.String())
		}
	}
}

func TestAdminDomainMessageDetailAndSoftDeletionCompatibility(t *testing.T) {
	store := newFakeAdminDomainMessageStore()
	store.detailResult = map[string]any{
		"id": "42", "isRead": false, "isDeleted": true, "portalState": "FORWARDED_HIDDEN",
	}
	store.deleteResult = adminDomainMessageDeleteResult{Deleted: 2, IDs: []string{"42", "2", "-3"}}
	handler := registeredDomainMessageHandler(testServer(store))

	response := serveAuthenticatedDomainMessageRequest(t, handler, http.MethodGet, "/admin/domain-messages/42", "")
	if response.Code != http.StatusOK || store.detailID != 42 ||
		!strings.Contains(response.Body.String(), `"isRead":false`) ||
		!strings.Contains(response.Body.String(), `"isDeleted":true`) ||
		!strings.Contains(response.Body.String(), `"portalState":"FORWARDED_HIDDEN"`) {
		t.Fatalf("detail response = %d %s, id=%d", response.Code, response.Body.String(), store.detailID)
	}
	if len(store.deletedIDs) != 0 {
		t.Fatalf("detail changed read/deletion state: %#v", store.deletedIDs)
	}

	response = serveAuthenticatedDomainMessageRequest(
		t,
		handler,
		http.MethodPost,
		"/admin/domain-messages/batch-delete",
		`{"ids":[" 42 ",42,"0x2","-3"]}`,
	)
	if response.Code != http.StatusOK || fmt.Sprint(store.deletedIDs) != "[42 2 -3]" ||
		!strings.Contains(response.Body.String(), `"deleted":2`) ||
		!strings.Contains(response.Body.String(), `"ids":["42","2","-3"]`) {
		t.Fatalf("batch delete response = %d %s, ids=%v", response.Code, response.Body.String(), store.deletedIDs)
	}

	store.deleteResult = adminDomainMessageDeleteResult{Deleted: 0, IDs: []string{"0"}}
	response = serveAuthenticatedDomainMessageRequest(t, handler, http.MethodDelete, "/admin/domain-messages/0", "")
	if response.Code != http.StatusOK || fmt.Sprint(store.deletedIDs) != "[0]" || !strings.Contains(response.Body.String(), `"ids":["0"]`) {
		t.Fatalf("zero-id delete compatibility = %d %s, ids=%v", response.Code, response.Body.String(), store.deletedIDs)
	}

	response = serveAuthenticatedDomainMessageRequest(t, handler, http.MethodDelete, "/admin/domain-messages/not-an-id", "")
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), `"code":"INBOUND_MESSAGE_INVALID_ID"`) {
		t.Fatalf("invalid-id response = %d %s", response.Code, response.Body.String())
	}
	for _, body := range []string{`{}`, `{"ids":[]}`, `{"ids":[0]}`, `{"ids":["bad"]}`} {
		response = serveAuthenticatedDomainMessageRequest(t, handler, http.MethodPost, "/admin/domain-messages/batch-delete", body)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("batch validation for %s = %d %s", body, response.Code, response.Body.String())
		}
	}
}

type fakeDomainMessageTextStore struct {
	*fakeDomainMailboxStore
	content       string
	found         bool
	storeErr      error
	apiKeyID      int64
	email         string
	maxCharacters int
}

func (s *fakeDomainMessageTextStore) GetLatestDomainMessageText(_ context.Context, apiKeyID int64, email string, maxCharacters int) (string, bool, error) {
	s.apiKeyID = apiKeyID
	s.email = email
	s.maxCharacters = maxCharacters
	return s.content, s.found, s.storeErr
}

func TestDomainMessageTextRoutesRegisterBothAllMethodAliases(t *testing.T) {
	server, _ := domainMessageTextTestServer("", false, map[string]bool{"all": true})
	handler := registeredDomainMessageTextHandler(server)
	for _, route := range []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/domain-mail/messages/text?email=pool@example.org"},
		{http.MethodPut, "/api/domain-mail/messages/text"},
		{http.MethodGet, "/api/domain-mail/mail_text?email=pool@example.org"},
		{http.MethodDelete, "/api/domain-mail/mail_text"},
	} {
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

func TestDomainMessageTextReturnsFullMatchForGETAndBodyForOtherMethods(t *testing.T) {
	server, store := domainMessageTextTestServer("prefix code=123456 suffix", true, map[string]bool{actionDomainReadMessageText: true})
	handler := registeredDomainMessageTextHandler(server)
	target := "/api/domain-mail/messages/text?email=" + url.QueryEscape(" Pool@Example.ORG ") + "&match=" + url.QueryEscape(` code=(\d+) `)
	response := serveDomainMessageTextRequest(handler, http.MethodGet, target, "")
	if response.Code != http.StatusOK || response.Body.String() != "code=123456" ||
		response.Header().Get("Content-Type") != "text/plain; charset=utf-8" {
		t.Fatalf("GET text response = %d %q (%s)", response.Code, response.Body.String(), response.Header().Get("Content-Type"))
	}
	if store.apiKeyID != 12 || store.email != "Pool@Example.ORG" || store.maxCharacters != maxDomainMessageTextCharacters {
		t.Fatalf("text store input = key=%d email=%q max=%d", store.apiKeyID, store.email, store.maxCharacters)
	}

	store.content = "<p>html fallback</p>"
	response = serveDomainMessageTextRequest(
		handler,
		http.MethodPatch,
		"/api/domain-mail/mail_text",
		`{"email":" pool@example.org ","match":""}`,
	)
	if response.Code != http.StatusOK || response.Body.String() != "<p>html fallback</p>" || store.email != "pool@example.org" {
		t.Fatalf("body text response = %d %q, email=%q", response.Code, response.Body.String(), store.email)
	}
}

func TestDomainMessageTextSupportsJavaScriptLookbehind(t *testing.T) {
	server, _ := domainMessageTextTestServer("prefix code=123456 suffix", true, map[string]bool{actionDomainReadMessageText: true})
	target := "/api/domain-mail/messages/text?email=pool@example.org&match=" + url.QueryEscape(`(?<=code=)\d{6}`)
	response := serveDomainMessageTextRequest(registeredDomainMessageTextHandler(server), http.MethodGet, target, "")
	if response.Code != http.StatusOK || response.Body.String() != "123456" {
		t.Fatalf("lookbehind response = %d %q", response.Code, response.Body.String())
	}
}

func TestDomainMessageTextPreservesPlainTextErrorsAndBoundsRegexSurface(t *testing.T) {
	server, store := domainMessageTextTestServer("verification 654321", true, map[string]bool{actionDomainReadMessageText: true})
	handler := registeredDomainMessageTextHandler(server)

	testCases := []struct {
		name       string
		found      bool
		match      string
		wantStatus int
		wantBody   string
	}{
		{name: "no messages", found: false, wantStatus: http.StatusNotFound, wantBody: "Error: No messages found"},
		{name: "no match", found: true, match: "missing", wantStatus: http.StatusNotFound, wantBody: "Error: No match found"},
		{name: "invalid regular expression", found: true, match: "(", wantStatus: http.StatusBadRequest, wantBody: "Error: Invalid regular expression supplied in match"},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			store.found = testCase.found
			target := "/api/domain-mail/messages/text?email=pool@example.org"
			if testCase.match != "" {
				target += "&match=" + url.QueryEscape(testCase.match)
			}
			response := serveDomainMessageTextRequest(handler, http.MethodGet, target, "")
			if response.Code != testCase.wantStatus || response.Body.String() != testCase.wantBody ||
				response.Header().Get("Content-Type") != "text/plain; charset=utf-8" {
				t.Fatalf("response = %d %q (%s)", response.Code, response.Body.String(), response.Header().Get("Content-Type"))
			}
		})
	}

	store.found = true
	tooLongPattern := strings.Repeat("a", maxDomainMessageTextPatternBytes+1)
	response := serveDomainMessageTextRequest(
		handler,
		http.MethodPost,
		"/api/domain-mail/mail_text",
		`{"email":"pool@example.org","match":"`+tooLongPattern+`"}`,
	)
	if response.Code != http.StatusBadRequest || response.Body.String() != "Error: Invalid regular expression supplied in match" {
		t.Fatalf("bounded pattern response = %d %q", response.Code, response.Body.String())
	}

	store.content = strings.Repeat("x", maxDomainMessageTextOutputBytes+32)
	response = serveDomainMessageTextRequest(handler, http.MethodGet, "/api/domain-mail/messages/text?email=pool@example.org", "")
	if response.Code != http.StatusOK || response.Body.Len() != maxDomainMessageTextOutputBytes {
		t.Fatalf("bounded output response = %d, bytes=%d", response.Code, response.Body.Len())
	}

	server, _ = domainMessageTextTestServer("content", true, map[string]bool{actionDomainReadMessageText: false})
	response = serveDomainMessageTextRequest(
		registeredDomainMessageTextHandler(server),
		http.MethodGet,
		"/api/domain-mail/messages/text?email=pool@example.org",
		"",
	)
	if response.Code != http.StatusForbidden || response.Body.String() != "Error: API Key has no permission for action: domain_read_message_text" {
		t.Fatalf("permission response = %d %q", response.Code, response.Body.String())
	}
}

func TestDomainMessageTextRegistrarServesLoopbackHTTP(t *testing.T) {
	server, _ := domainMessageTextTestServer("loopback code=482913", true, map[string]bool{actionDomainReadMessageText: true})
	loopback := httptest.NewServer(registeredDomainMessageTextHandler(server))
	defer loopback.Close()

	request, err := http.NewRequest(
		http.MethodGet,
		loopback.URL+"/api/domain-mail/messages/text?email=pool@example.org&match=%28%3F%3C%3Dcode%3D%29%5Cd%2B",
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("X-API-Key", "sk_external")
	response, err := loopback.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, maxDomainMessageTextOutputBytes+1))
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK || string(body) != "482913" ||
		response.Header.Get("Content-Type") != "text/plain; charset=utf-8" {
		t.Fatalf("loopback response = %d %q (%s)", response.StatusCode, string(body), response.Header.Get("Content-Type"))
	}
}

func registeredDomainMessageHandler(server *Server) http.Handler {
	mux := http.NewServeMux()
	server.registerDomainMessageRoutes(mux)
	mux.HandleFunc("/", server.notFound)
	return server.withRequestMetadata(mux)
}

func serveAuthenticatedDomainMessageRequest(t *testing.T, handler http.Handler, method, target, body string) *httptest.ResponseRecorder {
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

func domainMessageTextTestServer(content string, found bool, permissions map[string]bool) (*Server, *fakeDomainMessageTextStore) {
	apiKeys := &fakeAPIKeyStore{
		principal: APIKeyPrincipal{ID: 12, Name: "external", Status: "ACTIVE", RateLimit: 60, Permissions: permissions},
	}
	domains := &fakeDomainMessageTextStore{
		fakeDomainMailboxStore: &fakeDomainMailboxStore{},
		content:                content,
		found:                  found,
	}
	return testBusinessServer(apiKeys, domains, &fakeRateLimiter{count: 1}), domains
}

func registeredDomainMessageTextHandler(server *Server) http.Handler {
	mux := http.NewServeMux()
	server.registerDomainMessageTextRoutes(mux)
	mux.HandleFunc("/", server.notFound)
	return server.withRequestMetadata(mux)
}

func serveDomainMessageTextRequest(handler http.Handler, method, target, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	request.Header.Set("X-API-Key", "sk_external")
	request.Header.Set("X-Request-Id", "domain-message-text-test")
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}
