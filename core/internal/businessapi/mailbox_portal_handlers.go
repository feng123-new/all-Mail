package businessapi

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
)

func (s *Server) registerMailboxPortalReadRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /mail/api/mailboxes", s.withMailbox(s.mailboxPortalMailboxes))
	mux.HandleFunc("GET /mail/api/messages", s.withMailbox(s.mailboxPortalMessages))
	mux.HandleFunc("GET /mail/api/messages/{id}", s.withMailbox(s.mailboxPortalMessageDetail))
}

func (s *Server) mailboxPortalMailboxes(w http.ResponseWriter, r *http.Request, identity MailboxIdentity) {
	store, err := s.requireMailboxPortalStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	mailboxes, err := store.ListMailboxPortalMailboxes(r.Context(), identity.ID)
	if err != nil {
		s.writeStoreError(w, r, "list mailbox portal mailboxes", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": mailboxes})
}

func (s *Server) mailboxPortalMessages(w http.ResponseWriter, r *http.Request, identity MailboxIdentity) {
	input, err := parseMailboxPortalMessageListInput(r)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	input.MailboxUserID = identity.ID
	if input.MailboxID != nil && !portalMailboxIDAllowed(*input.MailboxID, identity.MailboxIDs) {
		s.writeRequestError(w, r, &requestError{Status: http.StatusForbidden, Code: "FORBIDDEN_MAILBOX"})
		return
	}
	store, err := s.requireMailboxPortalStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	result, err := store.ListMailboxPortalMessages(r.Context(), input)
	if err != nil {
		s.writeStoreError(w, r, "list mailbox portal messages", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) mailboxPortalMessageDetail(w http.ResponseWriter, r *http.Request, identity MailboxIdentity) {
	rawID := strings.TrimSpace(r.PathValue("id"))
	id, err := strconv.ParseInt(rawID, 10, 64)
	if err != nil {
		s.writeRequestError(w, r, &requestError{Status: http.StatusBadRequest, Code: "INBOUND_MESSAGE_INVALID_ID"})
		return
	}
	store, err := s.requireMailboxPortalStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	message, err := store.GetMailboxPortalMessage(r.Context(), id, identity.ID)
	if errors.Is(err, errNotFound) {
		s.writeRequestError(w, r, &requestError{Status: http.StatusNotFound, Code: "INBOUND_MESSAGE_NOT_FOUND"})
		return
	}
	if err != nil {
		s.writeStoreError(w, r, "get mailbox portal message", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": message})
}

func (s *Server) requireMailboxPortalStore() (MailboxPortalStore, error) {
	if s.mailboxPortalStore == nil {
		return nil, &requestError{Status: http.StatusServiceUnavailable, Code: "MAILBOX_PORTAL_BACKEND_UNAVAILABLE"}
	}
	return s.mailboxPortalStore, nil
}

func parseMailboxPortalMessageListInput(r *http.Request) (MailboxPortalMessageListInput, error) {
	page, err := parseMailboxPortalQueryInt(r, "page", 1, 1, 1_000_000)
	if err != nil {
		return MailboxPortalMessageListInput{}, err
	}
	pageSize, err := parseMailboxPortalQueryInt(r, "pageSize", 20, 1, 100)
	if err != nil {
		return MailboxPortalMessageListInput{}, err
	}
	var mailboxID *int64
	if r.URL.Query().Has("mailboxId") {
		value, err := strconv.ParseInt(strings.TrimSpace(r.URL.Query().Get("mailboxId")), 10, 64)
		if err != nil || value <= 0 {
			return MailboxPortalMessageListInput{}, validationError("mailboxId must be a positive integer")
		}
		mailboxID = &value
	}
	unreadOnly := false
	if r.URL.Query().Has("unreadOnly") {
		unreadOnly, err = strconv.ParseBool(strings.TrimSpace(r.URL.Query().Get("unreadOnly")))
		if err != nil {
			return MailboxPortalMessageListInput{}, validationError("unreadOnly must be a boolean")
		}
	}
	return MailboxPortalMessageListInput{
		Page: page, PageSize: pageSize, MailboxID: mailboxID, UnreadOnly: unreadOnly,
	}, nil
}

func parseMailboxPortalQueryInt(r *http.Request, name string, fallback, minimum, maximum int) (int, error) {
	if !r.URL.Query().Has(name) {
		return fallback, nil
	}
	value, err := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get(name)))
	if err != nil || value < minimum || value > maximum {
		return 0, validationError(name + " must be an integer within the supported range")
	}
	return value, nil
}

func portalMailboxIDAllowed(id int64, allowed []int64) bool {
	for _, candidate := range allowed {
		if candidate == id {
			return true
		}
	}
	return false
}
