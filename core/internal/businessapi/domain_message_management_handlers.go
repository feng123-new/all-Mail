package businessapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
)

type managedDomainMessageListInput struct {
	Page       int
	PageSize   int
	DomainID   *int64
	MailboxID  *int64
	UnreadOnly bool
}

type batchDeleteDomainMessagesRequest struct {
	IDs []json.RawMessage `json:"ids"`
}

func (s *Server) registerDomainMessageManagementRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /admin/domain-messages", s.withAdministrator(s.listManagedDomainMessages))
	mux.HandleFunc("POST /admin/domain-messages/batch-delete", s.withAdministrator(s.batchDeleteManagedDomainMessages))
	mux.HandleFunc("GET /admin/domain-messages/{id}", s.withAdministrator(s.getManagedDomainMessage))
	mux.HandleFunc("DELETE /admin/domain-messages/{id}", s.withAdministrator(s.deleteManagedDomainMessage))
}

func (s *Server) listManagedDomainMessages(w http.ResponseWriter, r *http.Request, _ Admin) {
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
	domainID, err := parseOptionalPositiveQueryID(r, "domainId")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	mailboxID, err := parseOptionalPositiveQueryID(r, "mailboxId")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	unreadOnly, err := parseOptionalQueryBoolean(r, "unreadOnly", false)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	result, err := store.listManagedDomainMessages(r.Context(), managedDomainMessageListInput{
		Page: page, PageSize: pageSize, DomainID: domainID, MailboxID: mailboxID, UnreadOnly: unreadOnly,
	})
	if err != nil {
		s.writeStoreError(w, r, "list inbound domain messages", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) getManagedDomainMessage(w http.ResponseWriter, r *http.Request, _ Admin) {
	store, err := s.managementStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	id, err := parseMessagePathID(r, "id")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	result, err := store.getManagedDomainMessage(r.Context(), id)
	if err != nil {
		s.writeStoreError(w, r, "get inbound domain message", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) deleteManagedDomainMessage(w http.ResponseWriter, r *http.Request, _ Admin) {
	store, err := s.managementStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	id, err := parseMessagePathID(r, "id")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	result, err := store.deleteManagedDomainMessages(r.Context(), []int64{id})
	if err != nil {
		s.writeStoreError(w, r, "delete inbound domain message", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) batchDeleteManagedDomainMessages(w http.ResponseWriter, r *http.Request, _ Admin) {
	store, err := s.managementStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	var body batchDeleteDomainMessagesRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	ids, err := parseInboundMessageIDs(body.IDs)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	result, err := store.deleteManagedDomainMessages(r.Context(), ids)
	if err != nil {
		s.writeStoreError(w, r, "batch delete inbound domain messages", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func parseMessagePathID(r *http.Request, name string) (int64, error) {
	value, err := strconv.ParseInt(strings.TrimSpace(r.PathValue(name)), 10, 64)
	if err != nil {
		return 0, &requestError{Status: http.StatusBadRequest, Code: "INBOUND_MESSAGE_INVALID_ID"}
	}
	return value, nil
}

func parseInboundMessageIDs(rawIDs []json.RawMessage) ([]int64, error) {
	if len(rawIDs) == 0 {
		return nil, validationError("ids must contain at least one message id")
	}
	seen := make(map[int64]struct{}, len(rawIDs))
	ids := make([]int64, 0, len(rawIDs))
	for _, raw := range rawIDs {
		trimmed := strings.TrimSpace(string(raw))
		var value int64
		var err error
		if strings.HasPrefix(trimmed, `"`) {
			var text string
			if json.Unmarshal(raw, &text) != nil || strings.TrimSpace(text) == "" {
				return nil, &requestError{Status: http.StatusBadRequest, Code: "INBOUND_MESSAGE_INVALID_ID"}
			}
			value, err = strconv.ParseInt(strings.TrimSpace(text), 10, 64)
		} else {
			value, err = strconv.ParseInt(trimmed, 10, 64)
			if err == nil && value <= 0 {
				err = strconv.ErrSyntax
			}
		}
		if err != nil {
			return nil, &requestError{Status: http.StatusBadRequest, Code: "INBOUND_MESSAGE_INVALID_ID"}
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		ids = append(ids, value)
	}
	return ids, nil
}

func parseOptionalQueryBoolean(r *http.Request, name string, fallback bool) (bool, error) {
	if !r.URL.Query().Has(name) {
		return fallback, nil
	}
	value, err := strconv.ParseBool(strings.TrimSpace(r.URL.Query().Get(name)))
	if err != nil {
		return false, validationError(name + " must be a boolean")
	}
	return value, nil
}
