package businessapi

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type DomainMailboxStore interface {
	AllocateDomainMailbox(context.Context, int64, DomainSelector) (DomainMailboxAllocation, error)
	ListDomainMailboxes(context.Context, int64, DomainSelector) (DomainMailboxList, error)
	DomainMailboxAllocationStats(context.Context, int64, DomainSelector) (AllocationStats, error)
	ResetDomainMailboxAllocations(context.Context, int64, DomainSelector) (int64, error)
	ListDomainMessages(context.Context, int64, string, int) (DomainMessageList, error)
}

type domainMailboxRow struct {
	ID         int64
	Address    string
	LocalPart  string
	BatchTag   *string
	DomainID   int64
	DomainName string
	CanSend    bool
	CanReceive bool
}

func (s *PostgresStore) AllocateDomainMailbox(ctx context.Context, apiKeyID int64, selector DomainSelector) (DomainMailboxAllocation, error) {
	transaction, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return DomainMailboxAllocation{}, fmt.Errorf("begin domain mailbox allocation: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()

	domainIDs, err := s.resolveScopedDomainIDs(ctx, transaction, apiKeyID, selector)
	if err != nil {
		return DomainMailboxAllocation{}, err
	}
	var row domainMailboxRow
	err = transaction.QueryRow(ctx, `
		SELECT
			mailbox.id,
			mailbox.address,
			mailbox.local_part,
			mailbox.batch_tag,
			mailbox.domain_id,
			domain.name,
			domain.can_send,
			domain.can_receive
		FROM domain_mailboxes AS mailbox
		JOIN domains AS domain ON domain.id = mailbox.domain_id
		WHERE mailbox.provisioning_mode::text = 'API_POOL'
		  AND mailbox.status::text = 'ACTIVE'
		  AND domain.status::text = 'ACTIVE'
		  AND domain.can_receive = TRUE
		  AND ($1 = '' OR mailbox.batch_tag = $1)
		  AND (cardinality($2::bigint[]) = 0 OR mailbox.domain_id = ANY($2::bigint[]))
		  AND NOT EXISTS (
			SELECT 1
			FROM domain_mailbox_usage AS usage
			WHERE usage.api_key_id = $3 AND usage.domain_mailbox_id = mailbox.id
		  )
		ORDER BY mailbox.domain_id ASC, mailbox.id ASC
		FOR UPDATE SKIP LOCKED
		LIMIT 1
	`, selector.BatchTag, nonNilIDs(domainIDs), apiKeyID).Scan(
		&row.ID,
		&row.Address,
		&row.LocalPart,
		&row.BatchTag,
		&row.DomainID,
		&row.DomainName,
		&row.CanSend,
		&row.CanReceive,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		stats, statsErr := s.domainMailboxStatsWithQuerier(ctx, transaction, apiKeyID, selector.BatchTag, domainIDs)
		if statsErr != nil {
			return DomainMailboxAllocation{}, statsErr
		}
		return DomainMailboxAllocation{}, &requestError{
			Status: 400,
			Code:   "NO_UNUSED_DOMAIN_MAILBOX",
			Cause:  fmt.Errorf("used %d of %d", stats.Used, stats.Total),
		}
	}
	if err != nil {
		return DomainMailboxAllocation{}, fmt.Errorf("select unused domain mailbox: %w", err)
	}
	if _, err := transaction.Exec(ctx, `
		INSERT INTO domain_mailbox_usage (api_key_id, domain_mailbox_id, used_at)
		VALUES ($1, $2, CURRENT_TIMESTAMP)
		ON CONFLICT (api_key_id, domain_mailbox_id) DO NOTHING
	`, apiKeyID, row.ID); err != nil {
		return DomainMailboxAllocation{}, fmt.Errorf("record domain mailbox allocation: %w", err)
	}
	if err := transaction.Commit(ctx); err != nil {
		return DomainMailboxAllocation{}, fmt.Errorf("commit domain mailbox allocation: %w", err)
	}
	return row.allocation(), nil
}

func (s *PostgresStore) ListDomainMailboxes(ctx context.Context, apiKeyID int64, selector DomainSelector) (DomainMailboxList, error) {
	domainIDs, err := s.resolveScopedDomainIDs(ctx, s.pool, apiKeyID, selector)
	if err != nil {
		return DomainMailboxList{}, err
	}
	rows, err := s.pool.Query(ctx, `
		SELECT
			mailbox.id,
			mailbox.address,
			mailbox.local_part,
			mailbox.batch_tag,
			mailbox.domain_id,
			domain.name,
			domain.can_send,
			domain.can_receive,
			EXISTS (
				SELECT 1
				FROM domain_mailbox_usage AS usage
				WHERE usage.api_key_id = $3 AND usage.domain_mailbox_id = mailbox.id
			)
		FROM domain_mailboxes AS mailbox
		JOIN domains AS domain ON domain.id = mailbox.domain_id
		WHERE mailbox.provisioning_mode::text = 'API_POOL'
		  AND mailbox.status::text = 'ACTIVE'
		  AND domain.status::text = 'ACTIVE'
		  AND domain.can_receive = TRUE
		  AND ($1 = '' OR mailbox.batch_tag = $1)
		  AND (cardinality($2::bigint[]) = 0 OR mailbox.domain_id = ANY($2::bigint[]))
		ORDER BY mailbox.domain_id ASC, mailbox.id ASC
	`, selector.BatchTag, nonNilIDs(domainIDs), apiKeyID)
	if err != nil {
		return DomainMailboxList{}, fmt.Errorf("query domain mailboxes: %w", err)
	}
	defer rows.Close()

	result := DomainMailboxList{Mailboxes: make([]DomainMailboxItem, 0)}
	for rows.Next() {
		var row domainMailboxRow
		var used bool
		if err := rows.Scan(
			&row.ID,
			&row.Address,
			&row.LocalPart,
			&row.BatchTag,
			&row.DomainID,
			&row.DomainName,
			&row.CanSend,
			&row.CanReceive,
			&used,
		); err != nil {
			return DomainMailboxList{}, fmt.Errorf("scan domain mailbox: %w", err)
		}
		result.Mailboxes = append(result.Mailboxes, DomainMailboxItem{
			DomainMailboxAllocation: row.allocation(),
			Used:                    used,
		})
	}
	if err := rows.Err(); err != nil {
		return DomainMailboxList{}, fmt.Errorf("iterate domain mailboxes: %w", err)
	}
	result.Total = len(result.Mailboxes)
	return result, nil
}

func (s *PostgresStore) DomainMailboxAllocationStats(ctx context.Context, apiKeyID int64, selector DomainSelector) (AllocationStats, error) {
	domainIDs, err := s.resolveScopedDomainIDs(ctx, s.pool, apiKeyID, selector)
	if err != nil {
		return AllocationStats{}, err
	}
	return s.domainMailboxStatsWithQuerier(ctx, s.pool, apiKeyID, selector.BatchTag, domainIDs)
}

func (s *PostgresStore) ResetDomainMailboxAllocations(ctx context.Context, apiKeyID int64, selector DomainSelector) (int64, error) {
	domainIDs, err := s.resolveScopedDomainIDs(ctx, s.pool, apiKeyID, selector)
	if err != nil {
		return 0, err
	}
	command, err := s.pool.Exec(ctx, `
		DELETE FROM domain_mailbox_usage AS usage
		USING domain_mailboxes AS mailbox, domains AS domain
		WHERE usage.api_key_id = $1
		  AND usage.domain_mailbox_id = mailbox.id
		  AND domain.id = mailbox.domain_id
		  AND mailbox.provisioning_mode::text = 'API_POOL'
		  AND mailbox.status::text = 'ACTIVE'
		  AND domain.status::text = 'ACTIVE'
		  AND domain.can_receive = TRUE
		  AND ($2 = '' OR mailbox.batch_tag = $2)
		  AND (cardinality($3::bigint[]) = 0 OR mailbox.domain_id = ANY($3::bigint[]))
	`, apiKeyID, selector.BatchTag, nonNilIDs(domainIDs))
	if err != nil {
		return 0, fmt.Errorf("reset domain mailbox allocations: %w", err)
	}
	return command.RowsAffected(), nil
}

func (s *PostgresStore) ListDomainMessages(ctx context.Context, apiKeyID int64, email string, limit int) (DomainMessageList, error) {
	mailbox, err := s.resolveAccessibleDomainMailbox(ctx, apiKeyID, email)
	if err != nil {
		return DomainMessageList{}, err
	}
	if limit < 1 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	rows, err := s.pool.Query(ctx, `
		SELECT
			id,
			from_address,
			to_address,
			subject,
			text_preview,
			html_preview,
			verification_code,
			route_kind,
			received_at
		FROM inbound_messages
		WHERE mailbox_id = $1 AND is_deleted = FALSE
		ORDER BY received_at DESC, id DESC
		LIMIT $2
	`, mailbox.ID, limit)
	if err != nil {
		return DomainMessageList{}, fmt.Errorf("query domain messages: %w", err)
	}
	defer rows.Close()

	messages := make([]DomainMessage, 0, limit)
	for rows.Next() {
		var message DomainMessage
		var id int64
		var subject, textPreview, htmlPreview *string
		var receivedAt time.Time
		if err := rows.Scan(
			&id,
			&message.From,
			&message.To,
			&subject,
			&textPreview,
			&htmlPreview,
			&message.VerificationCode,
			&message.RouteKind,
			&receivedAt,
		); err != nil {
			return DomainMessageList{}, fmt.Errorf("scan domain message: %w", err)
		}
		message.ID = fmt.Sprintf("%d", id)
		if subject != nil {
			message.Subject = *subject
		}
		if textPreview != nil {
			message.Text = *textPreview
		}
		if htmlPreview != nil {
			message.HTML = *htmlPreview
		}
		message.Date = formatAPITime(receivedAt)
		messages = append(messages, message)
	}
	if err := rows.Err(); err != nil {
		return DomainMessageList{}, fmt.Errorf("iterate domain messages: %w", err)
	}
	protocol := hostedInternalProtocol(mailbox.CanSend, mailbox.CanReceive)
	return DomainMessageList{
		Email:                  mailbox.Address,
		MailboxID:              mailbox.ID,
		DomainID:               mailbox.DomainID,
		DomainName:             mailbox.DomainName,
		Count:                  len(messages),
		ProviderProfile:        protocol.ProviderProfile,
		RepresentativeProtocol: protocol.RepresentativeProtocol,
		SecondaryProtocols:     protocol.SecondaryProtocols,
		ProfileSummaryHint:     protocol.ProfileSummaryHint,
		CapabilitySummary:      protocol.CapabilitySummary,
		Messages:               messages,
	}, nil
}

func (s *PostgresStore) resolveScopedDomainIDs(ctx context.Context, querier basicQuerier, apiKeyID int64, selector DomainSelector) ([]int64, error) {
	scope, err := s.loadAPIKeyScope(ctx, querier, apiKeyID)
	if err != nil {
		return nil, err
	}
	if selector.DomainID != nil {
		if len(scope.AllowedDomainIDs) > 0 && !containsInt64(scope.AllowedDomainIDs, *selector.DomainID) {
			return nil, &requestError{Status: 403, Code: "DOMAIN_FORBIDDEN"}
		}
		var id int64
		if err := querier.QueryRow(ctx, `SELECT id FROM domains WHERE id = $1`, *selector.DomainID).Scan(&id); errors.Is(err, pgx.ErrNoRows) {
			return nil, &requestError{Status: 404, Code: "DOMAIN_NOT_FOUND"}
		} else if err != nil {
			return nil, fmt.Errorf("resolve domain by id: %w", err)
		}
		return []int64{id}, nil
	}
	if selector.Domain != "" {
		var id int64
		if err := querier.QueryRow(ctx, `SELECT id FROM domains WHERE name = $1`, strings.ToLower(strings.TrimSpace(selector.Domain))).Scan(&id); errors.Is(err, pgx.ErrNoRows) {
			return nil, &requestError{Status: 404, Code: "DOMAIN_NOT_FOUND"}
		} else if err != nil {
			return nil, fmt.Errorf("resolve domain by name: %w", err)
		}
		if len(scope.AllowedDomainIDs) > 0 && !containsInt64(scope.AllowedDomainIDs, id) {
			return nil, &requestError{Status: 403, Code: "DOMAIN_FORBIDDEN"}
		}
		return []int64{id}, nil
	}
	return scope.AllowedDomainIDs, nil
}

func (s *PostgresStore) resolveAccessibleDomainMailbox(ctx context.Context, apiKeyID int64, email string) (domainMailboxRow, error) {
	scope, err := s.loadAPIKeyScope(ctx, s.pool, apiKeyID)
	if err != nil {
		return domainMailboxRow{}, err
	}
	var row domainMailboxRow
	var provisioningMode, mailboxStatus, domainStatus string
	err = s.pool.QueryRow(ctx, `
		SELECT
			mailbox.id,
			mailbox.address,
			mailbox.local_part,
			mailbox.batch_tag,
			mailbox.domain_id,
			mailbox.provisioning_mode::text,
			mailbox.status::text,
			domain.name,
			domain.status::text,
			domain.can_send,
			domain.can_receive
		FROM domain_mailboxes AS mailbox
		JOIN domains AS domain ON domain.id = mailbox.domain_id
		WHERE mailbox.address = $1
	`, strings.ToLower(strings.TrimSpace(email))).Scan(
		&row.ID,
		&row.Address,
		&row.LocalPart,
		&row.BatchTag,
		&row.DomainID,
		&provisioningMode,
		&mailboxStatus,
		&row.DomainName,
		&domainStatus,
		&row.CanSend,
		&row.CanReceive,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return domainMailboxRow{}, &requestError{Status: 404, Code: "DOMAIN_MAILBOX_NOT_FOUND"}
	}
	if err != nil {
		return domainMailboxRow{}, fmt.Errorf("load domain mailbox: %w", err)
	}
	if provisioningMode != "API_POOL" {
		return domainMailboxRow{}, &requestError{Status: 404, Code: "DOMAIN_MAILBOX_NOT_FOUND"}
	}
	if len(scope.AllowedDomainIDs) > 0 && !containsInt64(scope.AllowedDomainIDs, row.DomainID) {
		return domainMailboxRow{}, &requestError{Status: 403, Code: "DOMAIN_FORBIDDEN"}
	}
	if mailboxStatus != "ACTIVE" || domainStatus != "ACTIVE" || !row.CanReceive {
		return domainMailboxRow{}, &requestError{Status: 403, Code: "DOMAIN_MAILBOX_DISABLED"}
	}
	return row, nil
}

func (s *PostgresStore) domainMailboxStatsWithQuerier(
	ctx context.Context,
	querier basicQuerier,
	apiKeyID int64,
	batchTag string,
	domainIDs []int64,
) (AllocationStats, error) {
	var result AllocationStats
	err := querier.QueryRow(ctx, `
		WITH scoped AS (
			SELECT mailbox.id
			FROM domain_mailboxes AS mailbox
			JOIN domains AS domain ON domain.id = mailbox.domain_id
			WHERE mailbox.provisioning_mode::text = 'API_POOL'
			  AND mailbox.status::text = 'ACTIVE'
			  AND domain.status::text = 'ACTIVE'
			  AND domain.can_receive = TRUE
			  AND ($1 = '' OR mailbox.batch_tag = $1)
			  AND (cardinality($2::bigint[]) = 0 OR mailbox.domain_id = ANY($2::bigint[]))
		)
		SELECT
			COUNT(*)::bigint,
			COUNT(usage.domain_mailbox_id)::bigint
		FROM scoped
		LEFT JOIN domain_mailbox_usage AS usage
		  ON usage.api_key_id = $3 AND usage.domain_mailbox_id = scoped.id
	`, batchTag, nonNilIDs(domainIDs), apiKeyID).Scan(&result.Total, &result.Used)
	if err != nil {
		return AllocationStats{}, fmt.Errorf("query domain mailbox allocation statistics: %w", err)
	}
	result.Remaining = result.Total - result.Used
	if result.Remaining < 0 {
		result.Remaining = 0
	}
	return result, nil
}

func (row domainMailboxRow) allocation() DomainMailboxAllocation {
	protocol := hostedInternalProtocol(row.CanSend, row.CanReceive)
	return DomainMailboxAllocation{
		ID:                     row.ID,
		Email:                  row.Address,
		LocalPart:              row.LocalPart,
		BatchTag:               row.BatchTag,
		DomainID:               row.DomainID,
		DomainName:             row.DomainName,
		ProviderProfile:        protocol.ProviderProfile,
		RepresentativeProtocol: protocol.RepresentativeProtocol,
		SecondaryProtocols:     protocol.SecondaryProtocols,
		ProfileSummaryHint:     protocol.ProfileSummaryHint,
		CapabilitySummary:      protocol.CapabilitySummary,
	}
}

func hostedInternalProtocol(canSend, canReceive bool) DomainMailboxAllocation {
	return DomainMailboxAllocation{
		ProviderProfile:        "hosted-internal-api-pool",
		RepresentativeProtocol: "hosted_internal",
		SecondaryProtocols:     []string{},
		ProfileSummaryHint:     "Hosted Internal · API_POOL：适合 API 池自动分配的站内邮箱，由内部域名收件链路统一承载。",
		CapabilitySummary: CapabilitySummary{
			ReadInbox:    canReceive,
			ReadJunk:     false,
			ReadSent:     false,
			ClearMailbox: true,
			SendMail:     canSend,
			UsesOAuth:    false,
			ReceiveMail:  canReceive,
			APIAccess:    true,
			Forwarding:   true,
			Search:       false,
			RefreshToken: false,
			Webhook:      false,
			AliasSupport: false,
			Modes:        []string{},
		},
	}
}
