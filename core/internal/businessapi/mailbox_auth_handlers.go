package businessapi

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/legacycrypto"
	"github.com/feng123-new/all-Mail/core/internal/passwordpolicy"
	"golang.org/x/crypto/bcrypt"
)

const (
	mailboxSessionCookieName   = "mailbox_token"
	mailboxSessionCookieMaxAge = 2 * 60 * 60
	mailboxPasswordHashCost    = 10
)

type mailboxLoginRequest struct {
	Username string  `json:"username"`
	Password string  `json:"password"`
	OTP      *string `json:"otp"`
}

type mailboxChangePasswordRequest struct {
	OldPassword string `json:"oldPassword"`
	NewPassword string `json:"newPassword"`
}

type mailboxVerifyTwoFactorRequest struct {
	OTP string `json:"otp"`
}

type mailboxDisableTwoFactorRequest struct {
	Password string `json:"password"`
	OTP      string `json:"otp"`
}

func (s *Server) registerMailboxAuthenticationRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /mail/api/login", s.mailboxLogin)
	mux.HandleFunc("POST /mail/api/logout", s.mailboxLogout)
	mux.HandleFunc("GET /mail/api/session", s.withMailboxIdentity(s.mailboxSession))
	mux.HandleFunc("POST /mail/api/change-password", s.withMailboxIdentity(s.mailboxChangePassword))
	mux.HandleFunc("GET /mail/api/2fa/status", s.withMailbox(s.mailboxTwoFactorStatus))
	mux.HandleFunc("POST /mail/api/2fa/setup", s.withMailbox(s.mailboxTwoFactorSetup))
	mux.HandleFunc("POST /mail/api/2fa/enable", s.withMailbox(s.mailboxTwoFactorEnable))
	mux.HandleFunc("POST /mail/api/2fa/disable", s.withMailbox(s.mailboxTwoFactorDisable))
}

func (s *Server) mailboxLogin(w http.ResponseWriter, r *http.Request) {
	var body mailboxLoginRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	body.Username = strings.TrimSpace(body.Username)
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
	store, err := s.requireMailboxAuthenticationStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	protector, err := s.mailboxLoginProtector()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	ctx, cancel := s.databaseContext(r.Context())
	defer cancel()
	r = r.WithContext(ctx)
	cacheKey := buildLoginProtectionCacheKey("mailbox", body.Username, requestClientIP(r))
	remaining, err := protector.lockRemaining(ctx, cacheKey)
	if err != nil {
		s.writeRequestError(w, r, loginSecurityBackendError(err))
		return
	}
	if remaining > 0 {
		s.writeRequestError(w, r, &requestError{Status: http.StatusTooManyRequests, Code: "ACCOUNT_LOCKED"})
		return
	}

	identity, err := store.FindMailboxAuthenticationByIdentifier(ctx, body.Username)
	if errors.Is(err, errNotFound) {
		s.writeLoginFailure(w, r, protector, cacheKey, nil)
		return
	}
	if err != nil {
		s.writeStoreError(w, r, "load mailbox login", err)
		return
	}
	if identity.Status != "ACTIVE" {
		s.writeRequestError(w, r, &requestError{Status: http.StatusForbidden, Code: "ACCOUNT_DISABLED"})
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(identity.PasswordHash), []byte(body.Password)) != nil {
		s.writeLoginFailure(w, r, protector, cacheKey, nil)
		return
	}
	if identity.TwoFactorEnabled {
		if body.OTP == nil {
			s.writeRequestError(w, r, &requestError{Status: http.StatusUnauthorized, Code: "OTP_REQUIRED"})
			return
		}
		if identity.TwoFactorSecret == nil || *identity.TwoFactorSecret == "" {
			s.writeRequestError(w, r, &requestError{Status: http.StatusInternalServerError, Code: "TWO_FACTOR_CONFIGURATION_INVALID"})
			return
		}
		secret, decryptErr := legacycrypto.Decrypt(s.cfg.EncryptionKey, *identity.TwoFactorSecret)
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
	identity, err = store.RecordMailboxLogin(ctx, identity.ID, identity.SessionVersion, s.now(), requestClientIP(r))
	if errors.Is(err, errNotFound) {
		s.writeRequestError(w, r, &requestError{Status: http.StatusUnauthorized, Code: "INVALID_CREDENTIALS"})
		return
	}
	if err != nil {
		s.writeStoreError(w, r, "record mailbox login", err)
		return
	}
	token, err := s.signMailboxSession(identity)
	if err != nil {
		s.writeRequestError(w, r, &requestError{Status: http.StatusInternalServerError, Code: "INTERNAL_ERROR", Cause: err})
		return
	}
	s.setMailboxSessionCookie(w, r, token)
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]any{
			"mailboxUser": mailboxUserResponse(identity),
		},
	})
}

func (s *Server) mailboxLogout(w http.ResponseWriter, r *http.Request) {
	s.clearMailboxSessionCookie(w, r)
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"data":    map[string]string{"code": "MAILBOX_PORTAL_LOGGED_OUT"},
	})
}

func (s *Server) mailboxSession(w http.ResponseWriter, _ *http.Request, identity MailboxIdentity) {
	var lastLoginAt any
	if identity.LastLoginAt != nil {
		lastLoginAt = formatAPITime(*identity.LastLoginAt)
	}
	user := mailboxUserResponse(identity)
	user["status"] = identity.Status
	user["lastLoginAt"] = lastLoginAt
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]any{
			"authenticated": true,
			"mailboxUser":   user,
		},
	})
}

func (s *Server) mailboxChangePassword(w http.ResponseWriter, r *http.Request, identity MailboxIdentity) {
	var body mailboxChangePasswordRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if body.OldPassword == "" {
		s.writeRequestError(w, r, validationError("oldPassword is required"))
		return
	}
	if err := passwordpolicy.Validate("newPassword", body.NewPassword, 8); err != nil {
		s.writeRequestError(w, r, validationError(err.Error()))
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(identity.PasswordHash), []byte(body.OldPassword)) != nil {
		s.writeRequestError(w, r, &requestError{Status: http.StatusBadRequest, Code: "INVALID_PASSWORD"})
		return
	}
	newHash, err := bcrypt.GenerateFromPassword([]byte(body.NewPassword), mailboxPasswordHashCost)
	if err != nil {
		s.writeRequestError(w, r, &requestError{Status: http.StatusInternalServerError, Code: "INTERNAL_ERROR", Cause: err})
		return
	}
	store, err := s.requireMailboxAuthenticationStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	identity, err = store.ChangeMailboxPassword(r.Context(), identity.ID, identity.SessionVersion, identity.PasswordHash, string(newHash))
	if !s.writeMailboxMutationError(w, r, "change mailbox password", err) {
		return
	}
	if !s.rotateMailboxSession(w, r, identity) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"data":    map[string]bool{"success": true},
	})
}

func (s *Server) mailboxTwoFactorStatus(w http.ResponseWriter, _ *http.Request, identity MailboxIdentity) {
	pending := !identity.TwoFactorEnabled && identity.TwoFactorSecret != nil && *identity.TwoFactorSecret != ""
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]bool{
			"enabled": identity.TwoFactorEnabled,
			"pending": pending,
		},
	})
}

func (s *Server) mailboxTwoFactorSetup(w http.ResponseWriter, r *http.Request, identity MailboxIdentity) {
	if identity.TwoFactorEnabled {
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
	store, err := s.requireMailboxAuthenticationStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	identity, err = store.SetMailboxTwoFactorSecret(r.Context(), identity.ID, identity.SessionVersion, encryptedSecret)
	if !s.writeMailboxMutationError(w, r, "store pending mailbox two-factor secret", err) {
		return
	}
	if !s.rotateMailboxSession(w, r, identity) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]string{
			"secret":     secret,
			"otpauthUrl": buildTOTPURI(secret, identity.Username, "all-Mail"),
		},
	})
}

func (s *Server) mailboxTwoFactorEnable(w http.ResponseWriter, r *http.Request, identity MailboxIdentity) {
	var body mailboxVerifyTwoFactorRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if !validTOTPToken(body.OTP) {
		s.writeRequestError(w, r, validationError("otp must contain 6 digits"))
		return
	}
	if identity.TwoFactorEnabled {
		writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]bool{"enabled": true}})
		return
	}
	if identity.TwoFactorSecret == nil || *identity.TwoFactorSecret == "" {
		s.writeRequestError(w, r, &requestError{Status: http.StatusBadRequest, Code: "TWO_FACTOR_SETUP_REQUIRED"})
		return
	}
	secret, err := legacycrypto.Decrypt(s.cfg.EncryptionKey, *identity.TwoFactorSecret)
	if err != nil {
		s.writeRequestError(w, r, &requestError{Status: http.StatusInternalServerError, Code: "TWO_FACTOR_SECRET_INVALID", Cause: err})
		return
	}
	if !verifyTOTP(secret, body.OTP, s.cfg.Admin2FAWindow, s.now()) {
		s.writeRequestError(w, r, &requestError{Status: http.StatusUnauthorized, Code: "INVALID_OTP"})
		return
	}
	store, err := s.requireMailboxAuthenticationStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	identity, err = store.EnableMailboxTwoFactor(r.Context(), identity.ID, identity.SessionVersion, *identity.TwoFactorSecret)
	if !s.writeMailboxMutationError(w, r, "enable mailbox two-factor authentication", err) {
		return
	}
	s.writeMailboxTwoFactorRotation(w, r, identity, true)
}

func (s *Server) mailboxTwoFactorDisable(w http.ResponseWriter, r *http.Request, identity MailboxIdentity) {
	var body mailboxDisableTwoFactorRequest
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
	if !identity.TwoFactorEnabled {
		writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]bool{"enabled": false}})
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(identity.PasswordHash), []byte(body.Password)) != nil {
		s.writeRequestError(w, r, &requestError{Status: http.StatusBadRequest, Code: "INVALID_PASSWORD"})
		return
	}
	if identity.TwoFactorSecret == nil || *identity.TwoFactorSecret == "" {
		s.writeRequestError(w, r, &requestError{Status: http.StatusUnauthorized, Code: "INVALID_OTP"})
		return
	}
	secret, err := legacycrypto.Decrypt(s.cfg.EncryptionKey, *identity.TwoFactorSecret)
	if err != nil {
		s.writeRequestError(w, r, &requestError{Status: http.StatusInternalServerError, Code: "TWO_FACTOR_SECRET_INVALID", Cause: err})
		return
	}
	if !verifyTOTP(secret, body.OTP, s.cfg.Admin2FAWindow, s.now()) {
		s.writeRequestError(w, r, &requestError{Status: http.StatusUnauthorized, Code: "INVALID_OTP"})
		return
	}
	store, err := s.requireMailboxAuthenticationStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	identity, err = store.DisableMailboxTwoFactor(r.Context(), identity.ID, identity.SessionVersion, *identity.TwoFactorSecret)
	if !s.writeMailboxMutationError(w, r, "disable mailbox two-factor authentication", err) {
		return
	}
	s.writeMailboxTwoFactorRotation(w, r, identity, false)
}

func (s *Server) withMailboxIdentity(next func(http.ResponseWriter, *http.Request, MailboxIdentity)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := s.databaseContext(r.Context())
		defer cancel()
		identity, err := authenticateMailboxIdentity(ctx, r, s.mailboxAuthStore, s.cfg.JWTSecret, s.now())
		if err != nil {
			s.writeRequestError(w, r, err)
			return
		}
		next(w, r.WithContext(ctx), identity)
	}
}

func (s *Server) withMailbox(next func(http.ResponseWriter, *http.Request, MailboxIdentity)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := s.databaseContext(r.Context())
		defer cancel()
		identity, err := authenticateMailbox(ctx, r, s.mailboxAuthStore, s.cfg.JWTSecret, s.now())
		if err != nil {
			s.writeRequestError(w, r, err)
			return
		}
		next(w, r.WithContext(ctx), identity)
	}
}

func (s *Server) requireMailboxAuthenticationStore() (MailboxAuthenticationStore, error) {
	if s.mailboxAuthStore == nil {
		return nil, &requestError{Status: http.StatusServiceUnavailable, Code: "MAILBOX_AUTHENTICATION_BACKEND_UNAVAILABLE"}
	}
	return s.mailboxAuthStore, nil
}

func (s *Server) mailboxLoginProtector() (loginProtector, error) {
	if s.loginStore == nil {
		return loginProtector{}, loginSecurityBackendError(errors.New("login protection store is not configured"))
	}
	return newLoginProtector(
		s.loginStore,
		"mailbox",
		s.cfg.AdminLoginMaxAttempts,
		s.cfg.AdminLoginLockDuration,
	), nil
}

func (s *Server) writeMailboxMutationError(w http.ResponseWriter, r *http.Request, operation string, err error) bool {
	if err == nil {
		return true
	}
	if errors.Is(err, errNotFound) {
		s.writeRequestError(w, r, &requestError{Status: http.StatusUnauthorized, Code: "INVALID_MAILBOX_TOKEN"})
		return false
	}
	s.writeStoreError(w, r, operation, err)
	return false
}

func (s *Server) signMailboxSession(identity MailboxIdentity) (string, error) {
	return signSessionJWT(sessionJWTClaims{
		Subject:        identity.ID,
		Audience:       mailboxJWTAudience,
		SessionVersion: identity.SessionVersion,
		Username:       identity.Username,
		Role:           "MAILBOX_USER",
		MailboxUserID:  identity.ID,
		MailboxIDs:     identity.MailboxIDs,
	}, s.cfg.JWTSecret, s.now(), s.cfg.JWTLifetime)
}

func (s *Server) rotateMailboxSession(w http.ResponseWriter, r *http.Request, identity MailboxIdentity) bool {
	token, err := s.signMailboxSession(identity)
	if err != nil {
		s.writeRequestError(w, r, &requestError{Status: http.StatusInternalServerError, Code: "INTERNAL_ERROR", Cause: err})
		return false
	}
	s.setMailboxSessionCookie(w, r, token)
	return true
}

func (s *Server) writeMailboxTwoFactorRotation(w http.ResponseWriter, r *http.Request, identity MailboxIdentity, enabled bool) {
	if !s.rotateMailboxSession(w, r, identity) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"data":    map[string]bool{"enabled": enabled},
	})
}

func mailboxUserResponse(identity MailboxIdentity) map[string]any {
	return map[string]any{
		"id":                 identity.ID,
		"username":           identity.Username,
		"email":              identity.Email,
		"mustChangePassword": identity.MustChangePassword,
		"mailboxIds":         identity.MailboxIDs,
	}
}

func (s *Server) setMailboxSessionCookie(w http.ResponseWriter, r *http.Request, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     mailboxSessionCookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   mailboxSessionCookieMaxAge,
		HttpOnly: true,
		Secure:   s.secureSessionCookie(r),
		SameSite: http.SameSiteLaxMode,
	})
}

func (s *Server) clearMailboxSessionCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     mailboxSessionCookieName,
		Path:     "/",
		MaxAge:   -1,
		Expires:  time.Unix(1, 0).UTC(),
		HttpOnly: true,
		Secure:   s.secureSessionCookie(r),
		SameSite: http.SameSiteLaxMode,
	})
}
