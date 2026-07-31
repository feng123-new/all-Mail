package businessapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"
)

var ingressVerificationCodePattern = regexp.MustCompile(`\b[0-9]{4,8}\b`)

type ingressDomain struct {
	ID                      int64
	Status                  string
	CanReceive              bool
	IsCatchAllEnabled       bool
	CatchAllTargetMailboxID *int64
}

type ingressMailbox struct {
	ID          int64
	DomainID    int64
	Address     string
	Status      string
	ForwardMode string
	ForwardTo   *string
}

type ingressTarget struct {
	RouteKind string
	Mailbox   ingressMailbox
}

func (s *PostgresStore) FindIngressEndpoint(ctx context.Context, keyID string) (IngressEndpoint, error) {
	var endpoint IngressEndpoint
	err := s.pool.QueryRow(ctx, `
		SELECT
			endpoint.id,
			endpoint.domain_id,
			domain.name,
			endpoint.key_id,
			endpoint.name,
			endpoint.status::text,
			COALESCE(endpoint.signing_secret_encrypted, '')
		FROM ingress_endpoints AS endpoint
		LEFT JOIN domains AS domain ON domain.id = endpoint.domain_id
		WHERE endpoint.key_id = $1
	`, keyID).Scan(
		&endpoint.ID,
		&endpoint.DomainID,
		&endpoint.DomainName,
		&endpoint.KeyID,
		&endpoint.Name,
		&endpoint.Status,
		&endpoint.SigningSecretEncrypted,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return IngressEndpoint{}, errNotFound
	}
	if err != nil {
		return IngressEndpoint{}, fmt.Errorf("load ingress endpoint: %w", err)
	}
	return endpoint, nil
}

func (s *PostgresStore) ReceiveIngress(
	ctx context.Context,
	input IngressReceiveInput,
	endpoint IngressEndpoint,
) (IngressResult, error) {
	domain, err := s.loadIngressDomain(ctx, input.Routing.Domain)
	if err != nil {
		return IngressResult{}, err
	}
	if endpoint.DomainID != nil && *endpoint.DomainID != domain.ID {
		return IngressResult{}, ingressRequestError(403, "INGRESS_ENDPOINT_DOMAIN_MISMATCH")
	}
	if domain.Status != "ACTIVE" {
		return IngressResult{}, ingressRequestError(403, "DOMAIN_DISABLED")
	}
	if !domain.CanReceive {
		return IngressResult{}, ingressRequestError(403, "DOMAIN_RECEIVE_DISABLED")
	}

	target, err := s.resolveIngressTarget(ctx, domain, input.Routing.MatchedAddress)
	if err != nil {
		return IngressResult{}, err
	}
	if target.Mailbox.Status != "ACTIVE" {
		return IngressResult{}, ingressRequestError(403, "DOMAIN_MAILBOX_DISABLED")
	}

	attachmentsJSON, err := json.Marshal(input.Message.Attachments)
	if err != nil {
		return IngressResult{}, fmt.Errorf("encode ingress attachments: %w", err)
	}
	headersJSON, err := json.Marshal(input.Message.Headers)
	if err != nil {
		return IngressResult{}, fmt.Errorf("encode ingress headers: %w", err)
	}

	transaction, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return IngressResult{}, fmt.Errorf("begin ingress persistence: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()

	var messageID int64
	err = transaction.QueryRow(ctx, `
		INSERT INTO inbound_messages (
			domain_id,
			mailbox_id,
			matched_address,
			final_address,
			delivery_key,
			message_id_header,
			from_address,
			to_address,
			subject,
			text_preview,
			html_preview,
			verification_code,
			route_kind,
			received_at,
			storage_status,
			raw_object_key,
			attachments_meta,
			headers_json,
			created_at,
			updated_at
		)
		VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
			$11, $12, $13, $14, $15::"MessageStorageStatus", $16,
			$17::jsonb, $18::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
		)
		ON CONFLICT (domain_id, delivery_key) DO NOTHING
		RETURNING id
	`,
		domain.ID,
		target.Mailbox.ID,
		input.Routing.MatchedAddress,
		target.Mailbox.Address,
		input.DeliveryKey,
		input.Message.MessageID,
		input.Envelope.From,
		input.Envelope.To,
		input.Message.Subject,
		input.Message.TextPreview,
		input.Message.HTMLPreview,
		extractIngressVerificationCode(input.Message.TextPreview, input.Message.HTMLPreview),
		target.RouteKind,
		input.ReceivedTime,
		input.Message.StorageStatus,
		input.Message.RawObjectKey,
		string(attachmentsJSON),
		string(headersJSON),
	).Scan(&messageID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return IngressResult{}, fmt.Errorf("insert inbound message: %w", err)
	}

	duplicate := errors.Is(err, pgx.ErrNoRows)
	if duplicate {
		var existingMailboxID *int64
		var existingRoute *string
		if err := transaction.QueryRow(ctx, `
			SELECT id, mailbox_id, route_kind
			FROM inbound_messages
			WHERE domain_id = $1 AND delivery_key = $2
		`, domain.ID, input.DeliveryKey).Scan(&messageID, &existingMailboxID, &existingRoute); err != nil {
			return IngressResult{}, fmt.Errorf("load duplicate inbound message: %w", err)
		}
		if existingMailboxID != nil {
			target.Mailbox.ID = *existingMailboxID
		}
		if existingRoute != nil && strings.TrimSpace(*existingRoute) != "" {
			target.RouteKind = *existingRoute
		}
	} else if target.Mailbox.ForwardMode != "DISABLED" && target.Mailbox.ForwardTo != nil && strings.TrimSpace(*target.Mailbox.ForwardTo) != "" {
		if _, err := transaction.Exec(ctx, `
			INSERT INTO mailbox_forward_jobs (
				inbound_message_id,
				mailbox_id,
				mode,
				forward_to,
				status,
				next_attempt_at,
				created_at,
				updated_at
			)
			VALUES ($1, $2, $3::"ForwardMode", $4, 'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
			ON CONFLICT (inbound_message_id) DO NOTHING
		`, messageID, target.Mailbox.ID, target.Mailbox.ForwardMode, strings.TrimSpace(*target.Mailbox.ForwardTo)); err != nil {
			return IngressResult{}, fmt.Errorf("create mailbox forward job: %w", err)
		}
	}

	if _, err := transaction.Exec(ctx, `
		UPDATE ingress_endpoints
		SET last_used_at = CURRENT_TIMESTAMP,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, endpoint.ID); err != nil {
		return IngressResult{}, fmt.Errorf("update ingress endpoint usage: %w", err)
	}

	if err := transaction.Commit(ctx); err != nil {
		return IngressResult{}, fmt.Errorf("commit ingress persistence: %w", err)
	}
	return IngressResult{
		Accepted:  true,
		Duplicate: duplicate,
		Route:     target.RouteKind,
		DomainID:  domain.ID,
		MailboxID: target.Mailbox.ID,
		MessageID: fmt.Sprintf("%d", messageID),
	}, nil
}

func (s *PostgresStore) loadIngressDomain(ctx context.Context, domainName string) (ingressDomain, error) {
	var domain ingressDomain
	err := s.pool.QueryRow(ctx, `
		SELECT
			id,
			status::text,
			can_receive,
			is_catch_all_enabled,
			catch_all_target_mailbox_id
		FROM domains
		WHERE name = $1
	`, domainName).Scan(
		&domain.ID,
		&domain.Status,
		&domain.CanReceive,
		&domain.IsCatchAllEnabled,
		&domain.CatchAllTargetMailboxID,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return ingressDomain{}, ingressRequestError(404, "DOMAIN_NOT_FOUND")
	}
	if err != nil {
		return ingressDomain{}, fmt.Errorf("load ingress domain: %w", err)
	}
	return domain, nil
}

func (s *PostgresStore) resolveIngressTarget(
	ctx context.Context,
	domain ingressDomain,
	matchedAddress string,
) (ingressTarget, error) {
	mailbox, err := s.loadIngressMailboxByAddress(ctx, matchedAddress)
	if err == nil && mailbox.DomainID == domain.ID {
		return ingressTarget{RouteKind: "EXACT_MAILBOX", Mailbox: mailbox}, nil
	}
	if err != nil && !errors.Is(err, errNotFound) {
		return ingressTarget{}, err
	}

	mailbox, err = s.loadIngressAliasMailbox(ctx, matchedAddress)
	if err == nil && mailbox.DomainID == domain.ID {
		return ingressTarget{RouteKind: "ALIAS", Mailbox: mailbox}, nil
	}
	if err != nil && !errors.Is(err, errNotFound) {
		return ingressTarget{}, err
	}

	if domain.IsCatchAllEnabled && domain.CatchAllTargetMailboxID != nil {
		mailbox, err = s.loadIngressMailboxByID(ctx, *domain.CatchAllTargetMailboxID)
		if err == nil && mailbox.DomainID == domain.ID {
			return ingressTarget{RouteKind: "CATCH_ALL", Mailbox: mailbox}, nil
		}
		if err != nil && !errors.Is(err, errNotFound) {
			return ingressTarget{}, err
		}
	}
	return ingressTarget{}, ingressRequestError(404, "DOMAIN_MAILBOX_NOT_FOUND")
}

func (s *PostgresStore) loadIngressMailboxByAddress(ctx context.Context, address string) (ingressMailbox, error) {
	return scanIngressMailbox(s.pool.QueryRow(ctx, `
		SELECT id, domain_id, address, status::text, forward_mode::text, forward_to
		FROM domain_mailboxes
		WHERE address = $1
	`, address))
}

func (s *PostgresStore) loadIngressMailboxByID(ctx context.Context, id int64) (ingressMailbox, error) {
	return scanIngressMailbox(s.pool.QueryRow(ctx, `
		SELECT id, domain_id, address, status::text, forward_mode::text, forward_to
		FROM domain_mailboxes
		WHERE id = $1
	`, id))
}

func (s *PostgresStore) loadIngressAliasMailbox(ctx context.Context, address string) (ingressMailbox, error) {
	return scanIngressMailbox(s.pool.QueryRow(ctx, `
		SELECT mailbox.id, mailbox.domain_id, mailbox.address, mailbox.status::text,
		       mailbox.forward_mode::text, mailbox.forward_to
		FROM mailbox_aliases AS alias
		JOIN domain_mailboxes AS mailbox ON mailbox.id = alias.mailbox_id
		WHERE alias.alias_address = $1
	`, address))
}

type ingressMailboxRow interface {
	Scan(...any) error
}

func scanIngressMailbox(row ingressMailboxRow) (ingressMailbox, error) {
	var mailbox ingressMailbox
	if err := row.Scan(
		&mailbox.ID,
		&mailbox.DomainID,
		&mailbox.Address,
		&mailbox.Status,
		&mailbox.ForwardMode,
		&mailbox.ForwardTo,
	); errors.Is(err, pgx.ErrNoRows) {
		return ingressMailbox{}, errNotFound
	} else if err != nil {
		return ingressMailbox{}, fmt.Errorf("load ingress mailbox: %w", err)
	}
	return mailbox, nil
}

func extractIngressVerificationCode(text, html *string) *string {
	source := ""
	if text != nil {
		source += *text
	}
	source += "\n"
	if html != nil {
		source += *html
	}
	match := ingressVerificationCodePattern.FindString(source)
	if match == "" {
		return nil
	}
	return &match
}

func ingressRequestError(status int, code string) error {
	return &requestError{Status: status, Code: code}
}
