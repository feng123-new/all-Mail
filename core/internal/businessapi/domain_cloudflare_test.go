package businessapi

import (
	"context"
	"net/http"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestManagedCloudflareZoneCandidatesAndSafeViews(t *testing.T) {
	candidates := resolveManagedCloudflareZoneCandidates("mail.ops.example.com")
	want := []string{"mail.ops.example.com", "ops.example.com", "example.com"}
	if !reflect.DeepEqual(candidates, want) {
		t.Fatalf("zone candidates = %#v, want %#v", candidates, want)
	}

	encrypted := "secret-ciphertext"
	hint := "Saved token ending in 7890"
	zoneID := "zone_12345678"
	when := "2026-08-01T00:00:00.000Z"
	status := managedDomainDNSStatus{
		Provider: managedDNSStringPointer("CLOUDFLARE"),
		Cloudflare: &managedDomainCloudflareConfig{
			APITokenEncrypted: &encrypted,
			TokenHint:         &hint,
			ZoneID:            &zoneID,
			LastValidatedAt:   &when,
		},
	}
	safe := safeManagedDomainDNSStatus(status).(map[string]any)
	cloudflare := safe["cloudflare"].(map[string]any)
	if _, exposed := cloudflare["apiTokenEncrypted"]; exposed {
		t.Fatalf("safe DNS status exposed encrypted token: %#v", safe)
	}
	view := managedDomainCloudflareView(status)
	if view["hasSavedToken"] != true || view["zoneId"] != zoneID || view["tokenHint"] != hint {
		t.Fatalf("Cloudflare view = %#v", view)
	}
}

func TestValidateManagedCloudflareDomainBuildsCompleteResult(t *testing.T) {
	requests := make([]string, 0, 7)
	client := &http.Client{Transport: providerRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.Header.Get("Authorization") != "Bearer token-value" {
			t.Fatalf("authorization header = %q", request.Header.Get("Authorization"))
		}
		requests = append(requests, request.URL.Path+"?"+request.URL.RawQuery)
		switch request.URL.Path {
		case "/client/v4/zones":
			if request.URL.Query().Get("name") != "mail.example.com" {
				t.Fatalf("zone query = %q", request.URL.RawQuery)
			}
			return providerJSONResponse(http.StatusOK, `{"success":true,"result":[{"id":"zone-id","name":"mail.example.com","status":"active","name_servers":["ns1.example"]}],"errors":[]}`), nil
		case "/client/v4/zones/zone-id/email/routing":
			return providerJSONResponse(http.StatusOK, `{"success":true,"result":{"enabled":true,"status":"ready","name":"mail.example.com"},"errors":[]}`), nil
		case "/client/v4/zones/zone-id/email/routing/dns":
			return providerJSONResponse(http.StatusOK, `{"success":true,"result":{"errors":[],"record":[]},"errors":[]}`), nil
		case "/client/v4/zones/zone-id/dns_records":
			switch request.URL.Query().Get("type") {
			case "MX":
				return providerJSONResponse(http.StatusOK, `{"success":true,"result":[{"id":"mx","type":"MX","name":"mail.example.com","content":"route.mx.cloudflare.net","priority":10}],"errors":[]}`), nil
			case "TXT":
				return providerJSONResponse(http.StatusOK, `{"success":true,"result":[{"id":"spf","type":"TXT","name":"mail.example.com","content":"v=spf1 include:_spf.mx.cloudflare.net ~all"},{"id":"dmarc","type":"TXT","name":"_dmarc.mail.example.com","content":"v=DMARC1; p=none"},{"id":"dkim","type":"TXT","name":"selector._domainkey.mail.example.com","content":"v=DKIM1; p=fixture"}],"errors":[]}`), nil
			}
		case "/client/v4/zones/zone-id/email/routing/rules":
			return providerJSONResponse(http.StatusOK, `{"success":true,"result":[{"id":"rule","name":"all-mail","enabled":true,"actions":[{"type":"worker","value":["allmail-edge"]}],"matchers":[{"type":"all","field":"to","value":""}]}],"errors":[]}`), nil
		}
		t.Fatalf("unexpected Cloudflare request %s", request.URL.String())
		return nil, nil
	})}

	now := time.Date(2026, time.August, 1, 0, 0, 0, 0, time.UTC)
	result, err := validateManagedCloudflareDomain(context.Background(), client, managedCloudflareValidationOptions{
		DomainName: "mail.example.com", CanReceive: true, IsCatchAllEnabled: true,
		APIToken: "token-value", Now: now,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "pass" || result.ZoneID == nil || *result.ZoneID != "zone-id" {
		t.Fatalf("validation result = %#v", result)
	}
	if result.LastValidatedAt != "2026-08-01T00:00:00.000Z" {
		t.Fatalf("lastValidatedAt = %q", result.LastValidatedAt)
	}
	if len(result.Checks) != 8 || len(result.ManualActions) != 0 {
		t.Fatalf("validation checks/actions = %#v / %#v", result.Checks, result.ManualActions)
	}
	if len(requests) != 6 {
		t.Fatalf("Cloudflare request count = %d: %#v", len(requests), requests)
	}
}

func TestFetchManagedCloudflareMapsAuthenticationFailure(t *testing.T) {
	client := &http.Client{Transport: providerRoundTripFunc(func(_ *http.Request) (*http.Response, error) {
		return providerJSONResponse(http.StatusForbidden, `{"success":false,"result":null,"errors":[{"code":9109,"message":"Invalid access token"}]}`), nil
	})}
	_, err := fetchManagedCloudflare[managedCloudflareZone](context.Background(), client, "/zones/zone-id", "bad-token", nil)
	requestErr, ok := err.(*requestError)
	if !ok || requestErr.Status != http.StatusBadRequest || requestErr.Code != "CLOUDFLARE_AUTH_FAILED" || !strings.Contains(requestErr.Cause.Error(), "Invalid access token") {
		t.Fatalf("Cloudflare auth error = %#v", err)
	}
}
