package jobs

import (
	"strings"
	"testing"

	"github.com/feng123-new/all-Mail/core/internal/config"
)

func TestRetentionDeleteSQLIsBoundedAndClaimSafe(t *testing.T) {
	for _, expected := range []string{
		"$1::int * interval '1 day'",
		"LIMIT $2",
		"FOR UPDATE SKIP LOCKED",
		"DELETE FROM api_logs",
		"RETURNING logs.id",
	} {
		if !strings.Contains(retentionDeleteSQL, expected) {
			t.Fatalf("retention SQL is missing %q:\n%s", expected, retentionDeleteSQL)
		}
	}
}

func TestNewRetentionCleanerUsesTypedConfiguration(t *testing.T) {
	cleaner, err := newRetentionCleaner(config.Config{
		DatabaseURL:         "postgresql://example.invalid/allmail",
		APILogRetentionDays: 30,
		APILogCleanupBatch:  5000,
	})
	if err != nil {
		t.Fatal(err)
	}
	value, ok := cleaner.(pgxRetentionCleaner)
	if !ok {
		t.Fatalf("cleaner type = %T, want pgxRetentionCleaner", cleaner)
	}
	if value.retention != 30 || value.batchSize != 5000 {
		t.Fatalf("cleaner = %#v", value)
	}
}

func TestNewRetentionCleanerRequiresDatabaseURL(t *testing.T) {
	if _, err := newRetentionCleaner(config.Config{}); err == nil {
		t.Fatal("newRetentionCleaner expected an error")
	}
}
