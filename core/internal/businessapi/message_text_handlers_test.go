package businessapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestExtractMessageTextPreservesExternalAndDomainCompatibility(t *testing.T) {
	content := "Your verification code is 483921."
	captured, err := extractMessageText(content, `code is (\d{6})`, true)
	if err != nil || captured != "483921" {
		t.Fatalf("external capture = %q, err=%v", captured, err)
	}
	matched, err := extractMessageText(content, `code is (\d{6})`, false)
	if err != nil || matched != "code is 483921" {
		t.Fatalf("domain match = %q, err=%v", matched, err)
	}
	emptyCapture, err := extractMessageText("abc", `()abc`, true)
	if err != nil || emptyCapture != "abc" {
		t.Fatalf("empty capture fallback = %q, err=%v", emptyCapture, err)
	}
	if _, err := extractMessageText(content, `[`, true); err == nil {
		t.Fatal("invalid expression was accepted")
	}
	if _, err := extractMessageText(content, `missing`, true); err != errMessageTextNoMatch {
		t.Fatalf("no-match error = %v", err)
	}
	lookbehind, err := extractMessageText("Code: 483921", `(?<=Code: )\d{6}`, true)
	if err != nil || lookbehind != "483921" {
		t.Fatalf("ECMAScript lookbehind = %q, err=%v", lookbehind, err)
	}
	backreference, err := extractMessageText("token-token", `^(\w+)-\1$`, false)
	if err != nil || backreference != "token-token" {
		t.Fatalf("ECMAScript backreference = %q, err=%v", backreference, err)
	}
	if _, err := extractMessageText("x", strings.Repeat("a", messageTextPatternMaxBytes+1), true); err != errMessageTextPatternTooLong {
		t.Fatalf("oversized pattern error = %v", err)
	}
}

func TestDomainMessageTextRoutesReturnPlainTextAndAuditOutcomes(t *testing.T) {
	apiKeys := &fakeAPIKeyStore{principal: APIKeyPrincipal{
		ID: 12, Name: "external", Status: "ACTIVE", RateLimit: 60,
		Permissions: map[string]bool{actionDomainReadMessageText: true},
	}}
	domains := &fakeDomainMailboxStore{messages: DomainMessageList{
		Email:    "pool@example.org",
		Messages: []DomainMessage{{ID: "99", HTML: "<p>Code: <strong>483921</strong></p>"}},
	}}
	server := testBusinessServer(apiKeys, domains, &fakeRateLimiter{count: 1})

	request := httptest.NewRequest(http.MethodGet, `/api/domain-mail/mail_text?email=pool@example.org&match=483921`, nil)
	request.Header.Set("X-API-Key", "sk_external")
	request.Header.Set("X-Request-Id", "domain-text")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || response.Body.String() != "483921" {
		t.Fatalf("match response = %d %q", response.Code, response.Body.String())
	}
	if contentType := response.Header().Get("Content-Type"); !strings.HasPrefix(contentType, "text/plain") {
		t.Fatalf("content type = %q", contentType)
	}
	if domains.email != "pool@example.org" || domains.limit != 1 {
		t.Fatalf("domain input = email %q limit %d", domains.email, domains.limit)
	}
	if len(apiKeys.logged) != 1 || apiKeys.logged[0].action != actionDomainReadMessageText || apiKeys.logged[0].responseCode != http.StatusOK {
		t.Fatalf("API logs = %#v", apiKeys.logged)
	}

	domains.messages.Messages = nil
	request = httptest.NewRequest(http.MethodPost, `/api/domain-mail/messages/text`, strings.NewReader(`{"email":"pool@example.org"}`))
	request.Header.Set("X-API-Key", "sk_external")
	request.Header.Set("Content-Type", "application/json")
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusNotFound || response.Body.String() != "Error: No messages found" {
		t.Fatalf("empty response = %d %q", response.Code, response.Body.String())
	}
}

func TestMessageTextPermissionDenialIsScriptFriendly(t *testing.T) {
	apiKeys := &fakeAPIKeyStore{principal: APIKeyPrincipal{
		ID: 12, Name: "external", Status: "ACTIVE", RateLimit: 60,
		Permissions: map[string]bool{actionDomainReadMessageText: false},
	}}
	server := testBusinessServer(apiKeys, &fakeDomainMailboxStore{}, &fakeRateLimiter{count: 1})
	request := httptest.NewRequest(http.MethodGet, `/api/domain-mail/mail_text?email=pool@example.org`, nil)
	request.Header.Set("X-API-Key", "sk_external")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusForbidden || response.Body.String() != "Error: API Key has no permission for action: domain_read_message_text" {
		t.Fatalf("permission response = %d %q", response.Code, response.Body.String())
	}
	if len(apiKeys.logged) != 1 || apiKeys.logged[0].responseCode != http.StatusForbidden {
		t.Fatalf("API logs = %#v", apiKeys.logged)
	}
}
