package businessapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
)

type createMailAccountRequest struct {
	Email                string          `json:"email"`
	Provider             string          `json:"provider"`
	AuthType             string          `json:"authType"`
	ClientID             *string         `json:"clientId"`
	ClientSecret         *string         `json:"clientSecret"`
	RefreshToken         *string         `json:"refreshToken"`
	Password             *string         `json:"password"`
	AccountLoginPassword *string         `json:"accountLoginPassword"`
	GroupID              *int64          `json:"groupId"`
	ProviderConfig       json.RawMessage `json:"providerConfig"`
	Capabilities         json.RawMessage `json:"capabilities"`
}

type updateMailAccountRequest struct {
	Email                     json.RawMessage `json:"email"`
	Provider                  json.RawMessage `json:"provider"`
	AuthType                  json.RawMessage `json:"authType"`
	ClientID                  json.RawMessage `json:"clientId"`
	ClientSecret              json.RawMessage `json:"clientSecret"`
	RefreshToken              json.RawMessage `json:"refreshToken"`
	Password                  json.RawMessage `json:"password"`
	AccountLoginPassword      json.RawMessage `json:"accountLoginPassword"`
	AccountPasswordGrantToken json.RawMessage `json:"accountPasswordGrantToken"`
	Status                    json.RawMessage `json:"status"`
	GroupID                   json.RawMessage `json:"groupId"`
	ProviderConfig            json.RawMessage `json:"providerConfig"`
	Capabilities              json.RawMessage `json:"capabilities"`
}

type mailAccountIDsRequest struct {
	IDs []int64 `json:"ids"`
}

type batchMailOperationRequest struct {
	IDs                    []int64  `json:"ids"`
	Status                 string   `json:"status"`
	Keyword                string   `json:"keyword"`
	GroupID                *int64   `json:"groupId"`
	GroupName              string   `json:"groupName"`
	Provider               string   `json:"provider"`
	RepresentativeProtocol string   `json:"representativeProtocol"`
	Mailboxes              []string `json:"mailboxes"`
	Mailbox                string   `json:"mailbox"`
}

type selectedMailDeleteRequest struct {
	Mailbox    string   `json:"mailbox"`
	MessageIDs []string `json:"messageIds"`
}

type accountSendRequest struct {
	FromName string   `json:"fromName"`
	To       []string `json:"to"`
	Subject  string   `json:"subject"`
	Text     string   `json:"text"`
	HTML     string   `json:"html"`
}

type clearMailAccountRequest struct {
	Mailbox string `json:"mailbox"`
}

type importMailAccountsRequest struct {
	Content   string `json:"content"`
	Separator string `json:"separator"`
	GroupID   *int64 `json:"groupId"`
}

func (s *Server) registerMailAccountRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /admin/emails", s.withAdministrator(s.listMailAccounts))
	mux.HandleFunc("GET /admin/emails/stats", s.withAdministrator(s.mailAccountStats))
	mux.HandleFunc("POST /admin/emails/reveal-unlock", s.withAdministrator(s.revealMailAccountUnlock))
	mux.HandleFunc("POST /admin/emails/{id}/reveal-secrets", s.withAdministrator(s.revealMailAccountSecrets))
	mux.HandleFunc("GET /admin/emails/{id}", s.withAdministrator(s.getMailAccount))
	mux.HandleFunc("POST /admin/emails", s.withAdministrator(s.createMailAccount))
	mux.HandleFunc("PUT /admin/emails/{id}", s.withAdministrator(s.updateMailAccount))
	mux.HandleFunc("DELETE /admin/emails/{id}", s.withAdministrator(s.deleteMailAccount))
	mux.HandleFunc("POST /admin/emails/batch-delete", s.withAdministrator(s.batchDeleteMailAccounts))
	mux.HandleFunc("POST /admin/emails/batch-fetch-mails", s.withAdministratorProvider(s.batchFetchMailAccounts))
	mux.HandleFunc("POST /admin/emails/batch-clear-mailbox", s.withAdministratorProvider(s.batchClearMailAccounts))
	mux.HandleFunc("POST /admin/emails/import", s.withAdministrator(s.importMailAccounts))
	mux.HandleFunc("GET /admin/emails/export", s.withSuperAdministrator(s.exportMailAccounts))
	mux.HandleFunc("GET /admin/emails/{id}/mails", s.withAdministratorProvider(s.fetchMailAccountMessages))
	mux.HandleFunc("POST /admin/emails/{id}/mails/delete", s.withAdministratorProvider(s.deleteMailAccountMessages))
	mux.HandleFunc("POST /admin/emails/{id}/send", s.withAdministratorProvider(s.sendMailAccountMessage))
	mux.HandleFunc("POST /admin/emails/{id}/clear", s.withAdministratorProvider(s.clearMailAccountMailbox))
}

func (s *Server) listMailAccounts(w http.ResponseWriter, r *http.Request, _ Admin) {
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
	groupID, err := parseOptionalPositiveQueryID(r, "groupId")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	provider := strings.TrimSpace(r.URL.Query().Get("provider"))
	representative := strings.TrimSpace(r.URL.Query().Get("representativeProtocol"))
	if status != "" {
		if err := validateManagementEnum("status", status, "ACTIVE", "ERROR", "DISABLED"); err != nil {
			s.writeRequestError(w, r, err)
			return
		}
	}
	if provider != "" {
		if err := validateMailProvider(provider); err != nil {
			s.writeRequestError(w, r, err)
			return
		}
	}
	if representative != "" {
		if err := validateManagementEnum("representativeProtocol", representative, "oauth_api", "imap_smtp"); err != nil {
			s.writeRequestError(w, r, err)
			return
		}
	}
	result, err := store.listMailAccounts(
		r.Context(), page, pageSize, status, strings.TrimSpace(r.URL.Query().Get("keyword")),
		groupID, strings.TrimSpace(r.URL.Query().Get("groupName")), provider, representative,
	)
	if err != nil {
		s.writeStoreError(w, r, "list mail accounts", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) mailAccountStats(w http.ResponseWriter, r *http.Request, _ Admin) {
	store, err := s.managementStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	result, err := store.mailAccountStats(r.Context())
	if err != nil {
		s.writeStoreError(w, r, "query mail account statistics", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) getMailAccount(w http.ResponseWriter, r *http.Request, _ Admin) {
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
	result, err := store.getMailAccount(r.Context(), id)
	if err != nil {
		s.writeStoreError(w, r, "get mail account", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) createMailAccount(w http.ResponseWriter, r *http.Request, _ Admin) {
	store, err := s.managementStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	var body createMailAccountRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	input, err := parseCreateMailAccount(body)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	result, err := store.createMailAccount(r.Context(), input, s.cfg.EncryptionKey)
	if err != nil {
		s.writeStoreError(w, r, "create mail account", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) updateMailAccount(w http.ResponseWriter, r *http.Request, admin Admin) {
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
	var body updateMailAccountRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	input, err := parseUpdateMailAccount(body)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if input.AccountLoginPasswordPresent {
		grantToken, present, err := decodeNullableString(body.AccountPasswordGrantToken, "accountPasswordGrantToken")
		if err != nil {
			s.writeRequestError(w, r, err)
			return
		}
		if !present || grantToken == nil || strings.TrimSpace(*grantToken) == "" {
			s.writeRequestError(w, r, &requestError{Status: http.StatusForbidden, Code: "ACCOUNT_LOGIN_PASSWORD_GRANT_REQUIRED"})
			return
		}
		if err := verifyAdminRevealGrant(*grantToken, admin, s.cfg.JWTSecret, s.now()); err != nil {
			s.writeRequestError(w, r, err)
			return
		}
	}
	result, err := store.updateMailAccount(r.Context(), id, input, s.cfg.EncryptionKey)
	if err != nil {
		s.writeStoreError(w, r, "update mail account", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) deleteMailAccount(w http.ResponseWriter, r *http.Request, _ Admin) {
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
	if err := store.deleteMailAccount(r.Context(), id); err != nil {
		s.writeStoreError(w, r, "delete mail account", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]bool{"success": true}})
}

func (s *Server) batchDeleteMailAccounts(w http.ResponseWriter, r *http.Request, _ Admin) {
	store, err := s.managementStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	var body mailAccountIDsRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if len(body.IDs) == 0 || len(body.IDs) > 1000 {
		s.writeRequestError(w, r, validationError("ids must contain between 1 and 1000 positive integers"))
		return
	}
	if err := requirePositiveIDs(body.IDs, "ids"); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	deleted, err := store.batchDeleteMailAccounts(r.Context(), body.IDs)
	if err != nil {
		s.writeStoreError(w, r, "batch delete mail accounts", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]int64{"deleted": deleted}})
}

func (s *Server) fetchMailAccountMessages(w http.ResponseWriter, r *http.Request, _ Admin) {
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
	mailbox, err := validateMailboxName(r.URL.Query().Get("mailbox"), true)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	limit, err := parseBoundedQueryInt(r, "limit", 100, 1, 100)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	markAsSeen := strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("markAsSeen")), "true")
	account, err := s.loadProviderMailAccount(r.Context(), store, id)
	if err != nil {
		s.writeStoreError(w, r, "load mail account", err)
		return
	}
	if account.Status == "DISABLED" {
		s.writeRequestError(w, r, &requestError{Status: http.StatusForbidden, Code: "EMAIL_DISABLED"})
		return
	}
	result, err := s.fetchAccountMailbox(r.Context(), account, mailbox, limit, markAsSeen)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) deleteMailAccountMessages(w http.ResponseWriter, r *http.Request, _ Admin) {
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
	var body selectedMailDeleteRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	mailbox, err := validateMailboxName(body.Mailbox, true)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if len(body.MessageIDs) == 0 || len(body.MessageIDs) > 1000 {
		s.writeRequestError(w, r, validationError("messageIds must contain between 1 and 1000 values"))
		return
	}
	account, err := s.loadProviderMailAccount(r.Context(), store, id)
	if err != nil {
		s.writeStoreError(w, r, "load mail account", err)
		return
	}
	result, err := s.deleteAccountMessages(r.Context(), account, mailbox, normalizeManagementStrings(body.MessageIDs))
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	remaining, err := s.fetchAccountMailbox(r.Context(), account, mailbox, 100, true)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]any{
		"email": result.Email, "mailbox": result.Mailbox, "resolvedMailbox": result.ResolvedMailbox,
		"deletedCount": result.DeletedCount, "mailboxCheckpoint": remaining.MailboxCheckpoint,
		"method": result.Method, "provider": result.Provider,
		"messages": remaining.Messages, "remainingCount": remaining.Count,
	}})
}

func (s *Server) sendMailAccountMessage(w http.ResponseWriter, r *http.Request, _ Admin) {
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
	var body accountSendRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	body.To, err = validateRecipientList(body.To)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	body.Subject = strings.TrimSpace(body.Subject)
	if body.Subject == "" || len(body.Subject) > 500 || (strings.TrimSpace(body.Text) == "" && strings.TrimSpace(body.HTML) == "") {
		s.writeRequestError(w, r, validationError("subject and at least one message body are required"))
		return
	}
	account, err := s.loadProviderMailAccount(r.Context(), store, id)
	if err != nil {
		s.writeStoreError(w, r, "load mail account", err)
		return
	}
	result, err := s.sendAccountMessage(r.Context(), account, providerSendInput{
		FromEmail: account.Email, FromName: strings.TrimSpace(body.FromName), To: body.To,
		Subject: body.Subject, Text: body.Text, HTML: body.HTML,
	})
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) clearMailAccountMailbox(w http.ResponseWriter, r *http.Request, _ Admin) {
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
	var body clearMailAccountRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	mailbox, err := validateMailboxName(body.Mailbox, false)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	account, err := s.loadProviderMailAccount(r.Context(), store, id)
	if err != nil {
		s.writeStoreError(w, r, "load mail account", err)
		return
	}
	result, err := s.clearAccountMailbox(r.Context(), account, mailbox)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) batchFetchMailAccounts(w http.ResponseWriter, r *http.Request, _ Admin) {
	s.batchMailAccountOperation(w, r, false)
}

func (s *Server) batchClearMailAccounts(w http.ResponseWriter, r *http.Request, _ Admin) {
	s.batchMailAccountOperation(w, r, true)
}

func (s *Server) batchMailAccountOperation(w http.ResponseWriter, r *http.Request, clear bool) {
	store, err := s.managementStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	var body batchMailOperationRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	databaseCtx, cancelDatabase := s.databaseContext(r.Context())
	ids, err := store.selectMailAccountIDs(databaseCtx, body)
	cancelDatabase()
	if err != nil {
		s.writeStoreError(w, r, "select mail accounts", err)
		return
	}
	if len(ids) > 500 {
		s.writeRequestError(w, r, validationError("batch operation matches more than 500 accounts"))
		return
	}
	mailboxes := body.Mailboxes
	if clear {
		mailbox, err := validateMailboxName(body.Mailbox, false)
		if err != nil {
			s.writeRequestError(w, r, err)
			return
		}
		mailboxes = []string{mailbox}
	} else {
		if len(mailboxes) == 0 {
			mailboxes = []string{"INBOX", "SENT", "Junk"}
		}
		validated := make([]string, 0, len(mailboxes))
		seen := make(map[string]struct{}, len(mailboxes))
		for _, rawMailbox := range mailboxes {
			mailbox, err := validateMailboxName(rawMailbox, true)
			if err != nil {
				s.writeRequestError(w, r, err)
				return
			}
			if _, duplicate := seen[mailbox]; duplicate {
				continue
			}
			seen[mailbox] = struct{}{}
			validated = append(validated, mailbox)
		}
		mailboxes = validated
	}
	results := make([]map[string]any, 0, len(ids))
	successCount := 0
	partialCount := 0
	errorCount := 0
	skippedCount := 0
	deletedCount := 0
	for _, id := range ids {
		account, err := s.loadProviderMailAccount(r.Context(), store, id)
		if err != nil {
			errorCount++
			results = append(results, map[string]any{
				"id": id, "status": "error", "code": requestErrorCode(err, "MAIL_ACCOUNT_LOAD_FAILED"), "mailboxResults": []any{},
			})
			continue
		}
		if account.Status == "DISABLED" {
			skippedCount++
			results = append(results, map[string]any{
				"id": id, "email": account.Email, "status": "skipped", "code": "EMAIL_TARGET_DISABLED", "deletedCount": 0, "mailboxResults": []any{},
			})
			continue
		}
		if clear {
			if !mailAccountSupportsClear(account) {
				skippedCount++
				results = append(results, map[string]any{
					"id": id, "email": account.Email, "status": "skipped", "code": "MAILBOX_CLEAR_UNSUPPORTED", "deletedCount": 0, "mailboxResults": []any{},
				})
				continue
			}
			result, err := s.clearAccountMailbox(r.Context(), account, mailboxes[0])
			if err != nil {
				errorCount++
				results = append(results, map[string]any{
					"id": id, "email": account.Email, "status": "error", "code": requestErrorCode(err, "MAILBOX_CLEAR_FAILED"), "deletedCount": 0,
				})
				continue
			}
			deletedCount += result.DeletedCount
			successCount++
			results = append(results, map[string]any{
				"id": id, "email": account.Email, "status": "success", "code": "MAILBOX_CLEAR_SUCCESS", "deletedCount": result.DeletedCount,
			})
			continue
		}

		mailboxResults := make([]any, 0, len(mailboxes))
		mailboxSuccesses := 0
		for _, mailbox := range mailboxes {
			result, err := s.fetchAccountMailbox(r.Context(), account, mailbox, 100, false)
			if err != nil {
				mailboxResults = append(mailboxResults, map[string]any{
					"mailbox": mailbox, "status": "error", "code": requestErrorCode(err, "MAILBOX_FETCH_FAILED"),
				})
				continue
			}
			mailboxSuccesses++
			mailboxResults = append(mailboxResults, map[string]any{
				"mailbox": mailbox, "status": "success", "count": result.Count,
			})
		}
		status, code := "error", "EMAIL_BATCH_FETCH_FAILED"
		switch {
		case mailboxSuccesses == len(mailboxes):
			status, code = "success", "EMAIL_BATCH_FETCH_SUCCESS"
			successCount++
		case mailboxSuccesses > 0:
			status, code = "partial", "EMAIL_BATCH_FETCH_PARTIAL"
			partialCount++
		default:
			errorCount++
		}
		if mailboxSuccesses > 0 {
			databaseCtx, cancelDatabase := s.databaseContext(context.WithoutCancel(r.Context()))
			if err := store.updateMailAccountHealth(databaseCtx, account.ID, true, ""); err != nil {
				s.logger.Error("persist batch mailbox health", "request_id", requestID(r), "account_id", account.ID, "error", err)
			}
			cancelDatabase()
		}
		results = append(results, map[string]any{
			"id": id, "email": account.Email, "status": status, "code": code, "mailboxResults": mailboxResults,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]any{
		"targeted": len(ids), "deletedCount": deletedCount, "successCount": successCount,
		"partialCount": partialCount, "errorCount": errorCount, "skippedCount": skippedCount, "results": results,
	}})
}

func requestErrorCode(err error, fallback string) string {
	var requestErr *requestError
	if errors.As(err, &requestErr) && strings.TrimSpace(requestErr.Code) != "" {
		return requestErr.Code
	}
	return fallback
}

func (s *Server) loadProviderMailAccount(ctx context.Context, store *PostgresStore, id int64) (mailAccountCredentials, error) {
	databaseCtx, cancel := s.databaseContext(ctx)
	defer cancel()
	return store.loadMailAccountCredentials(databaseCtx, id, s.cfg.EncryptionKey)
}

func parseCreateMailAccount(body createMailAccountRequest) (mailAccountCreateInput, error) {
	body.Email = strings.ToLower(strings.TrimSpace(body.Email))
	if err := validateEmailAddress(body.Email); err != nil {
		return mailAccountCreateInput{}, err
	}
	if body.Provider == "" {
		body.Provider = "OUTLOOK"
	}
	if err := validateMailProvider(body.Provider); err != nil {
		return mailAccountCreateInput{}, err
	}
	if body.AuthType == "" {
		body.AuthType = defaultMailAuthType(body.Provider)
	}
	if err := validateMailAuthType(body.AuthType); err != nil {
		return mailAccountCreateInput{}, err
	}
	config, err := mergeProviderConfig(body.Provider, body.ProviderConfig)
	if err != nil {
		return mailAccountCreateInput{}, err
	}
	if err := validateMailAccountProfile(body.Provider, body.AuthType, config); err != nil {
		return mailAccountCreateInput{}, err
	}
	capabilities, err := decodeJSONObject(body.Capabilities, "capabilities")
	if err != nil {
		return mailAccountCreateInput{}, err
	}
	return mailAccountCreateInput{
		Email: body.Email, Provider: body.Provider, AuthType: body.AuthType,
		ClientID: cleanOptionalString(body.ClientID), ClientSecret: cleanOptionalString(body.ClientSecret),
		RefreshToken: cleanOptionalString(body.RefreshToken), Password: cleanOptionalString(body.Password),
		AccountLoginPassword: cleanOptionalString(body.AccountLoginPassword), GroupID: body.GroupID,
		ProviderConfig: config, Capabilities: capabilities,
	}, nil
}

func parseUpdateMailAccount(body updateMailAccountRequest) (mailAccountUpdateInput, error) {
	var result mailAccountUpdateInput
	var err error
	if value, present, parseErr := decodeNullableString(body.Email, "email"); parseErr != nil {
		return result, parseErr
	} else if present {
		if value == nil {
			return result, validationError("email cannot be null")
		}
		result.EmailPresent, result.Email = true, strings.ToLower(*value)
		if err := validateEmailAddress(result.Email); err != nil {
			return result, err
		}
	}
	if value, present, parseErr := decodeNullableString(body.Provider, "provider"); parseErr != nil {
		return result, parseErr
	} else if present {
		if value == nil {
			return result, validationError("provider cannot be null")
		}
		result.ProviderPresent, result.Provider = true, *value
		if err := validateMailProvider(result.Provider); err != nil {
			return result, err
		}
	}
	if value, present, parseErr := decodeNullableString(body.AuthType, "authType"); parseErr != nil {
		return result, parseErr
	} else if present {
		if value == nil {
			return result, validationError("authType cannot be null")
		}
		result.AuthTypePresent, result.AuthType = true, *value
		if err := validateMailAuthType(result.AuthType); err != nil {
			return result, err
		}
	}
	result.ClientID, result.ClientIDPresent, err = decodeNullableString(body.ClientID, "clientId")
	if err != nil {
		return result, err
	}
	result.ClientSecret, result.ClientSecretPresent, err = decodeNullableString(body.ClientSecret, "clientSecret")
	if err != nil {
		return result, err
	}
	result.RefreshToken, result.RefreshTokenPresent, err = decodeNullableString(body.RefreshToken, "refreshToken")
	if err != nil {
		return result, err
	}
	result.Password, result.PasswordPresent, err = decodeNullableString(body.Password, "password")
	if err != nil {
		return result, err
	}
	result.AccountLoginPassword, result.AccountLoginPasswordPresent, err = decodeNullableString(body.AccountLoginPassword, "accountLoginPassword")
	if err != nil {
		return result, err
	}
	if value, present, parseErr := decodeNullableString(body.Status, "status"); parseErr != nil {
		return result, parseErr
	} else if present {
		if value == nil {
			return result, validationError("status cannot be null")
		}
		result.StatusPresent, result.Status = true, *value
		if err := validateManagementEnum("status", result.Status, "ACTIVE", "ERROR", "DISABLED"); err != nil {
			return result, err
		}
	}
	result.GroupID, result.GroupIDPresent, err = decodeNullableInt64(body.GroupID, "groupId")
	if err != nil {
		return result, err
	}
	if len(body.ProviderConfig) > 0 {
		result.ProviderConfigPresent = true
		if strings.TrimSpace(string(body.ProviderConfig)) == "null" {
			result.ProviderConfigRaw = json.RawMessage(`{}`)
		} else {
			var object map[string]any
			if err := json.Unmarshal(body.ProviderConfig, &object); err != nil || object == nil {
				return result, validationError("providerConfig must be a JSON object or null")
			}
			result.ProviderConfigRaw = append(json.RawMessage(nil), body.ProviderConfig...)
		}
	}
	if len(body.Capabilities) > 0 {
		result.CapabilitiesPresent = true
		result.Capabilities, err = decodeJSONObject(body.Capabilities, "capabilities")
		if err != nil {
			return result, err
		}
	}
	return result, nil
}

func decodeJSONObject(raw json.RawMessage, field string) (map[string]any, error) {
	if len(raw) == 0 || strings.TrimSpace(string(raw)) == "null" {
		return map[string]any{}, nil
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil || value == nil {
		return nil, validationError(field + " must be a JSON object")
	}
	return value, nil
}

func cleanOptionalString(value *string) *string {
	if value == nil {
		return nil
	}
	cleaned := strings.TrimSpace(*value)
	if cleaned == "" {
		return nil
	}
	return &cleaned
}

func validateMailboxName(value string, allowSent bool) (string, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "inbox":
		return "INBOX", nil
	case "junk", "spam":
		return "Junk", nil
	case "sent":
		if allowSent {
			return "SENT", nil
		}
	}
	return "", validationError("mailbox contains an unsupported value")
}

func validateRecipientList(values []string) ([]string, error) {
	values = normalizeManagementStrings(values)
	if len(values) == 0 || len(values) > 100 {
		return nil, validationError("to must contain between 1 and 100 email addresses")
	}
	for _, value := range values {
		if err := validateEmailAddress(value); err != nil {
			return nil, err
		}
	}
	return values, nil
}

func (s *PostgresStore) selectMailAccountIDs(ctx context.Context, input batchMailOperationRequest) ([]int64, error) {
	if err := requirePositiveIDs(input.IDs, "ids"); err != nil {
		return nil, err
	}
	var groupFilter any
	if input.GroupID != nil {
		groupFilter = *input.GroupID
	}
	rows, err := s.pool.Query(ctx, `
		SELECT account.id
		FROM email_accounts AS account
		LEFT JOIN email_groups AS group_row ON group_row.id = account.group_id
		WHERE (COALESCE(cardinality($1::int[]), 0) = 0 OR account.id = ANY($1::int[]))
		  AND ($2 = '' OR account.status::text = $2)
		  AND ($3 = '' OR account.email ILIKE '%' || $3 || '%')
		  AND ($4::bigint IS NULL OR account.group_id = $4)
		  AND ($5 = '' OR group_row.name = $5)
		  AND ($6 = '' OR account.provider::text = $6)
		  AND ($7 = '' OR CASE WHEN account.auth_type IN ('MICROSOFT_OAUTH'::"MailAuthType", 'GOOGLE_OAUTH'::"MailAuthType") THEN 'oauth_api' ELSE 'imap_smtp' END = $7)
		ORDER BY account.id ASC
	`, normalizeManagementIDs(input.IDs), input.Status, strings.TrimSpace(input.Keyword), groupFilter,
		strings.TrimSpace(input.GroupName), strings.TrimSpace(input.Provider), strings.TrimSpace(input.RepresentativeProtocol))
	if err != nil {
		return nil, fmt.Errorf("select mail accounts: %w", err)
	}
	defer rows.Close()
	ids := make([]int64, 0)
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func parseInt64(value string) (*int64, error) {
	if strings.TrimSpace(value) == "" {
		return nil, nil
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil || parsed <= 0 {
		return nil, validationError("value must be a positive integer")
	}
	return &parsed, nil
}
