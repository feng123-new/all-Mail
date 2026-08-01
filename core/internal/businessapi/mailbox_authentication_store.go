package businessapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

type MailboxIdentity struct {
	ID                 int64
	Username           string
	Email              *string
	PasswordHash       string
	Status             string
	MustChangePassword bool
	SessionVersion     int64
	TwoFactorEnabled   bool
	TwoFactorSecret    *string
	LastLoginAt        *time.Time
	LastLoginIP        *string
	MailboxIDs         []int64
}

type MailboxAuthenticationStore interface {
	FindMailboxAuthenticationByIdentifier(context.Context, string) (MailboxIdentity, error)
	FindMailboxIdentity(context.Context, int64) (MailboxIdentity, error)
	RecordMailboxLogin(context.Context, int64, int64, time.Time, string) (MailboxIdentity, error)
	ChangeMailboxPassword(context.Context, int64, int64, string, string) (MailboxIdentity, error)
	SetMailboxTwoFactorSecret(context.Context, int64, int64, string) (MailboxIdentity, error)
	EnableMailboxTwoFactor(context.Context, int64, int64, string) (MailboxIdentity, error)
	DisableMailboxTwoFactor(context.Context, int64, int64, string) (MailboxIdentity, error)
}

var _ MailboxAuthenticationStore = (*PostgresStore)(nil)

type mailboxIdentityRowScanner interface {
	Scan(...any) error
}

const mailboxIdentityColumns = `
	id, username, password_hash, email, status::text, must_change_password,
	session_version, two_factor_enabled, two_factor_secret, last_login_at, last_login_ip
`

func (s *PostgresStore) FindMailboxAuthenticationByIdentifier(ctx context.Context, identifier string) (MailboxIdentity, error) {
	identity, err := scanMailboxIdentity(s.pool.QueryRow(ctx, `
		SELECT `+mailboxIdentityColumns+`
		FROM mailbox_users
		WHERE username = $1 OR email = $1
		ORDER BY CASE WHEN username = $1 THEN 0 ELSE 1 END, id
		LIMIT 1
	`, identifier))
	return s.completeMailboxIdentity(ctx, identity, err, "load mailbox authentication")
}

func (s *PostgresStore) FindMailboxIdentity(ctx context.Context, id int64) (MailboxIdentity, error) {
	identity, err := scanMailboxIdentity(s.pool.QueryRow(ctx, `
		SELECT `+mailboxIdentityColumns+`
		FROM mailbox_users
		WHERE id = $1
	`, id))
	return s.completeMailboxIdentity(ctx, identity, err, "load mailbox identity")
}

func (s *PostgresStore) RecordMailboxLogin(
	ctx context.Context,
	id int64,
	sessionVersion int64,
	at time.Time,
	ip string,
) (MailboxIdentity, error) {
	identity, err := scanMailboxIdentity(s.pool.QueryRow(ctx, `
		UPDATE mailbox_users
		SET last_login_at = $3,
		    last_login_ip = NULLIF($4, ''),
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
		  AND session_version = $2
		  AND status = 'ACTIVE'
		RETURNING `+mailboxIdentityColumns,
		id, sessionVersion, at, ip,
	))
	return s.completeMailboxIdentity(ctx, identity, err, "record mailbox login")
}

func (s *PostgresStore) ChangeMailboxPassword(
	ctx context.Context,
	id int64,
	sessionVersion int64,
	expectedHash string,
	newHash string,
) (MailboxIdentity, error) {
	identity, err := scanMailboxIdentity(s.pool.QueryRow(ctx, `
		UPDATE mailbox_users
		SET password_hash = $4,
		    must_change_password = FALSE,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
		  AND session_version = $2
		  AND password_hash = $3
		  AND status = 'ACTIVE'
		RETURNING `+mailboxIdentityColumns,
		id, sessionVersion, expectedHash, newHash,
	))
	return s.completeMailboxIdentity(ctx, identity, err, "change mailbox password")
}

func (s *PostgresStore) SetMailboxTwoFactorSecret(
	ctx context.Context,
	id int64,
	sessionVersion int64,
	encryptedSecret string,
) (MailboxIdentity, error) {
	identity, err := scanMailboxIdentity(s.pool.QueryRow(ctx, `
		UPDATE mailbox_users
		SET two_factor_secret = $3,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
		  AND session_version = $2
		  AND status = 'ACTIVE'
		  AND two_factor_enabled = FALSE
		RETURNING `+mailboxIdentityColumns,
		id, sessionVersion, encryptedSecret,
	))
	return s.completeMailboxIdentity(ctx, identity, err, "store pending mailbox two-factor secret")
}

func (s *PostgresStore) EnableMailboxTwoFactor(
	ctx context.Context,
	id int64,
	sessionVersion int64,
	expectedSecret string,
) (MailboxIdentity, error) {
	identity, err := scanMailboxIdentity(s.pool.QueryRow(ctx, `
		UPDATE mailbox_users
		SET two_factor_enabled = TRUE,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
		  AND session_version = $2
		  AND status = 'ACTIVE'
		  AND two_factor_enabled = FALSE
		  AND two_factor_secret = $3
		RETURNING `+mailboxIdentityColumns,
		id, sessionVersion, expectedSecret,
	))
	return s.completeMailboxIdentity(ctx, identity, err, "enable mailbox two-factor authentication")
}

func (s *PostgresStore) DisableMailboxTwoFactor(
	ctx context.Context,
	id int64,
	sessionVersion int64,
	expectedSecret string,
) (MailboxIdentity, error) {
	identity, err := scanMailboxIdentity(s.pool.QueryRow(ctx, `
		UPDATE mailbox_users
		SET two_factor_enabled = FALSE,
		    two_factor_secret = NULL,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
		  AND session_version = $2
		  AND status = 'ACTIVE'
		  AND two_factor_enabled = TRUE
		  AND two_factor_secret = $3
		RETURNING `+mailboxIdentityColumns,
		id, sessionVersion, expectedSecret,
	))
	return s.completeMailboxIdentity(ctx, identity, err, "disable mailbox two-factor authentication")
}

func scanMailboxIdentity(scanner mailboxIdentityRowScanner) (MailboxIdentity, error) {
	var identity MailboxIdentity
	var email, twoFactorSecret, lastLoginIP sql.NullString
	var lastLoginAt sql.NullTime
	err := scanner.Scan(
		&identity.ID,
		&identity.Username,
		&identity.PasswordHash,
		&email,
		&identity.Status,
		&identity.MustChangePassword,
		&identity.SessionVersion,
		&identity.TwoFactorEnabled,
		&twoFactorSecret,
		&lastLoginAt,
		&lastLoginIP,
	)
	if err != nil {
		return MailboxIdentity{}, err
	}
	if email.Valid {
		identity.Email = &email.String
	}
	if twoFactorSecret.Valid {
		identity.TwoFactorSecret = &twoFactorSecret.String
	}
	if lastLoginAt.Valid {
		value := lastLoginAt.Time.UTC()
		identity.LastLoginAt = &value
	}
	if lastLoginIP.Valid {
		identity.LastLoginIP = &lastLoginIP.String
	}
	return identity, nil
}

func (s *PostgresStore) completeMailboxIdentity(
	ctx context.Context,
	identity MailboxIdentity,
	err error,
	operation string,
) (MailboxIdentity, error) {
	if errors.Is(err, pgx.ErrNoRows) {
		return MailboxIdentity{}, errNotFound
	}
	if err != nil {
		return MailboxIdentity{}, fmt.Errorf("%s: %w", operation, err)
	}
	mailboxIDs, err := s.loadMailboxIdentityIDs(ctx, identity.ID)
	if err != nil {
		return MailboxIdentity{}, fmt.Errorf("%s memberships: %w", operation, err)
	}
	identity.MailboxIDs = mailboxIDs
	return identity, nil
}

func (s *PostgresStore) loadMailboxIdentityIDs(ctx context.Context, userID int64) ([]int64, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT mailbox_id
		FROM (
			SELECT mailbox.id::bigint AS mailbox_id
			FROM domain_mailboxes AS mailbox
			WHERE mailbox.owner_user_id = $1
			  AND mailbox.status = 'ACTIVE'
			UNION
			SELECT membership.mailbox_id::bigint AS mailbox_id
			FROM mailbox_memberships AS membership
			JOIN domain_mailboxes AS mailbox ON mailbox.id = membership.mailbox_id
			WHERE membership.user_id = $1
			  AND mailbox.status = 'ACTIVE'
		) AS access
		ORDER BY mailbox_id
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	mailboxIDs := make([]int64, 0)
	for rows.Next() {
		var mailboxID int64
		if err := rows.Scan(&mailboxID); err != nil {
			return nil, err
		}
		mailboxIDs = append(mailboxIDs, mailboxID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return mailboxIDs, nil
}
