package businessapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type fakeMailboxPortalStore struct {
	mailboxes     []map[string]any
	messages      MailboxPortalMessageList
	detail        map[string]any
	err           error
	mailboxCalls  int
	messageCalls  int
	detailCalls   int
	mailboxUserID int64
	messageInput  MailboxPortalMessageListInput
	detailID      int64
	detailUserID  int64
}

func (s *fakeMailboxPortalStore) ListMailboxPortalMailboxes(_ context.Context, mailboxUserID int64) ([]map[string]any, error) {
	s.mailboxCalls++
	s.mailboxUserID = mailboxUserID
	return s.mailboxes, s.err
}

func (s *fakeMailboxPortalStore) ListMailboxPortalMessages(_ context.Context, input MailboxPortalMessageListInput) (MailboxPortalMessageList, error) {
	s.messageCalls++
	s.messageInput = input
	return s.messages, s.err
}

func (s *fakeMailboxPortalStore) GetMailboxPortalMessage(_ context.Context, id, mailboxUserID int64) (map[string]any, error) {
	s.detailCalls++
	s.detailID = id
	s.detailUserID = mailboxUserID
	return s.detail, s.err
}

func TestMailboxPortalReadRoutesAreRegisteredThroughServerHandler(t *testing.T) {
	server := testServer(&fakeStore{})
	for _, target := range []string{
		"/mail/api/mailboxes",
		"/mail/api/messages",
		"/mail/api/messages/42",
	} {
		t.Run(target, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, target, nil)
			response := httptest.NewRecorder()
			server.Handler().ServeHTTP(response, request)
			if response.Code != http.StatusUnauthorized {
				t.Fatalf("response = %d %s, want status %d", response.Code, response.Body.String(), http.StatusUnauthorized)
			}
		})
	}
}

func TestMailboxPortalReadRoutesDenyForcedPasswordSessions(t *testing.T) {
	identity := MailboxIdentity{
		ID: 17, Username: "portal-user", Status: "ACTIVE", MustChangePassword: true,
		SessionVersion: 1, MailboxIDs: []int64{11, 12},
	}
	portalStore := &fakeMailboxPortalStore{}
	server := mailboxPortalTestServer(identity, portalStore)
	token := authMailboxToken(t, identity, identity.MailboxIDs, server.now())
	for _, target := range []string{
		"/mail/api/mailboxes",
		"/mail/api/messages",
		"/mail/api/messages/42",
	} {
		request := mailboxJSONRequest(http.MethodGet, target, "", token)
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), `"code":"PASSWORD_CHANGE_REQUIRED"`) {
			t.Fatalf("forced-password response for %s = %d %s", target, response.Code, response.Body.String())
		}
	}
	if portalStore.mailboxCalls != 0 || portalStore.messageCalls != 0 || portalStore.detailCalls != 0 {
		t.Fatalf("forced-password requests reached portal store: %#v", portalStore)
	}
}

func TestMailboxPortalMailboxListUsesDatabaseIdentityAndPreservesProtocolShape(t *testing.T) {
	identity := MailboxIdentity{
		ID: 17, Username: "portal-user", Status: "ACTIVE", SessionVersion: 3,
		MailboxIDs: []int64{11, 12},
	}
	mailbox := map[string]any{
		"id": 11, "domainId": 2, "localPart": "inbox", "address": "inbox@example.test",
		"displayName": nil, "status": "ACTIVE", "provisioningMode": "MANUAL", "canLogin": true,
		"isCatchAllTarget": false, "forwardMode": "DISABLED", "forwardTo": nil,
		"domain":    map[string]any{"id": 2, "name": "example.test", "canSend": true, "canReceive": true},
		"sendReady": true,
	}
	for key, value := range hostedInternalProtocolSummary("MANUAL", true, true) {
		mailbox[key] = value
	}
	portalStore := &fakeMailboxPortalStore{mailboxes: []map[string]any{mailbox}}
	server := mailboxPortalTestServer(identity, portalStore)
	token := authMailboxToken(t, identity, []int64{999}, server.now())
	request := mailboxJSONRequest(http.MethodGet, "/mail/api/mailboxes", "", token)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusOK || portalStore.mailboxUserID != 17 {
		t.Fatalf("mailbox response = %d %s; user=%d", response.Code, response.Body.String(), portalStore.mailboxUserID)
	}
	for _, expected := range []string{
		`"data":[{"address":"inbox@example.test"`, `"sendReady":true`,
		`"providerProfile":"hosted-internal-manual"`, `"representativeProtocol":"hosted_internal"`,
		`"capabilitySummary":{"aliasSupport":false`, `"receiveMail":true`,
	} {
		if !strings.Contains(response.Body.String(), expected) {
			t.Fatalf("mailbox response missing %s: %s", expected, response.Body.String())
		}
	}
	if strings.Contains(response.Body.String(), "999") {
		t.Fatalf("mailbox response trusted forged JWT scope: %s", response.Body.String())
	}
}

func TestMailboxPortalMessageListPreservesFiltersPaginationAndProjection(t *testing.T) {
	identity := MailboxIdentity{
		ID: 17, Username: "portal-user", Status: "ACTIVE", SessionVersion: 3,
		MailboxIDs: []int64{11, 12},
	}
	message := map[string]any{
		"id": "9223372036854775806", "matchedAddress": "inbox@example.test", "finalAddress": "inbox@example.test",
		"fromAddress": "sender@example.net", "toAddress": "inbox@example.test", "subject": nil,
		"textPreview": "hello", "htmlPreview": nil, "verificationCode": "123456", "routeKind": "EXACT_MAILBOX",
		"receivedAt": "2026-08-01T12:00:00.000Z", "storageStatus": "STORED", "isRead": false,
		"domain":  map[string]any{"id": 2, "name": "example.test", "canSend": true, "canReceive": true},
		"mailbox": portalMessageMailboxFixture(11, "inbox@example.test", "MANUAL", true, true),
	}
	portalStore := &fakeMailboxPortalStore{messages: MailboxPortalMessageList{
		List: []map[string]any{message}, Total: 21, Page: 2, PageSize: 10,
	}}
	server := mailboxPortalTestServer(identity, portalStore)
	token := authMailboxToken(t, identity, []int64{999}, server.now())
	request := mailboxJSONRequest(http.MethodGet, "/mail/api/messages?mailboxId=11&page=2&pageSize=10&unreadOnly=true", "", token)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("message list response = %d %s", response.Code, response.Body.String())
	}
	input := portalStore.messageInput
	if input.Page != 2 || input.PageSize != 10 || input.MailboxID == nil || *input.MailboxID != 11 || !input.UnreadOnly ||
		input.MailboxUserID != 17 {
		t.Fatalf("message list input = %#v", input)
	}
	for _, expected := range []string{
		`"id":"9223372036854775806"`, `"receivedAt":"2026-08-01T12:00:00.000Z"`,
		`"subject":null`, `"providerProfile":"hosted-internal-manual"`, `"total":21`, `"pageSize":10`,
	} {
		if !strings.Contains(response.Body.String(), expected) {
			t.Fatalf("message list response missing %s: %s", expected, response.Body.String())
		}
	}

	request = mailboxJSONRequest(http.MethodGet, "/mail/api/messages?mailboxId=999", "", token)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), `"code":"FORBIDDEN_MAILBOX"`) || portalStore.messageCalls != 1 {
		t.Fatalf("forbidden mailbox response = %d %s; calls=%d", response.Code, response.Body.String(), portalStore.messageCalls)
	}

	for _, target := range []string{
		"/mail/api/messages?page=0",
		"/mail/api/messages?pageSize=101",
		"/mail/api/messages?mailboxId=0",
		"/mail/api/messages?unreadOnly=not-a-boolean",
	} {
		request = mailboxJSONRequest(http.MethodGet, target, "", token)
		response = httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("validation response for %s = %d %s", target, response.Code, response.Body.String())
		}
	}
}

func TestMailboxPortalMessageDetailUsesScopedAtomicStoreResult(t *testing.T) {
	identity := MailboxIdentity{
		ID: 17, Username: "portal-user", Status: "ACTIVE", SessionVersion: 3,
		MailboxIDs: []int64{11, 12},
	}
	detail := map[string]any{
		"id": "9223372036854775806", "domainId": 2, "mailboxId": 11,
		"matchedAddress": "inbox@example.test", "finalAddress": "inbox@example.test", "messageIdHeader": nil,
		"fromAddress": "sender@example.net", "toAddress": "inbox@example.test", "subject": "Subject",
		"textPreview": "hello", "htmlPreview": nil, "verificationCode": nil, "routeKind": "EXACT_MAILBOX",
		"receivedAt": "2026-08-01T12:00:00.000Z", "storageStatus": "STORED", "rawObjectKey": nil,
		"attachmentsMeta": []any{map[string]any{"name": "note.txt"}}, "headersJson": map[string]any{"x-test": "yes"},
		"isRead": true, "isDeleted": false, "portalState": "VISIBLE",
		"createdAt": "2026-08-01T12:00:01.000Z", "updatedAt": "2026-08-01T12:00:02.000Z",
		"domain":  map[string]any{"id": 2, "name": "example.test", "canSend": true, "canReceive": true},
		"mailbox": portalMessageMailboxFixture(11, "inbox@example.test", "MANUAL", true, true),
	}
	portalStore := &fakeMailboxPortalStore{detail: detail}
	server := mailboxPortalTestServer(identity, portalStore)
	token := authMailboxToken(t, identity, []int64{999}, server.now())
	request := mailboxJSONRequest(http.MethodGet, "/mail/api/messages/9223372036854775806", "", token)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusOK || portalStore.detailID != 9223372036854775806 ||
		portalStore.detailUserID != 17 {
		t.Fatalf("detail response = %d %s; id=%d user=%d", response.Code, response.Body.String(), portalStore.detailID, portalStore.detailUserID)
	}
	for _, expected := range []string{
		`"id":"9223372036854775806"`, `"isRead":true`, `"messageIdHeader":null`,
		`"attachmentsMeta":[{"name":"note.txt"}]`, `"headersJson":{"x-test":"yes"}`,
	} {
		if !strings.Contains(response.Body.String(), expected) {
			t.Fatalf("detail response missing %s: %s", expected, response.Body.String())
		}
	}

	portalStore.err = errNotFound
	request = mailboxJSONRequest(http.MethodGet, "/mail/api/messages/42", "", token)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusNotFound || !strings.Contains(response.Body.String(), `"code":"INBOUND_MESSAGE_NOT_FOUND"`) {
		t.Fatalf("scoped not-found response = %d %s", response.Code, response.Body.String())
	}

	detailCalls := portalStore.detailCalls
	request = mailboxJSONRequest(http.MethodGet, "/mail/api/messages/not-a-number", "", token)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), `"code":"INBOUND_MESSAGE_INVALID_ID"`) || portalStore.detailCalls != detailCalls {
		t.Fatalf("invalid detail id response = %d %s; calls=%d", response.Code, response.Body.String(), portalStore.detailCalls)
	}
}

func mailboxPortalTestServer(identity MailboxIdentity, portalStore *fakeMailboxPortalStore) *Server {
	authStore := &fakeMailboxAuthenticationStore{record: identity}
	server := mailboxAuthTestServer(authStore, &fakeLoginProtectionStore{counts: make(map[string]int64), ttls: make(map[string]time.Duration)})
	server.mailboxPortalStore = portalStore
	return server
}

func portalMessageMailboxFixture(id int64, address, mode string, canSend, canReceive bool) map[string]any {
	mailbox := map[string]any{"id": id, "address": address, "provisioningMode": mode}
	for key, value := range hostedInternalProtocolSummary(mode, canSend, canReceive) {
		mailbox[key] = value
	}
	return mailbox
}
