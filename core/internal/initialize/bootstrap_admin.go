package initialize

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/feng123-new/all-Mail/core/internal/secretstate"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

type BootstrapResult struct {
	Created            bool
	Username           string
	MustChangePassword bool
	SecretAvailable    bool
}

type adminCredential struct {
	Username string
	Password string
}

type bootstrapAdminRow struct {
	ID                 int64
	Username           string
	PasswordHash       string
	MustChangePassword bool
}

func BootstrapAdministrator(ctx context.Context, databaseURL, bootstrapFile string, environment map[string]string) (BootstrapResult, error) {
	connection, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		return BootstrapResult{}, fmt.Errorf("connect administrator bootstrap: %w", err)
	}
	defer connection.Close(context.Background())
	transaction, err := connection.Begin(ctx)
	if err != nil {
		return BootstrapResult{}, fmt.Errorf("begin administrator bootstrap: %w", err)
	}
	defer transaction.Rollback(context.Background())
	if _, err := transaction.Exec(ctx, `SELECT pg_advisory_xact_lock(421337, 240730)`); err != nil {
		return BootstrapResult{}, fmt.Errorf("lock administrator bootstrap: %w", err)
	}
	rows, err := transaction.Query(ctx, `
		SELECT id, username, password_hash, must_change_password FROM admins ORDER BY id FOR UPDATE
	`)
	if err != nil {
		return BootstrapResult{}, fmt.Errorf("list administrators for bootstrap: %w", err)
	}
	var admins []bootstrapAdminRow
	for rows.Next() {
		var admin bootstrapAdminRow
		if err := rows.Scan(&admin.ID, &admin.Username, &admin.PasswordHash, &admin.MustChangePassword); err != nil {
			rows.Close()
			return BootstrapResult{}, fmt.Errorf("scan administrator for bootstrap: %w", err)
		}
		admins = append(admins, admin)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return BootstrapResult{}, fmt.Errorf("list administrators for bootstrap: %w", err)
	}

	if len(admins) > 0 {
		entries, err := secretstate.ReadEnvFile(bootstrapFile)
		if err != nil {
			return BootstrapResult{}, err
		}
		matching := matchBootstrapAdmin(admins, entries)
		if matching != nil {
			if strings.TrimSpace(entries["ADMIN_USERNAME"]) != matching.Username {
				if err := secretstate.WriteEnvFile(bootstrapFile, "One-time all-Mail bootstrap administrator credential", map[string]string{
					"ADMIN_USERNAME": matching.Username,
					"ADMIN_PASSWORD": strings.TrimSpace(entries["ADMIN_PASSWORD"]),
				}); err != nil {
					return BootstrapResult{}, err
				}
			}
		} else if err := os.Remove(bootstrapFile); err != nil && !errors.Is(err, os.ErrNotExist) {
			return BootstrapResult{}, fmt.Errorf("remove stale administrator bootstrap secret: %w", err)
		}
		pending := matching
		if pending == nil {
			for index := range admins {
				if admins[index].MustChangePassword {
					pending = &admins[index]
					break
				}
			}
		}
		username := admins[0].Username
		if pending != nil {
			username = pending.Username
		}
		if err := transaction.Commit(ctx); err != nil {
			return BootstrapResult{}, fmt.Errorf("commit administrator bootstrap reconciliation: %w", err)
		}
		return BootstrapResult{
			Username:           username,
			MustChangePassword: pending != nil,
			SecretAvailable:    matching != nil,
		}, nil
	}

	entries, err := secretstate.ReadEnvFile(bootstrapFile)
	if err != nil {
		return BootstrapResult{}, err
	}
	credential, err := resolveAdminCredential(entries, environment)
	if err != nil {
		return BootstrapResult{}, err
	}
	if err := secretstate.WriteEnvFile(bootstrapFile, "One-time all-Mail bootstrap administrator credential", map[string]string{
		"ADMIN_USERNAME": credential.Username,
		"ADMIN_PASSWORD": credential.Password,
	}); err != nil {
		return BootstrapResult{}, err
	}
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(credential.Password), 10)
	if err != nil {
		return BootstrapResult{}, fmt.Errorf("hash administrator bootstrap password: %w", err)
	}
	if _, err := transaction.Exec(ctx, `
		INSERT INTO admins (
			username, password_hash, role, status, must_change_password, two_factor_enabled,
			created_at, updated_at
		) VALUES ($1, $2, 'SUPER_ADMIN', 'ACTIVE', true, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
	`, credential.Username, string(passwordHash)); err != nil {
		return BootstrapResult{}, fmt.Errorf("create bootstrap administrator: %w", err)
	}
	if err := transaction.Commit(ctx); err != nil {
		return BootstrapResult{}, fmt.Errorf("commit administrator bootstrap: %w", err)
	}
	return BootstrapResult{
		Created:            true,
		Username:           credential.Username,
		MustChangePassword: true,
		SecretAvailable:    true,
	}, nil
}

func resolveAdminCredential(fileEntries, environment map[string]string) (adminCredential, error) {
	username := strings.TrimSpace(fileEntries["ADMIN_USERNAME"])
	password := strings.TrimSpace(fileEntries["ADMIN_PASSWORD"])
	if secretstate.IsMissing(password) {
		username = strings.TrimSpace(environment["ADMIN_USERNAME"])
		password = strings.TrimSpace(environment["ADMIN_PASSWORD"])
	}
	if secretstate.IsMissing(username) {
		username = "admin"
	}
	if secretstate.IsMissing(password) {
		var err error
		password, err = secretstate.GenerateAdminPassword()
		if err != nil {
			return adminCredential{}, err
		}
	}
	if len(username) < 1 || len(username) > 50 || strings.ContainsAny(username, "\r\n") {
		return adminCredential{}, errors.New("ADMIN_USERNAME must contain between 1 and 50 characters without line breaks")
	}
	if len(password) < 8 || strings.ContainsAny(password, "\r\n") {
		return adminCredential{}, errors.New("ADMIN_PASSWORD must contain at least 8 characters without line breaks")
	}
	return adminCredential{Username: username, Password: password}, nil
}

func matchBootstrapAdmin(admins []bootstrapAdminRow, entries map[string]string) *bootstrapAdminRow {
	password := strings.TrimSpace(entries["ADMIN_PASSWORD"])
	if secretstate.IsMissing(password) {
		return nil
	}
	requested := strings.TrimSpace(entries["ADMIN_USERNAME"])
	if requested != "" {
		for index := range admins {
			admin := &admins[index]
			if admin.Username == requested && admin.MustChangePassword && bcrypt.CompareHashAndPassword([]byte(admin.PasswordHash), []byte(password)) == nil {
				return admin
			}
		}
	}
	for index := range admins {
		admin := &admins[index]
		if admin.MustChangePassword && bcrypt.CompareHashAndPassword([]byte(admin.PasswordHash), []byte(password)) == nil {
			return admin
		}
	}
	return nil
}
