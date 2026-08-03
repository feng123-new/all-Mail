package businessapi

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strings"
	"time"
)

type providerIPResolver interface {
	LookupIPAddr(context.Context, string) ([]net.IPAddr, error)
}

type providerDialFunc func(context.Context, string, string) (net.Conn, error)

var blockedProviderNetworks = mustProviderNetworks(
	"100.64.0.0/10", // carrier-grade NAT and shared address space
	"192.0.0.0/24",  // IETF protocol assignments
	"198.18.0.0/15", // benchmark networks
	"240.0.0.0/4",   // reserved IPv4 space
)

func mustProviderNetworks(values ...string) []*net.IPNet {
	result := make([]*net.IPNet, 0, len(values))
	for _, value := range values {
		_, network, err := net.ParseCIDR(value)
		if err != nil {
			panic(err)
		}
		result = append(result, network)
	}
	return result
}

func (s *Server) dialProviderContext(ctx context.Context, network, address string) (net.Conn, error) {
	if s != nil && s.providerDialContext != nil {
		return s.providerDialContext(ctx, network, address)
	}
	dialer := &net.Dialer{Timeout: 20 * time.Second, KeepAlive: 30 * time.Second}
	return dialProviderAddress(ctx, network, address, net.DefaultResolver, dialer.DialContext)
}

type providerContextDialer struct {
	server *Server
}

func (d providerContextDialer) Dial(network, address string) (net.Conn, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	return d.DialContext(ctx, network, address)
}

func (d providerContextDialer) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	return d.server.dialProviderContext(ctx, network, address)
}

func dialProviderAddress(
	ctx context.Context,
	network,
	address string,
	resolver providerIPResolver,
	dial providerDialFunc,
) (net.Conn, error) {
	host, port, err := net.SplitHostPort(strings.TrimSpace(address))
	if err != nil || strings.TrimSpace(host) == "" || strings.TrimSpace(port) == "" {
		return nil, fmt.Errorf("provider target must include a host and port")
	}
	if resolver == nil || dial == nil {
		return nil, errors.New("provider network resolver and dialer are required")
	}
	if isLocalhostProviderName(host) {
		return nil, fmt.Errorf("provider target resolves to a blocked local address")
	}

	addresses := make([]net.IPAddr, 0, 4)
	if literal := parseProviderIP(host); literal != nil {
		addresses = append(addresses, net.IPAddr{IP: literal})
	} else {
		resolved, resolveErr := resolver.LookupIPAddr(ctx, host)
		if resolveErr != nil {
			return nil, fmt.Errorf("resolve provider target %s: %w", host, resolveErr)
		}
		addresses = append(addresses, resolved...)
	}
	if len(addresses) == 0 {
		return nil, fmt.Errorf("provider target %s resolved without addresses", host)
	}

	unique := make([]net.IP, 0, len(addresses))
	seen := make(map[string]struct{}, len(addresses))
	for _, address := range addresses {
		ip := address.IP
		if isBlockedProviderIP(ip) {
			return nil, fmt.Errorf("provider target %s resolves to a blocked network address", host)
		}
		key := ip.String()
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		unique = append(unique, ip)
	}

	var lastErr error
	attempted := 0
	for _, ip := range unique {
		if !providerIPMatchesNetwork(network, ip) {
			continue
		}
		attempted++
		pinned := net.JoinHostPort(ip.String(), port)
		connection, dialErr := dial(ctx, network, pinned)
		if dialErr == nil {
			return connection, nil
		}
		lastErr = dialErr
	}
	if attempted == 0 {
		return nil, fmt.Errorf("provider target %s has no address for network %s", host, network)
	}
	return nil, fmt.Errorf("dial provider target %s: %w", host, lastErr)
}

func validateProviderHostLiteral(host string) error {
	if isLocalhostProviderName(host) {
		return errors.New("local hostnames are blocked")
	}
	if ip := parseProviderIP(host); ip != nil && isBlockedProviderIP(ip) {
		return errors.New("private, local, and special-use network addresses are blocked")
	}
	return nil
}

func parseProviderIP(host string) net.IP {
	host = strings.Trim(strings.TrimSpace(host), "[]")
	if value, _, found := strings.Cut(host, "%"); found {
		host = value
	}
	return net.ParseIP(host)
}

func isLocalhostProviderName(host string) bool {
	normalized := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(host)), ".")
	return normalized == "localhost" || strings.HasSuffix(normalized, ".localhost")
}

func isBlockedProviderIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	if ipv4 := ip.To4(); ipv4 != nil {
		ip = ipv4
	}
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() ||
		ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsUnspecified() || ip.IsMulticast() {
		return true
	}
	for _, network := range blockedProviderNetworks {
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

func providerIPMatchesNetwork(network string, ip net.IP) bool {
	switch strings.ToLower(strings.TrimSpace(network)) {
	case "tcp4":
		return ip.To4() != nil
	case "tcp6":
		return ip.To4() == nil
	default:
		return true
	}
}
