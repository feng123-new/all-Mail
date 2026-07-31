package businessapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type adminManagementRecord struct {
	ID                 int64   `json:"id"`
	Username           string  `json:"username"`
	Email              *string `json:"email"`
	Role               string  `json:"role"`
	Status             string  `json:"status"`
	TwoFactorEnabled   bool    `json:"twoFactorEnabled"`
	MustChangePassword *bool   `json:"mustChangePassword,omitempty"`
	LastLoginAt        *string `json:"lastLoginAt,omitempty"`
	LastLoginIP        *string `json:"lastLoginIp,omitempty"`
	CreatedAt          string  `json:"createdAt"`
	UpdatedAt          string  `json:"updatedAt,omitempty"`
}

type createAdminManagementRequest struct {
	Username string          `json:"username"`
	Password string          `json:"password"`
	Email    json.RawMessage `json:"email"`
	Role     string          `json:"role"`
}

type updateAdminManagementRequest struct {
	Username         *string         `json:"username"`
	Password         *string         `json:"password"`
	Email            json.RawMessage `json:"email"`
	Role             *string         `json:"role"`
	Status           *string         `json:"status"`
	TwoFactorEnabled *bool           `json:"twoFactorEnabled"`
}

func (s *Server) registerAdminManagementRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /admin/admins", s.withSuperAdministrator(s.listManagedAdmins))
	mux.HandleFunc("POST /admin/admins", s.withSuperAdministrator(s.createManagedAdmin))
	mux.HandleFunc("GET /admin/admins/{id}", s.withSuperAdministrator(s.getManagedAdmin))
	mux.HandleFunc("PUT /admin/admins/{id}", s.withSuperAdministrator(s.updateManagedAdmin))
	mux.HandleFunc("DELETE /admin/admins/{id}", s.withSuperAdministrator(s.deleteManagedAdmin))
}

func (s *Server) listManagedAdmins(w http.ResponseWriter, r *http.Request, _ Admin) {
	store, err := s.managementStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	page, err := parseBoundedQueryInt(r, "page", 1, 1, 1_000_000)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	pageSize, err := parseBoundedQueryInt(r, "pageSize", 10, 1, 100)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	keyword := strings.TrimSpace(r.URL.Query().Get("keyword"))
	if len(keyword) > 255 {
		s.writeRequestError(w, r, validationError("keyword must contain at most 255 characters"))
		return
	}
	result, err := store.listManagedAdmins(r.Context(), page, pageSize, keyword)
	if err != nil {
		s.writeStoreError(w, r, "list administrators", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) getManagedAdmin(w http.ResponseWriter, r *http.Request, _ Admin) {
	store, err := s.managementStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	id, err := parsePositivePathID(r, "id")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	result, err := store.getManagedAdmin(r.Context(), id)
	if err != nil {
		s.writeStoreError(w, r, "get administrator", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) createManagedAdmin(w http.ResponseWriter, r *http.Request, _ Admin) {
	store, err := s.managementStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	var body createAdminManagementRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	body.Username = strings.TrimSpace(body.Username)
	if err := validateTextLength("username", body.Username, 3, 50); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if body.Role == "" {
		body.Role = "ADMIN"
	}
	if err := validateManagementEnum("role", body.Role, "SUPER_ADMIN", "ADMIN"); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	email, present, err := decodeNullableString(body.Email, "email")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if present && email == nil {
		s.writeRequestError(w, r, validationError("email must be a valid email address"))
		return
	}
	if email != nil {
		if err := validateEmailAddress(*email); err != nil {
			s.writeRequestError(w, r, err)
			return
		}
	}
	passwordHash, err := hashManagementPassword(body.Password)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	result, err := store.createManagedAdmin(r.Context(), body.Username, passwordHash, email, body.Role)
	if err != nil {
		s.writeStoreError(w, r, "create administrator", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) updateManagedAdmin(w http.ResponseWriter, r *http.Request, _ Admin) {
	store, err := s.managementStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	id, err := parsePositivePathID(r, "id")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	var body updateAdminManagementRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if body.Username != nil {
		value := strings.TrimSpace(*body.Username)
		body.Username = &value
		if err := validateTextLength("username", value, 3, 50); err != nil {
			s.writeRequestError(w, r, err)
			return
		}
	}
	if body.Role != nil {
		if err := validateManagementEnum("role", *body.Role, "SUPER_ADMIN", "ADMIN"); err != nil {
			s.writeRequestError(w, r, err)
			return
		}
	}
	if body.Status != nil {
		if err := validateManagementEnum("status", *body.Status, "ACTIVE", "DISABLED"); err != nil {
			s.writeRequestError(w, r, err)
			return
		}
	}
	email, emailPresent, err := decodeNullableString(body.Email, "email")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if email != nil {
		if err := validateEmailAddress(*email); err != nil {
			s.writeRequestError(w, r, err)
			return
		}
	}
	var passwordHash *string
	if body.Password != nil {
		hash, err := hashManagementPassword(*body.Password)
		if err != nil {
			s.writeRequestError(w, r, err)
			return
		}
		passwordHash = &hash
	}
	result, err := store.updateManagedAdmin(r.Context(), id, body, email, emailPresent, passwordHash)
	if err != nil {
		s.writeStoreError(w, r, "update administrator", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) deleteManagedAdmin(w http.ResponseWriter, r *http.Request, _ Admin) {
	store, err := s.managementStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	id, err := parsePositivePathID(r, "id")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if err := store.deleteManagedAdmin(r.Context(), id); err != nil {
		s.writeStoreError(w, r, "delete administrator", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]string{"code": "ADMIN_DELETED"}})
}

func (s *PostgresStore) listManagedAdmins(ctx context.Context, page, pageSize int, keyword string) (map[string]any, error) {
	var total int64
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*)::bigint
		FROM admins
		WHERE $1 = '' OR username ILIKE '%' || $1 || '%' OR COALESCE(email, '') ILIKE '%' || $1 || '%'
	`, keyword).Scan(&total); err != nil {
		return nil, fmt.Errorf("count administrators: %w", err)
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, username, email, role::text, status::text, two_factor_enabled,
		       last_login_at, created_at
		FROM admins
		WHERE $1 = '' OR username ILIKE '%' || $1 || '%' OR COALESCE(email, '') ILIKE '%' || $1 || '%'
		ORDER BY id DESC
		LIMIT $2 OFFSET $3
	`, keyword, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, fmt.Errorf("list administrators: %w", err)
	}
	defer rows.Close()
	list := make([]adminManagementRecord, 0, pageSize)
	for rows.Next() {
		var item adminManagementRecord
		var email sql.NullString
		var lastLogin sql.NullTime
		var created time.Time
		if err := rows.Scan(&item.ID, &item.Username, &email, &item.Role, &item.Status, &item.TwoFactorEnabled, &lastLogin, &created); err != nil {
			return nil, fmt.Errorf("scan administrator: %w", err)
		}
		item.Email = nullableStringValue(email)
		item.LastLoginAt = nullableTimeValue(lastLogin)
		item.CreatedAt = formatAPITime(created)
		list = append(list, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate administrators: %w", err)
	}
	return map[string]any{"list": list, "total": total, "page": page, "pageSize": pageSize}, nil
}

func (s *PostgresStore) getManagedAdmin(ctx context.Context, id int64) (adminManagementRecord, error) {
	var item adminManagementRecord
	var email, lastIP sql.NullString
	var lastLogin sql.NullTime
	var created, updated time.Time
	err := s.pool.QueryRow(ctx, `
		SELECT id, username, email, role::text, status::text, two_factor_enabled,
		       last_login_at, last_login_ip, created_at, updated_at
		FROM admins WHERE id = $1
	`, id).Scan(&item.ID, &item.Username, &email, &item.Role, &item.Status, &item.TwoFactorEnabled, &lastLogin, &lastIP, &created, &updated)
	if err != nil {
		if errorsIsNoRows(err) {
			return adminManagementRecord{}, managementNotFound("NOT_FOUND")
		}
		return adminManagementRecord{}, fmt.Errorf("get administrator: %w", err)
	}
	item.Email = nullableStringValue(email)
	item.LastLoginAt = nullableTimeValue(lastLogin)
	item.LastLoginIP = nullableStringValue(lastIP)
	item.CreatedAt = formatAPITime(created)
	item.UpdatedAt = formatAPITime(updated)
	return item, nil
}

func (s *PostgresStore) createManagedAdmin(ctx context.Context, username, passwordHash string, email *string, role string) (adminManagementRecord, error) {
	var item adminManagementRecord
	var storedEmail sql.NullString
	var created time.Time
	err := s.pool.QueryRow(ctx, `
		INSERT INTO admins (username, password_hash, email, role, status, must_change_password, two_factor_enabled, session_version, created_at, updated_at)
		VALUES ($1, $2, $3, $4::"Role", 'ACTIVE', FALSE, FALSE, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		RETURNING id, username, email, role::text, status::text, two_factor_enabled, created_at
	`, username, passwordHash, email, role).Scan(&item.ID, &item.Username, &storedEmail, &item.Role, &item.Status, &item.TwoFactorEnabled, &created)
	if err != nil {
		if managementPGCode(err) == "23505" {
			return adminManagementRecord{}, managementConflict("DUPLICATE_USERNAME", err)
		}
		return adminManagementRecord{}, fmt.Errorf("create administrator: %w", err)
	}
	item.Email = nullableStringValue(storedEmail)
	item.CreatedAt = formatAPITime(created)
	return item, nil
}

func (s *PostgresStore) updateManagedAdmin(ctx context.Context, id int64, input updateAdminManagementRequest, email *string, emailPresent bool, passwordHash *string) (adminManagementRecord, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return adminManagementRecord{}, fmt.Errorf("begin administrator update: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var username, currentHash, role, status string
	var currentEmail sql.NullString
	var twoFactorEnabled bool
	err = tx.QueryRow(ctx, `SELECT username, password_hash, email, role::text, status::text, two_factor_enabled FROM admins WHERE id = $1 FOR UPDATE`, id).
		Scan(&username, &currentHash, &currentEmail, &role, &status, &twoFactorEnabled)
	if err != nil {
		if errorsIsNoRows(err) {
			return adminManagementRecord{}, managementNotFound("NOT_FOUND")
		}
		return adminManagementRecord{}, fmt.Errorf("load administrator for update: %w", err)
	}
	if input.Username != nil {
		username = *input.Username
	}
	if passwordHash != nil {
		currentHash = *passwordHash
	}
	var nextEmail any
	if emailPresent {
		nextEmail = email
	} else if currentEmail.Valid {
		nextEmail = currentEmail.String
	} else {
		nextEmail = nil
	}
	if input.Role != nil {
		role = *input.Role
	}
	if input.Status != nil {
		status = *input.Status
	}
	if input.TwoFactorEnabled != nil {
		if *input.TwoFactorEnabled && !twoFactorEnabled {
			return adminManagementRecord{}, managementBadRequest("INVALID_2FA_UPDATE", fmt.Errorf("cannot enable 2FA without owner setup"))
		}
		twoFactorEnabled = *input.TwoFactorEnabled
	}
	var item adminManagementRecord
	var storedEmail sql.NullString
	var updated time.Time
	err = tx.QueryRow(ctx, `
		UPDATE admins
		SET username = $2,
		    password_hash = $3,
		    email = $4,
		    role = $5::"Role",
		    status = $6::"Status",
		    two_factor_enabled = $7,
		    two_factor_secret = CASE WHEN $7 THEN two_factor_secret ELSE NULL END,
		    two_factor_temp_secret = CASE WHEN $7 THEN two_factor_temp_secret ELSE NULL END,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
		RETURNING id, username, email, role::text, status::text, two_factor_enabled, updated_at
	`, id, username, currentHash, nextEmail, role, status, twoFactorEnabled).
		Scan(&item.ID, &item.Username, &storedEmail, &item.Role, &item.Status, &item.TwoFactorEnabled, &updated)
	if err != nil {
		if managementPGCode(err) == "23505" {
			return adminManagementRecord{}, managementConflict("DUPLICATE_USERNAME", err)
		}
		return adminManagementRecord{}, fmt.Errorf("update administrator: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return adminManagementRecord{}, fmt.Errorf("commit administrator update: %w", err)
	}
	item.Email = nullableStringValue(storedEmail)
	item.UpdatedAt = formatAPITime(updated)
	return item, nil
}

func (s *PostgresStore) deleteManagedAdmin(ctx context.Context, id int64) error {
	command, err := s.pool.Exec(ctx, `DELETE FROM admins WHERE id = $1`, id)
	if err != nil {
		if managementPGCode(err) == "23503" {
			return managementConflict("ADMIN_IN_USE", err)
		}
		return fmt.Errorf("delete administrator: %w", err)
	}
	if command.RowsAffected() == 0 {
		return managementNotFound("NOT_FOUND")
	}
	return nil
}
