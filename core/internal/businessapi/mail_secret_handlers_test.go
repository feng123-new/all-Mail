package businessapi

import (
	"strings"
	"testing"
	"time"
)

func TestVerifyTOTPAcceptsRFCVectorAndRejectsMalformedToken(t *testing.T) {
	now := time.Unix(59, 0)
	if !verifyTOTP("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", "287082", 0, now) {
		t.Fatal("verifyTOTP rejected the RFC 6238 SHA-1 vector")
	}
	for _, token := range []string{"28708", "2870820", "abcdef"} {
		if verifyTOTP("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", token, 1, now) {
			t.Fatalf("verifyTOTP accepted malformed token %q", token)
		}
	}
}

func TestAdminRevealGrantBindsIdentitySessionPurposeAndExpiry(t *testing.T) {
	now := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	admin := Admin{ID: 7, SessionVersion: 3}
	token, expiresAt, err := signAdminRevealGrant(admin, testJWTSecret, now)
	if err != nil {
		t.Fatal(err)
	}
	if expiresAt != now.Add(adminRevealGrantTTL) || strings.Count(token, ".") != 2 {
		t.Fatalf("grant = %q, expiresAt = %s", token, expiresAt)
	}
	if err := verifyAdminRevealGrant(token, admin, testJWTSecret, now); err != nil {
		t.Fatal(err)
	}
	for name, candidate := range map[string]Admin{
		"administrator": {ID: 8, SessionVersion: 3},
		"session":       {ID: 7, SessionVersion: 4},
	} {
		if err := verifyAdminRevealGrant(token, candidate, testJWTSecret, now); err == nil {
			t.Fatalf("grant accepted a different %s", name)
		}
	}
	if err := verifyAdminRevealGrant(token, admin, testJWTSecret, expiresAt); err == nil {
		t.Fatal("grant remained valid at its expiration time")
	}
}
