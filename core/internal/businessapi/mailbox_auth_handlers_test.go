package businessapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/legacycrypto"
	"golang.org/x/crypto/bcrypt"
)

type fakeMailboxAuthenticationStore struct {
	record              MailboxIdentity
	findIdentifierCalls int
	findIdentityCalls   int
	recordLoginCalls    int
	changePasswordCalls int
	setupCalls          int
	enableCalls         int
	disableCalls        int
	lastLoginAt         time.Time
	lastLoginIP         string
	operationErr        error
}

func (s *fakeMailboxAuthenticationStore) FindMailboxAuthenticationByIdentifier(_ context.Context, identifier string) (MailboxIdentity, error) {
	s.findIdentifierCalls++
	if s.operationErr != nil {
		return MailboxIdentity{}, s.operationErr
	}
	if identifier != s.record.Username && (s.record.Email == nil || identifier != *s.record.Email) {
		return MailboxIdentity{}, errNotFound
	}
	return s.record, nil
}

func (s *fakeMailboxAuthenticationStore) FindMailboxIdentity(_ context.Context, id int64) (MailboxIdentity, error) {
	s.findIdentityCalls++
	if s.operationErr != nil {
		return MailboxIdentity{}, s.operationErr
	}
	if id != s.record.ID {
		return MailboxIdentity{}, errNotFound
	}
	return s.record, nil
}

func (s *fakeMailboxAuthenticationStore) RecordMailboxLogin(_ context.Context, id, sessionVersion int64, at time.Time, ip string) (MailboxIdentity, error) {
	s.recordLoginCalls++
	if s.operationErr != nil {
		return MailboxIdentity{}, s.operationErr
	}
	if id != s.record.ID || sessionVersion != s.record.SessionVersion {
		return MailboxIdentity{}, errNotFound
	}
	s.lastLoginAt = at
	s.lastLoginIP = ip
	s.record.LastLoginAt = &at
	s.record.LastLoginIP = &ip
	return s.record, nil
}

func (s *fakeMailboxAuthenticationStore) ChangeMailboxPassword(_ context.Context, id, sessionVersion int64, expectedHash, newHash string) (MailboxIdentity, error) {
	s.changePasswordCalls++
	if s.operationErr != nil {
		return MailboxIdentity{}, s.operationErr
	}
	if id != s.record.ID || sessionVersion != s.record.SessionVersion || expectedHash != s.record.PasswordHash {
		return MailboxIdentity{}, errNotFound
	}
	s.record.PasswordHash = newHash
	s.record.MustChangePassword = false
	s.record.SessionVersion++
	return s.record, nil
}

func (s *fakeMailboxAuthenticationStore) SetMailboxTwoFactorSecret(_ context.Context, id, sessionVersion int64, encryptedSecret string) (MailboxIdentity, error) {
	s.setupCalls++
	if s.operationErr != nil {
		return MailboxIdentity{}, s.operationErr
	}
	if id != s.record.ID || sessionVersion != s.record.SessionVersion || s.record.TwoFactorEnabled {
		return MailboxIdentity{}, errNotFound
	}
	s.record.TwoFactorSecret = &encryptedSecret
	s.record.SessionVersion++
	return s.record, nil
}

func (s *fakeMailboxAuthenticationStore) EnableMailboxTwoFactor(_ context.Context, id, sessionVersion int64, expectedSecret string) (MailboxIdentity, error) {
	s.enableCalls++
	if s.operationErr != nil {
		return MailboxIdentity{}, s.operationErr
	}
	if id != s.record.ID || sessionVersion != s.record.SessionVersion || s.record.TwoFactorEnabled ||
		s.record.TwoFactorSecret == nil || expectedSecret != *s.record.TwoFactorSecret {
		return MailboxIdentity{}, errNotFound
	}
	s.record.TwoFactorEnabled = true
	s.record.SessionVersion++
	return s.record, nil
}

func (s *fakeMailboxAuthenticationStore) DisableMailboxTwoFactor(_ context.Context, id, sessionVersion int64, expectedSecret string) (MailboxIdentity, error) {
	s.disableCalls++
	if s.operationErr != nil {
		return MailboxIdentity{}, s.operationErr
	}
	if id != s.record.ID || sessionVersion != s.record.SessionVersion || !s.record.TwoFactorEnabled ||
		s.record.TwoFactorSecret == nil || expectedSecret != *s.record.TwoFactorSecret {
		return MailboxIdentity{}, errNotFound
	}
	s.record.TwoFactorEnabled = false
	s.record.TwoFactorSecret = nil
	s.record.SessionVersion++
	return s.record, nil
}

func TestMailboxAuthenticationRoutesAreRegisteredThroughServerHandler(t *testing.T) {
	server := testServer(&fakeStore{})
	testCases := []struct {
		method     string
		target     string
		body       string
		wantStatus int
	}{
		{method: http.MethodPost, target: "/mail/api/login", body: `{}`, wantStatus: http.StatusBadRequest},
		{method: http.MethodPost, target: "/mail/api/logout", wantStatus: http.StatusOK},
		{method: http.MethodGet, target: "/mail/api/session", wantStatus: http.StatusUnauthorized},
		{method: http.MethodPost, target: "/mail/api/change-password", wantStatus: http.StatusUnauthorized},
		{method: http.MethodGet, target: "/mail/api/2fa/status", wantStatus: http.StatusUnauthorized},
		{method: http.MethodPost, target: "/mail/api/2fa/setup", wantStatus: http.StatusUnauthorized},
		{method: http.MethodPost, target: "/mail/api/2fa/enable", wantStatus: http.StatusUnauthorized},
		{method: http.MethodPost, target: "/mail/api/2fa/disable", wantStatus: http.StatusUnauthorized},
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

func TestMailboxLoginReturnsCurrentMembershipSessionAndMetadata(t *testing.T) {
	email := "portal@example.test"
	pendingSecret, err := legacycrypto.Encrypt(authTestEncryptionKey, "JBSWY3DPEHPK3PXP")
	if err != nil {
		t.Fatal(err)
	}
	store := &fakeMailboxAuthenticationStore{record: MailboxIdentity{
		ID: 17, Username: "portal-user", Email: &email,
		PasswordHash: authPasswordHash(t, "temporary-password"),
		Status:       "ACTIVE", MustChangePassword: true, SessionVersion: 4,
		TwoFactorSecret: &pendingSecret, MailboxIDs: []int64{11, 12},
	}}
	protection := &fakeLoginProtectionStore{
		counts: map[string]int64{"auth:mailbox:login:attempt:mailbox-login:portal@example.test:203.0.113.8": 1},
		ttls:   map[string]time.Duration{"auth:mailbox:login:attempt:mailbox-login:portal@example.test:203.0.113.8": 15 * time.Minute},
	}
	server := mailboxAuthTestServer(store, protection)
	request := mailboxJSONRequest(http.MethodPost, "/mail/api/login", `{"username":" portal@example.test ","password":"temporary-password"}`, "")
	request.RemoteAddr = "203.0.113.8:4321"
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("login response = %d %s", response.Code, response.Body.String())
	}
	for _, expected := range []string{
		`"success":true`, `"mailboxUser":{"email":"portal@example.test","id":17`,
		`"mailboxIds":[11,12]`, `"mustChangePassword":true`, `"username":"portal-user"`,
	} {
		if !strings.Contains(response.Body.String(), expected) {
			t.Fatalf("login response missing %s: %s", expected, response.Body.String())
		}
	}
	cookie := requireMailboxSessionCookie(t, response)
	assertSessionCookieAttributes(t, cookie, false, 7200)
	claims, err := verifyJWT(cookie.Value, testJWTSecret, server.now(), mailboxJWTAudience)
	if err != nil {
		t.Fatal(err)
	}
	if claims.Subject != "17" || claims.MailboxUserID != 17 || claims.SessionVersion != 4 ||
		claims.Username != "portal-user" || claims.Role != "MAILBOX_USER" || !equalInt64s(claims.MailboxIDs, []int64{11, 12}) {
		t.Fatalf("mailbox login claims = %#v", claims)
	}
	if store.recordLoginCalls != 1 || !store.lastLoginAt.Equal(server.now()) || store.lastLoginIP != "203.0.113.8" {
		t.Fatalf("login metadata = calls %d at %v ip %q", store.recordLoginCalls, store.lastLoginAt, store.lastLoginIP)
	}
	if len(protection.deleted) != 2 || protection.deleted[0] != "auth:mailbox:login:attempt:mailbox-login:portal@example.test:203.0.113.8" ||
		protection.deleted[1] != "auth:mailbox:login:lock:mailbox-login:portal@example.test:203.0.113.8" {
		t.Fatalf("cleared mailbox login keys = %#v", protection.deleted)
	}
	if store.record.TwoFactorEnabled {
		t.Fatal("pending two-factor secret unexpectedly required OTP")
	}
}

func TestMailboxLoginLockoutIsIndependentAndFailsClosed(t *testing.T) {
	store := &fakeMailboxAuthenticationStore{record: MailboxIdentity{
		ID: 17, Username: "portal-user", PasswordHash: authPasswordHash(t, "correct-password"),
		Status: "ACTIVE", SessionVersion: 1,
	}}
	protection := &fakeLoginProtectionStore{counts: make(map[string]int64), ttls: make(map[string]time.Duration)}
	server := mailboxAuthTestServer(store, protection)
	server.cfg.AdminLoginMaxAttempts = 2
	server.cfg.AdminLoginLockDuration = 15 * time.Minute

	for attempt, wantStatus := range []int{http.StatusUnauthorized, http.StatusTooManyRequests} {
		request := mailboxJSONRequest(http.MethodPost, "/mail/api/login", `{"username":" User@Example.com ","password":"wrong"}`, "")
		request.RemoteAddr = "198.51.100.7:4000"
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != wantStatus {
			t.Fatalf("attempt %d response = %d %s", attempt+1, response.Code, response.Body.String())
		}
	}
	lockKey := "auth:mailbox:login:lock:mailbox-login:user@example.com:198.51.100.7"
	if protection.ttls[lockKey] != 15*time.Minute {
		t.Fatalf("mailbox lock state = %#v", protection.ttls)
	}
	for key := range protection.ttls {
		if strings.HasPrefix(key, "auth:admin:") {
			t.Fatalf("mailbox failure touched administrator key %q", key)
		}
	}

	findCalls := store.findIdentifierCalls
	request := mailboxJSONRequest(http.MethodPost, "/mail/api/login", `{"username":"User@Example.com","password":"correct-password"}`, "")
	request.RemoteAddr = "198.51.100.7:4000"
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusTooManyRequests || store.findIdentifierCalls != findCalls {
		t.Fatalf("locked response = %d %s; find calls %d", response.Code, response.Body.String(), store.findIdentifierCalls)
	}

	protection.err = errors.New("redis unavailable")
	request = mailboxJSONRequest(http.MethodPost, "/mail/api/login", `{"username":"portal-user","password":"correct-password"}`, "")
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), `"code":"LOGIN_SECURITY_BACKEND_UNAVAILABLE"`) {
		t.Fatalf("fail-closed response = %d %s", response.Code, response.Body.String())
	}
}

func TestMailboxLoginRequiresOTPOnlyWhenTwoFactorIsEnabled(t *testing.T) {
	const secret = "JBSWY3DPEHPK3PXP"
	encryptedSecret, err := legacycrypto.Encrypt(authTestEncryptionKey, secret)
	if err != nil {
		t.Fatal(err)
	}
	store := &fakeMailboxAuthenticationStore{record: MailboxIdentity{
		ID: 17, Username: "portal-user", PasswordHash: authPasswordHash(t, "correct-password"),
		Status: "ACTIVE", SessionVersion: 1, TwoFactorEnabled: true, TwoFactorSecret: &encryptedSecret,
		MailboxIDs: []int64{11},
	}}
	protection := &fakeLoginProtectionStore{counts: make(map[string]int64), ttls: make(map[string]time.Duration)}
	server := mailboxAuthTestServer(store, protection)

	request := mailboxJSONRequest(http.MethodPost, "/mail/api/login", `{"username":"portal-user","password":"correct-password"}`, "")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), `"code":"OTP_REQUIRED"`) || len(protection.counts) != 0 {
		t.Fatalf("missing OTP response = %d %s; attempts=%#v", response.Code, response.Body.String(), protection.counts)
	}

	otp := authTOTPCode(t, secret, server.now())
	request = mailboxJSONRequest(http.MethodPost, "/mail/api/login", `{"username":"portal-user","password":"correct-password","otp":"`+otp+`"}`, "")
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("valid OTP response = %d %s", response.Code, response.Body.String())
	}
}

func TestMailboxIdentityIgnoresJWTMembershipsAndAllowsForcedPasswordRotation(t *testing.T) {
	email := "portal@example.test"
	lastLogin := time.Date(2026, 8, 1, 10, 0, 0, 0, time.UTC)
	store := &fakeMailboxAuthenticationStore{record: MailboxIdentity{
		ID: 17, Username: "portal-user", Email: &email,
		PasswordHash: authPasswordHash(t, "temporary-password"), Status: "ACTIVE",
		MustChangePassword: true, SessionVersion: 1, LastLoginAt: &lastLogin,
		MailboxIDs: []int64{11, 12},
	}}
	server := mailboxAuthTestServer(store, &fakeLoginProtectionStore{counts: make(map[string]int64), ttls: make(map[string]time.Duration)})
	oldToken := authMailboxToken(t, store.record, []int64{999}, server.now())

	request := mailboxJSONRequest(http.MethodGet, "/mail/api/session", "", oldToken)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"authenticated":true`) ||
		!strings.Contains(response.Body.String(), `"mailboxIds":[11,12]`) || strings.Contains(response.Body.String(), "999") {
		t.Fatalf("database-authoritative session = %d %s", response.Code, response.Body.String())
	}
	for _, expected := range []string{`"status":"ACTIVE"`, `"mustChangePassword":true`, `"lastLoginAt":"2026-08-01T10:00:00.000Z"`} {
		if !strings.Contains(response.Body.String(), expected) {
			t.Fatalf("session response missing %s: %s", expected, response.Body.String())
		}
	}

	request = mailboxJSONRequest(http.MethodGet, "/mail/api/2fa/status", "", oldToken)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), `"code":"PASSWORD_CHANGE_REQUIRED"`) {
		t.Fatalf("forced-password 2FA response = %d %s", response.Code, response.Body.String())
	}
	request = mailboxJSONRequest(http.MethodPost, "/mail/api/logout", "", oldToken)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("forced-password logout response = %d %s", response.Code, response.Body.String())
	}

	request = mailboxJSONRequest(http.MethodPost, "/mail/api/change-password", `{"oldPassword":"temporary-password","newPassword":"replacement-password"}`, oldToken)
	request.Header.Set("X-Forwarded-Proto", "https")
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"data":{"success":true}`) {
		t.Fatalf("change-password response = %d %s", response.Code, response.Body.String())
	}
	newCookie := requireMailboxSessionCookie(t, response)
	assertSessionCookieAttributes(t, newCookie, true, 7200)
	claims, err := verifyJWT(newCookie.Value, testJWTSecret, server.now(), mailboxJWTAudience)
	if err != nil || claims.SessionVersion != 2 || !equalInt64s(claims.MailboxIDs, []int64{11, 12}) {
		t.Fatalf("rotated mailbox claims = %#v, %v", claims, err)
	}
	if store.changePasswordCalls != 1 || store.record.MustChangePassword {
		t.Fatalf("mailbox password mutation = calls %d record %#v", store.changePasswordCalls, store.record)
	}
	if err := bcrypt.CompareHashAndPassword([]byte(store.record.PasswordHash), []byte("replacement-password")); err != nil {
		t.Fatalf("replacement password does not match: %v", err)
	}
	if cost, err := bcrypt.Cost([]byte(store.record.PasswordHash)); err != nil || cost != 10 {
		t.Fatalf("replacement password cost = %d, %v", cost, err)
	}

	request = mailboxJSONRequest(http.MethodGet, "/mail/api/session", "", oldToken)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), `"code":"INVALID_MAILBOX_TOKEN"`) {
		t.Fatalf("old mailbox session response = %d %s", response.Code, response.Body.String())
	}
	store.record.MailboxIDs = []int64{12, 13}
	request = mailboxJSONRequest(http.MethodGet, "/mail/api/session", "", newCookie.Value)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"mailboxIds":[12,13]`) || strings.Contains(response.Body.String(), `"mailboxIds":[11,12]`) {
		t.Fatalf("refreshed membership session = %d %s", response.Code, response.Body.String())
	}

	store.record.Status = "DISABLED"
	request = mailboxJSONRequest(http.MethodGet, "/mail/api/session", "", newCookie.Value)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), `"code":"ACCOUNT_DISABLED"`) {
		t.Fatalf("disabled mailbox identity response = %d %s", response.Code, response.Body.String())
	}
}

func TestMailboxTwoFactorLifecycleUsesPendingSecretAndRotatesSessions(t *testing.T) {
	store := &fakeMailboxAuthenticationStore{record: MailboxIdentity{
		ID: 17, Username: "portal-user", PasswordHash: authPasswordHash(t, "current-password"),
		Status: "ACTIVE", SessionVersion: 1, MailboxIDs: []int64{11, 12},
	}}
	server := mailboxAuthTestServer(store, &fakeLoginProtectionStore{counts: make(map[string]int64), ttls: make(map[string]time.Duration)})
	versionOneToken := authMailboxToken(t, store.record, store.record.MailboxIDs, server.now())

	request := mailboxJSONRequest(http.MethodPost, "/mail/api/2fa/setup", "", versionOneToken)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("mailbox 2FA setup response = %d %s", response.Code, response.Body.String())
	}
	versionTwoCookie := requireMailboxSessionCookie(t, response)
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
		!strings.HasPrefix(setupEnvelope.Data.OTPAuthURL, "otpauth://totp/all-Mail%3Aportal-user?") {
		t.Fatalf("mailbox 2FA setup envelope = %#v", setupEnvelope)
	}
	if store.record.TwoFactorSecret == nil || store.record.TwoFactorEnabled || store.record.SessionVersion != 2 {
		t.Fatalf("pending mailbox 2FA state = %#v", store.record)
	}
	decrypted, err := legacycrypto.Decrypt(authTestEncryptionKey, *store.record.TwoFactorSecret)
	if err != nil || decrypted != setupEnvelope.Data.Secret {
		t.Fatalf("pending mailbox secret = %q, %v", decrypted, err)
	}
	versionTwoClaims, err := verifyJWT(versionTwoCookie.Value, testJWTSecret, server.now(), mailboxJWTAudience)
	if err != nil || versionTwoClaims.SessionVersion != 2 {
		t.Fatalf("setup rotation claims = %#v, %v", versionTwoClaims, err)
	}

	request = mailboxJSONRequest(http.MethodGet, "/mail/api/2fa/status", "", versionOneToken)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("pre-setup mailbox session response = %d %s", response.Code, response.Body.String())
	}
	request = mailboxJSONRequest(http.MethodGet, "/mail/api/2fa/status", "", versionTwoCookie.Value)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"enabled":false`) || !strings.Contains(response.Body.String(), `"pending":true`) {
		t.Fatalf("pending mailbox 2FA status = %d %s", response.Code, response.Body.String())
	}

	otp := authTOTPCode(t, setupEnvelope.Data.Secret, server.now())
	request = mailboxJSONRequest(http.MethodPost, "/mail/api/2fa/enable", `{"otp":"`+otp+`"}`, versionTwoCookie.Value)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"enabled":true`) {
		t.Fatalf("enable mailbox 2FA response = %d %s", response.Code, response.Body.String())
	}
	versionThreeCookie := requireMailboxSessionCookie(t, response)
	versionThreeClaims, err := verifyJWT(versionThreeCookie.Value, testJWTSecret, server.now(), mailboxJWTAudience)
	if err != nil || versionThreeClaims.SessionVersion != 3 || !store.record.TwoFactorEnabled {
		t.Fatalf("enabled mailbox 2FA state = claims %#v err=%v record=%#v", versionThreeClaims, err, store.record)
	}
	request = mailboxJSONRequest(http.MethodPost, "/mail/api/2fa/enable", `{"otp":"`+otp+`"}`, versionThreeCookie.Value)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"enabled":true`) || len(response.Result().Cookies()) != 0 || store.enableCalls != 1 {
		t.Fatalf("repeat mailbox enable response = %d %s calls=%d cookies=%v", response.Code, response.Body.String(), store.enableCalls, response.Result().Cookies())
	}

	request = mailboxJSONRequest(http.MethodPost, "/mail/api/2fa/disable", `{"password":"wrong","otp":"`+otp+`"}`, versionThreeCookie.Value)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), `"code":"INVALID_PASSWORD"`) || store.disableCalls != 0 {
		t.Fatalf("invalid mailbox disable response = %d %s calls=%d", response.Code, response.Body.String(), store.disableCalls)
	}
	request = mailboxJSONRequest(http.MethodPost, "/mail/api/2fa/disable", `{"password":"current-password","otp":"`+otp+`"}`, versionThreeCookie.Value)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"enabled":false`) {
		t.Fatalf("disable mailbox 2FA response = %d %s", response.Code, response.Body.String())
	}
	versionFourCookie := requireMailboxSessionCookie(t, response)
	versionFourClaims, err := verifyJWT(versionFourCookie.Value, testJWTSecret, server.now(), mailboxJWTAudience)
	if err != nil || versionFourClaims.SessionVersion != 4 || store.record.TwoFactorEnabled || store.record.TwoFactorSecret != nil {
		t.Fatalf("disabled mailbox 2FA state = claims %#v err=%v record=%#v", versionFourClaims, err, store.record)
	}

	request = mailboxJSONRequest(http.MethodGet, "/mail/api/2fa/status", "", versionThreeCookie.Value)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("pre-disable mailbox session response = %d %s", response.Code, response.Body.String())
	}
	request = mailboxJSONRequest(http.MethodGet, "/mail/api/2fa/status", "", versionFourCookie.Value)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"enabled":false`) || !strings.Contains(response.Body.String(), `"pending":false`) {
		t.Fatalf("disabled mailbox 2FA status = %d %s", response.Code, response.Body.String())
	}
	request = mailboxJSONRequest(http.MethodPost, "/mail/api/2fa/disable", `{"password":"current-password","otp":"000000"}`, versionFourCookie.Value)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"enabled":false`) || len(response.Result().Cookies()) != 0 || store.disableCalls != 1 {
		t.Fatalf("repeat mailbox disable response = %d %s calls=%d cookies=%v", response.Code, response.Body.String(), store.disableCalls, response.Result().Cookies())
	}
}

func TestMailboxLogoutClearsCompatibleCookie(t *testing.T) {
	server := testServer(&fakeStore{})
	request := httptest.NewRequest(http.MethodPost, "/mail/api/logout", nil)
	request.Header.Set("X-Forwarded-Proto", "https")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"code":"MAILBOX_PORTAL_LOGGED_OUT"`) {
		t.Fatalf("mailbox logout response = %d %s", response.Code, response.Body.String())
	}
	cookies := response.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("mailbox logout cookies = %#v", cookies)
	}
	cookie := cookies[0]
	if cookie.Name != "mailbox_token" || cookie.Value != "" || cookie.Path != "/" || !cookie.HttpOnly || !cookie.Secure ||
		cookie.SameSite != http.SameSiteLaxMode || cookie.MaxAge >= 0 {
		t.Fatalf("mailbox logout cookie = %#v", cookie)
	}
}

func mailboxAuthTestServer(store *fakeMailboxAuthenticationStore, protection *fakeLoginProtectionStore) *Server {
	server := testServer(&fakeStore{})
	server.mailboxAuthStore = store
	server.loginStore = protection
	server.cfg.EncryptionKey = authTestEncryptionKey
	server.cfg.Admin2FAWindow = 1
	server.cfg.JWTLifetime = 2 * time.Hour
	server.cfg.AdminLoginMaxAttempts = 5
	server.cfg.AdminLoginLockDuration = 15 * time.Minute
	return server
}

func mailboxJSONRequest(method, target, body, token string) *http.Request {
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		request.AddCookie(&http.Cookie{Name: "mailbox_token", Value: token})
	}
	return request
}

func authMailboxToken(t *testing.T, identity MailboxIdentity, mailboxIDs []int64, now time.Time) string {
	t.Helper()
	token, err := signSessionJWT(sessionJWTClaims{
		Subject: identity.ID, Audience: mailboxJWTAudience, SessionVersion: identity.SessionVersion,
		Username: identity.Username, Role: "MAILBOX_USER", MailboxUserID: identity.ID, MailboxIDs: mailboxIDs,
	}, testJWTSecret, now, 2*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func requireMailboxSessionCookie(t *testing.T, response *httptest.ResponseRecorder) *http.Cookie {
	t.Helper()
	cookies := response.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != "mailbox_token" || cookies[0].Value == "" {
		t.Fatalf("mailbox session cookies = %#v", cookies)
	}
	return cookies[0]
}

func equalInt64s(left, right []int64) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
