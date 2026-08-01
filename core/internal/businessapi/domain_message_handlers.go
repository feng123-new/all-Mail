package businessapi

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"math/big"
	"net/http"
	"strconv"
	"strings"
)

type adminDomainMessageListInput struct {
	Page       int
	PageSize   int
	DomainID   *int64
	MailboxID  *int64
	UnreadOnly bool
}

type adminDomainMessageListResult struct {
	List     []map[string]any `json:"list"`
	Total    int64            `json:"total"`
	Page     int              `json:"page"`
	PageSize int              `json:"pageSize"`
}

type adminDomainMessageDeleteResult struct {
	Deleted int64    `json:"deleted"`
	IDs     []string `json:"ids"`
}

type adminDomainMessageStore interface {
	ListAdminDomainMessages(context.Context, adminDomainMessageListInput) (adminDomainMessageListResult, error)
	GetAdminDomainMessage(context.Context, int64) (map[string]any, error)
	DeleteAdminDomainMessages(context.Context, []int64) (adminDomainMessageDeleteResult, error)
}

type adminDomainMessageDeleteRequest struct {
	IDs []json.RawMessage `json:"ids"`
}

func (s *Server) registerDomainMessageRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /admin/domain-messages", s.withAdministrator(s.listAdminDomainMessages))
	mux.HandleFunc("GET /admin/domain-messages/{id}", s.withAdministrator(s.getAdminDomainMessage))
	mux.HandleFunc("DELETE /admin/domain-messages/{id}", s.withAdministrator(s.deleteAdminDomainMessage))
	mux.HandleFunc("POST /admin/domain-messages/batch-delete", s.withAdministrator(s.batchDeleteAdminDomainMessages))
}

func (s *Server) adminDomainMessageStore() (adminDomainMessageStore, error) {
	store, ok := s.store.(adminDomainMessageStore)
	if !ok || store == nil {
		return nil, &requestError{Status: http.StatusServiceUnavailable, Code: "DOMAIN_MESSAGE_STORE_UNAVAILABLE"}
	}
	return store, nil
}

func (s *Server) listAdminDomainMessages(w http.ResponseWriter, r *http.Request, _ Admin) {
	store, err := s.adminDomainMessageStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	input, err := parseAdminDomainMessageListInput(r)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	result, err := store.ListAdminDomainMessages(r.Context(), input)
	if err != nil {
		s.writeStoreError(w, r, "list domain messages", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) getAdminDomainMessage(w http.ResponseWriter, r *http.Request, _ Admin) {
	store, err := s.adminDomainMessageStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	id, err := parseInboundMessageID(r.PathValue("id"))
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	result, err := store.GetAdminDomainMessage(r.Context(), id)
	if err != nil {
		s.writeStoreError(w, r, "get domain message", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) deleteAdminDomainMessage(w http.ResponseWriter, r *http.Request, _ Admin) {
	store, err := s.adminDomainMessageStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	id, err := parseInboundMessageID(r.PathValue("id"))
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	s.deleteAdminDomainMessageIDs(w, r, store, []int64{id})
}

func (s *Server) batchDeleteAdminDomainMessages(w http.ResponseWriter, r *http.Request, _ Admin) {
	store, err := s.adminDomainMessageStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	var body adminDomainMessageDeleteRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	ids, err := parseInboundMessageIDs(body.IDs)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	s.deleteAdminDomainMessageIDs(w, r, store, ids)
}

func (s *Server) deleteAdminDomainMessageIDs(
	w http.ResponseWriter,
	r *http.Request,
	store adminDomainMessageStore,
	ids []int64,
) {
	result, err := store.DeleteAdminDomainMessages(r.Context(), ids)
	if err != nil {
		s.writeStoreError(w, r, "delete domain messages", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func parseAdminDomainMessageListInput(r *http.Request) (adminDomainMessageListInput, error) {
	page, err := parseAdminDomainMessageIntegerQuery(r, "page", 1, 1, math.MaxInt)
	if err != nil {
		return adminDomainMessageListInput{}, err
	}
	pageSize, err := parseAdminDomainMessageIntegerQuery(r, "pageSize", 20, 1, 100)
	if err != nil {
		return adminDomainMessageListInput{}, err
	}
	domainID, err := parseAdminDomainMessageOptionalID(r, "domainId")
	if err != nil {
		return adminDomainMessageListInput{}, err
	}
	mailboxID, err := parseAdminDomainMessageOptionalID(r, "mailboxId")
	if err != nil {
		return adminDomainMessageListInput{}, err
	}
	unreadOnly := false
	if values, present := r.URL.Query()["unreadOnly"]; present {
		if len(values) == 0 {
			return adminDomainMessageListInput{}, validationError("unreadOnly must be a boolean")
		}
		unreadOnly, err = strconv.ParseBool(strings.TrimSpace(values[0]))
		if err != nil {
			return adminDomainMessageListInput{}, validationError("unreadOnly must be a boolean")
		}
	}
	return adminDomainMessageListInput{
		Page: page, PageSize: pageSize, DomainID: domainID, MailboxID: mailboxID, UnreadOnly: unreadOnly,
	}, nil
}

func parseAdminDomainMessageIntegerQuery(r *http.Request, name string, fallback, minimum, maximum int) (int, error) {
	values, present := r.URL.Query()[name]
	if !present || len(values) == 0 {
		return fallback, nil
	}
	numeric, err := parseAdminDomainMessageCoercedNumber(values[0])
	if err != nil || math.IsInf(numeric, 0) || math.IsNaN(numeric) || math.Trunc(numeric) != numeric ||
		numeric < float64(minimum) || numeric > float64(maximum) {
		return 0, validationError(fmt.Sprintf("%s must be an integer between %d and %d", name, minimum, maximum))
	}
	return int(numeric), nil
}

func parseAdminDomainMessageOptionalID(r *http.Request, name string) (*int64, error) {
	values, present := r.URL.Query()[name]
	if !present || len(values) == 0 {
		return nil, nil
	}
	numeric, err := parseAdminDomainMessageCoercedNumber(values[0])
	if err != nil || math.IsInf(numeric, 0) || math.IsNaN(numeric) || math.Trunc(numeric) != numeric ||
		numeric <= 0 || numeric > math.MaxInt64 {
		return nil, validationError(name + " must be a positive integer")
	}
	value := int64(numeric)
	return &value, nil
}

func parseAdminDomainMessageCoercedNumber(raw string) (float64, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return 0, nil
	}
	lower := strings.ToLower(value)
	for prefix, base := range map[string]int{"0x": 16, "0b": 2, "0o": 8} {
		if strings.HasPrefix(lower, prefix) {
			parsed, err := strconv.ParseUint(lower[len(prefix):], base, 64)
			return float64(parsed), err
		}
	}
	return strconv.ParseFloat(value, 64)
}

func parseInboundMessageIDs(rawIDs []json.RawMessage) ([]int64, error) {
	if len(rawIDs) == 0 {
		return nil, validationError("ids must contain at least one value")
	}
	result := make([]int64, 0, len(rawIDs))
	seen := make(map[int64]struct{}, len(rawIDs))
	for _, raw := range rawIDs {
		id, err := parseInboundMessageJSONID(raw)
		if err != nil {
			return nil, err
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		result = append(result, id)
	}
	return result, nil
}

func parseInboundMessageJSONID(raw json.RawMessage) (int64, error) {
	trimmed := strings.TrimSpace(string(raw))
	if strings.HasPrefix(trimmed, `"`) {
		var value string
		if err := json.Unmarshal(raw, &value); err != nil || strings.TrimSpace(value) == "" {
			return 0, validationError("ids must contain non-empty strings or positive integers")
		}
		return parseInboundMessageID(value)
	}
	var numeric float64
	if err := json.Unmarshal(raw, &numeric); err != nil || math.IsInf(numeric, 0) || math.IsNaN(numeric) ||
		math.Trunc(numeric) != numeric || numeric <= 0 || numeric > math.MaxInt64 {
		return 0, validationError("ids must contain non-empty strings or positive integers")
	}
	return int64(numeric), nil
}

func parseInboundMessageID(raw string) (int64, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return 0, invalidInboundMessageID()
	}
	sign := 1
	if value[0] == '+' || value[0] == '-' {
		if value[0] == '-' {
			sign = -1
		}
		value = value[1:]
		if value == "" {
			return 0, invalidInboundMessageID()
		}
	}
	base := 10
	lower := strings.ToLower(value)
	for prefix, candidateBase := range map[string]int{"0x": 16, "0b": 2, "0o": 8} {
		if strings.HasPrefix(lower, prefix) {
			base = candidateBase
			value = value[len(prefix):]
			break
		}
	}
	parsed, ok := new(big.Int).SetString(value, base)
	if !ok {
		return 0, invalidInboundMessageID()
	}
	if sign < 0 {
		parsed.Neg(parsed)
	}
	if !parsed.IsInt64() {
		return 0, invalidInboundMessageID()
	}
	return parsed.Int64(), nil
}

func invalidInboundMessageID() error {
	return &requestError{Status: http.StatusBadRequest, Code: "INBOUND_MESSAGE_INVALID_ID"}
}
