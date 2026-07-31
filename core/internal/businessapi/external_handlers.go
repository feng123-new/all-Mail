package businessapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

type externalGroupInput struct {
	Group string `json:"group"`
}

type domainSelectorInput struct {
	DomainID json.RawMessage `json:"domainId"`
	Domain   json.RawMessage `json:"domain"`
	BatchTag json.RawMessage `json:"batchTag"`
}

type domainMessageInput struct {
	Email string `json:"email"`
	Limit *int   `json:"limit"`
}

type externalProviderMailInput struct {
	Email   string `json:"email"`
	Mailbox string `json:"mailbox"`
	Socks5  string `json:"socks5"`
	HTTP    string `json:"http"`
	Proxy   providerProxyConfig
}

func (s *Server) registerExternalRoutes(mux *http.ServeMux) {
	for _, path := range []string{"/api/mailboxes/allocate", "/api/get-email"} {
		mux.HandleFunc(path, s.withAPIKey(actionExternalAllocateMailbox, s.allocateExternalEmail))
	}
	for _, path := range []string{"/api/mailboxes", "/api/list-emails"} {
		mux.HandleFunc(path, s.withAPIKey(actionExternalListMailboxes, s.listExternalEmails))
	}
	for _, path := range []string{"/api/mailboxes/allocation-stats", "/api/pool-stats"} {
		mux.HandleFunc(path, s.withAPIKey(actionExternalMailboxAllocationStats, s.externalEmailAllocationStats))
	}
	for _, path := range []string{"/api/mailboxes/allocation-reset", "/api/reset-pool"} {
		mux.HandleFunc(path, s.withAPIKey(actionExternalMailboxAllocationReset, s.resetExternalEmailAllocation))
	}
	for _, path := range []string{"/api/messages/latest", "/api/mail_new"} {
		mux.HandleFunc(path, s.withAPIKeyProvider(actionExternalReadLatestMessage, s.latestExternalProviderMessage))
	}
	for _, path := range []string{"/api/messages", "/api/mail_all"} {
		mux.HandleFunc(path, s.withAPIKeyProvider(actionExternalListMessages, s.listExternalProviderMessages))
	}
	for _, path := range []string{"/api/mailboxes/clear", "/api/process-mailbox"} {
		mux.HandleFunc(path, s.withAPIKeyProvider(actionExternalClearMailbox, s.clearExternalProviderMailbox))
	}

	for _, path := range []string{"/api/domain-mail/mailboxes/allocate", "/api/domain-mail/get-mailbox"} {
		mux.HandleFunc(path, s.withAPIKey(actionDomainAllocateMailbox, s.allocateDomainMailbox))
	}
	for _, path := range []string{"/api/domain-mail/messages/latest", "/api/domain-mail/mail_new"} {
		mux.HandleFunc(path, s.withAPIKey(actionDomainReadLatestMessage, s.latestDomainMessage))
	}
	for _, path := range []string{"/api/domain-mail/messages", "/api/domain-mail/mail_all"} {
		mux.HandleFunc(path, s.withAPIKey(actionDomainListMessages, s.listDomainMessages))
	}
	for _, path := range []string{"/api/domain-mail/mailboxes", "/api/domain-mail/list-mailboxes"} {
		mux.HandleFunc(path, s.withAPIKey(actionDomainListMailboxes, s.listDomainMailboxes))
	}
	for _, path := range []string{"/api/domain-mail/mailboxes/allocation-stats", "/api/domain-mail/pool-stats"} {
		mux.HandleFunc(path, s.withAPIKey(actionDomainMailboxAllocationStats, s.domainMailboxAllocationStats))
	}
	for _, path := range []string{"/api/domain-mail/mailboxes/allocation-reset", "/api/domain-mail/reset-pool"} {
		mux.HandleFunc(path, s.withAPIKey(actionDomainMailboxAllocationReset, s.resetDomainMailboxAllocation))
	}
}

func (s *Server) latestExternalProviderMessage(w http.ResponseWriter, r *http.Request, principal APIKeyPrincipal) {
	s.externalProviderMessages(w, r, principal, actionExternalReadLatestMessage, 1)
}

func (s *Server) listExternalProviderMessages(w http.ResponseWriter, r *http.Request, principal APIKeyPrincipal) {
	s.externalProviderMessages(w, r, principal, actionExternalListMessages, 100)
}

func (s *Server) externalProviderMessages(w http.ResponseWriter, r *http.Request, principal APIKeyPrincipal, action string, limit int) {
	started := time.Now()
	input, err := parseExternalProviderMailInput(r, true)
	if err != nil {
		s.finishExternalError(w, r, principal, action, nil, started, err)
		return
	}
	store, err := s.managementStore()
	if err != nil {
		s.finishExternalError(w, r, principal, action, nil, started, err)
		return
	}
	databaseCtx, cancelDatabase := s.databaseContext(r.Context())
	account, err := store.loadExternalMailAccountCredentials(databaseCtx, principal.ID, input.Email, s.cfg.EncryptionKey)
	cancelDatabase()
	if err != nil {
		s.finishExternalError(w, r, principal, action, nil, started, err)
		return
	}
	if account.Status == "DISABLED" {
		err := &requestError{Status: http.StatusForbidden, Code: "EMAIL_DISABLED"}
		s.finishExternalError(w, r, principal, action, &account.ID, started, err)
		return
	}
	account.Proxy = input.Proxy
	result, err := s.fetchAccountMailbox(r.Context(), account, input.Mailbox, limit, false)
	if err != nil {
		s.finishExternalError(w, r, principal, action, &account.ID, started, err)
		return
	}
	s.logExternalCall(r, principal.ID, &account.ID, action, http.StatusOK, started)
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result, "email": account.Email})
}

func (s *Server) clearExternalProviderMailbox(w http.ResponseWriter, r *http.Request, principal APIKeyPrincipal) {
	started := time.Now()
	input, err := parseExternalProviderMailInput(r, false)
	if err != nil {
		s.finishExternalError(w, r, principal, actionExternalClearMailbox, nil, started, err)
		return
	}
	store, err := s.managementStore()
	if err != nil {
		s.finishExternalError(w, r, principal, actionExternalClearMailbox, nil, started, err)
		return
	}
	databaseCtx, cancelDatabase := s.databaseContext(r.Context())
	account, err := store.loadExternalMailAccountCredentials(databaseCtx, principal.ID, input.Email, s.cfg.EncryptionKey)
	cancelDatabase()
	if err != nil {
		s.finishExternalError(w, r, principal, actionExternalClearMailbox, nil, started, err)
		return
	}
	account.Proxy = input.Proxy
	result, err := s.clearAccountMailbox(r.Context(), account, input.Mailbox)
	if err != nil {
		s.finishExternalError(w, r, principal, actionExternalClearMailbox, &account.ID, started, err)
		return
	}
	s.logExternalCall(r, principal.ID, &account.ID, actionExternalClearMailbox, http.StatusOK, started)
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result, "email": account.Email})
}

func parseExternalProviderMailInput(r *http.Request, allowSent bool) (externalProviderMailInput, error) {
	var input externalProviderMailInput
	if r.Method == http.MethodGet {
		input.Email = strings.TrimSpace(r.URL.Query().Get("email"))
		input.Mailbox = strings.TrimSpace(r.URL.Query().Get("mailbox"))
		input.Socks5 = strings.TrimSpace(r.URL.Query().Get("socks5"))
		input.HTTP = strings.TrimSpace(r.URL.Query().Get("http"))
	} else if err := decodeJSONBody(r, &input); err != nil {
		return input, err
	}
	input.Email = strings.ToLower(strings.TrimSpace(input.Email))
	if err := validateEmailAddress(input.Email); err != nil {
		return input, err
	}
	mailbox, err := validateMailboxName(input.Mailbox, allowSent)
	if err != nil {
		return input, err
	}
	input.Mailbox = mailbox
	proxyConfig, err := normalizeProviderProxyConfig(input.Socks5, input.HTTP)
	if err != nil {
		return input, err
	}
	input.Proxy = proxyConfig
	return input, nil
}

func (s *Server) allocateExternalEmail(w http.ResponseWriter, r *http.Request, principal APIKeyPrincipal) {
	started := time.Now()
	input, err := parseExternalGroupInput(r)
	if err != nil {
		s.finishExternalError(w, r, principal, actionExternalAllocateMailbox, nil, started, err)
		return
	}
	result, err := s.apiKeyStore.AllocateEmail(r.Context(), principal.ID, input.Group)
	if err != nil {
		s.finishExternalError(w, r, principal, actionExternalAllocateMailbox, nil, started, err)
		return
	}
	s.logExternalCall(r, principal.ID, &result.ID, actionExternalAllocateMailbox, http.StatusOK, started)
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) listExternalEmails(w http.ResponseWriter, r *http.Request, principal APIKeyPrincipal) {
	started := time.Now()
	input, err := parseExternalGroupInput(r)
	if err != nil {
		s.finishExternalError(w, r, principal, actionExternalListMailboxes, nil, started, err)
		return
	}
	result, err := s.apiKeyStore.ListExternalMailboxes(r.Context(), principal.ID, input.Group)
	if err != nil {
		s.finishExternalError(w, r, principal, actionExternalListMailboxes, nil, started, err)
		return
	}
	s.logExternalCall(r, principal.ID, nil, actionExternalListMailboxes, http.StatusOK, started)
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) externalEmailAllocationStats(w http.ResponseWriter, r *http.Request, principal APIKeyPrincipal) {
	started := time.Now()
	input, err := parseExternalGroupInput(r)
	if err != nil {
		s.finishExternalError(w, r, principal, actionExternalMailboxAllocationStats, nil, started, err)
		return
	}
	result, err := s.apiKeyStore.EmailAllocationStats(r.Context(), principal.ID, input.Group)
	if err != nil {
		s.finishExternalError(w, r, principal, actionExternalMailboxAllocationStats, nil, started, err)
		return
	}
	s.logExternalCall(r, principal.ID, nil, actionExternalMailboxAllocationStats, http.StatusOK, started)
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) resetExternalEmailAllocation(w http.ResponseWriter, r *http.Request, principal APIKeyPrincipal) {
	started := time.Now()
	input, err := parseExternalGroupInput(r)
	if err != nil {
		s.finishExternalError(w, r, principal, actionExternalMailboxAllocationReset, nil, started, err)
		return
	}
	if err := s.apiKeyStore.ResetEmailAllocations(r.Context(), principal.ID, input.Group); err != nil {
		s.finishExternalError(w, r, principal, actionExternalMailboxAllocationReset, nil, started, err)
		return
	}
	s.logExternalCall(r, principal.ID, nil, actionExternalMailboxAllocationReset, http.StatusOK, started)
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"data":    map[string]any{"code": "EXTERNAL_POOL_RESET", "groupName": nullIfEmpty(input.Group)},
	})
}

func (s *Server) allocateDomainMailbox(w http.ResponseWriter, r *http.Request, principal APIKeyPrincipal) {
	started := time.Now()
	selector, err := parseDomainSelector(r)
	if err != nil {
		s.finishExternalError(w, r, principal, actionDomainAllocateMailbox, nil, started, err)
		return
	}
	result, err := s.domainMailboxStore.AllocateDomainMailbox(r.Context(), principal.ID, selector)
	if err != nil {
		s.finishExternalError(w, r, principal, actionDomainAllocateMailbox, nil, started, err)
		return
	}
	s.logExternalCall(r, principal.ID, nil, actionDomainAllocateMailbox, http.StatusOK, started)
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) latestDomainMessage(w http.ResponseWriter, r *http.Request, principal APIKeyPrincipal) {
	s.domainMessages(w, r, principal, actionDomainReadLatestMessage, 1)
}

func (s *Server) listDomainMessages(w http.ResponseWriter, r *http.Request, principal APIKeyPrincipal) {
	s.domainMessages(w, r, principal, actionDomainListMessages, 20)
}

func (s *Server) domainMessages(w http.ResponseWriter, r *http.Request, principal APIKeyPrincipal, action string, defaultLimit int) {
	started := time.Now()
	input, err := parseDomainMessageInput(r, defaultLimit)
	if err != nil {
		s.finishExternalError(w, r, principal, action, nil, started, err)
		return
	}
	result, err := s.domainMailboxStore.ListDomainMessages(r.Context(), principal.ID, input.Email, *input.Limit)
	if err != nil {
		s.finishExternalError(w, r, principal, action, nil, started, err)
		return
	}
	s.logExternalCall(r, principal.ID, nil, action, http.StatusOK, started)
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result, "email": input.Email})
}

func (s *Server) listDomainMailboxes(w http.ResponseWriter, r *http.Request, principal APIKeyPrincipal) {
	started := time.Now()
	selector, err := parseDomainSelector(r)
	if err != nil {
		s.finishExternalError(w, r, principal, actionDomainListMailboxes, nil, started, err)
		return
	}
	result, err := s.domainMailboxStore.ListDomainMailboxes(r.Context(), principal.ID, selector)
	if err != nil {
		s.finishExternalError(w, r, principal, actionDomainListMailboxes, nil, started, err)
		return
	}
	s.logExternalCall(r, principal.ID, nil, actionDomainListMailboxes, http.StatusOK, started)
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) domainMailboxAllocationStats(w http.ResponseWriter, r *http.Request, principal APIKeyPrincipal) {
	started := time.Now()
	selector, err := parseDomainSelector(r)
	if err != nil {
		s.finishExternalError(w, r, principal, actionDomainMailboxAllocationStats, nil, started, err)
		return
	}
	result, err := s.domainMailboxStore.DomainMailboxAllocationStats(r.Context(), principal.ID, selector)
	if err != nil {
		s.finishExternalError(w, r, principal, actionDomainMailboxAllocationStats, nil, started, err)
		return
	}
	s.logExternalCall(r, principal.ID, nil, actionDomainMailboxAllocationStats, http.StatusOK, started)
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) resetDomainMailboxAllocation(w http.ResponseWriter, r *http.Request, principal APIKeyPrincipal) {
	started := time.Now()
	selector, err := parseDomainSelector(r)
	if err != nil {
		s.finishExternalError(w, r, principal, actionDomainMailboxAllocationReset, nil, started, err)
		return
	}
	deleted, err := s.domainMailboxStore.ResetDomainMailboxAllocations(r.Context(), principal.ID, selector)
	if err != nil {
		s.finishExternalError(w, r, principal, actionDomainMailboxAllocationReset, nil, started, err)
		return
	}
	s.logExternalCall(r, principal.ID, nil, actionDomainMailboxAllocationReset, http.StatusOK, started)
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]any{"success": true, "deletedCount": deleted}})
}

func parseExternalGroupInput(r *http.Request) (externalGroupInput, error) {
	if r.Method == http.MethodGet {
		return externalGroupInput{Group: strings.TrimSpace(r.URL.Query().Get("group"))}, nil
	}
	var input externalGroupInput
	if err := decodeJSONBody(r, &input); err != nil {
		return input, err
	}
	input.Group = strings.TrimSpace(input.Group)
	return input, nil
}

func parseDomainSelector(r *http.Request) (DomainSelector, error) {
	var selector DomainSelector
	if r.Method == http.MethodGet {
		query := r.URL.Query()
		if query.Has("domainId") {
			raw := strings.TrimSpace(query.Get("domainId"))
			if raw == "" {
				return DomainSelector{}, validationError("domainId must be a positive integer")
			}
			value, err := parsePositiveInt64(raw, "domainId")
			if err != nil {
				return DomainSelector{}, err
			}
			selector.DomainID = &value
		}
		if query.Has("domain") {
			selector.Domain = strings.TrimSpace(query.Get("domain"))
			if selector.Domain == "" {
				return DomainSelector{}, validationError("domain must contain at least 1 character")
			}
		}
		if query.Has("batchTag") {
			selector.BatchTag = strings.TrimSpace(query.Get("batchTag"))
			if selector.BatchTag == "" {
				return DomainSelector{}, validationError("batchTag must contain at least 1 character")
			}
		}
		return selector, nil
	}

	var input domainSelectorInput
	if err := decodeRequiredJSONObject(r, &input); err != nil {
		return DomainSelector{}, err
	}
	domainID, err := parseOptionalPositiveJSONID(input.DomainID, "domainId")
	if err != nil {
		return DomainSelector{}, err
	}
	domain, err := parseOptionalNonEmptyJSONString(input.Domain, "domain")
	if err != nil {
		return DomainSelector{}, err
	}
	batchTag, err := parseOptionalNonEmptyJSONString(input.BatchTag, "batchTag")
	if err != nil {
		return DomainSelector{}, err
	}
	return DomainSelector{DomainID: domainID, Domain: domain, BatchTag: batchTag}, nil
}

func parseOptionalNonEmptyJSONString(raw json.RawMessage, name string) (string, error) {
	if len(raw) == 0 {
		return "", nil
	}
	if isJSONNull(raw) {
		return "", validationError(name + " must contain at least 1 character")
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", validationError(name + " must be a string")
	}
	value = strings.TrimSpace(value)
	if value == "" {
		return "", validationError(name + " must contain at least 1 character")
	}
	return value, nil
}

func parseDomainMessageInput(r *http.Request, defaultLimit int) (domainMessageInput, error) {
	var input domainMessageInput
	if r.Method == http.MethodGet {
		input.Email = strings.TrimSpace(r.URL.Query().Get("email"))
		if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
			value, err := parsePositiveInt64(raw, "limit")
			if err != nil || value > 100 {
				return input, validationError("limit must be an integer between 1 and 100")
			}
			converted := int(value)
			input.Limit = &converted
		}
	} else if err := decodeJSONBody(r, &input); err != nil {
		return input, err
	}
	input.Email = strings.TrimSpace(input.Email)
	if err := validateEmailAddress(input.Email); err != nil {
		return input, err
	}
	if input.Limit == nil {
		input.Limit = &defaultLimit
	}
	if *input.Limit < 1 || *input.Limit > 100 {
		return input, validationError("limit must be an integer between 1 and 100")
	}
	return input, nil
}

func (s *Server) finishExternalError(
	w http.ResponseWriter,
	r *http.Request,
	principal APIKeyPrincipal,
	action string,
	emailID *int64,
	started time.Time,
	err error,
) {
	status := statusForError(err)
	s.logExternalCall(r, principal.ID, emailID, action, status, started)
	s.writeStoreError(w, r, action, err)
}

func (s *Server) logExternalCall(r *http.Request, apiKeyID int64, emailID *int64, action string, status int, started time.Time) {
	if s.apiKeyStore == nil {
		return
	}
	elapsed := time.Since(started).Milliseconds()
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), s.cfg.QueryTimeout)
	defer cancel()
	if err := s.apiKeyStore.LogAPICall(ctx, action, &apiKeyID, emailID, requestClientIP(r), status, elapsed, requestID(r)); err != nil {
		s.logger.Error("write external API log", "request_id", requestID(r), "action", action, "error", err)
	}
}

func nullIfEmpty(value string) any {
	if value == "" {
		return nil
	}
	return value
}
