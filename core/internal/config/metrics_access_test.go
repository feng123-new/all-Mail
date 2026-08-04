package config

import (
	"net/netip"
	"strings"
	"testing"
)

func TestLoadAPIDefaultsMetricsToLoopbackPeers(t *testing.T) {
	t.Setenv("METRICS_ALLOWED_CIDRS", "")
	cfg, err := LoadAPI()
	if err != nil {
		t.Fatal(err)
	}
	for _, raw := range []string{"127.0.0.1", "::1"} {
		if !cfg.AllowsMetrics(netip.MustParseAddr(raw)) {
			t.Fatalf("default metrics policy denied %s", raw)
		}
	}
	if cfg.AllowsMetrics(netip.MustParseAddr("192.0.2.10")) {
		t.Fatal("default metrics policy allowed a non-loopback peer")
	}
}

func TestLoadAPIAcceptsBoundedMetricsCIDRs(t *testing.T) {
	t.Setenv("METRICS_ALLOWED_CIDRS", "10.20.0.0/16,2001:db8:1234::/48,10.20.0.0/16")
	cfg, err := LoadAPI()
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.MetricsAllowedCIDRs) != 2 {
		t.Fatalf("metrics prefixes = %v", cfg.MetricsAllowedCIDRs)
	}
	if !cfg.AllowsMetrics(netip.MustParseAddr("10.20.4.7")) || !cfg.AllowsMetrics(netip.MustParseAddr("2001:db8:1234::7")) {
		t.Fatalf("custom metrics policy did not allow configured peers: %v", cfg.MetricsAllowedCIDRs)
	}
	if cfg.AllowsMetrics(netip.MustParseAddr("10.21.4.7")) {
		t.Fatal("custom metrics policy allowed a peer outside the configured CIDRs")
	}
}

func TestLoadAPIRejectsUnsafeMetricsCIDRs(t *testing.T) {
	for _, value := range []string{"0.0.0.0/0", "::/0", "not-a-cidr"} {
		t.Run(strings.ReplaceAll(value, "/", "-"), func(t *testing.T) {
			t.Setenv("METRICS_ALLOWED_CIDRS", value)
			_, err := LoadAPI()
			if err == nil || !strings.Contains(err.Error(), "METRICS_ALLOWED_CIDRS") {
				t.Fatalf("LoadAPI error = %v", err)
			}
		})
	}
}
