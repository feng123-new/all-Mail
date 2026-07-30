package businessapi

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/config"
)

const testJWTSecret = "0123456789abcdef0123456789abcdef"

type fakeStore struct {
	admin      Admin
	adminErr   error
	stats      DashboardStats
	trend      []TrendPoint
	logs       DashboardLogs
	pingErr    error
	trendDays  int
	logsInput  DashboardLogInput
	closed     bool
}

func (s *fakeStore) Ping(context.Context) error { return s.pingErr }
func (s *fakeStore) FindAdmin(context.Context, int64) (Admin, error) {
	return s.admin, s.adminErr
}
func (s *fakeStore) DashboardStats(context.Context) (DashboardStats, error) { return s.stats, nil }
func (s *fakeStore) DashboardTrend(_ context.Context, days int) ([]TrendPoint, error) {
	s.trendDays = days
	return s.trend, nil
}
func (s *fakeStore) DashboardLogs(_ context.Context, input DashboardLogInput) (DashboardLogs, error) {
	s.logsInput = input
	return s.logs, nil
}
func (s *fakeStore) Close() { s.closed = true }

func TestDashboardStatsRequiresActiveAdministrator(t *testing.T) {
	store := &fakeStore{
		admin: Admin{ID: 7, Username: "admin", Role: "SUPER_ADMIN", Status: "ACTIVE"},
		stats: DashboardStats{Emails: EmailStats{Total: 3, Active: 2, Error: 1}},
	}
	server := testServer(store)

	request := httptest.NewRequest(http.MethodGet, "/admin/dashboard/stats", nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), `"code":"UNAUTHORIZED"`) {
		t.Fatalf("unauthenticated response = %d %s", response.Code, response.Body.String())
	}

	request = authenticatedRequest(t, http.MethodGet, "/admin/dashboard/stats", "admin-console")
	request.Header.Set("X-Request-Id", "request-123")
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"total":3`) {
		t.Fatalf("authenticated response = %d %s", response.Code, response.Body.String())
	}
	if response.Header().Get("X-Request-Id") != "request-123" {
		t.Fatalf("request id = %q", response.Header().Get("X-Request-Id"))
	}

	store.admin.Status = "DISABLED"
	request = authenticatedRequest(t, http.MethodGet, "/admin/dashboard/stats", "admin-console")
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), `"code":"ACCOUNT_DISABLED"`) {
		t.Fatalf("disabled response = %d %s", response.Code, response.Body.String())
	}

	store.admin.Status = "ACTIVE"
	store.admin.MustChangePassword = true
	request = authenticatedRequest(t, http.MethodGet, "/admin/dashboard/stats", "admin-console")
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), `"code":"PASSWORD_CHANGE_REQUIRED"`) {
		t.Fatalf("password-change response = %d %s", response.Code, response.Body.String())
	}
}

func TestDashboardRejectsInvalidJWTAndQueryValues(t *testing.T) {
	store := &fakeStore{admin: Admin{ID: 7, Status: "ACTIVE"}}
	server := testServer(store)

	request := authenticatedRequest(t, http.MethodGet, "/admin/dashboard/stats", "mailbox-portal")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), `"code":"INVALID_TOKEN"`) {
		t.Fatalf("audience response = %d %s", response.Code, response.Body.String())
	}

	request = authenticatedRequest(t, http.MethodGet, "/admin/dashboard/api-trend?days=91", "admin-console")
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), `"code":"VALIDATION_ERROR"`) {
		t.Fatalf("trend validation response = %d %s", response.Code, response.Body.String())
	}

	request = authenticatedRequest(t, http.MethodGet, "/admin/dashboard/logs?page=0", "admin-console")
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("page validation response = %d %s", response.Code, response.Body.String())
	}
}

func TestDashboardTrendAndLogsPreserveContracts(t *testing.T) {
	store := &fakeStore{
		admin: Admin{ID: 7, Status: "ACTIVE"},
		trend: []TrendPoint{{Date: "2026-07-30", Count: 4}},
		logs: DashboardLogs{
			List: []DashboardLog{{ID: 42, Action: "allocate", APIKeyName: "key", Email: "mail@example.com", CreatedAt: "2026-07-30T00:00:00.000Z"}},
			Total: 1,
			Page: 2,
			PageSize: 10,
		},
	}
	server := testServer(store)

	request := authenticatedRequest(t, http.MethodGet, "/admin/dashboard/api-trend?days=30", "admin-console")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || store.trendDays != 30 || !strings.Contains(response.Body.String(), `"count":4`) {
		t.Fatalf("trend response = %d %s; days=%d", response.Code, response.Body.String(), store.trendDays)
	}

	request = authenticatedRequest(t, http.MethodGet, "/admin/dashboard/logs?page=2&pageSize=10&action=allocate", "admin-console")
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || store.logsInput != (DashboardLogInput{Page: 2, PageSize: 10, Action: "allocate"}) {
		t.Fatalf("logs response = %d %s; input=%#v", response.Code, response.Body.String(), store.logsInput)
	}
	for _, expected := range []string{`"id":42`, `"apiKeyName":"key"`, `"pageSize":10`} {
		if !strings.Contains(response.Body.String(), expected) {
			t.Fatalf("logs response is missing %s: %s", expected, response.Body.String())
		}
	}
}

func TestReadinessReportsDatabaseState(t *testing.T) {
	store := &fakeStore{}
	server := testServer(store)
	request := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"postgres":"ok"`) {
		t.Fatalf("ready response = %d %s", response.Code, response.Body.String())
	}

	store.pingErr = context.DeadlineExceeded
	request = httptest.NewRequest(http.MethodGet, "/readyz", nil)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), `"postgres":"unavailable"`) {
		t.Fatalf("not-ready response = %d %s", response.Code, response.Body.String())
	}
}

func TestVerifyAdminJWTRejectsTamperingAndExpiry(t *testing.T) {
	now := time.Date(2026, 7, 30, 0, 0, 0, 0, time.UTC)
	valid := signTestJWT(t, 7, "admin-console", now.Add(time.Hour))
	if id, err := verifyAdminJWT(valid, testJWTSecret, now); err != nil || id != 7 {
		t.Fatalf("valid JWT = %d, %v", id, err)
	}
	if _, err := verifyAdminJWT(valid+"tampered", testJWTSecret, now); err == nil {
		t.Fatal("verifyAdminJWT accepted a tampered token")
	}
	expired := signTestJWT(t, 7, "admin-console", now.Add(-time.Second))
	if _, err := verifyAdminJWT(expired, testJWTSecret, now); err == nil {
		t.Fatal("verifyAdminJWT accepted an expired token")
	}
}

func testServer(store Store) *Server {
	server := newWithStore(config.GoBusinessAPIConfig{
		Port:            3200,
		JWTSecret:       testJWTSecret,
		ReadyTimeout:    time.Second,
		QueryTimeout:    time.Second,
		ShutdownTimeout: time.Second,
	}, slog.New(slog.NewTextHandler(io.Discard, nil)), store)
	server.now = func() time.Time { return time.Date(2026, 7, 30, 0, 0, 0, 0, time.UTC) }
	return server
}

func authenticatedRequest(t *testing.T, method, target, audience string) *http.Request {
	t.Helper()
	now := time.Date(2026, 7, 30, 0, 0, 0, 0, time.UTC)
	token := signTestJWT(t, 7, audience, now.Add(time.Hour))
	request := httptest.NewRequest(method, target, nil)
	request.AddCookie(&http.Cookie{Name: "token", Value: token})
	return request
}

func signTestJWT(t *testing.T, subject int64, audience string, expiresAt time.Time) string {
	t.Helper()
	header, err := json.Marshal(map[string]any{"alg": "HS256", "typ": "JWT"})
	if err != nil {
		t.Fatal(err)
	}
	payload, err := json.Marshal(map[string]any{
		"sub": subject,
		"aud": audience,
		"exp": expiresAt.Unix(),
	})
	if err != nil {
		t.Fatal(err)
	}
	encodedHeader := base64.RawURLEncoding.EncodeToString(header)
	encodedPayload := base64.RawURLEncoding.EncodeToString(payload)
	unsigned := encodedHeader + "." + encodedPayload
	mac := hmac.New(sha256.New, []byte(testJWTSecret))
	_, _ = mac.Write([]byte(unsigned))
	return unsigned + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
