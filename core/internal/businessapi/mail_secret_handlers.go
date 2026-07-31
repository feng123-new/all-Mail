package businessapi

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/legacycrypto"
)

type revealMailUnlockRequest struct {
	OTP string `json:"otp"`
}

type revealMailSecretsRequest struct {
	OTP        string   `json:"otp"`
	GrantToken string   `json:"grantToken"`
	Fields     []string `json:"fields"`
}

type auditResponseWriter struct {
	http.ResponseWriter
	status int
}

func (w *auditResponseWriter) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
	}
	w.ResponseWriter.WriteHeader(status)
}

func (w *auditResponseWriter) Write(body []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	return w.ResponseWriter.Write(body)
}

func (s *Server) revealMailAccountUnlock(w http.ResponseWriter, r *http.Request, admin Admin) {
	startedAt := time.Now()
	auditWriter := &auditResponseWriter{ResponseWriter: w}
	w = auditWriter
	metadata := map[string]any{"adminId": admin.ID, "requestId": requestID(r), "stepUpMethod": "totp"}
	defer s.auditMailSecretAction(r, auditWriter, "admin_reveal_external_secret_unlock", nil, startedAt, metadata)
	var body revealMailUnlockRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if err := s.verifyAdminStepUp(admin, body.OTP); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	grantToken, expiresAt, err := signAdminRevealGrant(admin, s.cfg.JWTSecret, s.now())
	if err != nil {
		s.writeRequestError(w, r, &requestError{Status: http.StatusInternalServerError, Code: "REVEAL_UNLOCK_FAILED", Cause: err})
		return
	}
	metadata["expiresAt"] = formatAPITime(expiresAt)
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]any{
			"grantToken": grantToken,
			"expiresAt":  formatAPITime(expiresAt),
		},
	})
}

func (s *Server) revealMailAccountSecrets(w http.ResponseWriter, r *http.Request, admin Admin) {
	startedAt := time.Now()
	auditWriter := &auditResponseWriter{ResponseWriter: w}
	w = auditWriter
	var auditEmailID *int64
	metadata := map[string]any{"adminId": admin.ID, "requestId": requestID(r)}
	defer func() {
		s.auditMailSecretAction(r, auditWriter, "admin_reveal_external_secret", auditEmailID, startedAt, metadata)
	}()
	id, err := parsePositivePathID(r, "id")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	auditEmailID = &id
	var body revealMailSecretsRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	metadata["fields"] = body.Fields
	metadata["stepUpMethod"] = "totp"
	if strings.TrimSpace(body.GrantToken) != "" {
		metadata["stepUpMethod"] = "grant"
		if err := verifyAdminRevealGrant(body.GrantToken, admin, s.cfg.JWTSecret, s.now()); err != nil {
			s.writeRequestError(w, r, err)
			return
		}
	} else if err := s.verifyAdminStepUp(admin, body.OTP); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	fields, err := validateRevealFields(body.Fields)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	store, err := s.managementStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	account, err := store.loadMailAccountCredentials(r.Context(), id, s.cfg.EncryptionKey)
	if err != nil {
		s.writeStoreError(w, r, "reveal mail account secrets", err)
		return
	}
	allowed := map[string]bool{"accountLoginPassword": true}
	if account.AuthType == "GOOGLE_OAUTH" || account.AuthType == "MICROSOFT_OAUTH" {
		allowed["refreshToken"] = true
	} else {
		allowed["password"] = true
	}
	availableFields := make([]string, 0, len(allowed))
	for _, field := range []string{"password", "refreshToken", "accountLoginPassword"} {
		if allowed[field] {
			availableFields = append(availableFields, field)
		}
	}
	metadata["availableFields"] = availableFields
	secrets := make(map[string]any, len(fields))
	for _, field := range fields {
		if !allowed[field] {
			s.writeRequestError(w, r, &requestError{Status: http.StatusBadRequest, Code: "SECRET_REVEAL_NOT_ALLOWED"})
			return
		}
		var value string
		switch field {
		case "password":
			value = account.Password
			if value == "" {
				s.writeRequestError(w, r, &requestError{Status: http.StatusBadRequest, Code: "PASSWORD_NOT_PRESENT"})
				return
			}
		case "refreshToken":
			value = account.RefreshToken
		case "accountLoginPassword":
			value = account.AccountLoginPassword
			if value == "" {
				s.writeRequestError(w, r, &requestError{Status: http.StatusBadRequest, Code: "ACCOUNT_LOGIN_PASSWORD_NOT_PRESENT"})
				return
			}
		}
		if value == "" {
			secrets[field] = nil
		} else {
			secrets[field] = value
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]any{
			"secrets":         secrets,
			"availableFields": availableFields,
		},
	})
}

func (s *Server) auditMailSecretAction(
	r *http.Request,
	w *auditResponseWriter,
	action string,
	emailAccountID *int64,
	startedAt time.Time,
	metadata map[string]any,
) {
	status := w.status
	if status == 0 {
		status = http.StatusOK
	}
	metadata["success"] = status >= 200 && status < 400
	store, err := s.managementStore()
	if err == nil {
		ctx, cancel := s.databaseContext(context.WithoutCancel(r.Context()))
		err = store.logAdminAction(ctx, action, emailAccountID, requestClientIP(r), status, time.Since(startedAt).Milliseconds(), metadata)
		cancel()
	}
	if err != nil {
		s.logger.Error("write mail secret audit log", "request_id", requestID(r), "action", action, "error", err)
	}
}

func (s *Server) verifyAdminStepUp(admin Admin, otp string) error {
	if !admin.TwoFactorEnabled {
		return &requestError{Status: http.StatusForbidden, Code: "TWO_FACTOR_REQUIRED"}
	}
	if admin.TwoFactorSecret == nil || strings.TrimSpace(*admin.TwoFactorSecret) == "" {
		return &requestError{Status: http.StatusInternalServerError, Code: "TWO_FACTOR_SECRET_INVALID"}
	}
	secret, err := legacycrypto.Decrypt(s.cfg.EncryptionKey, *admin.TwoFactorSecret)
	if err != nil {
		return &requestError{Status: http.StatusInternalServerError, Code: "TWO_FACTOR_SECRET_INVALID", Cause: err}
	}
	if !verifyTOTP(secret, strings.TrimSpace(otp), s.cfg.Admin2FAWindow, s.now()) {
		return &requestError{Status: http.StatusUnauthorized, Code: "INVALID_OTP"}
	}
	return nil
}

func validateRevealFields(values []string) ([]string, error) {
	if len(values) == 0 {
		return nil, validationError("fields must contain at least one value")
	}
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		field := strings.TrimSpace(value)
		switch field {
		case "password", "refreshToken", "accountLoginPassword":
		default:
			return nil, validationError("fields contains an unsupported value")
		}
		if _, ok := seen[field]; ok {
			continue
		}
		seen[field] = struct{}{}
		result = append(result, field)
	}
	return result, nil
}
