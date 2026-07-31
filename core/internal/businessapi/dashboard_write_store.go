package businessapi

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	actionAdminDashboardLogDelete       = "admin_dashboard_log_delete"
	actionAdminDashboardLogsBatchDelete = "admin_dashboard_logs_batch_delete"
)

type DashboardDeleteAudit struct {
	AdminID   int64
	RequestID string
	RequestIP string
	StartedAt time.Time
}

type DashboardWriteStore interface {
	DeleteDashboardLog(context.Context, int64, DashboardDeleteAudit) (bool, error)
	BatchDeleteDashboardLogs(context.Context, []int64, DashboardDeleteAudit) (int64, error)
}

func (s *PostgresStore) DeleteDashboardLog(
	ctx context.Context,
	id int64,
	audit DashboardDeleteAudit,
) (bool, error) {
	transaction, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return false, fmt.Errorf("begin Dashboard log deletion: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()

	command, err := transaction.Exec(ctx, `DELETE FROM api_logs WHERE id = $1`, id)
	if err != nil {
		return false, fmt.Errorf("delete Dashboard log: %w", err)
	}
	deleted := command.RowsAffected() == 1
	if err := writeDashboardDeleteAudit(ctx, transaction, actionAdminDashboardLogDelete, audit, map[string]any{
		"targetId": id,
		"deleted":  deleted,
	}); err != nil {
		return false, err
	}
	if err := transaction.Commit(ctx); err != nil {
		return false, fmt.Errorf("commit Dashboard log deletion: %w", err)
	}
	return deleted, nil
}

func (s *PostgresStore) BatchDeleteDashboardLogs(
	ctx context.Context,
	ids []int64,
	audit DashboardDeleteAudit,
) (int64, error) {
	transaction, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return 0, fmt.Errorf("begin Dashboard batch log deletion: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()

	command, err := transaction.Exec(ctx, `DELETE FROM api_logs WHERE id = ANY($1::bigint[])`, ids)
	if err != nil {
		return 0, fmt.Errorf("batch delete Dashboard logs: %w", err)
	}
	deleted := command.RowsAffected()
	if err := writeDashboardDeleteAudit(ctx, transaction, actionAdminDashboardLogsBatchDelete, audit, map[string]any{
		"requestedCount": len(ids),
		"deletedCount":   deleted,
	}); err != nil {
		return 0, err
	}
	if err := transaction.Commit(ctx); err != nil {
		return 0, fmt.Errorf("commit Dashboard batch log deletion: %w", err)
	}
	return deleted, nil
}

func writeDashboardDeleteAudit(
	ctx context.Context,
	transaction pgx.Tx,
	action string,
	audit DashboardDeleteAudit,
	details map[string]any,
) error {
	metadata := map[string]any{
		"requestId": audit.RequestID,
		"adminId":   audit.AdminID,
		"operation": details,
	}
	encoded, err := json.Marshal(metadata)
	if err != nil {
		return fmt.Errorf("encode Dashboard deletion audit: %w", err)
	}
	responseTime := time.Since(audit.StartedAt).Milliseconds()
	if audit.StartedAt.IsZero() || responseTime < 0 {
		responseTime = 0
	}
	_, err = transaction.Exec(ctx, `
		INSERT INTO api_logs (
			action, request_ip, response_code, response_time_ms, metadata, created_at
		)
		VALUES ($1, NULLIF($2, ''), 200, $3, $4::jsonb, CURRENT_TIMESTAMP)
	`, action, audit.RequestIP, responseTime, string(encoded))
	if err != nil {
		return fmt.Errorf("write Dashboard deletion audit: %w", err)
	}
	return nil
}
