package businessapi

import (
	"context"
	"os"
	"testing"
	"time"
)

func TestPostgresAPIKeyAndExternalRouteIntegrationDashboardWrites(t *testing.T) {
	databaseURL := os.Getenv("ALLMAIL_GO_BUSINESS_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("ALLMAIL_GO_BUSINESS_TEST_DATABASE_URL is not configured")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	store, err := NewPostgresStore(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}

	var singleID, batchIDOne, batchIDTwo int64
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		_, _ = store.pool.Exec(cleanupCtx, `
			DELETE FROM api_logs
			WHERE id = ANY($1::bigint[])
			   OR action IN ($2, $3)
		`, []int64{singleID, batchIDOne, batchIDTwo}, actionAdminDashboardLogDelete, actionAdminDashboardLogsBatchDelete)
		store.Close()
	}()

	for index, target := range []*int64{&singleID, &batchIDOne, &batchIDTwo} {
		if err := store.pool.QueryRow(ctx, `
			INSERT INTO api_logs (action, response_code, created_at)
			VALUES ($1, 200, CURRENT_TIMESTAMP)
			RETURNING id
		`, "dashboard_write_fixture_"+string(rune('a'+index))).Scan(target); err != nil {
			t.Fatal(err)
		}
	}

	deleted, err := store.DeleteDashboardLog(ctx, singleID, DashboardDeleteAudit{
		AdminID:   99,
		RequestID: "integration-single-delete",
		RequestIP: "198.51.100.21",
		StartedAt: time.Now().Add(-time.Millisecond),
	})
	if err != nil {
		t.Fatal(err)
	}
	if !deleted {
		t.Fatal("single Dashboard log deletion did not report a deleted row")
	}

	batchDeleted, err := store.BatchDeleteDashboardLogs(ctx, []int64{batchIDOne, batchIDTwo}, DashboardDeleteAudit{
		AdminID:   99,
		RequestID: "integration-batch-delete",
		RequestIP: "198.51.100.22",
		StartedAt: time.Now().Add(-time.Millisecond),
	})
	if err != nil {
		t.Fatal(err)
	}
	if batchDeleted != 2 {
		t.Fatalf("batch deleted = %d, want 2", batchDeleted)
	}

	var remaining int64
	if err := store.pool.QueryRow(ctx, `
		SELECT COUNT(*)::bigint
		FROM api_logs
		WHERE id = ANY($1::bigint[])
	`, []int64{singleID, batchIDOne, batchIDTwo}).Scan(&remaining); err != nil {
		t.Fatal(err)
	}
	if remaining != 0 {
		t.Fatalf("deleted fixture rows remaining = %d", remaining)
	}

	var auditCount int64
	if err := store.pool.QueryRow(ctx, `
		SELECT COUNT(*)::bigint
		FROM api_logs
		WHERE action IN ($1, $2)
		  AND metadata ->> 'adminId' = '99'
		  AND metadata ->> 'requestId' IN ('integration-single-delete', 'integration-batch-delete')
		  AND request_ip IN ('198.51.100.21', '198.51.100.22')
		  AND response_code = 200
		  AND response_time_ms >= 0
	`, actionAdminDashboardLogDelete, actionAdminDashboardLogsBatchDelete).Scan(&auditCount); err != nil {
		t.Fatal(err)
	}
	if auditCount != 2 {
		t.Fatalf("Dashboard deletion audit rows = %d, want 2", auditCount)
	}
}
