package httpapi

import (
	"testing"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/config"
)

func TestGatewayWriteTimeoutCoversProviderDeadline(t *testing.T) {
	cfg := config.APIConfig{ProviderTimeout: 5 * time.Minute}
	if got := gatewayWriteTimeout(cfg); got != 5*time.Minute+30*time.Second {
		t.Fatalf("gateway write timeout = %s", got)
	}
}
