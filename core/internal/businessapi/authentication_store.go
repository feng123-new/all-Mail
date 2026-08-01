package businessapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

type AdminAuthentication struct {
	Admin
	PasswordHash        string
	Email               *string
	TwoFactorTempSecret *string
	LastLoginAt         *time.Time
	LastLoginIP         *string
	CreatedAt           time.Time
}

type AuthenticationStore interface {
	FindAdminAuthenticationByUsername(context.Context, string) (AdminAuthentication, error)
	FindAdminAuthentication(context.Context, int64) (AdminAuthentication, error)
	RecordAdminLogin(context.Context, int64, int64, time.Time, string) (AdminAuthentication, error)
	ChangeAdminPassword(context.Context, int64, int64, string, string) (AdminAuthentication, error)
	SetAdminTwoFactorTempSecret(context.Context, int64, int64, string) (AdminAuthentication, error)
	EnableAdminTwoFactor(context.Context, int64, int64, string) (AdminAuthentication, error)
	DisableAdminTwoFactor(context.Context, int64, int64, string) (AdminAuthentication, error)
}

var _ AuthenticationStore = (*PostgresStore)(nil)

const adminAuthenticationColumns = `
	id, username, password_hash, email, role::text, status::text,
	must_change_password, session_version, two_factor_enabled,
	two_factor_secret, two_factor_temp_secret, last_login_at, last_login_ip, created_at
`

type authenticationRowScanner interface {
	Scan(...any) error
}

func (s *PostgresStore) FindAdminAuthenticationByUsername(ctx context.Context, username string) (AdminAuthentication, error) {
	admin, err := scanAdminAuthentication(s.pool.QueryRow(ctx, `
		SELECT `+adminAuthenticationColumns+`
		FROM admins
		WHERE username = $1
	`, username))
	return authenticationStoreResult(admin, err, "load administrator authentication")
}

func (s *PostgresStore) FindAdminAuthentication(ctx context.Context, id int64) (AdminAuthentication, error) {
	admin, err := scanAdminAuthentication(s.pool.QueryRow(ctx, `
		SELECT `+adminAuthenticationColumns+`
		FROM admins
		WHERE id = $1
	`, id))
	return authenticationStoreResult(admin, err, "load administrator authentication")
}

func (s *PostgresStore) RecordAdminLogin(
	ctx context.Context,
	id int64,
	sessionVersion int64,
	at time.Time,
	ip string,
) (AdminAuthentication, error) {
	admin, err := scanAdminAuthentication(s.pool.QueryRow(ctx, `
		UPDATE admins
		SET last_login_at = $3,
		    last_login_ip = NULLIF($4, ''),
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
		  AND session_version = $2
		RETURNING `+adminAuthenticationColumns,
		id, sessionVersion, at, ip,
	))
	return authenticationStoreResult(admin, err, "record administrator login")
}

func (s *PostgresStore) ChangeAdminPassword(
	ctx context.Context,
	id int64,
	sessionVersion int64,
	expectedHash string,
	newHash string,
) (AdminAuthentication, error) {
	admin, err := scanAdminAuthentication(s.pool.QueryRow(ctx, `
		UPDATE admins
		SET password_hash = $4,
		    must_change_password = FALSE,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
		  AND session_version = $2
		  AND password_hash = $3
		RETURNING `+adminAuthenticationColumns,
		id, sessionVersion, expectedHash, newHash,
	))
	return authenticationStoreResult(admin, err, "change administrator password")
}

func (s *PostgresStore) SetAdminTwoFactorTempSecret(
	ctx context.Context,
	id int64,
	sessionVersion int64,
	encryptedSecret string,
) (AdminAuthentication, error) {
	admin, err := scanAdminAuthentication(s.pool.QueryRow(ctx, `
		UPDATE admins
		SET two_factor_temp_secret = $3,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
		  AND session_version = $2
		  AND two_factor_enabled = FALSE
		RETURNING `+adminAuthenticationColumns,
		id, sessionVersion, encryptedSecret,
	))
	return authenticationStoreResult(admin, err, "store administrator two-factor setup")
}

func (s *PostgresStore) EnableAdminTwoFactor(
	ctx context.Context,
	id int64,
	sessionVersion int64,
	expectedTempSecret string,
) (AdminAuthentication, error) {
	admin, err := scanAdminAuthentication(s.pool.QueryRow(ctx, `
		UPDATE admins
		SET two_factor_enabled = TRUE,
		    two_factor_secret = two_factor_temp_secret,
		    two_factor_temp_secret = NULL,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
		  AND session_version = $2
		  AND two_factor_enabled = FALSE
		  AND two_factor_temp_secret = $3
		RETURNING `+adminAuthenticationColumns,
		id, sessionVersion, expectedTempSecret,
	))
	return authenticationStoreResult(admin, err, "enable administrator two-factor authentication")
}

func (s *PostgresStore) DisableAdminTwoFactor(
	ctx context.Context,
	id int64,
	sessionVersion int64,
	expectedSecret string,
) (AdminAuthentication, error) {
	admin, err := scanAdminAuthentication(s.pool.QueryRow(ctx, `
		UPDATE admins
		SET two_factor_enabled = FALSE,
		    two_factor_secret = NULL,
		    two_factor_temp_secret = NULL,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
		  AND session_version = $2
		  AND two_factor_enabled = TRUE
		  AND two_factor_secret = $3
		RETURNING `+adminAuthenticationColumns,
		id, sessionVersion, expectedSecret,
	))
	return authenticationStoreResult(admin, err, "disable administrator two-factor authentication")
}

func scanAdminAuthentication(scanner authenticationRowScanner) (AdminAuthentication, error) {
	var admin AdminAuthentication
	var email, twoFactorSecret, twoFactorTempSecret, lastLoginIP sql.NullString
	var lastLoginAt sql.NullTime
	err := scanner.Scan(
		&admin.ID,
		&admin.Username,
		&admin.PasswordHash,
		&email,
		&admin.Role,
		&admin.Status,
		&admin.MustChangePassword,
		&admin.SessionVersion,
		&admin.TwoFactorEnabled,
		&twoFactorSecret,
		&twoFactorTempSecret,
		&lastLoginAt,
		&lastLoginIP,
		&admin.CreatedAt,
	)
	if err != nil {
		return AdminAuthentication{}, err
	}
	if email.Valid {
		admin.Email = &email.String
	}
	if twoFactorSecret.Valid {
		admin.TwoFactorSecret = &twoFactorSecret.String
	}
	if twoFactorTempSecret.Valid {
		admin.TwoFactorTempSecret = &twoFactorTempSecret.String
	}
	if lastLoginAt.Valid {
		lastLoginAtValue := lastLoginAt.Time.UTC()
		admin.LastLoginAt = &lastLoginAtValue
	}
	if lastLoginIP.Valid {
		admin.LastLoginIP = &lastLoginIP.String
	}
	admin.CreatedAt = admin.CreatedAt.UTC()
	return admin, nil
}

func authenticationStoreResult(admin AdminAuthentication, err error, operation string) (AdminAuthentication, error) {
	if errors.Is(err, pgx.ErrNoRows) {
		return AdminAuthentication{}, errNotFound
	}
	if err != nil {
		return AdminAuthentication{}, fmt.Errorf("%s: %w", operation, err)
	}
	return admin, nil
}
