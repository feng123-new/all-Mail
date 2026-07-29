package jobs

import (
	"context"
	"strings"
	"testing"

	"github.com/feng123-new/all-Mail/core/internal/config"
	"github.com/jackc/pgx/v5"
)

type fakeRetentionPool struct{}

func (fakeRetentionPool) Begin(context.Context) (pgx.Tx, error) { return nil, nil }
func (fakeRetentionPool) Ping(context.Context) error            { return nil }
func (fakeRetentionPool) Close()                                {}

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
	cleaner, err := newRetentionCleanerWithPool(fakeRetentionPool{}, config.RetentionConfig{
		RetentionDays: 30,
		BatchSize:     5000,
		MaxBatches:    10,
	})
	if err != nil {
		t.Fatal(err)
	}
	value, ok := cleaner.(*pgxRetentionCleaner)
	if !ok {
		t.Fatalf("cleaner type = %T, want pgxRetentionCleaner", cleaner)
	}
	if value.retention != 30 || value.batchSize != 5000 || value.maxBatches != 10 {
		t.Fatalf("cleaner = %#v", value)
	}
}

func TestNewRetentionCleanerRequiresDatabaseURL(t *testing.T) {
	if _, err := newRetentionCleaner(context.Background(), config.RetentionConfig{}); err == nil {
		t.Fatal("newRetentionCleaner expected an error")
	}
}
