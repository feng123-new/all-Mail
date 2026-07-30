package businessapi

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type requestError struct {
	Status int
	Code   string
	Cause  error
}

func (e *requestError) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("%s: %v", e.Code, e.Cause)
	}
	return e.Code
}

type jwtHeader struct {
	Algorithm string `json:"alg"`
}

type jwtPayload struct {
	Subject   string          `json:"sub"`
	Audience  json.RawMessage `json:"aud"`
	ExpiresAt float64         `json:"exp"`
	NotBefore *float64        `json:"nbf,omitempty"`
}

func authenticateAdmin(
	ctx context.Context,
	request *http.Request,
	store Store,
	secret string,
	now time.Time,
) (Admin, error) {
	token := extractAdminToken(request)
	if token == "" {
		return Admin{}, &requestError{Status: http.StatusUnauthorized, Code: "UNAUTHORIZED"}
	}
	adminID, err := verifyAdminJWT(token, secret, now)
	if err != nil {
		return Admin{}, &requestError{Status: http.StatusUnauthorized, Code: "INVALID_TOKEN", Cause: err}
	}
	admin, err := store.FindAdmin(ctx, adminID)
	if errors.Is(err, errNotFound) {
		return Admin{}, &requestError{Status: http.StatusUnauthorized, Code: "INVALID_TOKEN"}
	}
	if err != nil {
		return Admin{}, &requestError{Status: http.StatusInternalServerError, Code: "INTERNAL_ERROR", Cause: err}
	}
	if admin.Status != "ACTIVE" {
		return Admin{}, &requestError{Status: http.StatusForbidden, Code: "ACCOUNT_DISABLED"}
	}
	if admin.MustChangePassword {
		return Admin{}, &requestError{Status: http.StatusForbidden, Code: "PASSWORD_CHANGE_REQUIRED"}
	}
	return admin, nil
}

func extractAdminToken(request *http.Request) string {
	if cookie, err := request.Cookie("token"); err == nil && strings.TrimSpace(cookie.Value) != "" {
		return strings.TrimSpace(cookie.Value)
	}
	authorization := strings.TrimSpace(request.Header.Get("Authorization"))
	if strings.HasPrefix(authorization, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(authorization, "Bearer "))
	}
	return ""
}

func verifyAdminJWT(token, secret string, now time.Time) (int64, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return 0, errors.New("JWT must contain three segments")
	}

	headerBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return 0, errors.New("JWT header is not valid base64url")
	}
	var header jwtHeader
	if err := json.Unmarshal(headerBytes, &header); err != nil || header.Algorithm != "HS256" {
		return 0, errors.New("JWT algorithm is not HS256")
	}

	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return 0, errors.New("JWT payload is not valid base64url")
	}
	var payload jwtPayload
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		return 0, errors.New("JWT payload is not valid JSON")
	}
	if payload.ExpiresAt == 0 || float64(now.Unix()) >= payload.ExpiresAt {
		return 0, errors.New("JWT is expired")
	}
	if payload.NotBefore != nil && float64(now.Unix()) < *payload.NotBefore {
		return 0, errors.New("JWT is not active")
	}
	if !audienceContains(payload.Audience, adminJWTAudience) {
		return 0, errors.New("JWT audience is invalid")
	}

	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return 0, errors.New("JWT signature is not valid base64url")
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(parts[0] + "." + parts[1]))
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return 0, errors.New("JWT signature is invalid")
	}

	adminID, err := strconv.ParseInt(payload.Subject, 10, 64)
	if err != nil || adminID <= 0 {
		return 0, errors.New("JWT subject is invalid")
	}
	return adminID, nil
}

func audienceContains(raw json.RawMessage, expected string) bool {
	if len(raw) == 0 {
		return false
	}
	var single string
	if err := json.Unmarshal(raw, &single); err == nil {
		return single == expected
	}
	var multiple []string
	if err := json.Unmarshal(raw, &multiple); err != nil {
		return false
	}
	for _, audience := range multiple {
		if audience == expected {
			return true
		}
	}
	return false
}
