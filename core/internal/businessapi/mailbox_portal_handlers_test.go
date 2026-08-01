package businessapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	mailprovider "github.com/feng123-new/all-Mail/core/internal/provider"
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

	sentMessages         map[string]any
	forwardingJobs       map[string]any
	sentDetail           map[string]any
	forwardingResult     map[string]any
	sendConfig           resendSendConfig
	sendResult           map[string]any
	sentErr              error
	forwardingJobsErr    error
	sentDetailErr        error
	forwardingErr        error
	sendConfigErr        error
	pendingErr           error
	completeErr          error
	sentCalls            int
	forwardingJobCalls   int
	sentDetailCalls      int
	forwardingCalls      int
	sendConfigCalls      int
	pendingCalls         int
	completeCalls        int
	sentUserID           int64
	sentMailboxID        int64
	sentPage             int
	sentPageSize         int
	forwardingUserID     int64
	forwardingMailboxID  *int64
	forwardingPage       int
	forwardingPageSize   int
	sentMessageID        int64
	sentDetailUserID     int64
	forwardingMode       string
	forwardingTo         *string
	sendUserID           int64
	sendMailboxID        int64
	sendEncryptionKey    string
	pendingID            int64
	pendingDomainID      int64
	pendingMailboxID     *int64
	pendingMailboxUserID *int64
	pendingFrom          string
	pendingTo            []string
	pendingSubject       string
	pendingHTML          string
	pendingText          string
	completedID          int64
	providerMessageID    string
	completedStatus      string
	completedLastError   string
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

func (s *fakeMailboxPortalStore) ListMailboxPortalSentMessages(
	_ context.Context,
	mailboxUserID, mailboxID int64,
	page, pageSize int,
) (map[string]any, error) {
	s.sentCalls++
	s.sentUserID = mailboxUserID
	s.sentMailboxID = mailboxID
	s.sentPage = page
	s.sentPageSize = pageSize
	return s.sentMessages, s.sentErr
}

func (s *fakeMailboxPortalStore) ListMailboxPortalForwardingJobs(
	_ context.Context,
	mailboxUserID int64,
	mailboxID *int64,
	page, pageSize int,
) (map[string]any, error) {
	s.forwardingJobCalls++
	s.forwardingUserID = mailboxUserID
	if mailboxID != nil {
		value := *mailboxID
		s.forwardingMailboxID = &value
	} else {
		s.forwardingMailboxID = nil
	}
	s.forwardingPage = page
	s.forwardingPageSize = pageSize
	return s.forwardingJobs, s.forwardingJobsErr
}

func (s *fakeMailboxPortalStore) GetMailboxPortalSentMessage(_ context.Context, id, mailboxUserID int64) (map[string]any, error) {
	s.sentDetailCalls++
	s.sentMessageID = id
	s.sentDetailUserID = mailboxUserID
	return s.sentDetail, s.sentDetailErr
}

func (s *fakeMailboxPortalStore) UpdateMailboxPortalForwarding(
	_ context.Context,
	mailboxUserID, mailboxID int64,
	mode string,
	forwardTo *string,
) (map[string]any, error) {
	s.forwardingCalls++
	s.forwardingUserID = mailboxUserID
	s.forwardingMailboxID = &mailboxID
	s.forwardingMode = mode
	if forwardTo != nil {
		value := *forwardTo
		s.forwardingTo = &value
	} else {
		s.forwardingTo = nil
	}
	return s.forwardingResult, s.forwardingErr
}

func (s *fakeMailboxPortalStore) loadMailboxPortalSendConfig(
	_ context.Context,
	mailboxUserID, mailboxID int64,
	encryptionKey string,
) (resendSendConfig, error) {
	s.sendConfigCalls++
	s.sendUserID = mailboxUserID
	s.sendMailboxID = mailboxID
	s.sendEncryptionKey = encryptionKey
	return s.sendConfig, s.sendConfigErr
}

func (s *fakeMailboxPortalStore) createPendingOutboundMessage(
	_ context.Context,
	domainID int64,
	mailboxID *int64,
	mailboxUserID *int64,
	from string,
	to []string,
	subject, html, text string,
) (int64, error) {
	s.pendingCalls++
	s.pendingDomainID = domainID
	s.pendingMailboxID = mailboxID
	s.pendingMailboxUserID = mailboxUserID
	s.pendingFrom = from
	s.pendingTo = append([]string(nil), to...)
	s.pendingSubject = subject
	s.pendingHTML = html
	s.pendingText = text
	return s.pendingID, s.pendingErr
}

func (s *fakeMailboxPortalStore) completeOutboundMessage(
	_ context.Context,
	id int64,
	providerMessageID, status, lastError string,
) (map[string]any, error) {
	s.completeCalls++
	s.completedID = id
	s.providerMessageID = providerMessageID
	s.completedStatus = status
	s.completedLastError = lastError
	return s.sendResult, s.completeErr
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

func TestMailboxPortalOperationRoutesAreRegisteredThroughServerHandler(t *testing.T) {
	server := testServer(&fakeStore{})
	testCases := []struct {
		method string
		target string
	}{
		{method: http.MethodGet, target: "/mail/api/sent-messages?mailboxId=11"},
		{method: http.MethodGet, target: "/mail/api/forwarding-jobs"},
		{method: http.MethodGet, target: "/mail/api/sent-messages/42"},
		{method: http.MethodPost, target: "/mail/api/send"},
		{method: http.MethodPost, target: "/mail/api/forwarding"},
	}
	for _, testCase := range testCases {
		t.Run(testCase.method+" "+testCase.target, func(t *testing.T) {
			request := httptest.NewRequest(testCase.method, testCase.target, nil)
			response := httptest.NewRecorder()
			server.Handler().ServeHTTP(response, request)
			if response.Code != http.StatusUnauthorized {
				t.Fatalf("response = %d %s, want status %d", response.Code, response.Body.String(), http.StatusUnauthorized)
			}
		})
	}
}

func TestMailboxPortalOperationRoutesDenyForcedPasswordSessions(t *testing.T) {
	identity := MailboxIdentity{
		ID: 17, Username: "portal-user", Status: "ACTIVE", MustChangePassword: true,
		SessionVersion: 1, MailboxIDs: []int64{11},
	}
	portalStore := &fakeMailboxPortalStore{}
	server := mailboxPortalTestServer(identity, portalStore)
	token := authMailboxToken(t, identity, identity.MailboxIDs, server.now())
	testCases := []struct {
		method string
		target string
		body   string
	}{
		{method: http.MethodGet, target: "/mail/api/sent-messages?mailboxId=11"},
		{method: http.MethodGet, target: "/mail/api/forwarding-jobs"},
		{method: http.MethodGet, target: "/mail/api/sent-messages/42"},
		{method: http.MethodPost, target: "/mail/api/send", body: `{}`},
		{method: http.MethodPost, target: "/mail/api/forwarding", body: `{}`},
	}
	for _, testCase := range testCases {
		request := mailboxJSONRequest(testCase.method, testCase.target, testCase.body, token)
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), `"code":"PASSWORD_CHANGE_REQUIRED"`) {
			t.Fatalf("forced-password response for %s %s = %d %s", testCase.method, testCase.target, response.Code, response.Body.String())
		}
	}
	if portalStore.sentCalls != 0 || portalStore.forwardingJobCalls != 0 || portalStore.sentDetailCalls != 0 ||
		portalStore.sendConfigCalls != 0 || portalStore.forwardingCalls != 0 {
		t.Fatalf("forced-password requests reached portal store: %#v", portalStore)
	}
}

func TestMailboxPortalSentHistoryUsesDatabaseMailboxScopeAndValidatesPagination(t *testing.T) {
	identity := MailboxIdentity{
		ID: 17, Username: "portal-user", Status: "ACTIVE", SessionVersion: 3,
		MailboxIDs: []int64{11},
	}
	portalStore := &fakeMailboxPortalStore{sentMessages: map[string]any{
		"list": []map[string]any{{
			"id": "9223372036854775806", "mailboxId": int64(11), "providerMessageId": "provider-1",
			"fromAddress": "inbox@example.test", "toAddresses": []string{"target@example.net"},
			"subject": "Subject", "status": "SENT", "lastError": nil,
			"createdAt": "2026-08-01T12:00:00.000Z", "updatedAt": "2026-08-01T12:00:01.000Z",
		}},
		"total": int64(21), "page": 2, "pageSize": 10,
	}}
	server := mailboxPortalTestServer(identity, portalStore)
	token := authMailboxToken(t, identity, []int64{999}, server.now())
	request := mailboxJSONRequest(http.MethodGet, "/mail/api/sent-messages?mailboxId=11&page=2&pageSize=10", "", token)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusOK || portalStore.sentCalls != 1 || portalStore.sentUserID != 17 ||
		portalStore.sentMailboxID != 11 || portalStore.sentPage != 2 || portalStore.sentPageSize != 10 {
		t.Fatalf("sent history response = %d %s; store=%#v", response.Code, response.Body.String(), portalStore)
	}
	for _, expected := range []string{
		`"id":"9223372036854775806"`, `"providerMessageId":"provider-1"`, `"total":21`, `"pageSize":10`,
	} {
		if !strings.Contains(response.Body.String(), expected) {
			t.Fatalf("sent history response missing %s: %s", expected, response.Body.String())
		}
	}

	request = mailboxJSONRequest(http.MethodGet, "/mail/api/sent-messages?mailboxId=999", "", token)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), `"code":"FORBIDDEN_MAILBOX"`) || portalStore.sentCalls != 1 {
		t.Fatalf("forbidden sent history response = %d %s; calls=%d", response.Code, response.Body.String(), portalStore.sentCalls)
	}

	for _, target := range []string{
		"/mail/api/sent-messages",
		"/mail/api/sent-messages?mailboxId=0",
		"/mail/api/sent-messages?mailboxId=11&page=0",
		"/mail/api/sent-messages?mailboxId=11&pageSize=101",
	} {
		request = mailboxJSONRequest(http.MethodGet, target, "", token)
		response = httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), `"code":"VALIDATION_ERROR"`) {
			t.Fatalf("sent history validation for %s = %d %s", target, response.Code, response.Body.String())
		}
	}
}

func TestMailboxPortalForwardingJobsUseCurrentMailboxScopeAndPortalDefaults(t *testing.T) {
	identity := MailboxIdentity{
		ID: 17, Username: "portal-user", Status: "ACTIVE", SessionVersion: 3,
		MailboxIDs: []int64{11, 12},
	}
	portalStore := &fakeMailboxPortalStore{forwardingJobs: map[string]any{
		"list": []map[string]any{{
			"id": "91", "status": "FAILED", "mode": "COPY", "forwardTo": "target@example.net",
			"attemptCount": 3, "lastError": "provider failed", "processedAt": nil,
			"createdAt": "2026-08-01T12:00:00.000Z", "nextAttemptAt": nil,
			"inboundMessage": map[string]any{
				"id": "42", "subject": "Subject", "fromAddress": "sender@example.net", "finalAddress": "inbox@example.test",
			},
		}},
		"total": int64(1), "page": 1, "pageSize": 5,
	}}
	server := mailboxPortalTestServer(identity, portalStore)
	token := authMailboxToken(t, identity, []int64{999}, server.now())
	request := mailboxJSONRequest(http.MethodGet, "/mail/api/forwarding-jobs", "", token)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusOK || portalStore.forwardingJobCalls != 1 || portalStore.forwardingUserID != 17 ||
		portalStore.forwardingMailboxID != nil || portalStore.forwardingPage != 1 || portalStore.forwardingPageSize != 5 {
		t.Fatalf("forwarding jobs response = %d %s; store=%#v", response.Code, response.Body.String(), portalStore)
	}
	for _, expected := range []string{`"id":"91"`, `"attemptCount":3`, `"inboundMessage":{"finalAddress":"inbox@example.test"`, `"pageSize":5`} {
		if !strings.Contains(response.Body.String(), expected) {
			t.Fatalf("forwarding jobs response missing %s: %s", expected, response.Body.String())
		}
	}

	request = mailboxJSONRequest(http.MethodGet, "/mail/api/forwarding-jobs?mailboxId=12&page=2&pageSize=20", "", token)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || portalStore.forwardingMailboxID == nil || *portalStore.forwardingMailboxID != 12 ||
		portalStore.forwardingPage != 2 || portalStore.forwardingPageSize != 20 {
		t.Fatalf("filtered forwarding jobs response = %d %s; store=%#v", response.Code, response.Body.String(), portalStore)
	}

	request = mailboxJSONRequest(http.MethodGet, "/mail/api/forwarding-jobs?mailboxId=999", "", token)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), `"code":"FORBIDDEN_MAILBOX"`) || portalStore.forwardingJobCalls != 2 {
		t.Fatalf("forbidden forwarding jobs response = %d %s; calls=%d", response.Code, response.Body.String(), portalStore.forwardingJobCalls)
	}

	for _, target := range []string{
		"/mail/api/forwarding-jobs?mailboxId=0",
		"/mail/api/forwarding-jobs?page=0",
		"/mail/api/forwarding-jobs?pageSize=21",
	} {
		request = mailboxJSONRequest(http.MethodGet, target, "", token)
		response = httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("forwarding jobs validation for %s = %d %s", target, response.Code, response.Body.String())
		}
	}
}

func TestMailboxPortalSentDetailIsStoreScopedAndPreservesBodies(t *testing.T) {
	identity := MailboxIdentity{
		ID: 17, Username: "portal-user", Status: "ACTIVE", SessionVersion: 3,
		MailboxIDs: []int64{11},
	}
	portalStore := &fakeMailboxPortalStore{sentDetail: map[string]any{
		"id": "9223372036854775806", "mailboxId": int64(11), "providerMessageId": "provider-1",
		"htmlBody": "<p>hello</p>", "textBody": "hello", "status": "SENT",
	}}
	server := mailboxPortalTestServer(identity, portalStore)
	token := authMailboxToken(t, identity, []int64{999}, server.now())
	request := mailboxJSONRequest(http.MethodGet, "/mail/api/sent-messages/9223372036854775806", "", token)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusOK || portalStore.sentMessageID != 9223372036854775806 || portalStore.sentDetailUserID != 17 {
		t.Fatalf("sent detail response = %d %s; store=%#v", response.Code, response.Body.String(), portalStore)
	}
	for _, expected := range []string{`"id":"9223372036854775806"`, `"textBody":"hello"`} {
		if !strings.Contains(response.Body.String(), expected) {
			t.Fatalf("sent detail response missing %s: %s", expected, response.Body.String())
		}
	}
	var detailEnvelope struct {
		Data struct {
			HTMLBody string `json:"htmlBody"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &detailEnvelope); err != nil || detailEnvelope.Data.HTMLBody != "<p>hello</p>" {
		t.Fatalf("sent detail HTML body = %q, %v", detailEnvelope.Data.HTMLBody, err)
	}

	portalStore.sentDetailErr = errNotFound
	request = mailboxJSONRequest(http.MethodGet, "/mail/api/sent-messages/42", "", token)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusNotFound || !strings.Contains(response.Body.String(), `"code":"OUTBOUND_MESSAGE_NOT_FOUND"`) {
		t.Fatalf("scoped sent detail response = %d %s", response.Code, response.Body.String())
	}

	detailCalls := portalStore.sentDetailCalls
	request = mailboxJSONRequest(http.MethodGet, "/mail/api/sent-messages/not-a-number", "", token)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), `"code":"OUTBOUND_MESSAGE_INVALID_ID"`) ||
		portalStore.sentDetailCalls != detailCalls {
		t.Fatalf("invalid sent detail response = %d %s; calls=%d", response.Code, response.Body.String(), portalStore.sentDetailCalls)
	}
}

func TestMailboxPortalForwardingUpdateValidatesAndClearsDisabledTargets(t *testing.T) {
	identity := MailboxIdentity{
		ID: 17, Username: "portal-user", Status: "ACTIVE", SessionVersion: 3,
		MailboxIDs: []int64{11},
	}
	portalStore := &fakeMailboxPortalStore{forwardingResult: map[string]any{
		"id": int64(11), "address": "inbox@example.test", "forwardMode": "COPY", "forwardTo": "target@example.net",
	}}
	server := mailboxPortalTestServer(identity, portalStore)
	token := authMailboxToken(t, identity, []int64{999}, server.now())
	request := mailboxJSONRequest(http.MethodPost, "/mail/api/forwarding", `{
		"mailboxId":11,"forwardMode":"COPY","forwardTo":" target@example.net "
	}`, token)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusOK || portalStore.forwardingCalls != 1 || portalStore.forwardingUserID != 17 ||
		portalStore.forwardingMailboxID == nil || *portalStore.forwardingMailboxID != 11 || portalStore.forwardingMode != "COPY" ||
		portalStore.forwardingTo == nil || *portalStore.forwardingTo != "target@example.net" {
		t.Fatalf("forwarding update response = %d %s; store=%#v", response.Code, response.Body.String(), portalStore)
	}

	request = mailboxJSONRequest(http.MethodPost, "/mail/api/forwarding", `{
		"mailboxId":11,"forwardMode":"DISABLED","forwardTo":"unused@example.net"
	}`, token)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || portalStore.forwardingCalls != 2 || portalStore.forwardingTo != nil {
		t.Fatalf("disable forwarding response = %d %s; target=%v", response.Code, response.Body.String(), portalStore.forwardingTo)
	}

	request = mailboxJSONRequest(http.MethodPost, "/mail/api/forwarding", `{
		"mailboxId":999,"forwardMode":"COPY","forwardTo":"target@example.net"
	}`, token)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), `"code":"FORBIDDEN_MAILBOX"`) || portalStore.forwardingCalls != 2 {
		t.Fatalf("forbidden forwarding update response = %d %s; calls=%d", response.Code, response.Body.String(), portalStore.forwardingCalls)
	}

	request = mailboxJSONRequest(http.MethodPost, "/mail/api/forwarding", `{"mailboxId":11,"forwardMode":"MOVE"}`, token)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), `"code":"FORWARD_TARGET_REQUIRED"`) || portalStore.forwardingCalls != 2 {
		t.Fatalf("missing forwarding target response = %d %s; calls=%d", response.Code, response.Body.String(), portalStore.forwardingCalls)
	}

	for _, body := range []string{
		`{"mailboxId":0,"forwardMode":"DISABLED"}`,
		`{"mailboxId":11,"forwardMode":"INVALID"}`,
		`{"mailboxId":11,"forwardMode":"COPY","forwardTo":"not-an-email"}`,
	} {
		request = mailboxJSONRequest(http.MethodPost, "/mail/api/forwarding", body, token)
		response = httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), `"code":"VALIDATION_ERROR"`) {
			t.Fatalf("forwarding validation for %s = %d %s", body, response.Code, response.Body.String())
		}
	}
}

func TestMailboxPortalSendUsesScopedConfigProviderAndSharedHistoryPersistence(t *testing.T) {
	mailboxID := int64(11)
	identity := MailboxIdentity{
		ID: 17, Username: "portal-user", Status: "ACTIVE", SessionVersion: 3,
		MailboxIDs: []int64{mailboxID},
	}
	portalStore := &fakeMailboxPortalStore{
		sendConfig: resendSendConfig{
			DomainID: 2, APIKey: "re_portal_secret", FromName: "Portal Sender", ReplyTo: "reply@example.test",
			MailboxID: &mailboxID, MailboxAddress: "inbox@example.test",
		},
		pendingID: 99,
		sendResult: map[string]any{
			"id": "99", "providerMessageId": "provider-99", "status": "SENT", "lastError": nil,
		},
	}
	server := mailboxPortalTestServer(identity, portalStore)
	providerCalls := 0
	server.providerHTTPClient = &http.Client{Transport: providerRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		providerCalls++
		if request.Method != http.MethodPost || request.URL.Host != "api.resend.com" || request.URL.Path != "/emails" {
			t.Fatalf("provider request = %s %s", request.Method, request.URL.String())
		}
		if request.Header.Get("Authorization") != "Bearer re_portal_secret" || request.Header.Get("Idempotency-Key") != "outbound-message-99" {
			t.Fatalf("provider headers = %#v", request.Header)
		}
		var payload mailprovider.SendRequest
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if payload.From != `"Portal Sender" <inbox@example.test>` || len(payload.To) != 1 || payload.To[0] != "target@example.net" ||
			payload.Subject != "Subject" || payload.ReplyTo != "reply@example.test" || payload.HTML != "" || payload.Text != "" {
			t.Fatalf("provider payload = %#v", payload)
		}
		return providerJSONResponse(http.StatusOK, `{"id":"provider-99"}`), nil
	}), Timeout: time.Second}
	token := authMailboxToken(t, identity, []int64{999}, server.now())
	request := mailboxJSONRequest(http.MethodPost, "/mail/api/send", `{
		"mailboxId":11,"to":[" target@example.net "],"subject":" Subject "
	}`, token)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusOK || providerCalls != 1 || portalStore.sendConfigCalls != 1 ||
		portalStore.sendUserID != 17 || portalStore.sendMailboxID != 11 || portalStore.sendEncryptionKey != authTestEncryptionKey {
		t.Fatalf("portal send response = %d %s; provider=%d store=%#v", response.Code, response.Body.String(), providerCalls, portalStore)
	}
	if portalStore.pendingCalls != 1 || portalStore.pendingDomainID != 2 || portalStore.pendingMailboxID == nil ||
		*portalStore.pendingMailboxID != 11 || portalStore.pendingMailboxUserID == nil || *portalStore.pendingMailboxUserID != 17 ||
		portalStore.pendingFrom != "inbox@example.test" ||
		len(portalStore.pendingTo) != 1 || portalStore.pendingTo[0] != "target@example.net" || portalStore.pendingSubject != "Subject" {
		t.Fatalf("pending outbound persistence = %#v", portalStore)
	}
	if portalStore.completeCalls != 1 || portalStore.completedID != 99 || portalStore.providerMessageID != "provider-99" ||
		portalStore.completedStatus != "SENT" || portalStore.completedLastError != "" {
		t.Fatalf("completed outbound persistence = %#v", portalStore)
	}
	for _, expected := range []string{`"id":"99"`, `"providerMessageId":"provider-99"`, `"status":"SENT"`} {
		if !strings.Contains(response.Body.String(), expected) {
			t.Fatalf("portal send response missing %s: %s", expected, response.Body.String())
		}
	}
}

func TestMailboxPortalSendFailsClosedAndPersistsProviderFailures(t *testing.T) {
	mailboxID := int64(11)
	identity := MailboxIdentity{
		ID: 17, Username: "portal-user", Status: "ACTIVE", SessionVersion: 3,
		MailboxIDs: []int64{mailboxID},
	}
	t.Run("forbidden mailbox", func(t *testing.T) {
		portalStore := &fakeMailboxPortalStore{}
		server := mailboxPortalTestServer(identity, portalStore)
		token := authMailboxToken(t, identity, []int64{999}, server.now())
		request := mailboxJSONRequest(http.MethodPost, "/mail/api/send", `{
			"mailboxId":999,"to":["target@example.net"],"subject":"Subject"
		}`, token)
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), `"code":"FORBIDDEN_MAILBOX"`) ||
			portalStore.sendConfigCalls != 0 || portalStore.pendingCalls != 0 {
			t.Fatalf("forbidden send response = %d %s; store=%#v", response.Code, response.Body.String(), portalStore)
		}
	})

	t.Run("domain send disabled", func(t *testing.T) {
		portalStore := &fakeMailboxPortalStore{sendConfigErr: &requestError{Status: http.StatusBadRequest, Code: "DOMAIN_SEND_DISABLED"}}
		server := mailboxPortalTestServer(identity, portalStore)
		providerCalled := false
		server.providerHTTPClient = &http.Client{Transport: providerRoundTripFunc(func(_ *http.Request) (*http.Response, error) {
			providerCalled = true
			return providerJSONResponse(http.StatusOK, `{"id":"unexpected"}`), nil
		})}
		token := authMailboxToken(t, identity, identity.MailboxIDs, server.now())
		request := mailboxJSONRequest(http.MethodPost, "/mail/api/send", `{
			"mailboxId":11,"to":["target@example.net"],"subject":"Subject"
		}`, token)
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), `"code":"DOMAIN_SEND_DISABLED"`) ||
			providerCalled || portalStore.pendingCalls != 0 {
			t.Fatalf("disabled-domain send response = %d %s; provider=%v store=%#v", response.Code, response.Body.String(), providerCalled, portalStore)
		}
	})

	t.Run("provider failure", func(t *testing.T) {
		portalStore := &fakeMailboxPortalStore{
			sendConfig: resendSendConfig{
				DomainID: 2, APIKey: "re_portal_secret", MailboxID: &mailboxID, MailboxAddress: "inbox@example.test",
			},
			pendingID: 101,
		}
		server := mailboxPortalTestServer(identity, portalStore)
		server.providerHTTPClient = &http.Client{Transport: providerRoundTripFunc(func(_ *http.Request) (*http.Response, error) {
			return providerJSONResponse(http.StatusServiceUnavailable, `{"code":"application_error","message":"provider unavailable"}`), nil
		})}
		token := authMailboxToken(t, identity, identity.MailboxIDs, server.now())
		request := mailboxJSONRequest(http.MethodPost, "/mail/api/send", `{
			"mailboxId":11,"to":["target@example.net"],"subject":"Subject","text":"body"
		}`, token)
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != http.StatusBadGateway || !strings.Contains(response.Body.String(), `"code":"SEND_FAILED"`) {
			t.Fatalf("provider failure response = %d %s", response.Code, response.Body.String())
		}
		if portalStore.pendingCalls != 1 || portalStore.completeCalls != 1 || portalStore.completedID != 101 ||
			portalStore.completedStatus != "FAILED" || portalStore.providerMessageID != "" ||
			!strings.Contains(portalStore.completedLastError, "provider unavailable") {
			t.Fatalf("provider failure persistence = %#v", portalStore)
		}
	})
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

func mailboxPortalTestServer(identity MailboxIdentity, portalStore MailboxPortalStore) *Server {
	authStore := &fakeMailboxAuthenticationStore{record: identity}
	server := mailboxAuthTestServer(authStore, &fakeLoginProtectionStore{counts: make(map[string]int64), ttls: make(map[string]time.Duration)})
	server.mailboxPortalStore = portalStore
	server.cfg.ProviderTimeout = time.Second
	return server
}

func portalMessageMailboxFixture(id int64, address, mode string, canSend, canReceive bool) map[string]any {
	mailbox := map[string]any{"id": id, "address": address, "provisioningMode": mode}
	for key, value := range hostedInternalProtocolSummary(mode, canSend, canReceive) {
		mailbox[key] = value
	}
	return mailbox
}
