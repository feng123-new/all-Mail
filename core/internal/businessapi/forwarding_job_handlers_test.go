package businessapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"testing"
	"time"
)

type fakeForwardingJobAdminStore struct {
	*fakeStore

	listInput     forwardingJobListInput
	listResult    forwardingJobListResult
	listCalls     int
	detailID      int64
	detailResult  forwardingJobDetail
	detailCalls   int
	requeueID     int64
	requeueAt     time.Time
	requeueResult forwardingJobRequeueResult
	requeueCalls  int
	storeErr      error
}

func newFakeForwardingJobAdminStore() *fakeForwardingJobAdminStore {
	return &fakeForwardingJobAdminStore{
		fakeStore: &fakeStore{admin: Admin{
			ID: 7, Username: "admin", Role: "ADMIN", Status: "ACTIVE", SessionVersion: 1,
		}},
		listResult: forwardingJobListResult{
			List: []forwardingJobListItem{}, Page: 1, PageSize: 20,
		},
	}
}

func (s *fakeForwardingJobAdminStore) ListForwardingJobs(_ context.Context, input forwardingJobListInput) (forwardingJobListResult, error) {
	s.listCalls++
	s.listInput = input
	return s.listResult, s.storeErr
}

func (s *fakeForwardingJobAdminStore) GetForwardingJob(_ context.Context, id int64) (forwardingJobDetail, error) {
	s.detailCalls++
	s.detailID = id
	return s.detailResult, s.storeErr
}

func (s *fakeForwardingJobAdminStore) RequeueForwardingJob(_ context.Context, id int64, requeuedAt time.Time) (forwardingJobRequeueResult, error) {
	s.requeueCalls++
	s.requeueID = id
	s.requeueAt = requeuedAt
	return s.requeueResult, s.storeErr
}

func TestForwardingJobAdminRoutesRequireAdministratorAuthentication(t *testing.T) {
	handler := registeredForwardingJobHandler(testServer(newFakeForwardingJobAdminStore()))
	for _, route := range []struct {
		method string
		path   string
	}{
		{method: http.MethodGet, path: "/admin/forwarding-jobs"},
		{method: http.MethodGet, path: "/admin/forwarding-jobs/42"},
		{method: http.MethodPost, path: "/admin/forwarding-jobs/42/requeue"},
	} {
		t.Run(route.method+" "+route.path, func(t *testing.T) {
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest(route.method, route.path, nil))
			if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), `"code":"UNAUTHORIZED"`) {
				t.Fatalf("route response = %d %s", response.Code, response.Body.String())
			}
		})
	}
}

func TestForwardingJobListParsesFastifyCompatibleFiltersAndEnvelope(t *testing.T) {
	store := newFakeForwardingJobAdminStore()
	lastError := "delivery failed"
	store.listResult = forwardingJobListResult{
		List: []forwardingJobListItem{{
			forwardingJobCommon: forwardingJobCommon{
				ID: "42", InboundMessageID: "101", MailboxID: int64Pointer(9), DomainID: 3,
				Mode: "MOVE", ForwardTo: "target@example.net", Status: "FAILED", AttemptCount: 2,
				LastError: &lastError, CreatedAt: "2026-04-02T12:00:00.000Z", UpdatedAt: "2026-04-02T12:01:00.000Z",
			},
			Domain: forwardingJobDomainSummary{ID: 3, Name: "example.com", CanSend: true, CanReceive: true},
			InboundMessage: forwardingJobInboundSummary{
				ID: "101", FromAddress: "sender@example.org", MatchedAddress: "inbox@example.com",
				FinalAddress: "inbox@example.com", ReceivedAt: "2026-04-02T11:59:00.000Z", PortalState: "VISIBLE",
			},
		}},
		Total: 1, Page: 2, PageSize: 5,
	}
	handler := registeredForwardingJobHandler(testServer(store))
	target := "/admin/forwarding-jobs?page=2&pageSize=5&status=FAILED&mode=MOVE&mailboxId=9&domainId=3&keyword=%20sender%20&ignored=value"
	response := serveAuthenticatedForwardingJobRequest(t, handler, http.MethodGet, target, "")

	if response.Code != http.StatusOK {
		t.Fatalf("list response = %d %s", response.Code, response.Body.String())
	}
	wantInput := forwardingJobListInput{
		Page: 2, PageSize: 5, Status: "FAILED", Mode: "MOVE", MailboxID: int64Pointer(9), DomainID: int64Pointer(3), Keyword: "sender",
	}
	if store.listCalls != 1 || !reflect.DeepEqual(store.listInput, wantInput) {
		t.Fatalf("list calls = %d, input = %#v, want %#v", store.listCalls, store.listInput, wantInput)
	}
	var envelope struct {
		Success bool                    `json:"success"`
		Data    forwardingJobListResult `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if !envelope.Success || !reflect.DeepEqual(envelope.Data, store.listResult) {
		t.Fatalf("list envelope = %#v, want %#v", envelope, store.listResult)
	}
}

func TestForwardingJobListUsesFastifyDefaults(t *testing.T) {
	store := newFakeForwardingJobAdminStore()
	handler := registeredForwardingJobHandler(testServer(store))
	response := serveAuthenticatedForwardingJobRequest(t, handler, http.MethodGet, "/admin/forwarding-jobs", "")
	if response.Code != http.StatusOK || store.listInput != (forwardingJobListInput{Page: 1, PageSize: 20}) {
		t.Fatalf("default list response = %d %s, input = %#v", response.Code, response.Body.String(), store.listInput)
	}
}

func TestForwardingJobListRejectsInvalidFastifyInputsBeforeStoreAccess(t *testing.T) {
	tooLongKeyword := strings.Repeat("x", 256)
	for _, query := range []string{
		"page=0",
		"pageSize=101",
		"status=RETRY",
		"status=%20FAILED%20",
		"mode=DISABLED",
		"mailboxId=0",
		"domainId=not-a-number",
		"keyword=%20%20",
		"keyword=" + url.QueryEscape(tooLongKeyword),
	} {
		t.Run(query, func(t *testing.T) {
			store := newFakeForwardingJobAdminStore()
			handler := registeredForwardingJobHandler(testServer(store))
			response := serveAuthenticatedForwardingJobRequest(t, handler, http.MethodGet, "/admin/forwarding-jobs?"+query, "")
			if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), `"code":"VALIDATION_ERROR"`) {
				t.Fatalf("validation response = %d %s", response.Code, response.Body.String())
			}
			if store.listCalls != 0 {
				t.Fatalf("list store called %d times", store.listCalls)
			}
		})
	}
}

func TestForwardingJobDetailReturnsParityFieldsAndValidatesID(t *testing.T) {
	store := newFakeForwardingJobAdminStore()
	fullError := strings.Repeat("failure ", 30)
	subject := "Need help"
	routeKind := "EXACT_MAILBOX"
	store.detailResult = forwardingJobDetail{
		forwardingJobCommon: forwardingJobCommon{
			ID: "84", InboundMessageID: "101", MailboxID: int64Pointer(7), DomainID: 3,
			Mode: "MOVE", ForwardTo: "forward@example.net", Status: "SKIPPED", AttemptCount: 1,
			LastError: &fullError, ProcessedAt: stringPointer("2026-03-29T12:00:00.000Z"),
			CreatedAt: "2026-03-29T11:58:00.000Z", UpdatedAt: "2026-03-29T12:00:00.000Z",
		},
		Mailbox: &forwardingJobMailboxDetail{
			ID: 7, Address: "inbox@example.com", ProvisioningMode: "MANUAL", ForwardMode: "MOVE", ForwardTo: stringPointer("forward@example.net"),
		},
		Domain: forwardingJobDomainSummary{ID: 3, Name: "example.com", CanSend: true, CanReceive: true},
		InboundMessage: forwardingJobInboundDetail{
			forwardingJobInboundSummary: forwardingJobInboundSummary{
				ID: "101", FromAddress: "sender@example.org", Subject: &subject, MatchedAddress: "sales@example.com",
				FinalAddress: "sales@example.com", RouteKind: &routeKind, ReceivedAt: "2026-03-29T11:50:00.000Z", PortalState: "FORWARDED_HIDDEN",
			},
			HasTextPreview: true, HasHTMLPreview: true,
		},
	}
	handler := registeredForwardingJobHandler(testServer(store))
	response := serveAuthenticatedForwardingJobRequest(t, handler, http.MethodGet, "/admin/forwarding-jobs/84", "")
	if response.Code != http.StatusOK || store.detailCalls != 1 || store.detailID != 84 {
		t.Fatalf("detail response = %d %s, calls=%d id=%d", response.Code, response.Body.String(), store.detailCalls, store.detailID)
	}
	if !strings.Contains(response.Body.String(), `"hasTextPreview":true`) || !strings.Contains(response.Body.String(), fullError) {
		t.Fatalf("detail response lost parity fields: %s", response.Body.String())
	}

	invalid := serveAuthenticatedForwardingJobRequest(t, handler, http.MethodGet, "/admin/forwarding-jobs/not-a-job-id", "")
	if invalid.Code != http.StatusBadRequest || !strings.Contains(invalid.Body.String(), `"code":"FORWARDING_JOB_INVALID_ID"`) || store.detailCalls != 1 {
		t.Fatalf("invalid id response = %d %s, calls=%d", invalid.Code, invalid.Body.String(), store.detailCalls)
	}
}

func TestForwardingJobDetailAndRequeueMapBoundaryErrors(t *testing.T) {
	for _, testCase := range []struct {
		name       string
		method     string
		path       string
		storeError error
		wantStatus int
		wantCode   string
	}{
		{
			name: "missing detail", method: http.MethodGet, path: "/admin/forwarding-jobs/999",
			storeError: &requestError{Status: http.StatusNotFound, Code: "FORWARDING_JOB_NOT_FOUND"},
			wantStatus: http.StatusNotFound, wantCode: "FORWARDING_JOB_NOT_FOUND",
		},
		{
			name: "running requeue", method: http.MethodPost, path: "/admin/forwarding-jobs/92/requeue",
			storeError: &requestError{Status: http.StatusBadRequest, Code: "FORWARDING_JOB_REQUEUE_NOT_ALLOWED"},
			wantStatus: http.StatusBadRequest, wantCode: "FORWARDING_JOB_REQUEUE_NOT_ALLOWED",
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			store := newFakeForwardingJobAdminStore()
			store.storeErr = testCase.storeError
			handler := registeredForwardingJobHandler(testServer(store))
			response := serveAuthenticatedForwardingJobRequest(t, handler, testCase.method, testCase.path, "")
			if response.Code != testCase.wantStatus || !strings.Contains(response.Body.String(), `"code":"`+testCase.wantCode+`"`) {
				t.Fatalf("boundary response = %d %s", response.Code, response.Body.String())
			}
		})
	}
}

func TestForwardingJobRequeueUsesServerTimeAndReturnsResetState(t *testing.T) {
	store := newFakeForwardingJobAdminStore()
	store.requeueResult = forwardingJobRequeueResult{
		ID: "91", Status: "PENDING", AttemptCount: 0,
		NextAttemptAt: "2026-07-30T00:00:00.000Z", UpdatedAt: "2026-07-30T00:00:00.000Z",
	}
	server := testServer(store)
	handler := registeredForwardingJobHandler(server)
	response := serveAuthenticatedForwardingJobRequest(t, handler, http.MethodPost, "/admin/forwarding-jobs/91/requeue", `{not-json`)
	if response.Code != http.StatusOK {
		t.Fatalf("requeue response = %d %s", response.Code, response.Body.String())
	}
	if store.requeueCalls != 1 || store.requeueID != 91 || !store.requeueAt.Equal(server.now()) {
		t.Fatalf("requeue call = calls=%d id=%d at=%v", store.requeueCalls, store.requeueID, store.requeueAt)
	}
	for _, expected := range []string{
		`"id":"91"`, `"status":"PENDING"`, `"attemptCount":0`, `"lastError":null`,
		`"providerMessageId":null`, `"nextAttemptAt":"2026-07-30T00:00:00.000Z"`,
		`"processedAt":null`, `"updatedAt":"2026-07-30T00:00:00.000Z"`,
	} {
		if !strings.Contains(response.Body.String(), expected) {
			t.Fatalf("requeue response missing %s: %s", expected, response.Body.String())
		}
	}
}

func registeredForwardingJobHandler(server *Server) http.Handler {
	mux := http.NewServeMux()
	server.registerForwardingJobRoutes(mux)
	mux.HandleFunc("/", server.notFound)
	return server.withRequestMetadata(mux)
}

func serveAuthenticatedForwardingJobRequest(t *testing.T, handler http.Handler, method, target, body string) *httptest.ResponseRecorder {
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

func int64Pointer(value int64) *int64 { return &value }
