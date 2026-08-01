package businessapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/mail"
	"strconv"
	"strings"

	mailprovider "github.com/feng123-new/all-Mail/core/internal/provider"
)

type outboundSendRequest struct {
	DomainID      int64    `json:"domainId"`
	MailboxID     *int64   `json:"mailboxId"`
	MailboxUserID *int64   `json:"-"`
	From          string   `json:"from"`
	To            []string `json:"to"`
	Subject       string   `json:"subject"`
	HTML          string   `json:"html"`
	Text          string   `json:"text"`
}

type outboundDeleteRequest struct {
	IDs []json.RawMessage `json:"ids"`
}

type outboundSendStore interface {
	createPendingOutboundMessage(context.Context, int64, *int64, *int64, string, []string, string, string, string) (int64, error)
	completeOutboundMessage(context.Context, int64, string, string, string) (map[string]any, error)
}

func (s *Server) registerSendRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /admin/send/configs", s.withAdministrator(s.listSendConfigurations))
	mux.HandleFunc("DELETE /admin/send/configs/{id}", s.withAdministrator(s.deleteSendConfiguration))
	mux.HandleFunc("GET /admin/send/messages", s.withAdministrator(s.listOutboundMessageHistory))
	mux.HandleFunc("DELETE /admin/send/messages/{id}", s.withAdministrator(s.deleteOutboundMessageHistory))
	mux.HandleFunc("POST /admin/send/messages/batch-delete", s.withAdministrator(s.batchDeleteOutboundMessageHistory))
	mux.HandleFunc("POST /admin/send/messages", s.withAdministratorProvider(s.sendOutboundMessage))
}

func (s *Server) listSendConfigurations(w http.ResponseWriter, r *http.Request, _ Admin) {
	domainID, err := parseOptionalPositiveQueryID(r, "domainId")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	store, err := s.managementStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	result, err := store.listSendConfigs(r.Context(), domainID)
	if err != nil {
		s.writeStoreError(w, r, "list sending configurations", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) deleteSendConfiguration(w http.ResponseWriter, r *http.Request, _ Admin) {
	id, err := parsePositivePathID(r, "id")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	store, err := s.managementStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if err := store.deleteSendConfig(r.Context(), id); err != nil {
		s.writeStoreError(w, r, "delete sending configuration", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]any{"deleted": true, "id": id}})
}

func (s *Server) listOutboundMessageHistory(w http.ResponseWriter, r *http.Request, _ Admin) {
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
	store, err := s.managementStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	result, err := store.listOutboundMessages(r.Context(), page, pageSize, domainID, mailboxID)
	if err != nil {
		s.writeStoreError(w, r, "list outbound messages", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) deleteOutboundMessageHistory(w http.ResponseWriter, r *http.Request, _ Admin) {
	id, err := parsePositivePathID(r, "id")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	s.deleteOutboundMessageIDs(w, r, []int64{id})
}

func (s *Server) batchDeleteOutboundMessageHistory(w http.ResponseWriter, r *http.Request, _ Admin) {
	var body outboundDeleteRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if len(body.IDs) == 0 || len(body.IDs) > 1000 {
		s.writeRequestError(w, r, validationError("ids must contain between 1 and 1000 values"))
		return
	}
	ids := make([]int64, 0, len(body.IDs))
	for _, raw := range body.IDs {
		var numeric int64
		if err := json.Unmarshal(raw, &numeric); err != nil {
			var text string
			if err := json.Unmarshal(raw, &text); err != nil {
				s.writeRequestError(w, r, &requestError{Status: http.StatusBadRequest, Code: "OUTBOUND_MESSAGE_INVALID_ID"})
				return
			}
			parsed, err := strconv.ParseInt(strings.TrimSpace(text), 10, 64)
			if err != nil {
				s.writeRequestError(w, r, &requestError{Status: http.StatusBadRequest, Code: "OUTBOUND_MESSAGE_INVALID_ID"})
				return
			}
			numeric = parsed
		}
		if numeric <= 0 {
			s.writeRequestError(w, r, &requestError{Status: http.StatusBadRequest, Code: "OUTBOUND_MESSAGE_INVALID_ID"})
			return
		}
		ids = append(ids, numeric)
	}
	s.deleteOutboundMessageIDs(w, r, normalizeManagementIDs(ids))
}

func (s *Server) deleteOutboundMessageIDs(w http.ResponseWriter, r *http.Request, ids []int64) {
	store, err := s.managementStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	deleted, err := store.deleteOutboundMessages(r.Context(), ids)
	if err != nil {
		s.writeStoreError(w, r, "delete outbound messages", err)
		return
	}
	stringIDs := make([]string, 0, len(ids))
	for _, id := range ids {
		stringIDs = append(stringIDs, strconv.FormatInt(id, 10))
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]any{"deleted": deleted, "ids": stringIDs}})
}

func (s *Server) sendOutboundMessage(w http.ResponseWriter, r *http.Request, _ Admin) {
	var body outboundSendRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	body.From = strings.ToLower(strings.TrimSpace(body.From))
	if body.DomainID <= 0 || body.MailboxID != nil && *body.MailboxID <= 0 {
		s.writeRequestError(w, r, validationError("domainId and mailboxId must be positive integers"))
		return
	}
	if err := validateEmailAddress(body.From); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	recipients, err := validateRecipientList(body.To)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	body.To = recipients
	body.Subject = strings.TrimSpace(body.Subject)
	if body.Subject == "" || len(body.Subject) > 500 || (strings.TrimSpace(body.HTML) == "" && strings.TrimSpace(body.Text) == "") {
		s.writeRequestError(w, r, validationError("subject and at least one message body are required"))
		return
	}
	store, err := s.managementStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	databaseCtx, cancelDatabase := s.databaseContext(r.Context())
	sendConfig, err := store.loadResendSendConfig(databaseCtx, body.DomainID, body.MailboxID, body.From, s.cfg.EncryptionKey)
	cancelDatabase()
	if err != nil {
		s.writeStoreError(w, r, "load sending configuration", err)
		return
	}
	result, err := s.deliverOutboundMessage(r.Context(), store, sendConfig, body)
	if err != nil {
		s.writeStoreError(w, r, "send outbound message", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) deliverOutboundMessage(
	ctx context.Context,
	store outboundSendStore,
	sendConfig resendSendConfig,
	body outboundSendRequest,
) (map[string]any, error) {
	databaseCtx, cancelDatabase := s.databaseContext(ctx)
	outboundID, err := store.createPendingOutboundMessage(
		databaseCtx, body.DomainID, body.MailboxID, body.MailboxUserID, body.From, body.To, body.Subject, body.HTML, body.Text,
	)
	cancelDatabase()
	if err != nil {
		return nil, fmt.Errorf("create outbound message: %w", err)
	}
	sendResult, sendErr := mailprovider.NewResendClient("https://api.resend.com", s.providerClient()).Send(ctx, sendConfig.APIKey, mailprovider.SendRequest{
		From: formatOutboundFrom(body.From, sendConfig.FromName), To: body.To, Subject: body.Subject,
		HTML: body.HTML, Text: body.Text, ReplyTo: sendConfig.ReplyTo, IdempotencyKey: fmt.Sprintf("outbound-message-%d", outboundID),
	})
	databaseCtx, cancelDatabase = s.databaseContext(context.WithoutCancel(ctx))
	defer cancelDatabase()
	if sendErr != nil {
		message := boundedProviderError(sendErr)
		if _, updateErr := store.completeOutboundMessage(databaseCtx, outboundID, "", "FAILED", message); updateErr != nil {
			return nil, fmt.Errorf("mark outbound message failed: %w", updateErr)
		}
		return nil, &requestError{Status: http.StatusBadGateway, Code: "SEND_FAILED", Cause: sendErr}
	}
	result, err := store.completeOutboundMessage(databaseCtx, outboundID, sendResult.ID, "SENT", "")
	if err != nil {
		return nil, fmt.Errorf("mark outbound message sent: %w", err)
	}
	return result, nil
}

func formatOutboundFrom(address, name string) string {
	if strings.TrimSpace(name) == "" {
		return address
	}
	return (&mail.Address{Name: strings.TrimSpace(name), Address: address}).String()
}
