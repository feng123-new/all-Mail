package businessapi

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/crypto/bcrypt"
)

const bcryptCost = 10

func (s *Server) withSuperAdministrator(next func(http.ResponseWriter, *http.Request, Admin)) http.HandlerFunc {
	return s.withAdministrator(func(w http.ResponseWriter, r *http.Request, admin Admin) {
		if admin.Role != "SUPER_ADMIN" {
			s.writeRequestError(w, r, &requestError{Status: http.StatusForbidden, Code: "FORBIDDEN"})
			return
		}
		next(w, r, admin)
	})
}

func (s *Server) managementStore() (*PostgresStore, error) {
	store, ok := s.store.(*PostgresStore)
	if !ok || store == nil || store.pool == nil {
		return nil, &requestError{Status: http.StatusServiceUnavailable, Code: "MANAGEMENT_STORE_UNAVAILABLE"}
	}
	return store, nil
}

func hashManagementPassword(password string) (string, error) {
	if utf8.RuneCountInString(password) < 8 || utf8.RuneCountInString(password) > 1024 {
		return "", validationError("password must contain between 8 and 1024 characters")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
	if err != nil {
		return "", &requestError{Status: http.StatusInternalServerError, Code: "PASSWORD_HASH_FAILED", Cause: err}
	}
	return string(hash), nil
}

func decodeNullableString(raw json.RawMessage, field string) (*string, bool, error) {
	if len(raw) == 0 {
		return nil, false, nil
	}
	if strings.TrimSpace(string(raw)) == "null" {
		return nil, true, nil
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, true, validationError(field + " must be a string or null")
	}
	value = strings.TrimSpace(value)
	return &value, true, nil
}

func decodeOptionalInt64Slice(raw json.RawMessage, field string, maximum int) ([]int64, bool, error) {
	if len(raw) == 0 {
		return nil, false, nil
	}
	if strings.TrimSpace(string(raw)) == "null" {
		return nil, true, validationError(field + " must be an array")
	}
	var values []int64
	if err := json.Unmarshal(raw, &values); err != nil {
		return nil, true, validationError(field + " must be an array of positive integers")
	}
	if maximum > 0 && len(values) > maximum {
		return nil, true, validationError(field + " contains too many values")
	}
	values = normalizeManagementIDs(values)
	return values, true, nil
}

func normalizeManagementIDs(values []int64) []int64 {
	seen := make(map[int64]struct{}, len(values))
	result := make([]int64, 0, len(values))
	for _, value := range values {
		if value <= 0 {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func requirePositiveIDs(values []int64, field string) error {
	for _, value := range values {
		if value <= 0 {
			return validationError(field + " must contain only positive integers")
		}
	}
	return nil
}

func validateManagementEnum(field, value string, allowed ...string) error {
	for _, candidate := range allowed {
		if value == candidate {
			return nil
		}
	}
	return validationError(field + " contains an unsupported value")
}

func nullableStringValue(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	result := value.String
	return &result
}

func nullableTimeValue(value sql.NullTime) *string {
	if !value.Valid {
		return nil
	}
	result := formatAPITime(value.Time)
	return &result
}

func nullableInt64Value(value sql.NullInt64) *int64 {
	if !value.Valid {
		return nil
	}
	result := value.Int64
	return &result
}

func formatOptionalTime(value *time.Time) *string {
	if value == nil {
		return nil
	}
	result := formatAPITime(*value)
	return &result
}

func managementPGCode(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code
	}
	return ""
}

func managementConflict(code string, err error) error {
	return &requestError{Status: http.StatusConflict, Code: code, Cause: err}
}

func managementNotFound(code string) error {
	return &requestError{Status: http.StatusNotFound, Code: code}
}

func managementBadRequest(code string, err error) error {
	return &requestError{Status: http.StatusBadRequest, Code: code, Cause: err}
}
