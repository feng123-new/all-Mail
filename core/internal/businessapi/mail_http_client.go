package businessapi

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"

	netproxy "golang.org/x/net/proxy"
)

type providerProxyConfig struct {
	Socks5 string
	HTTP   string
}

func (s *Server) providerClient() *http.Client {
	if s.providerHTTPClient != nil {
		return s.providerHTTPClient
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.DialContext = s.dialProviderContext
	return &http.Client{Transport: transport, Timeout: s.cfg.ProviderTimeout}
}

func (s *Server) providerClientFor(account mailAccountCredentials) (*http.Client, error) {
	if account.Proxy.Socks5 == "" && account.Proxy.HTTP == "" {
		return s.providerClient(), nil
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.DialContext = s.dialProviderContext
	if account.Proxy.Socks5 != "" {
		proxyURL, err := url.Parse(account.Proxy.Socks5)
		if err != nil {
			return nil, err
		}
		var auth *netproxy.Auth
		if proxyURL.User != nil {
			password, _ := proxyURL.User.Password()
			auth = &netproxy.Auth{User: proxyURL.User.Username(), Password: password}
		}
		dialer, err := netproxy.SOCKS5("tcp", proxyURL.Host, auth, providerContextDialer{server: s})
		if err != nil {
			return nil, err
		}
		transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
			if contextDialer, ok := dialer.(netproxy.ContextDialer); ok {
				return contextDialer.DialContext(ctx, network, address)
			}
			return dialer.Dial(network, address)
		}
	} else {
		proxyURL, err := url.Parse(account.Proxy.HTTP)
		if err != nil {
			return nil, err
		}
		transport.Proxy = http.ProxyURL(proxyURL)
	}
	return &http.Client{Transport: transport, Timeout: s.cfg.ProviderTimeout}, nil
}

func (s *Server) doProviderRequest(account mailAccountCredentials, request *http.Request) (*http.Response, error) {
	client, err := s.providerClientFor(account)
	if err != nil {
		return nil, providerFailure("PROXY_CONFIGURATION_INVALID", err)
	}
	return client.Do(request)
}

func normalizeProviderProxyConfig(socks5, httpProxy string) (providerProxyConfig, error) {
	normalize := func(raw, expected string, allowed ...string) (string, error) {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			return "", nil
		}
		if len(raw) > 2048 {
			return "", validationError(expected + " proxy URL is too long")
		}
		if !strings.Contains(raw, "://") && expected == "socks5" {
			raw = "socks5://" + raw
		}
		parsed, err := url.Parse(raw)
		if err != nil || parsed.Host == "" {
			return "", validationError(expected + " proxy must be an absolute URL")
		}
		if err := validateProviderHostLiteral(parsed.Hostname()); err != nil {
			return "", validationError(expected + " proxy targets a blocked network address")
		}
		if expected == "socks5" && parsed.Port() == "" {
			return "", validationError("socks5 proxy must include a port")
		}
		for _, scheme := range allowed {
			if parsed.Scheme == scheme {
				return parsed.String(), nil
			}
		}
		return "", validationError(expected + " proxy uses an unsupported scheme")
	}
	normalizedSocks5, err := normalize(socks5, "socks5", "socks5")
	if err != nil {
		return providerProxyConfig{}, err
	}
	normalizedHTTP, err := normalize(httpProxy, "http", "http", "https")
	if err != nil {
		return providerProxyConfig{}, err
	}
	return providerProxyConfig{Socks5: normalizedSocks5, HTTP: normalizedHTTP}, nil
}

func providerHTTPFailure(code string, response *http.Response) error {
	body, _ := io.ReadAll(io.LimitReader(response.Body, 8192))
	message := strings.TrimSpace(string(body))
	if message == "" {
		message = response.Status
	}
	return providerFailure(code, fmt.Errorf("provider returned %d: %s", response.StatusCode, message))
}
