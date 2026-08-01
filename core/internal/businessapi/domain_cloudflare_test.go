package businessapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestDomainCloudflareConfigEncryptsAndSanitizesPersistedToken(t *testing.T) {
	const encryptionKey = "test-encryption-key-1234567890ab"
	token := "cloudflare-token-1234567890"
	zoneID := "zone_12345678"
	status, err := saveCloudflareConfigToDomainDNS(domainDNSStatus{}, domainCloudflareConfigInput{
		APITokenPresent: true,
		APIToken:        &token,
		ZoneIDPresent:   true,
		ZoneID:          &zoneID,
	}, encryptionKey)
	if err != nil {
		t.Fatal(err)
	}
	persisted, err := json.Marshal(status)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(persisted), token) || status.Cloudflare == nil || status.Cloudflare.APITokenEncrypted == nil {
		t.Fatalf("persisted DNS status exposed token: %s", persisted)
	}
	if status.Provider == nil || *status.Provider != "CLOUDFLARE" || status.Cloudflare.ZoneID == nil || *status.Cloudflare.ZoneID != zoneID {
		t.Fatalf("persisted DNS status = %#v", status)
	}
	decrypted, err := savedCloudflareToken(status, encryptionKey)
	if err != nil || decrypted != token {
		t.Fatalf("saved token = %q, %v", decrypted, err)
	}

	view := cloudflareValidationViewForDNS(status)
	if !view.HasSavedToken || view.TokenHint == nil || !strings.HasSuffix(*view.TokenHint, "7890") {
		t.Fatalf("validation view = %#v", view)
	}
	safe := safeDomainDNSStatus(status)
	safeJSON, err := json.Marshal(safe)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(safeJSON), "apiTokenEncrypted") || strings.Contains(string(safeJSON), token) {
		t.Fatalf("safe DNS status exposed secret: %s", safeJSON)
	}
}

func TestDomainCloudflareConfigClearTokenPreservesZoneAndClearsValidation(t *testing.T) {
	const encryptionKey = "test-encryption-key-1234567890ab"
	token := "cloudflare-token-1234567890"
	zoneID := "zone_12345678"
	status, err := saveCloudflareConfigToDomainDNS(domainDNSStatus{}, domainCloudflareConfigInput{
		APITokenPresent: true, APIToken: &token, ZoneIDPresent: true, ZoneID: &zoneID,
	}, encryptionKey)
	if err != nil {
		t.Fatal(err)
	}
	validatedAt := "2026-08-01T12:00:00.000Z"
	status.Cloudflare.LastValidation = &domainCloudflareValidationResult{Status: "warn", LastValidatedAt: validatedAt, Checks: []domainCloudflareValidationCheck{}, ManualActions: []string{}}
	status.Cloudflare.LastValidatedAt = &validatedAt
	status, err = saveCloudflareConfigToDomainDNS(status, domainCloudflareConfigInput{ClearSavedToken: true}, encryptionKey)
	if err != nil {
		t.Fatal(err)
	}
	if status.Cloudflare == nil || status.Cloudflare.APITokenEncrypted != nil || status.Cloudflare.TokenHint != nil || status.Cloudflare.LastValidation != nil || status.Cloudflare.LastValidatedAt != nil || status.Cloudflare.ZoneID == nil || *status.Cloudflare.ZoneID != zoneID {
		t.Fatalf("cleared DNS status = %#v", status)
	}
}

func TestResolveCloudflareZoneCandidatesFallsBackToParent(t *testing.T) {
	actual := resolveCloudflareZoneCandidates(" Mail.Ops.Example.COM ")
	expected := []string{"mail.ops.example.com", "ops.example.com", "example.com"}
	if len(actual) != len(expected) {
		t.Fatalf("zone candidates = %#v", actual)
	}
	for index := range expected {
		if actual[index] != expected[index] {
			t.Fatalf("zone candidates = %#v", actual)
		}
	}
}

func TestDomainCloudflareConfigFingerprintChangesWithCredentialsAndZone(t *testing.T) {
	tokenA := "encrypted-a"
	tokenB := "encrypted-b"
	zoneA := "zone-a"
	zoneB := "zone-b"
	base := domainDNSStatus{Cloudflare: &domainCloudflareDNSStatus{APITokenEncrypted: &tokenA, ZoneID: &zoneA}}
	baseFingerprint := domainCloudflareConfigFingerprint(base)
	if baseFingerprint == domainCloudflareConfigFingerprint(domainDNSStatus{Cloudflare: &domainCloudflareDNSStatus{APITokenEncrypted: &tokenB, ZoneID: &zoneA}}) {
		t.Fatal("Cloudflare token change did not change config fingerprint")
	}
	if baseFingerprint == domainCloudflareConfigFingerprint(domainDNSStatus{Cloudflare: &domainCloudflareDNSStatus{APITokenEncrypted: &tokenA, ZoneID: &zoneB}}) {
		t.Fatal("Cloudflare zone change did not change config fingerprint")
	}
}

func TestValidateCloudflareDomainBuildsEquivalentChecksAndUsesConcurrentRequests(t *testing.T) {
	var lock sync.Mutex
	paths := make(map[string]int)
	transport := providerRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		lock.Lock()
		paths[request.URL.Path+"?"+request.URL.RawQuery]++
		lock.Unlock()
		if request.Header.Get("Authorization") != "Bearer cloudflare-token-1234567890" {
			t.Fatalf("authorization header = %q", request.Header.Get("Authorization"))
		}
		var result any
		switch request.URL.Path {
		case "/client/v4/zones/zone_12345678":
			result = map[string]any{"id": "zone_12345678", "name": "example.com", "status": "active", "name_servers": []string{"ns1.example.net", "ns2.example.net"}}
		case "/client/v4/zones/zone_12345678/email/routing":
			result = map[string]any{"enabled": true, "status": "ready"}
		case "/client/v4/zones/zone_12345678/email/routing/dns":
			result = map[string]any{"errors": []any{}, "record": []any{}}
		case "/client/v4/zones/zone_12345678/dns_records":
			switch request.URL.Query().Get("type") {
			case "MX":
				result = []map[string]any{{"type": "MX", "name": "example.com", "content": "route.mx.cloudflare.net"}}
			case "TXT":
				result = []map[string]any{
					{"type": "TXT", "name": "example.com", "content": "v=spf1 include:_spf.mx.cloudflare.net ~all"},
					{"type": "TXT", "name": "_dmarc.example.com", "content": "v=DMARC1; p=none"},
					{"type": "TXT", "name": "selector._domainkey.example.com", "content": "v=DKIM1; p=value"},
				}
			default:
				t.Fatalf("unexpected DNS query: %s", request.URL.RawQuery)
			}
		case "/client/v4/zones/zone_12345678/email/routing/rules":
			result = []map[string]any{{
				"id": "rule-1", "name": "allmail", "enabled": true,
				"actions":  []map[string]any{{"type": "worker", "value": []string{"allmail-edge"}}},
				"matchers": []map[string]any{{"type": "all"}},
			}}
		default:
			t.Fatalf("unexpected Cloudflare path: %s", request.URL.String())
		}
		payload, err := json.Marshal(map[string]any{"success": true, "result": result})
		if err != nil {
			t.Fatal(err)
		}
		return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(string(payload))), Request: request}, nil
	})
	client := &http.Client{Transport: transport}
	now := time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC)
	result, err := validateCloudflareDomain(context.Background(), client, domainCloudflareValidationTarget{
		DomainName: "mail.example.com", CanReceive: true, IsCatchAllEnabled: true,
		APIToken: "cloudflare-token-1234567890", ZoneID: "zone_12345678",
	}, now)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "pass" || result.ZoneName == nil || *result.ZoneName != "example.com" || result.LastValidatedAt != "2026-08-01T12:00:00.000Z" || len(result.Checks) != 8 || len(result.ManualActions) != 0 {
		t.Fatalf("validation result = %#v", result)
	}
	for _, check := range result.Checks {
		if check.Status != "pass" {
			t.Fatalf("validation check = %#v", check)
		}
	}
	lock.Lock()
	defer lock.Unlock()
	if len(paths) != 6 {
		t.Fatalf("Cloudflare requests = %#v", paths)
	}
}

func TestCloudflareAPIErrorsMapAuthenticationAndUpstreamFailures(t *testing.T) {
	for _, test := range []struct {
		name       string
		statusCode int
		success    bool
		wantStatus int
		wantCode   string
	}{
		{name: "authentication", statusCode: http.StatusForbidden, wantStatus: http.StatusBadRequest, wantCode: "CLOUDFLARE_AUTH_FAILED"},
		{name: "upstream", statusCode: http.StatusInternalServerError, wantStatus: http.StatusBadGateway, wantCode: "CLOUDFLARE_API_REQUEST_FAILED"},
	} {
		t.Run(test.name, func(t *testing.T) {
			client := &http.Client{Transport: providerRoundTripFunc(func(request *http.Request) (*http.Response, error) {
				body := `{"success":false,"result":null,"errors":[{"message":"provider failure"}]}`
				return &http.Response{StatusCode: test.statusCode, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body)), Request: request}, nil
			})}
			_, err := validateCloudflareDomain(context.Background(), client, domainCloudflareValidationTarget{
				DomainName: "example.com", APIToken: "cloudflare-token-1234567890", ZoneID: "zone_12345678",
			}, time.Now())
			requestErr, ok := err.(*requestError)
			if !ok || requestErr.Status != test.wantStatus || requestErr.Code != test.wantCode {
				t.Fatalf("Cloudflare error = %#v", err)
			}
		})
	}
}
