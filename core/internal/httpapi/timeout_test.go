package httpapi

import (
	"testing"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/config"
)

func TestGatewayWriteTimeoutCoversProviderDeadline(t *testing.T) {
	cfg := config.APIConfig{BusinessQueryTimeout: 7 * time.Second, ProviderTimeout: 5 * time.Minute}
	if got := gatewayWriteTimeout(cfg); got != 5*time.Minute+4*7*time.Second+10*time.Second {
		t.Fatalf("gateway write timeout = %s", got)
	}
}
