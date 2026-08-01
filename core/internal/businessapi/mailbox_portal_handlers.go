package businessapi

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"
)

type mailboxPortalSendRequest struct {
	MailboxID int64    `json:"mailboxId"`
	To        []string `json:"to"`
	Subject   string   `json:"subject"`
	HTML      string   `json:"html"`
	Text      string   `json:"text"`
}

type mailboxPortalForwardingRequest struct {
	MailboxID   int64   `json:"mailboxId"`
	ForwardMode string  `json:"forwardMode"`
	ForwardTo   *string `json:"forwardTo"`
}

func (s *Server) registerMailboxPortalReadRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /mail/api/mailboxes", s.withMailbox(s.mailboxPortalMailboxes))
	mux.HandleFunc("GET /mail/api/messages", s.withMailbox(s.mailboxPortalMessages))
	mux.HandleFunc("GET /mail/api/messages/{id}", s.withMailbox(s.mailboxPortalMessageDetail))
	mux.HandleFunc("GET /mail/api/sent-messages", s.withMailbox(s.mailboxPortalSentMessages))
	mux.HandleFunc("GET /mail/api/forwarding-jobs", s.withMailbox(s.mailboxPortalForwardingJobs))
	mux.HandleFunc("GET /mail/api/sent-messages/{id}", s.withMailbox(s.mailboxPortalSentMessageDetail))
	mux.HandleFunc("POST /mail/api/send", s.withMailboxProvider(s.mailboxPortalSend))
	mux.HandleFunc("POST /mail/api/forwarding", s.withMailbox(s.mailboxPortalUpdateForwarding))
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

func (s *Server) mailboxPortalSentMessages(w http.ResponseWriter, r *http.Request, identity MailboxIdentity) {
	page, err := parseMailboxPortalQueryInt(r, "page", 1, 1, 1_000_000)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	pageSize, err := parseMailboxPortalQueryInt(r, "pageSize", 20, 1, 100)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	mailboxID, err := parseRequiredMailboxPortalID(r, "mailboxId")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if !portalMailboxIDAllowed(mailboxID, identity.MailboxIDs) {
		s.writeRequestError(w, r, &requestError{Status: http.StatusForbidden, Code: "FORBIDDEN_MAILBOX"})
		return
	}
	store, err := s.requireMailboxPortalStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	result, err := store.ListMailboxPortalSentMessages(r.Context(), identity.ID, mailboxID, page, pageSize)
	if err != nil {
		s.writeStoreError(w, r, "list mailbox portal sent messages", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) mailboxPortalForwardingJobs(w http.ResponseWriter, r *http.Request, identity MailboxIdentity) {
	page, err := parseMailboxPortalQueryInt(r, "page", 1, 1, 1_000_000)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	pageSize, err := parseMailboxPortalQueryInt(r, "pageSize", 5, 1, 20)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	mailboxID, err := parseOptionalMailboxPortalID(r, "mailboxId")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if mailboxID != nil && !portalMailboxIDAllowed(*mailboxID, identity.MailboxIDs) {
		s.writeRequestError(w, r, &requestError{Status: http.StatusForbidden, Code: "FORBIDDEN_MAILBOX"})
		return
	}
	store, err := s.requireMailboxPortalStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	result, err := store.ListMailboxPortalForwardingJobs(r.Context(), identity.ID, mailboxID, page, pageSize)
	if err != nil {
		s.writeStoreError(w, r, "list mailbox portal forwarding jobs", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) mailboxPortalSentMessageDetail(w http.ResponseWriter, r *http.Request, identity MailboxIdentity) {
	id, err := strconv.ParseInt(strings.TrimSpace(r.PathValue("id")), 10, 64)
	if err != nil {
		s.writeRequestError(w, r, &requestError{Status: http.StatusBadRequest, Code: "OUTBOUND_MESSAGE_INVALID_ID"})
		return
	}
	store, err := s.requireMailboxPortalStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	message, err := store.GetMailboxPortalSentMessage(r.Context(), id, identity.ID)
	if errors.Is(err, errNotFound) {
		s.writeRequestError(w, r, &requestError{Status: http.StatusNotFound, Code: "OUTBOUND_MESSAGE_NOT_FOUND"})
		return
	}
	if err != nil {
		s.writeStoreError(w, r, "get mailbox portal sent message", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": message})
}

func (s *Server) mailboxPortalSend(w http.ResponseWriter, r *http.Request, identity MailboxIdentity) {
	var body mailboxPortalSendRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if body.MailboxID <= 0 {
		s.writeRequestError(w, r, validationError("mailboxId must be a positive integer"))
		return
	}
	recipients, err := validateRecipientList(body.To)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	body.To = recipients
	body.Subject = strings.TrimSpace(body.Subject)
	body.HTML = strings.TrimSpace(body.HTML)
	body.Text = strings.TrimSpace(body.Text)
	if body.Subject == "" || utf8.RuneCountInString(body.Subject) > 500 {
		s.writeRequestError(w, r, validationError("subject must contain between 1 and 500 characters"))
		return
	}
	if !portalMailboxIDAllowed(body.MailboxID, identity.MailboxIDs) {
		s.writeRequestError(w, r, &requestError{Status: http.StatusForbidden, Code: "FORBIDDEN_MAILBOX"})
		return
	}
	store, err := s.requireMailboxPortalStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	databaseCtx, cancelDatabase := s.databaseContext(r.Context())
	sendConfig, err := store.loadMailboxPortalSendConfig(databaseCtx, identity.ID, body.MailboxID, s.cfg.EncryptionKey)
	cancelDatabase()
	if err != nil {
		s.writeStoreError(w, r, "load mailbox portal sending configuration", err)
		return
	}
	mailboxUserID := identity.ID
	result, err := s.deliverOutboundMessage(r.Context(), store, sendConfig, outboundSendRequest{
		DomainID: sendConfig.DomainID, MailboxID: sendConfig.MailboxID, MailboxUserID: &mailboxUserID, From: sendConfig.MailboxAddress,
		To: body.To, Subject: body.Subject, HTML: body.HTML, Text: body.Text,
	})
	if err != nil {
		s.writeStoreError(w, r, "send mailbox portal outbound message", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) mailboxPortalUpdateForwarding(w http.ResponseWriter, r *http.Request, identity MailboxIdentity) {
	var body mailboxPortalForwardingRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if body.MailboxID <= 0 {
		s.writeRequestError(w, r, validationError("mailboxId must be a positive integer"))
		return
	}
	if err := validateManagementEnum("forwardMode", body.ForwardMode, "DISABLED", "COPY", "MOVE"); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if body.ForwardTo != nil {
		value := strings.TrimSpace(*body.ForwardTo)
		if err := validateEmailAddress(value); err != nil {
			s.writeRequestError(w, r, err)
			return
		}
		body.ForwardTo = &value
	}
	if body.ForwardMode != "DISABLED" && body.ForwardTo == nil {
		s.writeRequestError(w, r, &requestError{Status: http.StatusBadRequest, Code: "FORWARD_TARGET_REQUIRED"})
		return
	}
	if !portalMailboxIDAllowed(body.MailboxID, identity.MailboxIDs) {
		s.writeRequestError(w, r, &requestError{Status: http.StatusForbidden, Code: "FORBIDDEN_MAILBOX"})
		return
	}
	if body.ForwardMode == "DISABLED" {
		body.ForwardTo = nil
	}
	store, err := s.requireMailboxPortalStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	result, err := store.UpdateMailboxPortalForwarding(
		r.Context(), identity.ID, body.MailboxID, body.ForwardMode, body.ForwardTo,
	)
	if err != nil {
		s.writeStoreError(w, r, "update mailbox portal forwarding", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) withMailboxProvider(next func(http.ResponseWriter, *http.Request, MailboxIdentity)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		databaseCtx, cancelDatabase := s.databaseContext(r.Context())
		identity, err := authenticateMailbox(databaseCtx, r, s.mailboxAuthStore, s.cfg.JWTSecret, s.now())
		cancelDatabase()
		if err != nil {
			s.writeRequestError(w, r, err)
			return
		}
		providerCtx, cancelProvider := context.WithTimeout(r.Context(), s.cfg.ProviderTimeout)
		defer cancelProvider()
		next(w, r.WithContext(providerCtx), identity)
	}
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

func parseRequiredMailboxPortalID(r *http.Request, name string) (int64, error) {
	value, err := parseOptionalMailboxPortalID(r, name)
	if err != nil || value == nil {
		if err != nil {
			return 0, err
		}
		return 0, validationError(name + " must be a positive integer")
	}
	return *value, nil
}

func parseOptionalMailboxPortalID(r *http.Request, name string) (*int64, error) {
	if !r.URL.Query().Has(name) {
		return nil, nil
	}
	value, err := strconv.ParseInt(strings.TrimSpace(r.URL.Query().Get(name)), 10, 64)
	if err != nil || value <= 0 {
		return nil, validationError(name + " must be a positive integer")
	}
	return &value, nil
}

func portalMailboxIDAllowed(id int64, allowed []int64) bool {
	for _, candidate := range allowed {
		if candidate == id {
			return true
		}
	}
	return false
}
