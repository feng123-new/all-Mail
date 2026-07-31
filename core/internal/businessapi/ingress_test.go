package businessapi

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const (
	testIngressEncryptionKey = "0123456789abcdef0123456789abcdef"
	testIngressSigningSecret = "ingress-signing-secret-for-tests"
	testIngressKeyID         = "edge-test-key"
)

type fakeIngressStore struct {
	*fakeStore
	endpoint      IngressEndpoint
	endpointErr   error
	result        IngressResult
	receiveErr    error
	receivedInput IngressReceiveInput
	receiveCalls  int
}

func (s *fakeIngressStore) FindIngressEndpoint(context.Context, string) (IngressEndpoint, error) {
	return s.endpoint, s.endpointErr
}

func (s *fakeIngressStore) ReceiveIngress(
	_ context.Context,
	input IngressReceiveInput,
	_ IngressEndpoint,
) (IngressResult, error) {
	s.receiveCalls++
	s.receivedInput = input
	return s.result, s.receiveErr
}

type fakeReplayProtector struct {
	reserved     bool
	reserveErr   error
	releaseErr   error
	reserveKey   string
	reserveValue string
	reserveTTL   time.Duration
	releaseCalls int
}

func (r *fakeReplayProtector) Reserve(_ context.Context, key, value string, ttl time.Duration) (bool, error) {
	r.reserveKey = key
	r.reserveValue = value
	r.reserveTTL = ttl
	return r.reserved, r.reserveErr
}

func (r *fakeReplayProtector) Release(context.Context, string, string) error {
	r.releaseCalls++
	return r.releaseErr
}

func TestIngressReceiveVerifiesSignatureNormalizesPayloadAndReservesReplay(t *testing.T) {
	domainName := "example.com"
	store := &fakeIngressStore{
		fakeStore: &fakeStore{},
		endpoint: IngressEndpoint{
			ID:                     11,
			DomainID:               ingressInt64Pointer(22),
			DomainName:             &domainName,
			KeyID:                  testIngressKeyID,
			Status:                 "ACTIVE",
			SigningSecretEncrypted: encryptIngressTestSecret(t, testIngressEncryptionKey, testIngressSigningSecret),
		},
		result: IngressResult{
			Accepted: true, Route: "EXACT_MAILBOX", DomainID: 22, MailboxID: 33, MessageID: "44",
		},
	}
	replay := &fakeReplayProtector{reserved: true}
	server := ingressTestServer(store, replay)
	body := validIngressBody("delivery-unit-1")
	request := signedIngressRequest(t, body, testIngressSigningSecret, server.now())
	request.Header.Set("X-Request-Id", "ingress-unit-request")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"messageId":"44"`) {
		t.Fatalf("ingress response = %d %s", response.Code, response.Body.String())
	}
	if store.receiveCalls != 1 {
		t.Fatalf("receive calls = %d", store.receiveCalls)
	}
	if store.receivedInput.Routing.Domain != "example.com" ||
		store.receivedInput.Routing.MatchedAddress != "inbox@example.com" ||
		store.receivedInput.Envelope.From != "sender@example.net" {
		t.Fatalf("normalized ingress input = %#v", store.receivedInput)
	}
	if replay.reserveKey != "ingress:replay:edge-test-key:delivery-unit-1" ||
		replay.reserveValue != "ingress-unit-request" || replay.reserveTTL != 10*time.Minute {
		t.Fatalf("replay reservation = key %q value %q ttl %s", replay.reserveKey, replay.reserveValue, replay.reserveTTL)
	}
	if replay.releaseCalls != 0 {
		t.Fatalf("successful ingress released replay reservation %d times", replay.releaseCalls)
	}
}

func TestIngressReceiveRejectsInvalidSecurityState(t *testing.T) {
	domainName := "example.com"
	baseEndpoint := IngressEndpoint{
		ID:                     11,
		DomainName:             &domainName,
		KeyID:                  testIngressKeyID,
		Status:                 "ACTIVE",
		SigningSecretEncrypted: encryptIngressTestSecret(t, testIngressEncryptionKey, testIngressSigningSecret),
	}

	tests := []struct {
		name       string
		mutate     func(*fakeIngressStore, *fakeReplayProtector, *http.Request)
		wantStatus int
		wantCode   string
	}{
		{
			name: "missing headers",
			mutate: func(_ *fakeIngressStore, _ *fakeReplayProtector, request *http.Request) {
				request.Header.Del("X-Ingress-Signature")
			},
			wantStatus: http.StatusUnauthorized,
			wantCode:   "INGRESS_SIGNATURE_REQUIRED",
		},
		{
			name: "bad signature",
			mutate: func(_ *fakeIngressStore, _ *fakeReplayProtector, request *http.Request) {
				request.Header.Set("X-Ingress-Signature", strings.Repeat("0", 64))
			},
			wantStatus: http.StatusUnauthorized,
			wantCode:   "INGRESS_SIGNATURE_INVALID",
		},
		{
			name: "expired timestamp",
			mutate: func(_ *fakeIngressStore, _ *fakeReplayProtector, request *http.Request) {
				request.Header.Set("X-Ingress-Timestamp", "1")
			},
			wantStatus: http.StatusUnauthorized,
			wantCode:   "INGRESS_SIGNATURE_EXPIRED",
		},
		{
			name: "disabled endpoint",
			mutate: func(store *fakeIngressStore, _ *fakeReplayProtector, _ *http.Request) {
				store.endpoint.Status = "DISABLED"
			},
			wantStatus: http.StatusForbidden,
			wantCode:   "INGRESS_ENDPOINT_DISABLED",
		},
		{
			name: "missing endpoint secret",
			mutate: func(store *fakeIngressStore, _ *fakeReplayProtector, _ *http.Request) {
				store.endpoint.SigningSecretEncrypted = ""
			},
			wantStatus: http.StatusServiceUnavailable,
			wantCode:   "INGRESS_NOT_CONFIGURED",
		},
		{
			name: "domain mismatch",
			mutate: func(store *fakeIngressStore, _ *fakeReplayProtector, _ *http.Request) {
				other := "other.example"
				store.endpoint.DomainName = &other
			},
			wantStatus: http.StatusForbidden,
			wantCode:   "INGRESS_ENDPOINT_DOMAIN_MISMATCH",
		},
		{
			name: "replay",
			mutate: func(_ *fakeIngressStore, replay *fakeReplayProtector, _ *http.Request) {
				replay.reserved = false
			},
			wantStatus: http.StatusConflict,
			wantCode:   "INGRESS_REPLAY_DETECTED",
		},
		{
			name: "replay backend unavailable",
			mutate: func(_ *fakeIngressStore, replay *fakeReplayProtector, _ *http.Request) {
				replay.reserveErr = errors.New("redis unavailable")
			},
			wantStatus: http.StatusServiceUnavailable,
			wantCode:   "INGRESS_REPLAY_BACKEND_UNAVAILABLE",
		},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			store := &fakeIngressStore{fakeStore: &fakeStore{}, endpoint: baseEndpoint}
			replay := &fakeReplayProtector{reserved: true}
			server := ingressTestServer(store, replay)
			body := validIngressBody("delivery-security")
			request := signedIngressRequest(t, body, testIngressSigningSecret, server.now())
			testCase.mutate(store, replay, request)
			response := httptest.NewRecorder()
			server.Handler().ServeHTTP(response, request)
			if response.Code != testCase.wantStatus || !strings.Contains(response.Body.String(), testCase.wantCode) {
				t.Fatalf("response = %d %s", response.Code, response.Body.String())
			}
		})
	}
}

func TestIngressReceiveReleasesReplayReservationWhenPersistenceFails(t *testing.T) {
	domainName := "example.com"
	store := &fakeIngressStore{
		fakeStore: &fakeStore{},
		endpoint: IngressEndpoint{
			ID:                     11,
			DomainName:             &domainName,
			KeyID:                  testIngressKeyID,
			Status:                 "ACTIVE",
			SigningSecretEncrypted: encryptIngressTestSecret(t, testIngressEncryptionKey, testIngressSigningSecret),
		},
		receiveErr: context.DeadlineExceeded,
	}
	replay := &fakeReplayProtector{reserved: true}
	server := ingressTestServer(store, replay)
	request := signedIngressRequest(t, validIngressBody("delivery-failure"), testIngressSigningSecret, server.now())
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("response = %d %s", response.Code, response.Body.String())
	}
	if replay.releaseCalls != 1 {
		t.Fatalf("replay release calls = %d, want 1", replay.releaseCalls)
	}
}

func TestIngressReceiveReportsEndpointStoreFailureAsInternalError(t *testing.T) {
	store := &fakeIngressStore{fakeStore: &fakeStore{}, endpointErr: errors.New("database unavailable")}
	server := ingressTestServer(store, &fakeReplayProtector{reserved: true})
	request := signedIngressRequest(t, validIngressBody("delivery-endpoint-error"), testIngressSigningSecret, server.now())
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusInternalServerError || !strings.Contains(response.Body.String(), "INTERNAL_ERROR") {
		t.Fatalf("response = %d %s", response.Code, response.Body.String())
	}
}

func TestIngressReceiveValidatesPayloadBeforePersistence(t *testing.T) {
	domainName := "example.com"
	store := &fakeIngressStore{
		fakeStore: &fakeStore{},
		endpoint: IngressEndpoint{
			ID:                     11,
			DomainName:             &domainName,
			KeyID:                  testIngressKeyID,
			Status:                 "ACTIVE",
			SigningSecretEncrypted: encryptIngressTestSecret(t, testIngressEncryptionKey, testIngressSigningSecret),
		},
	}
	server := ingressTestServer(store, &fakeReplayProtector{reserved: true})
	body := strings.Replace(validIngressBody("delivery-invalid"), `"to":"Inbox@Example.COM"`, `"to":"different@example.com"`, 1)
	request := signedIngressRequest(t, body, testIngressSigningSecret, server.now())
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "VALIDATION_ERROR") {
		t.Fatalf("response = %d %s", response.Code, response.Body.String())
	}
	if store.receiveCalls != 0 {
		t.Fatalf("invalid request reached persistence %d times", store.receiveCalls)
	}
}

func ingressTestServer(store *fakeIngressStore, replay ReplayProtector) *Server {
	server := testServer(store)
	server.cfg.EncryptionKey = testIngressEncryptionKey
	server.cfg.IngressAllowedSkew = 5 * time.Minute
	server.ingressStore = store
	server.replayProtector = replay
	return server
}

func signedIngressRequest(t *testing.T, body, secret string, now time.Time) *http.Request {
	t.Helper()
	timestamp := fmt.Sprintf("%d", now.Unix())
	request := httptest.NewRequest(http.MethodPost, "/ingress/domain-mail/receive", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Ingress-Key-Id", testIngressKeyID)
	request.Header.Set("X-Ingress-Timestamp", timestamp)
	request.Header.Set("X-Ingress-Signature", signIngressTestBody(secret, timestamp, request.Method, request.URL.Path, body))
	return request
}

func signIngressTestBody(secret, timestamp, method, path, body string) string {
	bodyHash := sha256.Sum256([]byte(body))
	canonical := timestamp + "\n" + strings.ToUpper(method) + "\n" + path + "\n" + hex.EncodeToString(bodyHash[:])
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(canonical))
	return hex.EncodeToString(mac.Sum(nil))
}

func encryptIngressTestSecret(t *testing.T, key, plaintext string) string {
	t.Helper()
	digest := sha256.Sum256([]byte(key))
	block, err := aes.NewCipher(digest[:])
	if err != nil {
		t.Fatal(err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatal(err)
	}
	nonce := make([]byte, gcm.NonceSize())
	for index := range nonce {
		nonce[index] = byte(index + 1)
	}
	sealed := gcm.Seal(nil, nonce, []byte(plaintext), nil)
	ciphertext := sealed[:len(sealed)-gcm.Overhead()]
	tag := sealed[len(sealed)-gcm.Overhead():]
	return hex.EncodeToString(nonce) + ":" + hex.EncodeToString(tag) + ":" + hex.EncodeToString(ciphertext)
}

func validIngressBody(deliveryKey string) string {
	return fmt.Sprintf(`{
		"provider":"CLOUDFLARE_EMAIL_ROUTING",
		"deliveryKey":%q,
		"receivedAt":"2026-07-30T00:00:00Z",
		"envelope":{"from":" Sender@Example.NET ","to":"Inbox@Example.COM"},
		"routing":{"domain":"Example.COM","localPart":"Inbox","matchedAddress":"Inbox@Example.COM"},
		"message":{
			"messageId":" <message@example.net> ",
			"subject":" Verification ",
			"textPreview":"Your code is 654321",
			"headers":{"message-id":"<message@example.net>"},
			"attachments":[],
			"rawObjectKey":"allmail-edge/raw/ab/abcdef.eml",
			"storageStatus":"STORED"
		}
	}`, deliveryKey)
}

func ingressInt64Pointer(value int64) *int64 { return &value }
