package businessapi

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestSignSessionJWTEmitsCrossRuntimeClaims(t *testing.T) {
	now := time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC)
	token, err := signSessionJWT(sessionJWTClaims{
		Subject:        42,
		Audience:       mailboxJWTAudience,
		SessionVersion: 3,
		Username:       "portal-user",
		Role:           "MAILBOX_USER",
		MailboxUserID:  42,
		MailboxIDs:     []int64{7, 9},
	}, testJWTSecret, now, 2*time.Hour)
	if err != nil {
		t.Fatal(err)
	}

	verified, err := verifyJWT(token, testJWTSecret, now.Add(time.Hour), mailboxJWTAudience)
	if err != nil {
		t.Fatal(err)
	}
	if verified.Subject != "42" || verified.SessionVersion != 3 || verified.IssuedAt != float64(now.Unix()) || verified.ExpiresAt != float64(now.Add(2*time.Hour).Unix()) {
		t.Fatalf("verified claims = %#v", verified)
	}

	parts := splitJWT(t, token)
	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		t.Fatal(err)
	}
	if payload["username"] != "portal-user" || payload["role"] != "MAILBOX_USER" || payload["mailboxUserId"] != float64(42) {
		t.Fatalf("compatibility payload = %#v", payload)
	}
	mailboxIDs, ok := payload["mailboxIds"].([]any)
	if !ok || len(mailboxIDs) != 2 || mailboxIDs[0] != float64(7) || mailboxIDs[1] != float64(9) {
		t.Fatalf("mailboxIds = %#v", payload["mailboxIds"])
	}
}

func TestAuthenticateAdminIdentityAllowsForcedPasswordRotation(t *testing.T) {
	now := time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC)
	store := &fakeStore{admin: Admin{
		ID:                 7,
		Username:           "admin",
		Status:             "ACTIVE",
		MustChangePassword: true,
		SessionVersion:     1,
	}}
	request := httptest.NewRequest(http.MethodGet, "/admin/auth/me", nil)
	request.AddCookie(&http.Cookie{Name: "token", Value: signTestJWT(t, 7, adminJWTAudience, now.Add(time.Hour))})

	admin, err := authenticateAdminIdentity(context.Background(), request, store, testJWTSecret, now)
	if err != nil {
		t.Fatal(err)
	}
	if admin.ID != 7 || !admin.MustChangePassword {
		t.Fatalf("admin = %#v", admin)
	}
	if _, err := authenticateAdmin(context.Background(), request, store, testJWTSecret, now); err == nil {
		t.Fatal("ordinary administrator authentication allowed a forced-password session")
	}
}

func splitJWT(t *testing.T, token string) []string {
	t.Helper()
	parts := make([]string, 0, 3)
	start := 0
	for index, value := range token {
		if value == '.' {
			parts = append(parts, token[start:index])
			start = index + 1
		}
	}
	parts = append(parts, token[start:])
	if len(parts) != 3 {
		t.Fatalf("JWT segments = %d", len(parts))
	}
	return parts
}
