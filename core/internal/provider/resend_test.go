package provider

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestResendSendPreservesPayloadAndIdempotencyKey(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/emails" {
			t.Fatalf("request = %s %s", r.Method, r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer re_secret" {
			t.Fatalf("Authorization = %q", got)
		}
		if got := r.Header.Get("Idempotency-Key"); got != "mailbox-forward/1/10" {
			t.Fatalf("Idempotency-Key = %q", got)
		}
		var payload SendRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if payload.From != "Forwarder <inbox@example.com>" || len(payload.To) != 1 || payload.To[0] != "target@example.net" {
			t.Fatalf("payload = %#v", payload)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"provider-1"}`))
	}))
	defer server.Close()

	client := NewResendClient(server.URL, server.Client())
	result, err := client.Send(context.Background(), "re_secret", SendRequest{
		From:           "Forwarder <inbox@example.com>",
		To:             []string{"target@example.net"},
		Subject:        "Fwd: Test",
		Text:           "text",
		HTML:           "<p>html</p>",
		IdempotencyKey: "mailbox-forward/1/10",
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.ID != "provider-1" {
		t.Fatalf("provider ID = %q", result.ID)
	}
}

func TestResendSendReturnsProviderError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"message":"temporary upstream 503"}`))
	}))
	defer server.Close()

	client := NewResendClient(server.URL, server.Client())
	if _, err := client.Send(context.Background(), "re_secret", SendRequest{To: []string{"target@example.net"}}); err == nil {
		t.Fatal("Send() expected an error")
	}
}
