package businessapi

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store interface {
	Ping(context.Context) error
	FindAdmin(context.Context, int64) (Admin, error)
	DashboardStats(context.Context) (DashboardStats, error)
	DashboardTrend(context.Context, int) ([]TrendPoint, error)
	DashboardLogs(context.Context, DashboardLogInput) (DashboardLogs, error)
	Close()
}

type PostgresStore struct {
	pool *pgxpool.Pool
}

func NewPostgresStore(ctx context.Context, databaseURL string) (*PostgresStore, error) {
	poolConfig, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse Go business DATABASE_URL: %w", err)
	}
	poolConfig.ConnConfig.RuntimeParams["timezone"] = "UTC"
	poolConfig.MaxConns = 8
	poolConfig.MinConns = 1
	poolConfig.MaxConnLifetime = 30 * time.Minute
	poolConfig.MaxConnIdleTime = 5 * time.Minute
	poolConfig.HealthCheckPeriod = 30 * time.Second

	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return nil, fmt.Errorf("create Go business PostgreSQL pool: %w", err)
	}
	store := &PostgresStore{pool: pool}
	if err := store.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return store, nil
}

func (s *PostgresStore) Close() {
	if s != nil && s.pool != nil {
		s.pool.Close()
	}
}

func (s *PostgresStore) Ping(ctx context.Context) error {
	if err := s.pool.Ping(ctx); err != nil {
		return fmt.Errorf("ping Go business PostgreSQL: %w", err)
	}
	return nil
}

func (s *PostgresStore) FindAdmin(ctx context.Context, id int64) (Admin, error) {
	var admin Admin
	err := s.pool.QueryRow(ctx, `
		SELECT id, username, role::text, status::text, must_change_password
		FROM admins
		WHERE id = $1
	`, id).Scan(
		&admin.ID,
		&admin.Username,
		&admin.Role,
		&admin.Status,
		&admin.MustChangePassword,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Admin{}, errNotFound
	}
	if err != nil {
		return Admin{}, fmt.Errorf("load administrator: %w", err)
	}
	return admin, nil
}

func (s *PostgresStore) DashboardStats(ctx context.Context) (DashboardStats, error) {
	var result DashboardStats
	err := s.pool.QueryRow(ctx, `
		SELECT
			(SELECT COUNT(*)::bigint FROM email_accounts),
			(SELECT COUNT(*)::bigint FROM email_accounts WHERE status = 'ACTIVE'),
			(SELECT COUNT(*)::bigint FROM email_accounts WHERE status = 'ERROR'),
			(SELECT COUNT(*)::bigint FROM api_keys),
			(SELECT COUNT(*)::bigint FROM api_keys WHERE status = 'ACTIVE'),
			(SELECT COALESCE(SUM(usage_count), 0)::bigint FROM api_keys),
			(SELECT COUNT(*)::bigint FROM api_keys WHERE last_used_at >= date_trunc('day', CURRENT_TIMESTAMP)),
			(SELECT COUNT(*)::bigint FROM domains),
			(SELECT COUNT(*)::bigint FROM domains WHERE status = 'ACTIVE'),
			(SELECT COUNT(*)::bigint FROM domain_mailboxes),
			(
				SELECT COUNT(*)::bigint
				FROM domain_mailboxes AS mailbox
				JOIN domains AS domain ON domain.id = mailbox.domain_id
				WHERE mailbox.status = 'ACTIVE'
				  AND domain.status = 'ACTIVE'
				  AND domain.can_receive = TRUE
			),
			(
				SELECT COUNT(*)::bigint
				FROM inbound_messages
				WHERE is_deleted = FALSE
				  AND mailbox_id IS NOT NULL
			),
			(SELECT COUNT(*)::bigint FROM outbound_messages)
	`).Scan(
		&result.Emails.Total,
		&result.Emails.Active,
		&result.Emails.Error,
		&result.APIKeys.Total,
		&result.APIKeys.Active,
		&result.APIKeys.TotalUsage,
		&result.APIKeys.TodayActive,
		&result.DomainMail.Domains,
		&result.DomainMail.ActiveDomains,
		&result.DomainMail.Mailboxes,
		&result.DomainMail.ActiveMailboxes,
		&result.DomainMail.InboundMessages,
		&result.DomainMail.OutboundMessages,
	)
	if err != nil {
		return DashboardStats{}, fmt.Errorf("query Dashboard statistics: %w", err)
	}
	return result, nil
}

func (s *PostgresStore) DashboardTrend(ctx context.Context, days int) ([]TrendPoint, error) {
	rows, err := s.pool.Query(ctx, `
		WITH day_series AS (
			SELECT generate_series(
				CURRENT_DATE - ($1::int - 1),
				CURRENT_DATE,
				interval '1 day'
			)::date AS day
		),
		day_counts AS (
			SELECT created_at::date AS day, COUNT(*)::bigint AS count
			FROM api_logs
			WHERE created_at >= CURRENT_DATE - ($1::int - 1)
			  AND created_at < CURRENT_DATE + 1
			GROUP BY 1
		)
		SELECT
			to_char(day_series.day, 'YYYY-MM-DD') AS date,
			COALESCE(day_counts.count, 0)::bigint AS count
		FROM day_series
		LEFT JOIN day_counts ON day_counts.day = day_series.day
		ORDER BY day_series.day ASC
	`, days)
	if err != nil {
		return nil, fmt.Errorf("query Dashboard API trend: %w", err)
	}
	defer rows.Close()

	result := make([]TrendPoint, 0, days)
	for rows.Next() {
		var point TrendPoint
		if err := rows.Scan(&point.Date, &point.Count); err != nil {
			return nil, fmt.Errorf("scan Dashboard API trend: %w", err)
		}
		result = append(result, point)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate Dashboard API trend: %w", err)
	}
	return result, nil
}

func (s *PostgresStore) DashboardLogs(ctx context.Context, input DashboardLogInput) (DashboardLogs, error) {
	var total int64
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*)::bigint
		FROM api_logs
		WHERE ($1 = '' OR action = $1)
	`, input.Action).Scan(&total); err != nil {
		return DashboardLogs{}, fmt.Errorf("count Dashboard logs: %w", err)
	}

	offset := (input.Page - 1) * input.PageSize
	rows, err := s.pool.Query(ctx, `
		SELECT
			log.id,
			log.action,
			COALESCE(api_key.name, '-'),
			COALESCE(email.email, '-'),
			log.request_ip,
			log.response_code,
			log.response_time_ms,
			log.metadata ->> 'requestId',
			log.created_at
		FROM api_logs AS log
		LEFT JOIN api_keys AS api_key ON api_key.id = log.api_key_id
		LEFT JOIN email_accounts AS email ON email.id = log.email_account_id
		WHERE ($1 = '' OR log.action = $1)
		ORDER BY log.created_at DESC, log.id DESC
		LIMIT $2 OFFSET $3
	`, input.Action, input.PageSize, offset)
	if err != nil {
		return DashboardLogs{}, fmt.Errorf("query Dashboard logs: %w", err)
	}
	defer rows.Close()

	list := make([]DashboardLog, 0, input.PageSize)
	for rows.Next() {
		var item DashboardLog
		var createdAt time.Time
		if err := rows.Scan(
			&item.ID,
			&item.Action,
			&item.APIKeyName,
			&item.Email,
			&item.RequestIP,
			&item.ResponseCode,
			&item.ResponseTimeMS,
			&item.RequestID,
			&createdAt,
		); err != nil {
			return DashboardLogs{}, fmt.Errorf("scan Dashboard log: %w", err)
		}
		item.CreatedAt = formatAPITime(createdAt)
		list = append(list, item)
	}
	if err := rows.Err(); err != nil {
		return DashboardLogs{}, fmt.Errorf("iterate Dashboard logs: %w", err)
	}

	return DashboardLogs{
		List:     list,
		Total:    total,
		Page:     input.Page,
		PageSize: input.PageSize,
	}, nil
}
