package businessapi

import (
	"database/sql"
	"encoding/base32"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/legacycrypto"
)

type gmailLoginRequest struct {
	GrantToken string  `json:"grantToken"`
	Email      string  `json:"email"`
	CodeOnly   bool    `json:"codeOnly"`
	Password   *string `json:"password"`
	TOTPSecret *string `json:"totpSecret"`
	Notes      *string `json:"notes"`
}

func (s *Server) gmailLoginDetails(w http.ResponseWriter, r *http.Request, admin Admin) {
	startedAt := time.Now()
	response := &auditResponseWriter{ResponseWriter: w}
	id, err := parsePositivePathID(r, "id")
	if err != nil {
		s.writeRequestError(response, r, err)
		return
	}
	updating := r.Method == http.MethodPatch
	action := "admin_read_gmail_login_details"
	if updating {
		action = "admin_update_gmail_login_details"
	}
	var auditedID *int64
	defer func() {
		s.auditMailSecretAction(r, response, action, auditedID, startedAt, map[string]any{
			"adminId": admin.ID, "requestId": requestID(r), "stepUpMethod": "grant",
		})
	}()
	var body *gmailLoginRequest
	decoder := json.NewDecoder(http.MaxBytesReader(response, r.Body, 64<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&body); err != nil || body == nil {
		s.writeRequestError(response, r, validationError("invalid Gmail login details request"))
		return
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		s.writeRequestError(response, r, validationError("expected a single JSON object"))
		return
	}
	if !admin.TwoFactorEnabled {
		s.writeRequestError(response, r, &requestError{Status: http.StatusForbidden, Code: "TWO_FACTOR_REQUIRED"})
		return
	}
	now := s.now().UTC()
	if err := verifyAdminRevealGrant(strings.TrimSpace(body.GrantToken), admin, s.cfg.JWTSecret, now); err != nil {
		s.writeRequestError(response, r, err)
		return
	}
	email := strings.TrimSpace(body.Email)
	if err := validateEmailAddress(email); err != nil {
		s.writeRequestError(response, r, err)
		return
	}
	fieldsPresent := body.Password != nil || body.TOTPSecret != nil || body.Notes != nil
	if (updating && (!fieldsPresent || body.CodeOnly)) || (!updating && fieldsPresent) {
		s.writeRequestError(response, r, validationError("invalid fields for Gmail login details operation"))
		return
	}
	if body.Password != nil && len(*body.Password) > 1024 {
		s.writeRequestError(response, r, validationError("password is too long"))
		return
	}
	if body.Notes != nil {
		if err := validateTextLength("notes", *body.Notes, 0, 8000); err != nil {
			s.writeRequestError(response, r, err)
			return
		}
	}
	if body.TOTPSecret != nil && *body.TOTPSecret != "" {
		key := strings.ToUpper(strings.Join(strings.Fields(*body.TOTPSecret), ""))
		key = strings.TrimRight(key, "=")
		decoded, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(key)
		if err != nil || len(decoded) < 10 || len(decoded) > 64 || base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(decoded) != key {
			s.writeRequestError(response, r, &requestError{Status: http.StatusBadRequest, Code: "INVALID_GMAIL_TOTP_SECRET"})
			return
		}
		body.TOTPSecret = &key
	}
	store, err := s.managementStore()
	if err != nil {
		s.writeRequestError(response, r, err)
		return
	}
	ctx, cancel := s.databaseContext(r.Context())
	defer cancel()
	var data map[string]any
	if updating {
		var encrypted [3]any
		for index, field := range []*string{body.Password, body.TOTPSecret, body.Notes} {
			if field != nil && *field != "" {
				encrypted[index], err = legacycrypto.Encrypt(s.cfg.EncryptionKey, *field)
				if err != nil {
					s.writeRequestError(response, r, err)
					return
				}
			}
		}
		result, updateErr := store.pool.Exec(ctx, `
			UPDATE email_accounts
			SET account_login_password = CASE WHEN $2 THEN $3 ELSE account_login_password END,
			    gmail_totp_secret = CASE WHEN $4 THEN $5 ELSE gmail_totp_secret END,
			    gmail_login_notes = CASE WHEN $6 THEN $7 ELSE gmail_login_notes END,
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = $1 AND provider = 'GMAIL' AND lower(email) = lower($8)
		`, id, body.Password != nil, encrypted[0], body.TOTPSecret != nil, encrypted[1], body.Notes != nil, encrypted[2], email)
		err = updateErr
		if err == nil && result.RowsAffected() == 0 {
			err = managementNotFound("NOT_FOUND")
		}
		data = map[string]any{"updated": true}
	} else {
		var password, key, notes sql.NullString
		err = store.pool.QueryRow(ctx, `
			SELECT CASE WHEN $2 THEN NULL ELSE account_login_password END, gmail_totp_secret,
			       CASE WHEN $2 THEN NULL ELSE gmail_login_notes END
			FROM email_accounts WHERE id = $1 AND provider = 'GMAIL' AND lower(email) = lower($3)
		`, id, body.CodeOnly, email).Scan(&password, &key, &notes)
		if errorsIsNoRows(err) {
			err = managementNotFound("NOT_FOUND")
		}
		if err == nil {
			data, err = gmailLoginPayload(s.cfg.EncryptionKey, password, key, notes, s.now().UTC())
		}
	}
	if err != nil {
		// Database diagnostics can contain parameters from writes. Keep vault values out of logs.
		writeError(response, statusForError(err), requestID(r), requestErrorCode(err, "GMAIL_LOGIN_DETAILS_UNAVAILABLE"), nil)
		return
	}
	auditedID = &id
	writeJSON(response, http.StatusOK, map[string]any{"success": true, "data": data})
}

func gmailLoginPayload(encryptionKey string, password, seed, notes sql.NullString, now time.Time) (map[string]any, error) {
	data := map[string]any{"code": nil, "codeExpiresAt": nil, "serverTime": now.Format(time.RFC3339Nano)}
	for name, ciphertext := range map[string]sql.NullString{"password": password, "notes": notes} {
		if ciphertext.Valid {
			value, err := legacycrypto.Decrypt(encryptionKey, ciphertext.String)
			if err != nil {
				return nil, err
			}
			data[name] = value
		}
	}
	if seed.Valid {
		secret, err := legacycrypto.Decrypt(encryptionKey, seed.String)
		if err != nil {
			return nil, err
		}
		key, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(secret)
		if err != nil || len(key) < 10 {
			return nil, errors.New("invalid stored Gmail authenticator key")
		}
		step := now.Unix() / 30
		data["code"] = totpCode(key, step)
		data["codeExpiresAt"] = time.Unix((step+1)*30, 0).UTC().Format(time.RFC3339)
	}
	return data, nil
}
