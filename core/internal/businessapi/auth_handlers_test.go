package businessapi

import (
	"context"
	"encoding/base32"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/legacycrypto"
	"golang.org/x/crypto/bcrypt"
)

const authTestEncryptionKey = "0123456789abcdef0123456789abcdef" // gitleaks:allow -- deterministic test fixture

type fakeAuthenticationStore struct {
	*fakeStore
	record             AdminAuthentication
	findUsernameCalls  int
	recordLoginCalls   int
	changePasswordCall int
	setupCalls         int
	enableCalls        int
	disableCalls       int
	lastLoginAt        time.Time
	lastLoginIP        string
	operationErr       error
}

func newFakeAuthenticationStore(record AdminAuthentication) *fakeAuthenticationStore {
	return &fakeAuthenticationStore{
		fakeStore: &fakeStore{admin: record.Admin},
		record:    record,
	}
}

func (s *fakeAuthenticationStore) FindAdminAuthenticationByUsername(_ context.Context, username string) (AdminAuthentication, error) {
	s.findUsernameCalls++
	if s.operationErr != nil {
		return AdminAuthentication{}, s.operationErr
	}
	if username != s.record.Username {
		return AdminAuthentication{}, errNotFound
	}
	return s.record, nil
}

func (s *fakeAuthenticationStore) FindAdminAuthentication(_ context.Context, id int64) (AdminAuthentication, error) {
	if s.operationErr != nil {
		return AdminAuthentication{}, s.operationErr
	}
	if id != s.record.ID {
		return AdminAuthentication{}, errNotFound
	}
	return s.record, nil
}

func (s *fakeAuthenticationStore) RecordAdminLogin(_ context.Context, id, sessionVersion int64, at time.Time, ip string) (AdminAuthentication, error) {
	s.recordLoginCalls++
	if s.operationErr != nil {
		return AdminAuthentication{}, s.operationErr
	}
	if id != s.record.ID || sessionVersion != s.record.SessionVersion {
		return AdminAuthentication{}, errNotFound
	}
	s.lastLoginAt = at
	s.lastLoginIP = ip
	s.record.LastLoginAt = &at
	s.record.LastLoginIP = &ip
	return s.record, nil
}

func (s *fakeAuthenticationStore) ChangeAdminPassword(_ context.Context, id, sessionVersion int64, expectedHash, newHash string) (AdminAuthentication, error) {
	s.changePasswordCall++
	if s.operationErr != nil {
		return AdminAuthentication{}, s.operationErr
	}
	if id != s.record.ID || sessionVersion != s.record.SessionVersion || expectedHash != s.record.PasswordHash {
		return AdminAuthentication{}, errNotFound
	}
	s.record.PasswordHash = newHash
	s.record.MustChangePassword = false
	s.record.SessionVersion++
	s.fakeStore.admin = s.record.Admin
	return s.record, nil
}

func (s *fakeAuthenticationStore) SetAdminTwoFactorTempSecret(_ context.Context, id, sessionVersion int64, encryptedSecret string) (AdminAuthentication, error) {
	s.setupCalls++
	if s.operationErr != nil {
		return AdminAuthentication{}, s.operationErr
	}
	if id != s.record.ID || sessionVersion != s.record.SessionVersion {
		return AdminAuthentication{}, errNotFound
	}
	s.record.TwoFactorTempSecret = &encryptedSecret
	return s.record, nil
}

func (s *fakeAuthenticationStore) EnableAdminTwoFactor(_ context.Context, id, sessionVersion int64, expectedTempSecret string) (AdminAuthentication, error) {
	s.enableCalls++
	if s.operationErr != nil {
		return AdminAuthentication{}, s.operationErr
	}
	if id != s.record.ID || sessionVersion != s.record.SessionVersion || s.record.TwoFactorTempSecret == nil || expectedTempSecret != *s.record.TwoFactorTempSecret {
		return AdminAuthentication{}, errNotFound
	}
	s.record.TwoFactorEnabled = true
	s.record.TwoFactorSecret = s.record.TwoFactorTempSecret
	s.record.TwoFactorTempSecret = nil
	s.record.SessionVersion++
	s.fakeStore.admin = s.record.Admin
	return s.record, nil
}

func (s *fakeAuthenticationStore) DisableAdminTwoFactor(_ context.Context, id, sessionVersion int64, expectedSecret string) (AdminAuthentication, error) {
	s.disableCalls++
	if s.operationErr != nil {
		return AdminAuthentication{}, s.operationErr
	}
	if id != s.record.ID || sessionVersion != s.record.SessionVersion || s.record.TwoFactorSecret == nil || expectedSecret != *s.record.TwoFactorSecret {
		return AdminAuthentication{}, errNotFound
	}
	s.record.TwoFactorEnabled = false
	s.record.TwoFactorSecret = nil
	s.record.TwoFactorTempSecret = nil
	s.record.SessionVersion++
	s.fakeStore.admin = s.record.Admin
	return s.record, nil
}

func TestAdministratorAuthRoutesAreRegisteredThroughServerHandler(t *testing.T) {
	server := testServer(&fakeStore{})
	testCases := []struct {
		method     string
		target     string
		body       string
		wantStatus int
	}{
		{method: http.MethodPost, target: "/admin/auth/login", body: `{}`, wantStatus: http.StatusBadRequest},
		{method: http.MethodPost, target: "/admin/auth/logout", wantStatus: http.StatusOK},
		{method: http.MethodGet, target: "/admin/auth/me", wantStatus: http.StatusUnauthorized},
		{method: http.MethodPost, target: "/admin/auth/change-password", wantStatus: http.StatusUnauthorized},
		{method: http.MethodGet, target: "/admin/auth/2fa/status", wantStatus: http.StatusUnauthorized},
		{method: http.MethodPost, target: "/admin/auth/2fa/setup", wantStatus: http.StatusUnauthorized},
		{method: http.MethodPost, target: "/admin/auth/2fa/enable", wantStatus: http.StatusUnauthorized},
		{method: http.MethodPost, target: "/admin/auth/2fa/disable", wantStatus: http.StatusUnauthorized},
	}

	for _, testCase := range testCases {
		t.Run(testCase.method+" "+testCase.target, func(t *testing.T) {
			request := httptest.NewRequest(testCase.method, testCase.target, strings.NewReader(testCase.body))
			if testCase.body != "" {
				request.Header.Set("Content-Type", "application/json")
			}
			response := httptest.NewRecorder()
			server.Handler().ServeHTTP(response, request)
			if response.Code != testCase.wantStatus {
				t.Fatalf("response = %d %s, want status %d", response.Code, response.Body.String(), testCase.wantStatus)
			}
		})
	}
}

func TestAdministratorLoginReturnsCompatibleSessionAndMetadata(t *testing.T) {
	passwordHash := authPasswordHash(t, "temporary-password")
	store := newFakeAuthenticationStore(AdminAuthentication{
		Admin: Admin{
			ID:                 7,
			Username:           "admin",
			Role:               "SUPER_ADMIN",
			Status:             "ACTIVE",
			MustChangePassword: true,
			SessionVersion:     4,
		},
		PasswordHash: passwordHash,
		CreatedAt:    time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC),
	})
	protection := &fakeLoginProtectionStore{
		counts: map[string]int64{"auth:admin:login:attempt:admin-login:admin:203.0.113.8": 1},
		ttls:   map[string]time.Duration{"auth:admin:login:attempt:admin-login:admin:203.0.113.8": 15 * time.Minute},
	}
	server := authTestServer(store, protection)
	request := authJSONRequest(http.MethodPost, "/admin/auth/login", `{"username":"admin","password":"temporary-password"}`, "")
	request.RemoteAddr = "203.0.113.8:4321"
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("login response = %d %s", response.Code, response.Body.String())
	}
	for _, expected := range []string{
		`"success":true`, `"id":7`, `"username":"admin"`, `"role":"SUPER_ADMIN"`,
		`"mustChangePassword":true`, `"twoFactorEnabled":false`,
	} {
		if !strings.Contains(response.Body.String(), expected) {
			t.Fatalf("login response is missing %s: %s", expected, response.Body.String())
		}
	}
	cookie := requireSessionCookie(t, response)
	assertSessionCookieAttributes(t, cookie, false, 7200)
	claims, err := verifyJWT(cookie.Value, testJWTSecret, server.now(), adminJWTAudience)
	if err != nil {
		t.Fatal(err)
	}
	if claims.Subject != "7" || claims.SessionVersion != 4 || claims.Username != "admin" || claims.Role != "SUPER_ADMIN" ||
		claims.IssuedAt != float64(server.now().Unix()) || claims.ExpiresAt != float64(server.now().Add(2*time.Hour).Unix()) {
		t.Fatalf("login claims = %#v", claims)
	}
	if store.recordLoginCalls != 1 || !store.lastLoginAt.Equal(server.now()) || store.lastLoginIP != "203.0.113.8" {
		t.Fatalf("login metadata = calls %d at %v ip %q", store.recordLoginCalls, store.lastLoginAt, store.lastLoginIP)
	}
	if len(protection.deleted) != 2 || protection.deleted[0] != "auth:admin:login:attempt:admin-login:admin:203.0.113.8" ||
		protection.deleted[1] != "auth:admin:login:lock:admin-login:admin:203.0.113.8" {
		t.Fatalf("cleared login keys = %#v", protection.deleted)
	}
}

func TestAdministratorLoginLockoutIsExactAndFailsClosed(t *testing.T) {
	store := newFakeAuthenticationStore(AdminAuthentication{
		Admin:        Admin{ID: 7, Username: "admin", Role: "SUPER_ADMIN", Status: "ACTIVE", SessionVersion: 1},
		PasswordHash: authPasswordHash(t, "correct-password"),
		CreatedAt:    time.Now(),
	})
	protection := &fakeLoginProtectionStore{counts: make(map[string]int64), ttls: make(map[string]time.Duration)}
	server := authTestServer(store, protection)
	server.cfg.AdminLoginMaxAttempts = 2
	server.cfg.AdminLoginLockDuration = 15 * time.Minute

	for attempt, wantStatus := range []int{http.StatusUnauthorized, http.StatusTooManyRequests} {
		request := authJSONRequest(http.MethodPost, "/admin/auth/login", `{"username":" Admin ","password":"wrong"}`, "")
		request.RemoteAddr = "198.51.100.7:4000"
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != wantStatus {
			t.Fatalf("attempt %d response = %d %s", attempt+1, response.Code, response.Body.String())
		}
	}
	lockKey := "auth:admin:login:lock:admin-login:admin:198.51.100.7"
	if protection.ttls[lockKey] != 15*time.Minute {
		t.Fatalf("lock state = %#v", protection.ttls)
	}

	findCalls := store.findUsernameCalls
	request := authJSONRequest(http.MethodPost, "/admin/auth/login", `{"username":" Admin ","password":"correct-password"}`, "")
	request.RemoteAddr = "198.51.100.7:4000"
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusTooManyRequests || store.findUsernameCalls != findCalls {
		t.Fatalf("locked response = %d %s; find calls %d", response.Code, response.Body.String(), store.findUsernameCalls)
	}

	protection.err = errors.New("redis unavailable")
	request = authJSONRequest(http.MethodPost, "/admin/auth/login", `{"username":"admin","password":"correct-password"}`, "")
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), `"code":"LOGIN_SECURITY_BACKEND_UNAVAILABLE"`) {
		t.Fatalf("fail-closed response = %d %s", response.Code, response.Body.String())
	}
}

func TestAdministratorLoginSupportsLegacyEncryptedTOTP(t *testing.T) {
	const secret = "JBSWY3DPEHPK3PXP"
	encryptedSecret, err := legacycrypto.Encrypt(authTestEncryptionKey, secret)
	if err != nil {
		t.Fatal(err)
	}
	store := newFakeAuthenticationStore(AdminAuthentication{
		Admin: Admin{
			ID: 7, Username: "admin", Role: "SUPER_ADMIN", Status: "ACTIVE", SessionVersion: 1,
			TwoFactorEnabled: true, TwoFactorSecret: &encryptedSecret,
		},
		PasswordHash: authPasswordHash(t, "correct-password"),
		CreatedAt:    time.Now(),
	})
	protection := &fakeLoginProtectionStore{counts: make(map[string]int64), ttls: make(map[string]time.Duration)}
	server := authTestServer(store, protection)

	request := authJSONRequest(http.MethodPost, "/admin/auth/login", `{"username":"admin","password":"correct-password"}`, "")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), `"code":"OTP_REQUIRED"`) || len(protection.counts) != 0 {
		t.Fatalf("missing OTP response = %d %s; attempts=%#v", response.Code, response.Body.String(), protection.counts)
	}

	request = authJSONRequest(http.MethodPost, "/admin/auth/login", `{"username":"admin","password":"correct-password","otp":"000000"}`, "")
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), `"code":"INVALID_OTP"`) {
		t.Fatalf("invalid OTP response = %d %s", response.Code, response.Body.String())
	}

	otp := authTOTPCode(t, secret, server.now())
	request = authJSONRequest(http.MethodPost, "/admin/auth/login", `{"username":"admin","password":"correct-password","otp":"`+otp+`"}`, "")
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"twoFactorEnabled":true`) {
		t.Fatalf("valid OTP response = %d %s", response.Code, response.Body.String())
	}
}

func TestAdministratorForcedPasswordRotationRevokesOldSessionAndCleansBootstrapSecret(t *testing.T) {
	passwordHash := authPasswordHash(t, "temporary-password")
	email := "admin@example.test"
	lastLogin := time.Date(2026, 7, 31, 22, 0, 0, 0, time.UTC)
	store := newFakeAuthenticationStore(AdminAuthentication{
		Admin: Admin{
			ID: 7, Username: "admin", Role: "SUPER_ADMIN", Status: "ACTIVE",
			MustChangePassword: true, SessionVersion: 1,
		},
		PasswordHash: passwordHash,
		Email:        &email,
		LastLoginAt:  &lastLogin,
		CreatedAt:    time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC),
	})
	server := authTestServer(store, &fakeLoginProtectionStore{counts: make(map[string]int64), ttls: make(map[string]time.Duration)})
	bootstrapFile := filepath.Join(t.TempDir(), "bootstrap-admin.env")
	if err := os.WriteFile(bootstrapFile, []byte("ADMIN_USERNAME='admin'\nADMIN_PASSWORD=temporary-password\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	server.cfg.BootstrapAdminFile = bootstrapFile
	oldToken := authAdminToken(t, store.record.Admin, server.now())

	request := authJSONRequest(http.MethodGet, "/admin/auth/me", "", oldToken)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("forced-rotation me response = %d %s", response.Code, response.Body.String())
	}
	for _, expected := range []string{`"email":"admin@example.test"`, `"mustChangePassword":true`, `"lastLoginAt":"2026-07-31T22:00:00.000Z"`, `"createdAt":"2026-01-02T03:04:05.000Z"`} {
		if !strings.Contains(response.Body.String(), expected) {
			t.Fatalf("me response missing %s: %s", expected, response.Body.String())
		}
	}

	request = authJSONRequest(http.MethodGet, "/admin/auth/2fa/status", "", oldToken)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), `"code":"PASSWORD_CHANGE_REQUIRED"`) {
		t.Fatalf("ordinary forced-rotation response = %d %s", response.Code, response.Body.String())
	}

	request = authJSONRequest(http.MethodPost, "/admin/auth/change-password", `{"oldPassword":"temporary-password","newPassword":"replacement-password"}`, oldToken)
	request.Header.Set("X-Forwarded-Proto", "https")
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"code":"AUTH_PASSWORD_CHANGED"`) {
		t.Fatalf("change-password response = %d %s", response.Code, response.Body.String())
	}
	newCookie := requireSessionCookie(t, response)
	assertSessionCookieAttributes(t, newCookie, true, 7200)
	claims, err := verifyJWT(newCookie.Value, testJWTSecret, server.now(), adminJWTAudience)
	if err != nil || claims.SessionVersion != 2 {
		t.Fatalf("rotated claims = %#v, %v", claims, err)
	}
	if store.changePasswordCall != 1 || store.record.MustChangePassword {
		t.Fatalf("password mutation = calls %d record %#v", store.changePasswordCall, store.record)
	}
	if err := bcrypt.CompareHashAndPassword([]byte(store.record.PasswordHash), []byte("replacement-password")); err != nil {
		t.Fatalf("replacement password does not match: %v", err)
	}
	if cost, err := bcrypt.Cost([]byte(store.record.PasswordHash)); err != nil || cost != 10 {
		t.Fatalf("replacement password cost = %d, %v", cost, err)
	}
	if _, err := os.Stat(bootstrapFile); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("bootstrap secret still exists: %v", err)
	}

	request = authJSONRequest(http.MethodGet, "/admin/auth/me", "", oldToken)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), `"code":"INVALID_TOKEN"`) {
		t.Fatalf("old session response = %d %s", response.Code, response.Body.String())
	}
	request = authJSONRequest(http.MethodGet, "/admin/auth/me", "", newCookie.Value)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"mustChangePassword":false`) {
		t.Fatalf("new session response = %d %s", response.Code, response.Body.String())
	}
}

func TestAdministratorHandlerRejectsVersionChangedAfterAuthentication(t *testing.T) {
	store := newFakeAuthenticationStore(AdminAuthentication{
		Admin: Admin{
			ID:             7,
			Username:       "admin",
			Role:           "SUPER_ADMIN",
			Status:         "ACTIVE",
			SessionVersion: 2,
		},
		PasswordHash: authPasswordHash(t, "current-password"),
		CreatedAt:    time.Now(),
	})
	store.fakeStore.admin = Admin{
		ID:             7,
		Username:       "admin",
		Role:           "SUPER_ADMIN",
		Status:         "ACTIVE",
		SessionVersion: 1,
	}
	server := authTestServer(store, &fakeLoginProtectionStore{counts: make(map[string]int64), ttls: make(map[string]time.Duration)})
	staleToken := authAdminToken(t, store.fakeStore.admin, server.now())

	request := authJSONRequest(http.MethodGet, "/admin/auth/me", "", staleToken)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), `"code":"INVALID_TOKEN"`) {
		t.Fatalf("stale me response = %d %s", response.Code, response.Body.String())
	}

	request = authJSONRequest(http.MethodPost, "/admin/auth/change-password", `{"oldPassword":"current-password","newPassword":"replacement-password"}`, staleToken)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), `"code":"INVALID_TOKEN"`) || store.changePasswordCall != 0 || len(response.Result().Cookies()) != 0 {
		t.Fatalf("stale mutation response = %d %s calls=%d cookies=%v", response.Code, response.Body.String(), store.changePasswordCall, response.Result().Cookies())
	}
}

func TestAdministratorTwoFactorLifecycleRotatesRevocableSessions(t *testing.T) {
	store := newFakeAuthenticationStore(AdminAuthentication{
		Admin:        Admin{ID: 7, Username: "admin", Role: "SUPER_ADMIN", Status: "ACTIVE", SessionVersion: 1},
		PasswordHash: authPasswordHash(t, "current-password"),
		CreatedAt:    time.Now(),
	})
	server := authTestServer(store, &fakeLoginProtectionStore{counts: make(map[string]int64), ttls: make(map[string]time.Duration)})
	versionOneToken := authAdminToken(t, store.record.Admin, server.now())

	request := authJSONRequest(http.MethodPost, "/admin/auth/2fa/setup", "", versionOneToken)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || len(response.Result().Cookies()) != 0 {
		t.Fatalf("2FA setup response = %d %s cookies=%v", response.Code, response.Body.String(), response.Result().Cookies())
	}
	var setupEnvelope struct {
		Success bool `json:"success"`
		Data    struct {
			Secret     string `json:"secret"`
			OTPAuthURL string `json:"otpauthUrl"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &setupEnvelope); err != nil {
		t.Fatal(err)
	}
	if !setupEnvelope.Success || len(setupEnvelope.Data.Secret) != 32 ||
		!strings.HasPrefix(setupEnvelope.Data.OTPAuthURL, "otpauth://totp/all-Mail%3Aadmin?") ||
		!strings.Contains(setupEnvelope.Data.OTPAuthURL, "issuer=all-Mail&algorithm=SHA1&digits=6&period=30") {
		t.Fatalf("2FA setup envelope = %#v", setupEnvelope)
	}
	if store.record.TwoFactorTempSecret == nil {
		t.Fatal("2FA setup did not persist a temporary secret")
	}
	decrypted, err := legacycrypto.Decrypt(authTestEncryptionKey, *store.record.TwoFactorTempSecret)
	if err != nil || decrypted != setupEnvelope.Data.Secret || store.record.SessionVersion != 1 {
		t.Fatalf("temporary 2FA secret = %q, %v; version=%d", decrypted, err, store.record.SessionVersion)
	}

	request = authJSONRequest(http.MethodGet, "/admin/auth/2fa/status", "", versionOneToken)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"enabled":false`) || !strings.Contains(response.Body.String(), `"pending":true`) {
		t.Fatalf("pending 2FA status = %d %s", response.Code, response.Body.String())
	}

	otp := authTOTPCode(t, setupEnvelope.Data.Secret, server.now())
	request = authJSONRequest(http.MethodPost, "/admin/auth/2fa/enable", `{"otp":"`+otp+`"}`, versionOneToken)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"enabled":true`) {
		t.Fatalf("enable 2FA response = %d %s", response.Code, response.Body.String())
	}
	versionTwoCookie := requireSessionCookie(t, response)
	versionTwoClaims, err := verifyJWT(versionTwoCookie.Value, testJWTSecret, server.now(), adminJWTAudience)
	if err != nil || versionTwoClaims.SessionVersion != 2 || !store.record.TwoFactorEnabled || store.record.TwoFactorTempSecret != nil {
		t.Fatalf("enabled 2FA state = claims %#v err=%v record=%#v", versionTwoClaims, err, store.record)
	}

	request = authJSONRequest(http.MethodGet, "/admin/auth/2fa/status", "", versionOneToken)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("pre-enable session response = %d %s", response.Code, response.Body.String())
	}
	request = authJSONRequest(http.MethodPost, "/admin/auth/2fa/setup", "", versionTwoCookie.Value)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), `"code":"TWO_FACTOR_ENABLED"`) {
		t.Fatalf("repeat setup response = %d %s", response.Code, response.Body.String())
	}
	request = authJSONRequest(http.MethodPost, "/admin/auth/2fa/enable", `{"otp":"`+otp+`"}`, versionTwoCookie.Value)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"enabled":true`) || len(response.Result().Cookies()) != 0 || store.enableCalls != 1 {
		t.Fatalf("repeat enable response = %d %s calls=%d cookies=%v", response.Code, response.Body.String(), store.enableCalls, response.Result().Cookies())
	}

	request = authJSONRequest(http.MethodPost, "/admin/auth/2fa/disable", `{"password":"wrong","otp":"`+otp+`"}`, versionTwoCookie.Value)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), `"code":"INVALID_PASSWORD"`) || store.disableCalls != 0 {
		t.Fatalf("invalid disable response = %d %s calls=%d", response.Code, response.Body.String(), store.disableCalls)
	}

	request = authJSONRequest(http.MethodPost, "/admin/auth/2fa/disable", `{"password":"current-password","otp":"`+otp+`"}`, versionTwoCookie.Value)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"enabled":false`) {
		t.Fatalf("disable 2FA response = %d %s", response.Code, response.Body.String())
	}
	versionThreeCookie := requireSessionCookie(t, response)
	versionThreeClaims, err := verifyJWT(versionThreeCookie.Value, testJWTSecret, server.now(), adminJWTAudience)
	if err != nil || versionThreeClaims.SessionVersion != 3 || store.record.TwoFactorEnabled || store.record.TwoFactorSecret != nil {
		t.Fatalf("disabled 2FA state = claims %#v err=%v record=%#v", versionThreeClaims, err, store.record)
	}

	request = authJSONRequest(http.MethodGet, "/admin/auth/2fa/status", "", versionTwoCookie.Value)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("pre-disable session response = %d %s", response.Code, response.Body.String())
	}
	request = authJSONRequest(http.MethodGet, "/admin/auth/2fa/status", "", versionThreeCookie.Value)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"enabled":false`) || !strings.Contains(response.Body.String(), `"pending":false`) {
		t.Fatalf("disabled 2FA status = %d %s", response.Code, response.Body.String())
	}
	request = authJSONRequest(http.MethodPost, "/admin/auth/2fa/disable", `{"password":"current-password","otp":"000000"}`, versionThreeCookie.Value)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"enabled":false`) || len(response.Result().Cookies()) != 0 || store.disableCalls != 1 {
		t.Fatalf("repeat disable response = %d %s calls=%d cookies=%v", response.Code, response.Body.String(), store.disableCalls, response.Result().Cookies())
	}
}

func TestAdministratorLogoutClearsCompatibleCookie(t *testing.T) {
	server := testServer(&fakeStore{})
	server.cfg.SecureCookies = true
	request := httptest.NewRequest(http.MethodPost, "/admin/auth/logout", nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"code":"AUTH_LOGGED_OUT"`) {
		t.Fatalf("logout response = %d %s", response.Code, response.Body.String())
	}
	cookies := response.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("logout cookies = %#v", cookies)
	}
	cookie := cookies[0]
	if cookie.Name != "token" || cookie.Value != "" || cookie.Path != "/" || !cookie.HttpOnly || !cookie.Secure ||
		cookie.SameSite != http.SameSiteLaxMode || cookie.MaxAge >= 0 {
		t.Fatalf("logout cookie = %#v", cookie)
	}
}

func authTestServer(store *fakeAuthenticationStore, protection *fakeLoginProtectionStore) *Server {
	server := testServer(store)
	server.authStore = store
	server.loginStore = protection
	server.cfg.EncryptionKey = authTestEncryptionKey
	server.cfg.Admin2FAWindow = 1
	server.cfg.JWTLifetime = 2 * time.Hour
	server.cfg.AdminLoginMaxAttempts = 5
	server.cfg.AdminLoginLockDuration = 15 * time.Minute
	return server
}

func authJSONRequest(method, target, body, token string) *http.Request {
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		request.AddCookie(&http.Cookie{Name: "token", Value: token})
	}
	return request
}

func authPasswordHash(t *testing.T, password string) string {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 10)
	if err != nil {
		t.Fatal(err)
	}
	return string(hash)
}

func authAdminToken(t *testing.T, admin Admin, now time.Time) string {
	t.Helper()
	token, err := signSessionJWT(sessionJWTClaims{
		Subject: admin.ID, Audience: adminJWTAudience, SessionVersion: admin.SessionVersion,
		Username: admin.Username, Role: admin.Role,
	}, testJWTSecret, now, 2*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func authTOTPCode(t *testing.T, secret string, now time.Time) string {
	t.Helper()
	decoded, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(secret)
	if err != nil {
		t.Fatal(err)
	}
	return totpCode(decoded, now.Unix()/30)
}

func requireSessionCookie(t *testing.T, response *httptest.ResponseRecorder) *http.Cookie {
	t.Helper()
	cookies := response.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != "token" || cookies[0].Value == "" {
		t.Fatalf("session cookies = %#v", cookies)
	}
	return cookies[0]
}

func assertSessionCookieAttributes(t *testing.T, cookie *http.Cookie, secure bool, maxAge int) {
	t.Helper()
	if cookie.Path != "/" || !cookie.HttpOnly || cookie.Secure != secure || cookie.SameSite != http.SameSiteLaxMode || cookie.MaxAge != maxAge {
		t.Fatalf("session cookie = %#v", cookie)
	}
}
