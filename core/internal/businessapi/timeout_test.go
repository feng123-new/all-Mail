package businessapi

import (
	"testing"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/config"
)

func TestBusinessWriteTimeoutCoversProviderAndDatabasePhases(t *testing.T) {
	cfg := config.GoBusinessAPIConfig{
		QueryTimeout:    7 * time.Second,
		ProviderTimeout: 5 * time.Minute,
	}
	if got := businessWriteTimeout(cfg); got != 5*time.Minute+4*7*time.Second+5*time.Second {
		t.Fatalf("business write timeout = %s", got)
	}
}
