package businessapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"
)

type fakeDashboardWriteStore struct {
	*fakeStore
	deleteID     int64
	deleteAudit  DashboardDeleteAudit
	deleteResult bool
	deleteErr    error
	batchIDs     []int64
	batchAudit   DashboardDeleteAudit
	batchResult  int64
	batchErr     error
}

func (s *fakeDashboardWriteStore) DeleteDashboardLog(
	_ context.Context,
	id int64,
	audit DashboardDeleteAudit,
) (bool, error) {
	s.deleteID = id
	s.deleteAudit = audit
	return s.deleteResult, s.deleteErr
}

func (s *fakeDashboardWriteStore) BatchDeleteDashboardLogs(
	_ context.Context,
	ids []int64,
	audit DashboardDeleteAudit,
) (int64, error) {
	s.batchIDs = append([]int64(nil), ids...)
	s.batchAudit = audit
	return s.batchResult, s.batchErr
}

func TestDashboardDeleteRoutesPreserveAuthAuditAndResponseContracts(t *testing.T) {
	store := &fakeDashboardWriteStore{
		fakeStore:    &fakeStore{admin: Admin{ID: 7, Username: "admin", Status: "ACTIVE"}},
		deleteResult: true,
		batchResult:  2,
	}
	server := testServer(store)

	request := authenticatedRequest(t, http.MethodDelete, "/admin/dashboard/logs/42", adminJWTAudience)
	request.Header.Set("X-Request-Id", "dashboard-delete-1")
	request.Header.Set("X-Real-IP", "198.51.100.17")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"deleted":true`) {
		t.Fatalf("delete response = %d %s", response.Code, response.Body.String())
	}
	if store.deleteID != 42 || store.deleteAudit.AdminID != 7 || store.deleteAudit.RequestID != "dashboard-delete-1" {
		t.Fatalf("delete call = id %d audit %#v", store.deleteID, store.deleteAudit)
	}
	if store.deleteAudit.RequestIP != "198.51.100.17" || store.deleteAudit.StartedAt.IsZero() {
		t.Fatalf("delete audit = %#v", store.deleteAudit)
	}

	request = authenticatedJSONRequest(t, http.MethodPost, "/admin/dashboard/logs/batch-delete", `{"ids":[3,2,3]}`)
	request.Header.Set("X-Request-Id", "dashboard-delete-batch")
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"deleted":2`) {
		t.Fatalf("batch response = %d %s", response.Code, response.Body.String())
	}
	if !reflect.DeepEqual(store.batchIDs, []int64{2, 3}) {
		t.Fatalf("batch ids = %#v", store.batchIDs)
	}
	if store.batchAudit.AdminID != 7 || store.batchAudit.RequestID != "dashboard-delete-batch" {
		t.Fatalf("batch audit = %#v", store.batchAudit)
	}
}

func TestDashboardDeleteRoutesRejectMalformedInputsAndUnavailableStore(t *testing.T) {
	writeStore := &fakeDashboardWriteStore{
		fakeStore: &fakeStore{admin: Admin{ID: 7, Status: "ACTIVE"}},
	}
	server := testServer(writeStore)

	for _, testCase := range []struct {
		method string
		path   string
		body   string
	}{
		{http.MethodDelete, "/admin/dashboard/logs/0", ""},
		{http.MethodPost, "/admin/dashboard/logs/batch-delete", `{}`},
		{http.MethodPost, "/admin/dashboard/logs/batch-delete", `{"ids":null}`},
		{http.MethodPost, "/admin/dashboard/logs/batch-delete", `{"ids":[]}`},
		{http.MethodPost, "/admin/dashboard/logs/batch-delete", `{"ids":[1,-2]}`},
		{http.MethodPost, "/admin/dashboard/logs/batch-delete", `{"ids":"1"}`},
	} {
		var request *http.Request
		if testCase.body == "" {
			request = authenticatedRequest(t, testCase.method, testCase.path, adminJWTAudience)
		} else {
			request = authenticatedJSONRequest(t, testCase.method, testCase.path, testCase.body)
		}
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("%s %s body %s response = %d %s", testCase.method, testCase.path, testCase.body, response.Code, response.Body.String())
		}
	}

	plainStore := &fakeStore{admin: Admin{ID: 7, Status: "ACTIVE"}}
	server = testServer(plainStore)
	request := authenticatedRequest(t, http.MethodDelete, "/admin/dashboard/logs/1", adminJWTAudience)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "DASHBOARD_WRITE_STORE_UNAVAILABLE") {
		t.Fatalf("unavailable store response = %d %s", response.Code, response.Body.String())
	}
}

func TestDashboardDeleteRoutesReportStoreFailure(t *testing.T) {
	store := &fakeDashboardWriteStore{
		fakeStore: &fakeStore{admin: Admin{ID: 7, Status: "ACTIVE"}},
		deleteErr: context.DeadlineExceeded,
		batchErr:  context.DeadlineExceeded,
	}
	server := testServer(store)
	for _, request := range []*http.Request{
		authenticatedRequest(t, http.MethodDelete, "/admin/dashboard/logs/1", adminJWTAudience),
		authenticatedJSONRequest(t, http.MethodPost, "/admin/dashboard/logs/batch-delete", `{"ids":[1]}`),
	} {
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != http.StatusInternalServerError {
			t.Fatalf("store failure response = %d %s", response.Code, response.Body.String())
		}
	}
}

func authenticatedJSONRequest(t *testing.T, method, target, body string) *http.Request {
	t.Helper()
	now := time.Date(2026, 7, 30, 0, 0, 0, 0, time.UTC)
	token := signTestJWT(t, 7, adminJWTAudience, now.Add(time.Hour))
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(&http.Cookie{Name: "token", Value: token})
	return request
}
