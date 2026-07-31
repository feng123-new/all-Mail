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
	Type      string `json:"typ,omitempty"`
}

type jwtPayload struct {
	Issuer         string          `json:"iss"`
	Subject        string          `json:"sub"`
	Audience       json.RawMessage `json:"aud"`
	ExpiresAt      float64         `json:"exp"`
	NotBefore      *float64        `json:"nbf,omitempty"`
	SessionVersion int64           `json:"sessionVersion"`
	Purpose        string          `json:"purpose,omitempty"`
}

type verifiedAdminJWT struct {
	AdminID        int64
	SessionVersion int64
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
	claims, err := verifyAdminJWT(token, secret, now)
	if err != nil {
		return Admin{}, &requestError{Status: http.StatusUnauthorized, Code: "INVALID_TOKEN", Cause: err}
	}
	admin, err := store.FindAdmin(ctx, claims.AdminID)
	if errors.Is(err, errNotFound) {
		return Admin{}, &requestError{Status: http.StatusUnauthorized, Code: "INVALID_TOKEN"}
	}
	if err != nil {
		return Admin{}, &requestError{Status: http.StatusInternalServerError, Code: "INTERNAL_ERROR", Cause: err}
	}
	storedVersion := admin.SessionVersion
	if storedVersion == 0 {
		// Test doubles created before the session-version migration represent the
		// initial version. PostgreSQL rows are constrained to positive values.
		storedVersion = 1
	}
	if claims.SessionVersion != storedVersion {
		return Admin{}, &requestError{Status: http.StatusUnauthorized, Code: "INVALID_TOKEN"}
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

func verifyAdminJWT(token, secret string, now time.Time) (verifiedAdminJWT, error) {
	payload, err := verifyJWT(token, secret, now, adminJWTAudience)
	if err != nil {
		return verifiedAdminJWT{}, err
	}
	adminID, err := strconv.ParseInt(payload.Subject, 10, 64)
	if err != nil || adminID <= 0 {
		return verifiedAdminJWT{}, errors.New("JWT subject is invalid")
	}
	return verifiedAdminJWT{AdminID: adminID, SessionVersion: payload.SessionVersion}, nil
}

func verifyJWT(token, secret string, now time.Time, audience string) (jwtPayload, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return jwtPayload{}, errors.New("JWT must contain three segments")
	}

	headerBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return jwtPayload{}, errors.New("JWT header is not valid base64url")
	}
	var header jwtHeader
	if err := json.Unmarshal(headerBytes, &header); err != nil || header.Algorithm != "HS256" {
		return jwtPayload{}, errors.New("JWT algorithm is not HS256")
	}

	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return jwtPayload{}, errors.New("JWT payload is not valid base64url")
	}
	var payload jwtPayload
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		return jwtPayload{}, errors.New("JWT payload is not valid JSON")
	}
	if payload.Issuer != allMailJWTIssuer {
		return jwtPayload{}, errors.New("JWT issuer is invalid")
	}
	if payload.ExpiresAt == 0 || float64(now.Unix()) >= payload.ExpiresAt {
		return jwtPayload{}, errors.New("JWT is expired")
	}
	if payload.NotBefore != nil && float64(now.Unix()) < *payload.NotBefore {
		return jwtPayload{}, errors.New("JWT is not active")
	}
	if !audienceContains(payload.Audience, audience) {
		return jwtPayload{}, errors.New("JWT audience is invalid")
	}
	if payload.SessionVersion <= 0 {
		return jwtPayload{}, errors.New("JWT session version is invalid")
	}

	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return jwtPayload{}, errors.New("JWT signature is not valid base64url")
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(parts[0] + "." + parts[1]))
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return jwtPayload{}, errors.New("JWT signature is invalid")
	}
	return payload, nil
}

func signAdminRevealGrant(admin Admin, secret string, now time.Time) (string, time.Time, error) {
	expiresAt := now.Add(adminRevealGrantTTL)
	sessionVersion := admin.SessionVersion
	if sessionVersion == 0 {
		sessionVersion = 1
	}
	audience, err := json.Marshal(adminRevealJWTAudience)
	if err != nil {
		return "", time.Time{}, err
	}
	headerBytes, err := json.Marshal(jwtHeader{Algorithm: "HS256", Type: "JWT"})
	if err != nil {
		return "", time.Time{}, err
	}
	payloadBytes, err := json.Marshal(jwtPayload{
		Issuer:         allMailJWTIssuer,
		Subject:        strconv.FormatInt(admin.ID, 10),
		Audience:       audience,
		ExpiresAt:      float64(expiresAt.Unix()),
		SessionVersion: sessionVersion,
		Purpose:        adminRevealJWTPurpose,
	})
	if err != nil {
		return "", time.Time{}, err
	}
	header := base64.RawURLEncoding.EncodeToString(headerBytes)
	payload := base64.RawURLEncoding.EncodeToString(payloadBytes)
	unsigned := header + "." + payload
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(unsigned))
	return unsigned + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), expiresAt, nil
}

func verifyAdminRevealGrant(token string, admin Admin, secret string, now time.Time) error {
	sessionVersion := admin.SessionVersion
	if sessionVersion == 0 {
		sessionVersion = 1
	}
	payload, err := verifyJWT(token, secret, now, adminRevealJWTAudience)
	if err != nil || payload.Subject != strconv.FormatInt(admin.ID, 10) ||
		payload.SessionVersion != sessionVersion || payload.Purpose != adminRevealJWTPurpose {
		return &requestError{Status: http.StatusUnauthorized, Code: "REVEAL_UNLOCK_EXPIRED", Cause: err}
	}
	return nil
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
