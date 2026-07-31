package businessapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type createMailboxUserManagementRequest struct {
	Username   string  `json:"username"`
	Email      *string `json:"email"`
	Password   string  `json:"password"`
	MailboxIDs []int64 `json:"mailboxIds"`
}

type updateMailboxUserManagementRequest struct {
	Email              json.RawMessage `json:"email"`
	Status             *string         `json:"status"`
	MustChangePassword *bool           `json:"mustChangePassword"`
	Password           json.RawMessage `json:"password"`
	MailboxIDs         json.RawMessage `json:"mailboxIds"`
}

type addMailboxUserMembershipsRequest struct {
	MailboxIDs []int64 `json:"mailboxIds"`
}

type mailboxUserManagementRecord struct {
	ID                 int64   `json:"id"`
	Username           string  `json:"username"`
	Email              *string `json:"email"`
	Status             string  `json:"status"`
	MustChangePassword bool    `json:"mustChangePassword"`
	LastLoginAt        *string `json:"lastLoginAt,omitempty"`
	LastLoginIP        *string `json:"lastLoginIp,omitempty"`
	CreatedAt          string  `json:"createdAt"`
	UpdatedAt          string  `json:"updatedAt,omitempty"`
	MailboxCount       *int64  `json:"mailboxCount,omitempty"`
	OwnedMailboxes     any     `json:"ownedMailboxes,omitempty"`
	Memberships        any     `json:"memberships,omitempty"`
}

func (s *Server) registerMailboxUserManagementRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /admin/mailbox-users", s.withAdministrator(s.listManagedMailboxUsers))
	mux.HandleFunc("POST /admin/mailbox-users", s.withAdministrator(s.createManagedMailboxUser))
	mux.HandleFunc("GET /admin/mailbox-users/{id}", s.withAdministrator(s.getManagedMailboxUser))
	mux.HandleFunc("PATCH /admin/mailbox-users/{id}", s.withAdministrator(s.updateManagedMailboxUser))
	mux.HandleFunc("POST /admin/mailbox-users/{id}/mailboxes/batch-add", s.withAdministrator(s.addManagedMailboxUserMailboxes))
	mux.HandleFunc("DELETE /admin/mailbox-users/{id}", s.withAdministrator(s.deleteManagedMailboxUser))
}

func (s *Server) listManagedMailboxUsers(w http.ResponseWriter, r *http.Request, _ Admin) {
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
	pageSize, err := parseBoundedQueryInt(r, "pageSize", 20, 1, 100)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	if status != "" {
		if err := validateManagementEnum("status", status, "ACTIVE", "DISABLED"); err != nil {
			s.writeRequestError(w, r, err)
			return
		}
	}
	keyword := strings.TrimSpace(r.URL.Query().Get("keyword"))
	result, err := store.listManagedMailboxUsers(r.Context(), page, pageSize, keyword, status)
	if err != nil {
		s.writeStoreError(w, r, "list mailbox users", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) getManagedMailboxUser(w http.ResponseWriter, r *http.Request, _ Admin) {
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
	result, err := store.getManagedMailboxUser(r.Context(), id)
	if err != nil {
		s.writeStoreError(w, r, "get mailbox user", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) createManagedMailboxUser(w http.ResponseWriter, r *http.Request, _ Admin) {
	store, err := s.managementStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	var body createMailboxUserManagementRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	body.Username = strings.TrimSpace(body.Username)
	if err := validateTextLength("username", body.Username, 3, 100); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if body.Email != nil {
		value := strings.TrimSpace(*body.Email)
		body.Email = &value
		if err := validateEmailAddress(value); err != nil {
			s.writeRequestError(w, r, err)
			return
		}
	}
	if err := requirePositiveIDs(body.MailboxIDs, "mailboxIds"); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	passwordHash, err := hashManagementPassword(body.Password)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	result, err := store.createManagedMailboxUser(r.Context(), body.Username, body.Email, passwordHash, normalizeManagementIDs(body.MailboxIDs))
	if err != nil {
		s.writeStoreError(w, r, "create mailbox user", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) updateManagedMailboxUser(w http.ResponseWriter, r *http.Request, _ Admin) {
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
	var body updateMailboxUserManagementRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
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
	if body.Status != nil {
		if err := validateManagementEnum("status", *body.Status, "ACTIVE", "DISABLED"); err != nil {
			s.writeRequestError(w, r, err)
			return
		}
	}
	password, passwordPresent, err := decodeNullableString(body.Password, "password")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	var passwordHash *string
	if password != nil {
		hash, err := hashManagementPassword(*password)
		if err != nil {
			s.writeRequestError(w, r, err)
			return
		}
		passwordHash = &hash
	}
	mailboxIDs, mailboxIDsPresent, err := decodeOptionalInt64Slice(body.MailboxIDs, "mailboxIds", 1000)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	result, err := store.updateManagedMailboxUser(r.Context(), id, email, emailPresent, body.Status, body.MustChangePassword, passwordHash, passwordPresent, mailboxIDs, mailboxIDsPresent)
	if err != nil {
		s.writeStoreError(w, r, "update mailbox user", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) addManagedMailboxUserMailboxes(w http.ResponseWriter, r *http.Request, _ Admin) {
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
	var body addMailboxUserMembershipsRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if len(body.MailboxIDs) == 0 {
		s.writeRequestError(w, r, validationError("mailboxIds must contain at least one value"))
		return
	}
	if err := requirePositiveIDs(body.MailboxIDs, "mailboxIds"); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	result, err := store.addManagedMailboxUserMailboxes(r.Context(), id, normalizeManagementIDs(body.MailboxIDs))
	if err != nil {
		s.writeStoreError(w, r, "add mailbox user memberships", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) deleteManagedMailboxUser(w http.ResponseWriter, r *http.Request, _ Admin) {
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
	if err := store.deleteManagedMailboxUser(r.Context(), id); err != nil {
		s.writeStoreError(w, r, "delete mailbox user", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]bool{"success": true}})
}

func (s *PostgresStore) listManagedMailboxUsers(ctx context.Context, page, pageSize int, keyword, status string) (map[string]any, error) {
	var total int64
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*)::bigint FROM mailbox_users
		WHERE ($1 = '' OR status::text = $1)
		  AND ($2 = '' OR username ILIKE '%' || $2 || '%' OR COALESCE(email, '') ILIKE '%' || $2 || '%')
	`, status, keyword).Scan(&total); err != nil {
		return nil, fmt.Errorf("count mailbox users: %w", err)
	}
	rows, err := s.pool.Query(ctx, `
		SELECT user_row.id, user_row.username, user_row.email, user_row.status::text,
		       user_row.must_change_password, user_row.last_login_at, user_row.created_at, user_row.updated_at,
		       ((SELECT COUNT(*) FROM mailbox_memberships WHERE user_id = user_row.id) +
		        (SELECT COUNT(*) FROM domain_mailboxes WHERE owner_user_id = user_row.id))::bigint
		FROM mailbox_users AS user_row
		WHERE ($1 = '' OR user_row.status::text = $1)
		  AND ($2 = '' OR user_row.username ILIKE '%' || $2 || '%' OR COALESCE(user_row.email, '') ILIKE '%' || $2 || '%')
		ORDER BY user_row.id DESC
		LIMIT $3 OFFSET $4
	`, status, keyword, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, fmt.Errorf("list mailbox users: %w", err)
	}
	defer rows.Close()
	list := make([]mailboxUserManagementRecord, 0, pageSize)
	for rows.Next() {
		var item mailboxUserManagementRecord
		var email sql.NullString
		var lastLogin sql.NullTime
		var created, updated time.Time
		var mailboxCount int64
		if err := rows.Scan(&item.ID, &item.Username, &email, &item.Status, &item.MustChangePassword, &lastLogin, &created, &updated, &mailboxCount); err != nil {
			return nil, fmt.Errorf("scan mailbox user: %w", err)
		}
		item.Email = nullableStringValue(email)
		item.LastLoginAt = nullableTimeValue(lastLogin)
		item.CreatedAt = formatAPITime(created)
		item.UpdatedAt = formatAPITime(updated)
		item.MailboxCount = &mailboxCount
		list = append(list, item)
	}
	return map[string]any{"list": list, "total": total, "page": page, "pageSize": pageSize}, rows.Err()
}

func (s *PostgresStore) getManagedMailboxUser(ctx context.Context, id int64) (mailboxUserManagementRecord, error) {
	var item mailboxUserManagementRecord
	var email, lastIP sql.NullString
	var lastLogin sql.NullTime
	var created, updated time.Time
	err := s.pool.QueryRow(ctx, `
		SELECT id, username, email, status::text, must_change_password, last_login_at, last_login_ip, created_at, updated_at
		FROM mailbox_users WHERE id = $1
	`, id).Scan(&item.ID, &item.Username, &email, &item.Status, &item.MustChangePassword, &lastLogin, &lastIP, &created, &updated)
	if err != nil {
		if errorsIsNoRows(err) {
			return mailboxUserManagementRecord{}, managementNotFound("MAILBOX_USER_NOT_FOUND")
		}
		return mailboxUserManagementRecord{}, fmt.Errorf("get mailbox user: %w", err)
	}
	item.Email = nullableStringValue(email)
	item.LastLoginAt = nullableTimeValue(lastLogin)
	item.LastLoginIP = nullableStringValue(lastIP)
	item.CreatedAt = formatAPITime(created)
	item.UpdatedAt = formatAPITime(updated)
	owned, err := s.listOwnedManagedMailboxes(ctx, id)
	if err != nil {
		return mailboxUserManagementRecord{}, err
	}
	memberships, err := s.listManagedUserMemberships(ctx, id)
	if err != nil {
		return mailboxUserManagementRecord{}, err
	}
	item.OwnedMailboxes = owned
	item.Memberships = memberships
	return item, nil
}

func (s *PostgresStore) listOwnedManagedMailboxes(ctx context.Context, userID int64) ([]map[string]any, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, address, status::text FROM domain_mailboxes WHERE owner_user_id = $1 ORDER BY id ASC`, userID)
	if err != nil {
		return nil, fmt.Errorf("list owned mailboxes: %w", err)
	}
	defer rows.Close()
	result := make([]map[string]any, 0)
	for rows.Next() {
		var id int64
		var address, status string
		if err := rows.Scan(&id, &address, &status); err != nil {
			return nil, err
		}
		result = append(result, map[string]any{"id": id, "address": address, "status": status})
	}
	return result, rows.Err()
}

func (s *PostgresStore) listManagedUserMemberships(ctx context.Context, userID int64) ([]map[string]any, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT membership.id, membership.role::text, mailbox.id, mailbox.address, mailbox.status::text
		FROM mailbox_memberships AS membership
		JOIN domain_mailboxes AS mailbox ON mailbox.id = membership.mailbox_id
		WHERE membership.user_id = $1 ORDER BY membership.id ASC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("list user memberships: %w", err)
	}
	defer rows.Close()
	result := make([]map[string]any, 0)
	for rows.Next() {
		var membershipID, mailboxID int64
		var role, address, status string
		if err := rows.Scan(&membershipID, &role, &mailboxID, &address, &status); err != nil {
			return nil, err
		}
		result = append(result, map[string]any{
			"id": membershipID, "role": role,
			"mailbox": map[string]any{"id": mailboxID, "address": address, "status": status},
		})
	}
	return result, rows.Err()
}

func (s *PostgresStore) createManagedMailboxUser(ctx context.Context, username string, email *string, passwordHash string, mailboxIDs []int64) (mailboxUserManagementRecord, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return mailboxUserManagementRecord{}, fmt.Errorf("begin mailbox user creation: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := ensureManagedDomainMailboxes(ctx, tx, mailboxIDs); err != nil {
		return mailboxUserManagementRecord{}, err
	}
	var item mailboxUserManagementRecord
	var storedEmail sql.NullString
	var created time.Time
	err = tx.QueryRow(ctx, `
		INSERT INTO mailbox_users (username, email, password_hash, status, must_change_password, two_factor_enabled, session_version, created_at, updated_at)
		VALUES ($1, $2, $3, 'ACTIVE', TRUE, FALSE, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		RETURNING id, username, email, status::text, must_change_password, created_at
	`, username, email, passwordHash).Scan(&item.ID, &item.Username, &storedEmail, &item.Status, &item.MustChangePassword, &created)
	if err != nil {
		if managementPGCode(err) == "23505" {
			return mailboxUserManagementRecord{}, managementConflict("MAILBOX_USER_EXISTS", err)
		}
		return mailboxUserManagementRecord{}, fmt.Errorf("create mailbox user: %w", err)
	}
	if err := replaceManagedUserMemberships(ctx, tx, item.ID, mailboxIDs); err != nil {
		return mailboxUserManagementRecord{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return mailboxUserManagementRecord{}, fmt.Errorf("commit mailbox user creation: %w", err)
	}
	item.Email = nullableStringValue(storedEmail)
	item.CreatedAt = formatAPITime(created)
	return item, nil
}

func (s *PostgresStore) updateManagedMailboxUser(
	ctx context.Context,
	id int64,
	email *string,
	emailPresent bool,
	status *string,
	mustChangePassword *bool,
	passwordHash *string,
	passwordPresent bool,
	mailboxIDs []int64,
	mailboxIDsPresent bool,
) (mailboxUserManagementRecord, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return mailboxUserManagementRecord{}, fmt.Errorf("begin mailbox user update: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var username, currentPassword, currentStatus string
	var currentEmail sql.NullString
	var currentMustChange bool
	err = tx.QueryRow(ctx, `SELECT username, email, password_hash, status::text, must_change_password FROM mailbox_users WHERE id = $1 FOR UPDATE`, id).
		Scan(&username, &currentEmail, &currentPassword, &currentStatus, &currentMustChange)
	if err != nil {
		if errorsIsNoRows(err) {
			return mailboxUserManagementRecord{}, managementNotFound("MAILBOX_USER_NOT_FOUND")
		}
		return mailboxUserManagementRecord{}, fmt.Errorf("load mailbox user: %w", err)
	}
	var nextEmail any
	if emailPresent {
		nextEmail = email
	} else if currentEmail.Valid {
		nextEmail = currentEmail.String
	}
	if status != nil {
		currentStatus = *status
	}
	if mustChangePassword != nil {
		currentMustChange = *mustChangePassword
	}
	if passwordPresent && passwordHash != nil {
		currentPassword = *passwordHash
	}
	if mailboxIDsPresent {
		if err := ensureManagedDomainMailboxes(ctx, tx, mailboxIDs); err != nil {
			return mailboxUserManagementRecord{}, err
		}
	}
	var item mailboxUserManagementRecord
	var storedEmail sql.NullString
	var updated time.Time
	err = tx.QueryRow(ctx, `
		UPDATE mailbox_users
		SET email = $2, password_hash = $3, status = $4::"MailboxUserStatus",
		    must_change_password = $5, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
		RETURNING id, username, email, status::text, must_change_password, updated_at
	`, id, nextEmail, currentPassword, currentStatus, currentMustChange).
		Scan(&item.ID, &item.Username, &storedEmail, &item.Status, &item.MustChangePassword, &updated)
	if err != nil {
		if managementPGCode(err) == "23505" {
			return mailboxUserManagementRecord{}, managementConflict("MAILBOX_USER_EXISTS", err)
		}
		return mailboxUserManagementRecord{}, fmt.Errorf("update mailbox user: %w", err)
	}
	if mailboxIDsPresent {
		if err := replaceManagedUserMemberships(ctx, tx, id, mailboxIDs); err != nil {
			return mailboxUserManagementRecord{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return mailboxUserManagementRecord{}, fmt.Errorf("commit mailbox user update: %w", err)
	}
	item.Email = nullableStringValue(storedEmail)
	item.UpdatedAt = formatAPITime(updated)
	return item, nil
}

func (s *PostgresStore) addManagedMailboxUserMailboxes(ctx context.Context, userID int64, mailboxIDs []int64) (map[string]any, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin mailbox membership addition: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var username string
	if err := tx.QueryRow(ctx, `SELECT username FROM mailbox_users WHERE id = $1`, userID).Scan(&username); err != nil {
		if errorsIsNoRows(err) {
			return nil, managementNotFound("MAILBOX_USER_NOT_FOUND")
		}
		return nil, fmt.Errorf("load mailbox user: %w", err)
	}
	if err := ensureManagedDomainMailboxes(ctx, tx, mailboxIDs); err != nil {
		return nil, err
	}
	var added int64
	for _, mailboxID := range mailboxIDs {
		var owned bool
		if err := tx.QueryRow(ctx, `SELECT owner_user_id = $2 FROM domain_mailboxes WHERE id = $1`, mailboxID, userID).Scan(&owned); err != nil {
			return nil, err
		}
		if owned {
			continue
		}
		command, err := tx.Exec(ctx, `
			INSERT INTO mailbox_memberships (mailbox_id, user_id, role, created_at, updated_at)
			VALUES ($1, $2, 'MEMBER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
			ON CONFLICT (mailbox_id, user_id) DO NOTHING
		`, mailboxID, userID)
		if err != nil {
			return nil, fmt.Errorf("add mailbox membership: %w", err)
		}
		added += command.RowsAffected()
	}
	var total int64
	if err := tx.QueryRow(ctx, `
		SELECT COUNT(DISTINCT mailbox_id)::bigint FROM (
			SELECT id AS mailbox_id FROM domain_mailboxes WHERE owner_user_id = $1
			UNION
			SELECT mailbox_id FROM mailbox_memberships WHERE user_id = $1
		) AS accessible
	`, userID).Scan(&total); err != nil {
		return nil, fmt.Errorf("count accessible mailboxes: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit mailbox membership addition: %w", err)
	}
	return map[string]any{"userId": userID, "username": username, "addedCount": added, "totalAccessible": total}, nil
}

func (s *PostgresStore) deleteManagedMailboxUser(ctx context.Context, id int64) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin mailbox user deletion: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM mailbox_users WHERE id = $1)`, id).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return managementNotFound("MAILBOX_USER_NOT_FOUND")
	}
	if _, err := tx.Exec(ctx, `DELETE FROM mailbox_memberships WHERE user_id = $1`, id); err != nil {
		return fmt.Errorf("delete mailbox user memberships: %w", err)
	}
	if _, err := tx.Exec(ctx, `UPDATE domain_mailboxes SET owner_user_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE owner_user_id = $1`, id); err != nil {
		return fmt.Errorf("clear mailbox ownership: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM mailbox_users WHERE id = $1`, id); err != nil {
		return fmt.Errorf("delete mailbox user: %w", err)
	}
	return tx.Commit(ctx)
}

func ensureManagedDomainMailboxes(ctx context.Context, tx pgx.Tx, ids []int64) error {
	ids = normalizeManagementIDs(ids)
	if len(ids) == 0 {
		return nil
	}
	var count int64
	if err := tx.QueryRow(ctx, `SELECT COUNT(*)::bigint FROM domain_mailboxes WHERE id = ANY($1::bigint[])`, ids).Scan(&count); err != nil {
		return fmt.Errorf("check domain mailboxes: %w", err)
	}
	if count != int64(len(ids)) {
		return managementNotFound("DOMAIN_MAILBOX_NOT_FOUND")
	}
	return nil
}

func replaceManagedUserMemberships(ctx context.Context, tx pgx.Tx, userID int64, mailboxIDs []int64) error {
	if _, err := tx.Exec(ctx, `DELETE FROM mailbox_memberships WHERE user_id = $1`, userID); err != nil {
		return fmt.Errorf("clear user mailbox memberships: %w", err)
	}
	for _, mailboxID := range normalizeManagementIDs(mailboxIDs) {
		var owned bool
		if err := tx.QueryRow(ctx, `SELECT owner_user_id = $2 FROM domain_mailboxes WHERE id = $1`, mailboxID, userID).Scan(&owned); err != nil {
			return err
		}
		if owned {
			continue
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO mailbox_memberships (mailbox_id, user_id, role, created_at, updated_at)
			VALUES ($1, $2, 'MEMBER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
			ON CONFLICT (mailbox_id, user_id) DO NOTHING
		`, mailboxID, userID); err != nil {
			return fmt.Errorf("create user mailbox membership: %w", err)
		}
	}
	return nil
}
