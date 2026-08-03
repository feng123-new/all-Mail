package businessapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/config"
)

func TestProviderProxyInputNormalizationAndTransport(t *testing.T) {
	proxyConfig, err := normalizeProviderProxyConfig("proxy.example.test:1080", "http://fallback.example.test:8080")
	if err != nil {
		t.Fatal(err)
	}
	if proxyConfig.Socks5 != "socks5://proxy.example.test:1080" || proxyConfig.HTTP != "http://fallback.example.test:8080" {
		t.Fatalf("proxy config = %#v", proxyConfig)
	}
	for _, fixture := range []struct {
		socks5 string
		http   string
	}{
		{socks5: "http://not-socks.example.test:1080"},
		{http: "socks5://not-http.example.test:8080"},
		{http: "relative-proxy"},
		{socks5: "127.0.0.1:1080"},
		{http: "http://169.254.169.254:80"},
		{http: "http://[::1]:8080"},
	} {
		if _, err := normalizeProviderProxyConfig(fixture.socks5, fixture.http); err == nil {
			t.Fatalf("accepted invalid proxy config %#v", fixture)
		}
	}

	server := &Server{cfg: config.GoBusinessAPIConfig{ProviderTimeout: 5 * time.Second}}
	client, err := server.providerClientFor(mailAccountCredentials{Proxy: providerProxyConfig{HTTP: "http://proxy.example.test:8080"}})
	if err != nil {
		t.Fatal(err)
	}
	transport, ok := client.Transport.(*http.Transport)
	if !ok || transport.Proxy == nil {
		t.Fatalf("HTTP proxy transport = %#v", client.Transport)
	}
	request := httptest.NewRequest(http.MethodGet, "https://gmail.googleapis.com/", nil)
	proxyURL, err := transport.Proxy(request)
	if err != nil || proxyURL.String() != "http://proxy.example.test:8080" {
		t.Fatalf("HTTP proxy URL = %v, %v", proxyURL, err)
	}
}

func TestParseExternalProviderMailInputPreservesProxyOptions(t *testing.T) {
	request := httptest.NewRequest(
		http.MethodGet,
		"/api/mail_all?email=user%40example.test&mailbox=INBOX&socks5=proxy.example.test%3A1080&http=http%3A%2F%2Ffallback.example.test%3A8080",
		nil,
	)
	input, err := parseExternalProviderMailInput(request, true)
	if err != nil {
		t.Fatal(err)
	}
	if input.Proxy.Socks5 != "socks5://proxy.example.test:1080" || input.Proxy.HTTP != "http://fallback.example.test:8080" {
		t.Fatalf("external proxy input = %#v", input)
	}

	request = httptest.NewRequest(http.MethodPost, "/api/mail_all", strings.NewReader(
		`{"email":"user@example.test","mailbox":"INBOX","http":"https://proxy.example.test:8443"}`,
	))
	input, err = parseExternalProviderMailInput(request, true)
	if err != nil || input.Proxy.HTTP != "https://proxy.example.test:8443" {
		t.Fatalf("external POST proxy input = %#v, %v", input, err)
	}
}
