package businessapi

import (
	"errors"
	"net/http"
	"os"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/feng123-new/all-Mail/core/internal/legacycrypto"
	"golang.org/x/crypto/bcrypt"
)

const (
	adminSessionCookieName   = "token"
	adminSessionCookieMaxAge = 2 * 60 * 60
	adminPasswordHashCost    = 10
)

type adminLoginRequest struct {
	Username string  `json:"username"`
	Password string  `json:"password"`
	OTP      *string `json:"otp"`
}

type adminChangePasswordRequest struct {
	OldPassword string `json:"oldPassword"`
	NewPassword string `json:"newPassword"`
}

type adminVerifyTwoFactorRequest struct {
	OTP string `json:"otp"`
}

type adminDisableTwoFactorRequest struct {
	Password string `json:"password"`
	OTP      string `json:"otp"`
}

func (s *Server) registerAuthenticationRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /admin/auth/login", s.adminLogin)
	mux.HandleFunc("POST /admin/auth/logout", s.adminLogout)
	mux.HandleFunc("GET /admin/auth/me", s.withAdministratorIdentity(s.adminMe))
	mux.HandleFunc("POST /admin/auth/change-password", s.withAdministratorIdentity(s.adminChangePassword))
	mux.HandleFunc("GET /admin/auth/2fa/status", s.withAdministrator(s.adminTwoFactorStatus))
	mux.HandleFunc("POST /admin/auth/2fa/setup", s.withAdministrator(s.adminTwoFactorSetup))
	mux.HandleFunc("POST /admin/auth/2fa/enable", s.withAdministrator(s.adminTwoFactorEnable))
	mux.HandleFunc("POST /admin/auth/2fa/disable", s.withAdministrator(s.adminTwoFactorDisable))
}

func (s *Server) adminLogin(w http.ResponseWriter, r *http.Request) {
	var body adminLoginRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if body.Username == "" {
		s.writeRequestError(w, r, validationError("username is required"))
		return
	}
	if body.Password == "" {
		s.writeRequestError(w, r, validationError("password is required"))
		return
	}
	if body.OTP != nil && !validTOTPToken(*body.OTP) {
		s.writeRequestError(w, r, validationError("otp must contain 6 digits"))
		return
	}
	store, err := s.requireAuthenticationStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	protector, err := s.adminLoginProtector()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	ctx, cancel := s.databaseContext(r.Context())
	defer cancel()
	r = r.WithContext(ctx)
	cacheKey := buildLoginProtectionCacheKey("admin", body.Username, requestClientIP(r))
	remaining, err := protector.lockRemaining(ctx, cacheKey)
	if err != nil {
		s.writeRequestError(w, r, loginSecurityBackendError(err))
		return
	}
	if remaining > 0 {
		s.writeRequestError(w, r, &requestError{Status: http.StatusTooManyRequests, Code: "ACCOUNT_LOCKED"})
		return
	}

	admin, err := store.FindAdminAuthenticationByUsername(ctx, body.Username)
	if errors.Is(err, errNotFound) {
		s.writeLoginFailure(w, r, protector, cacheKey, nil)
		return
	}
	if err != nil {
		s.writeStoreError(w, r, "load administrator login", err)
		return
	}
	if admin.Status != "ACTIVE" {
		s.writeRequestError(w, r, &requestError{Status: http.StatusForbidden, Code: "ACCOUNT_DISABLED"})
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(admin.PasswordHash), []byte(body.Password)) != nil {
		s.writeLoginFailure(w, r, protector, cacheKey, nil)
		return
	}
	if admin.TwoFactorEnabled {
		if body.OTP == nil {
			s.writeRequestError(w, r, &requestError{Status: http.StatusUnauthorized, Code: "OTP_REQUIRED"})
			return
		}
		if admin.TwoFactorSecret == nil || *admin.TwoFactorSecret == "" {
			s.writeRequestError(w, r, &requestError{Status: http.StatusInternalServerError, Code: "TWO_FACTOR_CONFIGURATION_INVALID"})
			return
		}
		secret, decryptErr := legacycrypto.Decrypt(s.cfg.EncryptionKey, *admin.TwoFactorSecret)
		if decryptErr != nil {
			s.writeRequestError(w, r, &requestError{Status: http.StatusInternalServerError, Code: "TWO_FACTOR_SECRET_INVALID", Cause: decryptErr})
			return
		}
		if !verifyTOTP(secret, *body.OTP, s.cfg.Admin2FAWindow, s.now()) {
			s.writeLoginFailure(w, r, protector, cacheKey, &requestError{Status: http.StatusUnauthorized, Code: "INVALID_OTP"})
			return
		}
	}
	if err := protector.clear(ctx, cacheKey); err != nil {
		s.writeRequestError(w, r, loginSecurityBackendError(err))
		return
	}
	admin, err = store.RecordAdminLogin(ctx, admin.ID, admin.SessionVersion, s.now(), requestClientIP(r))
	if errors.Is(err, errNotFound) {
		s.writeRequestError(w, r, &requestError{Status: http.StatusUnauthorized, Code: "INVALID_CREDENTIALS"})
		return
	}
	if err != nil {
		s.writeStoreError(w, r, "record administrator login", err)
		return
	}
	token, err := s.signAdminSession(admin)
	if err != nil {
		s.writeRequestError(w, r, &requestError{Status: http.StatusInternalServerError, Code: "INTERNAL_ERROR", Cause: err})
		return
	}
	s.setAdminSessionCookie(w, r, token)
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]any{
			"admin": map[string]any{
				"id":                 admin.ID,
				"username":           admin.Username,
				"role":               admin.Role,
				"mustChangePassword": admin.MustChangePassword,
				"twoFactorEnabled":   admin.TwoFactorEnabled,
			},
		},
	})
}

func (s *Server) adminLogout(w http.ResponseWriter, r *http.Request) {
	s.clearAdminSessionCookie(w, r)
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"data":    map[string]string{"code": "AUTH_LOGGED_OUT"},
	})
}

func (s *Server) adminMe(w http.ResponseWriter, r *http.Request, identity Admin) {
	admin, ok := s.loadAuthenticationAdmin(w, r, identity.ID, identity.SessionVersion)
	if !ok {
		return
	}
	var lastLoginAt any
	if admin.LastLoginAt != nil {
		lastLoginAt = formatAPITime(*admin.LastLoginAt)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]any{
			"id":                 admin.ID,
			"username":           admin.Username,
			"email":              admin.Email,
			"role":               admin.Role,
			"mustChangePassword": admin.MustChangePassword,
			"twoFactorEnabled":   admin.TwoFactorEnabled,
			"lastLoginAt":        lastLoginAt,
			"createdAt":          formatAPITime(admin.CreatedAt),
		},
	})
}

func (s *Server) adminChangePassword(w http.ResponseWriter, r *http.Request, identity Admin) {
	var body adminChangePasswordRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if body.OldPassword == "" {
		s.writeRequestError(w, r, validationError("oldPassword is required"))
		return
	}
	if utf8.RuneCountInString(body.NewPassword) < 8 {
		s.writeRequestError(w, r, validationError("newPassword must contain at least 8 characters"))
		return
	}
	admin, ok := s.loadAuthenticationAdmin(w, r, identity.ID, identity.SessionVersion)
	if !ok {
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(admin.PasswordHash), []byte(body.OldPassword)) != nil {
		s.writeRequestError(w, r, &requestError{Status: http.StatusBadRequest, Code: "INVALID_PASSWORD"})
		return
	}
	newHash, err := bcrypt.GenerateFromPassword([]byte(body.NewPassword), adminPasswordHashCost)
	if err != nil {
		s.writeRequestError(w, r, &requestError{Status: http.StatusInternalServerError, Code: "INTERNAL_ERROR", Cause: err})
		return
	}
	store, err := s.requireAuthenticationStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	admin, err = store.ChangeAdminPassword(r.Context(), admin.ID, admin.SessionVersion, admin.PasswordHash, string(newHash))
	if !s.writeAuthenticationMutationError(w, r, "change administrator password", err) {
		return
	}
	if identity.MustChangePassword {
		s.removeBootstrapAdminSecret(identity.Username)
	}
	token, err := s.signAdminSession(admin)
	if err != nil {
		s.writeRequestError(w, r, &requestError{Status: http.StatusInternalServerError, Code: "INTERNAL_ERROR", Cause: err})
		return
	}
	s.setAdminSessionCookie(w, r, token)
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"data":    map[string]string{"code": "AUTH_PASSWORD_CHANGED"},
	})
}

func (s *Server) adminTwoFactorStatus(w http.ResponseWriter, r *http.Request, identity Admin) {
	admin, ok := s.loadAuthenticationAdmin(w, r, identity.ID, identity.SessionVersion)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]bool{
			"enabled": admin.TwoFactorEnabled,
			"pending": admin.TwoFactorTempSecret != nil && *admin.TwoFactorTempSecret != "",
		},
	})
}

func (s *Server) adminTwoFactorSetup(w http.ResponseWriter, r *http.Request, identity Admin) {
	admin, ok := s.loadAuthenticationAdmin(w, r, identity.ID, identity.SessionVersion)
	if !ok {
		return
	}
	if admin.TwoFactorEnabled {
		s.writeRequestError(w, r, &requestError{Status: http.StatusBadRequest, Code: "TWO_FACTOR_ENABLED"})
		return
	}
	secret, err := generateTOTPSecret()
	if err != nil {
		s.writeRequestError(w, r, &requestError{Status: http.StatusInternalServerError, Code: "INTERNAL_ERROR", Cause: err})
		return
	}
	encryptedSecret, err := legacycrypto.Encrypt(s.cfg.EncryptionKey, secret)
	if err != nil {
		s.writeRequestError(w, r, &requestError{Status: http.StatusInternalServerError, Code: "INTERNAL_ERROR", Cause: err})
		return
	}
	store, err := s.requireAuthenticationStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	_, err = store.SetAdminTwoFactorTempSecret(r.Context(), admin.ID, admin.SessionVersion, encryptedSecret)
	if !s.writeAuthenticationMutationError(w, r, "store administrator two-factor setup", err) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]string{
			"secret":     secret,
			"otpauthUrl": buildTOTPURI(secret, admin.Username, "all-Mail"),
		},
	})
}

func (s *Server) adminTwoFactorEnable(w http.ResponseWriter, r *http.Request, identity Admin) {
	var body adminVerifyTwoFactorRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if !validTOTPToken(body.OTP) {
		s.writeRequestError(w, r, validationError("otp must contain 6 digits"))
		return
	}
	admin, ok := s.loadAuthenticationAdmin(w, r, identity.ID, identity.SessionVersion)
	if !ok {
		return
	}
	if admin.TwoFactorEnabled {
		writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]bool{"enabled": true}})
		return
	}
	if admin.TwoFactorTempSecret == nil || *admin.TwoFactorTempSecret == "" {
		s.writeRequestError(w, r, &requestError{Status: http.StatusBadRequest, Code: "TWO_FACTOR_SETUP_REQUIRED"})
		return
	}
	secret, err := legacycrypto.Decrypt(s.cfg.EncryptionKey, *admin.TwoFactorTempSecret)
	if err != nil {
		s.writeRequestError(w, r, &requestError{Status: http.StatusInternalServerError, Code: "TWO_FACTOR_SECRET_INVALID", Cause: err})
		return
	}
	if !verifyTOTP(secret, body.OTP, s.cfg.Admin2FAWindow, s.now()) {
		s.writeRequestError(w, r, &requestError{Status: http.StatusUnauthorized, Code: "INVALID_OTP"})
		return
	}
	store, err := s.requireAuthenticationStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	admin, err = store.EnableAdminTwoFactor(r.Context(), admin.ID, admin.SessionVersion, *admin.TwoFactorTempSecret)
	if !s.writeAuthenticationMutationError(w, r, "enable administrator two-factor authentication", err) {
		return
	}
	s.writeTwoFactorRotation(w, r, admin, true)
}

func (s *Server) adminTwoFactorDisable(w http.ResponseWriter, r *http.Request, identity Admin) {
	var body adminDisableTwoFactorRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if body.Password == "" {
		s.writeRequestError(w, r, validationError("password is required"))
		return
	}
	if !validTOTPToken(body.OTP) {
		s.writeRequestError(w, r, validationError("otp must contain 6 digits"))
		return
	}
	admin, ok := s.loadAuthenticationAdmin(w, r, identity.ID, identity.SessionVersion)
	if !ok {
		return
	}
	if !admin.TwoFactorEnabled {
		writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]bool{"enabled": false}})
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(admin.PasswordHash), []byte(body.Password)) != nil {
		s.writeRequestError(w, r, &requestError{Status: http.StatusBadRequest, Code: "INVALID_PASSWORD"})
		return
	}
	if admin.TwoFactorSecret == nil || *admin.TwoFactorSecret == "" {
		s.writeRequestError(w, r, &requestError{Status: http.StatusUnauthorized, Code: "INVALID_OTP"})
		return
	}
	secret, err := legacycrypto.Decrypt(s.cfg.EncryptionKey, *admin.TwoFactorSecret)
	if err != nil {
		s.writeRequestError(w, r, &requestError{Status: http.StatusInternalServerError, Code: "TWO_FACTOR_SECRET_INVALID", Cause: err})
		return
	}
	if !verifyTOTP(secret, body.OTP, s.cfg.Admin2FAWindow, s.now()) {
		s.writeRequestError(w, r, &requestError{Status: http.StatusUnauthorized, Code: "INVALID_OTP"})
		return
	}
	store, err := s.requireAuthenticationStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	admin, err = store.DisableAdminTwoFactor(r.Context(), admin.ID, admin.SessionVersion, *admin.TwoFactorSecret)
	if !s.writeAuthenticationMutationError(w, r, "disable administrator two-factor authentication", err) {
		return
	}
	s.writeTwoFactorRotation(w, r, admin, false)
}

func (s *Server) writeTwoFactorRotation(w http.ResponseWriter, r *http.Request, admin AdminAuthentication, enabled bool) {
	token, err := s.signAdminSession(admin)
	if err != nil {
		s.writeRequestError(w, r, &requestError{Status: http.StatusInternalServerError, Code: "INTERNAL_ERROR", Cause: err})
		return
	}
	s.setAdminSessionCookie(w, r, token)
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"data":    map[string]bool{"enabled": enabled},
	})
}

func (s *Server) withAdministratorIdentity(next func(http.ResponseWriter, *http.Request, Admin)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := s.databaseContext(r.Context())
		defer cancel()
		admin, err := authenticateAdminIdentity(ctx, r, s.store, s.cfg.JWTSecret, s.now())
		if err != nil {
			s.writeRequestError(w, r, err)
			return
		}
		next(w, r.WithContext(ctx), admin)
	}
}

func (s *Server) requireAuthenticationStore() (AuthenticationStore, error) {
	if s.authStore == nil {
		return nil, &requestError{Status: http.StatusServiceUnavailable, Code: "AUTHENTICATION_BACKEND_UNAVAILABLE"}
	}
	return s.authStore, nil
}

func (s *Server) adminLoginProtector() (loginProtector, error) {
	if s.loginStore == nil {
		return loginProtector{}, loginSecurityBackendError(errors.New("login protection store is not configured"))
	}
	return newLoginProtector(
		s.loginStore,
		"admin",
		s.cfg.AdminLoginMaxAttempts,
		s.cfg.AdminLoginLockDuration,
	), nil
}

func loginSecurityBackendError(err error) error {
	return &requestError{Status: http.StatusServiceUnavailable, Code: "LOGIN_SECURITY_BACKEND_UNAVAILABLE", Cause: err}
}

func (s *Server) writeLoginFailure(
	w http.ResponseWriter,
	r *http.Request,
	protector loginProtector,
	cacheKey string,
	failure *requestError,
) {
	remaining, err := protector.recordFailure(r.Context(), cacheKey)
	if err != nil {
		s.writeRequestError(w, r, loginSecurityBackendError(err))
		return
	}
	if remaining > 0 {
		s.writeRequestError(w, r, &requestError{Status: http.StatusTooManyRequests, Code: "ACCOUNT_LOCKED"})
		return
	}
	if failure == nil {
		failure = &requestError{Status: http.StatusUnauthorized, Code: "INVALID_CREDENTIALS"}
	}
	s.writeRequestError(w, r, failure)
}

func (s *Server) loadAuthenticationAdmin(w http.ResponseWriter, r *http.Request, id, expectedSessionVersion int64) (AdminAuthentication, bool) {
	store, err := s.requireAuthenticationStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return AdminAuthentication{}, false
	}
	admin, err := store.FindAdminAuthentication(r.Context(), id)
	if errors.Is(err, errNotFound) {
		s.writeRequestError(w, r, &requestError{Status: http.StatusNotFound, Code: "NOT_FOUND"})
		return AdminAuthentication{}, false
	}
	if err != nil {
		s.writeStoreError(w, r, "load administrator authentication", err)
		return AdminAuthentication{}, false
	}
	if admin.SessionVersion != expectedSessionVersion {
		s.writeRequestError(w, r, &requestError{Status: http.StatusUnauthorized, Code: "INVALID_TOKEN"})
		return AdminAuthentication{}, false
	}
	return admin, true
}

func (s *Server) writeAuthenticationMutationError(w http.ResponseWriter, r *http.Request, operation string, err error) bool {
	if err == nil {
		return true
	}
	if errors.Is(err, errNotFound) {
		s.writeRequestError(w, r, &requestError{Status: http.StatusUnauthorized, Code: "INVALID_TOKEN"})
		return false
	}
	s.writeStoreError(w, r, operation, err)
	return false
}

func (s *Server) signAdminSession(admin AdminAuthentication) (string, error) {
	return signSessionJWT(sessionJWTClaims{
		Subject:        admin.ID,
		Audience:       adminJWTAudience,
		SessionVersion: admin.SessionVersion,
		Username:       admin.Username,
		Role:           admin.Role,
	}, s.cfg.JWTSecret, s.now(), s.cfg.JWTLifetime)
}

func (s *Server) setAdminSessionCookie(w http.ResponseWriter, r *http.Request, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     adminSessionCookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   adminSessionCookieMaxAge,
		HttpOnly: true,
		Secure:   s.secureSessionCookie(r),
		SameSite: http.SameSiteLaxMode,
	})
}

func (s *Server) clearAdminSessionCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     adminSessionCookieName,
		Path:     "/",
		MaxAge:   -1,
		Expires:  time.Unix(1, 0).UTC(),
		HttpOnly: true,
		Secure:   s.secureSessionCookie(r),
		SameSite: http.SameSiteLaxMode,
	})
}

func (s *Server) secureSessionCookie(r *http.Request) bool {
	if s.cfg.SecureCookies {
		return true
	}
	if r.TLS != nil {
		return true
	}
	return strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "https")
}

func validTOTPToken(token string) bool {
	if len(token) != 6 {
		return false
	}
	for _, value := range token {
		if value < '0' || value > '9' {
			return false
		}
	}
	return true
}

func (s *Server) removeBootstrapAdminSecret(username string) {
	path := strings.TrimSpace(s.cfg.BootstrapAdminFile)
	if path == "" {
		return
	}
	content, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return
	}
	if err != nil {
		s.logger.Error("failed to read consumed bootstrap administrator credential", "file", path, "username", username, "error", err)
		return
	}
	if parseBootstrapAdminUsername(string(content)) != username {
		return
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		s.logger.Error("failed to remove consumed bootstrap administrator credential", "file", path, "username", username, "error", err)
	}
}

func parseBootstrapAdminUsername(content string) string {
	for _, rawLine := range strings.Split(content, "\n") {
		line := strings.TrimSpace(strings.TrimSuffix(rawLine, "\r"))
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		name, value, found := strings.Cut(line, "=")
		if !found || strings.TrimSpace(name) != "ADMIN_USERNAME" {
			continue
		}
		value = strings.TrimSpace(value)
		if len(value) >= 2 && ((value[0] == '\'' && value[len(value)-1] == '\'') || (value[0] == '"' && value[len(value)-1] == '"')) {
			value = value[1 : len(value)-1]
		}
		return value
	}
	return ""
}
