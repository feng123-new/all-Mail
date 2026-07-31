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

type emailGroupRecord struct {
	ID            int64   `json:"id"`
	Name          string  `json:"name"`
	Description   *string `json:"description"`
	FetchStrategy string  `json:"fetchStrategy"`
	EmailCount    *int64  `json:"emailCount,omitempty"`
	CreatedAt     string  `json:"createdAt"`
	UpdatedAt     string  `json:"updatedAt"`
	Count         any     `json:"_count,omitempty"`
	Emails        any     `json:"emails,omitempty"`
}

type createEmailGroupRequest struct {
	Name          string          `json:"name"`
	Description   json.RawMessage `json:"description"`
	FetchStrategy string          `json:"fetchStrategy"`
}

type updateEmailGroupRequest struct {
	Name          *string         `json:"name"`
	Description   json.RawMessage `json:"description"`
	FetchStrategy *string         `json:"fetchStrategy"`
}

type assignEmailGroupRequest struct {
	EmailIDs []int64 `json:"emailIds"`
}

func (s *Server) registerEmailGroupManagementRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /admin/email-groups", s.withAdministrator(s.listManagedEmailGroups))
	mux.HandleFunc("POST /admin/email-groups", s.withAdministrator(s.createManagedEmailGroup))
	mux.HandleFunc("GET /admin/email-groups/{id}", s.withAdministrator(s.getManagedEmailGroup))
	mux.HandleFunc("PUT /admin/email-groups/{id}", s.withAdministrator(s.updateManagedEmailGroup))
	mux.HandleFunc("DELETE /admin/email-groups/{id}", s.withAdministrator(s.deleteManagedEmailGroup))
	mux.HandleFunc("POST /admin/email-groups/{id}/assign", s.withAdministrator(s.assignManagedEmailGroup))
	mux.HandleFunc("POST /admin/email-groups/{id}/remove", s.withAdministrator(s.removeManagedEmailGroup))
}

func (s *Server) listManagedEmailGroups(w http.ResponseWriter, r *http.Request, _ Admin) {
	store, err := s.managementStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	result, err := store.listManagedEmailGroups(r.Context())
	if err != nil {
		s.writeStoreError(w, r, "list email groups", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) getManagedEmailGroup(w http.ResponseWriter, r *http.Request, _ Admin) {
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
	result, err := store.getManagedEmailGroup(r.Context(), id)
	if err != nil {
		s.writeStoreError(w, r, "get email group", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) createManagedEmailGroup(w http.ResponseWriter, r *http.Request, _ Admin) {
	store, err := s.managementStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	var body createEmailGroupRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	body.Name = strings.TrimSpace(body.Name)
	if err := validateTextLength("name", body.Name, 1, 50); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if body.FetchStrategy == "" {
		body.FetchStrategy = "GRAPH_FIRST"
	}
	if err := validateManagementEnum("fetchStrategy", body.FetchStrategy, "GRAPH_FIRST", "IMAP_FIRST", "GRAPH_ONLY", "IMAP_ONLY"); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	description, _, err := decodeNullableString(body.Description, "description")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if description != nil && len(*description) > 255 {
		s.writeRequestError(w, r, validationError("description must contain at most 255 characters"))
		return
	}
	result, err := store.createManagedEmailGroup(r.Context(), body.Name, description, body.FetchStrategy)
	if err != nil {
		s.writeStoreError(w, r, "create email group", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) updateManagedEmailGroup(w http.ResponseWriter, r *http.Request, _ Admin) {
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
	var body updateEmailGroupRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if body.Name != nil {
		value := strings.TrimSpace(*body.Name)
		body.Name = &value
		if err := validateTextLength("name", value, 1, 50); err != nil {
			s.writeRequestError(w, r, err)
			return
		}
	}
	if body.FetchStrategy != nil {
		if err := validateManagementEnum("fetchStrategy", *body.FetchStrategy, "GRAPH_FIRST", "IMAP_FIRST", "GRAPH_ONLY", "IMAP_ONLY"); err != nil {
			s.writeRequestError(w, r, err)
			return
		}
	}
	description, descriptionPresent, err := decodeNullableString(body.Description, "description")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if description != nil && len(*description) > 255 {
		s.writeRequestError(w, r, validationError("description must contain at most 255 characters"))
		return
	}
	result, err := store.updateManagedEmailGroup(r.Context(), id, body, description, descriptionPresent)
	if err != nil {
		s.writeStoreError(w, r, "update email group", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) deleteManagedEmailGroup(w http.ResponseWriter, r *http.Request, _ Admin) {
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
	if err := store.deleteManagedEmailGroup(r.Context(), id); err != nil {
		s.writeStoreError(w, r, "delete email group", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]bool{"success": true}})
}

func (s *Server) assignManagedEmailGroup(w http.ResponseWriter, r *http.Request, _ Admin) {
	s.mutateManagedEmailGroupAssignments(w, r, true)
}

func (s *Server) removeManagedEmailGroup(w http.ResponseWriter, r *http.Request, _ Admin) {
	s.mutateManagedEmailGroupAssignments(w, r, false)
}

func (s *Server) mutateManagedEmailGroupAssignments(w http.ResponseWriter, r *http.Request, assign bool) {
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
	var body assignEmailGroupRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if err := requirePositiveIDs(body.EmailIDs, "emailIds"); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	body.EmailIDs = normalizeManagementIDs(body.EmailIDs)
	count, err := store.mutateManagedEmailGroupAssignments(r.Context(), id, body.EmailIDs, assign)
	if err != nil {
		s.writeStoreError(w, r, "change email group assignments", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]any{"success": true, "count": count}})
}

func (s *PostgresStore) listManagedEmailGroups(ctx context.Context) ([]emailGroupRecord, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT group_row.id, group_row.name, group_row.description, group_row.fetch_strategy::text,
		       COUNT(email.id)::bigint, group_row.created_at, group_row.updated_at
		FROM email_groups AS group_row
		LEFT JOIN email_accounts AS email ON email.group_id = group_row.id
		GROUP BY group_row.id
		ORDER BY group_row.id ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("list email groups: %w", err)
	}
	defer rows.Close()
	result := make([]emailGroupRecord, 0)
	for rows.Next() {
		var item emailGroupRecord
		var description sql.NullString
		var count int64
		var created, updated time.Time
		if err := rows.Scan(&item.ID, &item.Name, &description, &item.FetchStrategy, &count, &created, &updated); err != nil {
			return nil, fmt.Errorf("scan email group: %w", err)
		}
		item.Description = nullableStringValue(description)
		item.EmailCount = &count
		item.CreatedAt = formatAPITime(created)
		item.UpdatedAt = formatAPITime(updated)
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s *PostgresStore) getManagedEmailGroup(ctx context.Context, id int64) (emailGroupRecord, error) {
	var item emailGroupRecord
	var description sql.NullString
	var created, updated time.Time
	var count int64
	err := s.pool.QueryRow(ctx, `
		SELECT group_row.id, group_row.name, group_row.description, group_row.fetch_strategy::text,
		       COUNT(email.id)::bigint, group_row.created_at, group_row.updated_at
		FROM email_groups AS group_row
		LEFT JOIN email_accounts AS email ON email.group_id = group_row.id
		WHERE group_row.id = $1
		GROUP BY group_row.id
	`, id).Scan(&item.ID, &item.Name, &description, &item.FetchStrategy, &count, &created, &updated)
	if err != nil {
		if errorsIsNoRows(err) {
			return emailGroupRecord{}, managementNotFound("GROUP_NOT_FOUND")
		}
		return emailGroupRecord{}, fmt.Errorf("get email group: %w", err)
	}
	rows, err := s.pool.Query(ctx, `SELECT id, email, status::text FROM email_accounts WHERE group_id = $1 ORDER BY id ASC`, id)
	if err != nil {
		return emailGroupRecord{}, fmt.Errorf("list group emails: %w", err)
	}
	defer rows.Close()
	emails := make([]map[string]any, 0)
	for rows.Next() {
		var emailID int64
		var address, status string
		if err := rows.Scan(&emailID, &address, &status); err != nil {
			return emailGroupRecord{}, fmt.Errorf("scan group email: %w", err)
		}
		emails = append(emails, map[string]any{"id": emailID, "email": address, "status": status})
	}
	item.Description = nullableStringValue(description)
	item.CreatedAt = formatAPITime(created)
	item.UpdatedAt = formatAPITime(updated)
	item.Count = map[string]int64{"emails": count}
	item.Emails = emails
	return item, rows.Err()
}

func (s *PostgresStore) createManagedEmailGroup(ctx context.Context, name string, description *string, strategy string) (emailGroupRecord, error) {
	var item emailGroupRecord
	var storedDescription sql.NullString
	var created, updated time.Time
	err := s.pool.QueryRow(ctx, `
		INSERT INTO email_groups (name, description, fetch_strategy, created_at, updated_at)
		VALUES ($1, $2, $3::"MailFetchStrategy", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		RETURNING id, name, description, fetch_strategy::text, created_at, updated_at
	`, name, description, strategy).Scan(&item.ID, &item.Name, &storedDescription, &item.FetchStrategy, &created, &updated)
	if err != nil {
		if managementPGCode(err) == "23505" {
			return emailGroupRecord{}, managementConflict("GROUP_EXISTS", err)
		}
		return emailGroupRecord{}, fmt.Errorf("create email group: %w", err)
	}
	item.Description = nullableStringValue(storedDescription)
	item.CreatedAt = formatAPITime(created)
	item.UpdatedAt = formatAPITime(updated)
	return item, nil
}

func (s *PostgresStore) updateManagedEmailGroup(ctx context.Context, id int64, input updateEmailGroupRequest, description *string, descriptionPresent bool) (emailGroupRecord, error) {
	var name, strategy string
	var currentDescription sql.NullString
	if err := s.pool.QueryRow(ctx, `SELECT name, description, fetch_strategy::text FROM email_groups WHERE id = $1`, id).Scan(&name, &currentDescription, &strategy); err != nil {
		if errorsIsNoRows(err) {
			return emailGroupRecord{}, managementNotFound("GROUP_NOT_FOUND")
		}
		return emailGroupRecord{}, fmt.Errorf("load email group: %w", err)
	}
	if input.Name != nil {
		name = *input.Name
	}
	var nextDescription any
	if descriptionPresent {
		nextDescription = description
	} else if currentDescription.Valid {
		nextDescription = currentDescription.String
	} else {
		nextDescription = nil
	}
	if input.FetchStrategy != nil {
		strategy = *input.FetchStrategy
	}
	var item emailGroupRecord
	var storedDescription sql.NullString
	var created, updated time.Time
	err := s.pool.QueryRow(ctx, `
		UPDATE email_groups
		SET name = $2, description = $3, fetch_strategy = $4::"MailFetchStrategy", updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
		RETURNING id, name, description, fetch_strategy::text, created_at, updated_at
	`, id, name, nextDescription, strategy).Scan(&item.ID, &item.Name, &storedDescription, &item.FetchStrategy, &created, &updated)
	if err != nil {
		if managementPGCode(err) == "23505" {
			return emailGroupRecord{}, managementConflict("GROUP_EXISTS", err)
		}
		return emailGroupRecord{}, fmt.Errorf("update email group: %w", err)
	}
	item.Description = nullableStringValue(storedDescription)
	item.CreatedAt = formatAPITime(created)
	item.UpdatedAt = formatAPITime(updated)
	return item, nil
}

func (s *PostgresStore) deleteManagedEmailGroup(ctx context.Context, id int64) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin email group deletion: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM email_groups WHERE id = $1)`, id).Scan(&exists); err != nil {
		return fmt.Errorf("check email group: %w", err)
	}
	if !exists {
		return managementNotFound("GROUP_NOT_FOUND")
	}
	if _, err := tx.Exec(ctx, `UPDATE email_accounts SET group_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE group_id = $1`, id); err != nil {
		return fmt.Errorf("detach group emails: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM email_groups WHERE id = $1`, id); err != nil {
		return fmt.Errorf("delete email group: %w", err)
	}
	return tx.Commit(ctx)
}

func (s *PostgresStore) mutateManagedEmailGroupAssignments(ctx context.Context, groupID int64, emailIDs []int64, assign bool) (int64, error) {
	if assign {
		var exists bool
		if err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM email_groups WHERE id = $1)`, groupID).Scan(&exists); err != nil {
			return 0, fmt.Errorf("check email group: %w", err)
		}
		if !exists {
			return 0, managementNotFound("GROUP_NOT_FOUND")
		}
		command, err := s.pool.Exec(ctx, `UPDATE email_accounts SET group_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = ANY($2::int[])`, groupID, emailIDs)
		if err != nil {
			return 0, fmt.Errorf("assign email group: %w", err)
		}
		return command.RowsAffected(), nil
	}
	command, err := s.pool.Exec(ctx, `UPDATE email_accounts SET group_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE group_id = $1 AND id = ANY($2::int[])`, groupID, emailIDs)
	if err != nil {
		return 0, fmt.Errorf("remove email group assignments: %w", err)
	}
	return command.RowsAffected(), nil
}
