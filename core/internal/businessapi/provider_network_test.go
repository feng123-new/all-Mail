package businessapi

import (
	"context"
	"errors"
	"net"
	"strings"
	"testing"
)

type staticProviderResolver struct {
	addresses []net.IPAddr
	err       error
}

func (r staticProviderResolver) LookupIPAddr(context.Context, string) ([]net.IPAddr, error) {
	return r.addresses, r.err
}

func TestProviderNetworkPolicyRejectsLocalAndPrivateTargets(t *testing.T) {
	for _, host := range []string{
		"localhost",
		"mail.localhost.",
		"127.0.0.1",
		"10.0.0.1",
		"172.16.0.1",
		"192.168.1.1",
		"100.64.0.1",
		"169.254.169.254",
		"[::1]",
		"fd00::1",
		"fe80::1%eth0",
	} {
		if err := validateProviderHostLiteral(host); err == nil {
			t.Fatalf("provider host %q was accepted", host)
		}
	}
	if err := validateProviderHostLiteral("93.184.216.34"); err != nil {
		t.Fatalf("public provider host rejected: %v", err)
	}
}

func TestProviderNetworkPolicyRejectsMixedDNSBeforeDial(t *testing.T) {
	called := false
	_, err := dialProviderAddress(
		context.Background(),
		"tcp",
		"mail.example.test:993",
		staticProviderResolver{addresses: []net.IPAddr{
			{IP: net.ParseIP("93.184.216.34")},
			{IP: net.ParseIP("127.0.0.1")},
		}},
		func(context.Context, string, string) (net.Conn, error) {
			called = true
			return nil, errors.New("unexpected dial")
		},
	)
	if err == nil || called || !strings.Contains(err.Error(), "blocked network address") {
		t.Fatalf("mixed DNS result = called %v, error %v", called, err)
	}
}

func TestProviderNetworkPolicyPinsTheResolvedPublicAddress(t *testing.T) {
	sentinel := errors.New("dial attempted")
	var target string
	_, err := dialProviderAddress(
		context.Background(),
		"tcp",
		"mail.example.test:993",
		staticProviderResolver{addresses: []net.IPAddr{{IP: net.ParseIP("93.184.216.34")}}},
		func(_ context.Context, _ string, address string) (net.Conn, error) {
			target = address
			return nil, sentinel
		},
	)
	if !errors.Is(err, sentinel) || target != "93.184.216.34:993" {
		t.Fatalf("pinned dial target = %q, %v", target, err)
	}
}
