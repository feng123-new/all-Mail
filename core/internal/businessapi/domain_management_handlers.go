package businessapi

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
)

type domainCreator struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
}

type domainSummary struct {
	ID                  int64         `json:"id"`
	Name                string        `json:"name"`
	DisplayName         *string       `json:"displayName"`
	Status              string        `json:"status"`
	CanReceive          bool          `json:"canReceive"`
	CanSend             bool          `json:"canSend"`
	IsCatchAllEnabled   bool          `json:"isCatchAllEnabled"`
	VerificationToken   *string       `json:"verificationToken"`
	ResendDomainID      *string       `json:"resendDomainId"`
	MailboxCount        int64         `json:"mailboxCount"`
	InboundMessageCount int64         `json:"inboundMessageCount"`
	SendingConfigCount  int64         `json:"sendingConfigCount"`
	CreatedBy           domainCreator `json:"createdBy"`
	CreatedAt           string        `json:"createdAt"`
	UpdatedAt           string        `json:"updatedAt"`
}

type domainListResult struct {
	List     []domainSummary `json:"list"`
	Total    int64           `json:"total"`
	Page     int             `json:"page"`
	PageSize int             `json:"pageSize"`
}

type domainMailboxSummary struct {
	ID               int64  `json:"id"`
	Address          string `json:"address"`
	LocalPart        string `json:"localPart"`
	Status           string `json:"status"`
	CanLogin         bool   `json:"canLogin"`
	IsCatchAllTarget bool   `json:"isCatchAllTarget"`
}

type domainSendingConfig struct {
	ID              int64   `json:"id"`
	Provider        string  `json:"provider"`
	FromNameDefault *string `json:"fromNameDefault"`
	ReplyToDefault  *string `json:"replyToDefault"`
	Status          string  `json:"status"`
	CreatedAt       string  `json:"createdAt"`
	UpdatedAt       string  `json:"updatedAt"`
}

type domainDetail struct {
	ID                      int64                          `json:"id"`
	Name                    string                         `json:"name"`
	DisplayName             *string                        `json:"displayName"`
	Status                  string                         `json:"status"`
	Provider                string                         `json:"provider"`
	CanReceive              bool                           `json:"canReceive"`
	CanSend                 bool                           `json:"canSend"`
	IsCatchAllEnabled       bool                           `json:"isCatchAllEnabled"`
	CatchAllTargetMailboxID *int64                         `json:"catchAllTargetMailboxId"`
	VerificationToken       *string                        `json:"verificationToken"`
	DNSStatus               *domainSafeDNSStatus           `json:"dnsStatus"`
	CloudflareValidation    domainCloudflareValidationView `json:"cloudflareValidation"`
	ResendDomainID          *string                        `json:"resendDomainId"`
	CreatedAt               string                         `json:"createdAt"`
	UpdatedAt               string                         `json:"updatedAt"`
	Creator                 domainCreator                  `json:"creator"`
	Mailboxes               []domainMailboxSummary         `json:"mailboxes"`
	SendingConfigs          []domainSendingConfig          `json:"sendingConfigs"`
	InboundMessageCount     int64                          `json:"inboundMessageCount"`
	OutboundMessageCount    int64                          `json:"outboundMessageCount"`
}

type domainVerificationResult struct {
	ID                int64  `json:"id"`
	Name              string `json:"name"`
	VerificationToken string `json:"verificationToken"`
	UpdatedAt         string `json:"updatedAt"`
}

type domainCloudflareConfigResult struct {
	ID                   int64                          `json:"id"`
	UpdatedAt            string                         `json:"updatedAt"`
	DNSStatus            *domainSafeDNSStatus           `json:"dnsStatus"`
	CloudflareValidation domainCloudflareValidationView `json:"cloudflareValidation"`
}

type domainCatchAllResult struct {
	ID                      int64  `json:"id"`
	Name                    string `json:"name"`
	IsCatchAllEnabled       bool   `json:"isCatchAllEnabled"`
	CatchAllTargetMailboxID *int64 `json:"catchAllTargetMailboxId"`
	UpdatedAt               string `json:"updatedAt"`
}

type domainAliasMailbox struct {
	ID      int64  `json:"id"`
	Address string `json:"address"`
	Status  string `json:"status"`
}

type domainAlias struct {
	ID             int64               `json:"id"`
	MailboxID      int64               `json:"mailboxId"`
	AliasLocalPart string              `json:"aliasLocalPart"`
	AliasAddress   string              `json:"aliasAddress"`
	Status         string              `json:"status"`
	CreatedAt      string              `json:"createdAt,omitempty"`
	UpdatedAt      string              `json:"updatedAt,omitempty"`
	Mailbox        *domainAliasMailbox `json:"mailbox,omitempty"`
}

type domainListInput struct {
	Page     int
	PageSize int
	Keyword  string
	Status   string
}

type domainCreateInput struct {
	Name              string
	DisplayName       *string
	CanReceive        bool
	CanSend           bool
	IsCatchAllEnabled bool
}

type domainUpdateInput struct {
	DisplayNamePresent bool
	DisplayName        *string
	Status             *string
	CanReceive         *bool
	CanSend            *bool
	IsCatchAllEnabled  *bool
}

type domainCatchAllInput struct {
	IsCatchAllEnabled       bool
	CatchAllTargetMailboxID *int64
}

type domainSendingConfigInput struct {
	Provider        string
	FromNamePresent bool
	FromNameDefault *string
	ReplyToPresent  bool
	ReplyToDefault  *string
	APIKeyPresent   bool
	APIKey          *string
}

type domainAliasCreateInput struct {
	MailboxID      int64
	AliasLocalPart string
}

type domainManagementStore interface {
	ListDomains(context.Context, domainListInput) (domainListResult, error)
	GetDomain(context.Context, int64) (domainDetail, error)
	CreateDomain(context.Context, domainCreateInput, int64, bool) (domainSummary, error)
	UpdateDomain(context.Context, int64, domainUpdateInput, bool) (domainSummary, error)
	ConfigureDomainVerification(context.Context, int64, *string) (domainVerificationResult, error)
	SaveDomainCloudflareConfig(context.Context, int64, domainCloudflareConfigInput, string) (domainCloudflareConfigResult, error)
	LoadDomainCloudflareValidation(context.Context, int64, string) (domainCloudflareValidationTarget, error)
	SaveDomainCloudflareValidation(context.Context, int64, string, domainCloudflareValidationResult) (domainCloudflareConfigResult, error)
	ConfigureDomainCatchAll(context.Context, int64, domainCatchAllInput) (domainCatchAllResult, error)
	SaveDomainSendingConfig(context.Context, int64, domainSendingConfigInput, string) (domainSendingConfig, error)
	ListDomainAliases(context.Context, int64, *int64) ([]domainAlias, error)
	CreateDomainAlias(context.Context, int64, domainAliasCreateInput) (domainAlias, error)
	UpdateDomainAlias(context.Context, int64, int64, *string) (domainAlias, error)
	DeleteDomainAlias(context.Context, int64, int64) error
	DeleteDomain(context.Context, int64) error
}

type domainJSONField[T any] struct {
	Present bool
	Null    bool
	Value   T
}

func (field *domainJSONField[T]) UnmarshalJSON(raw []byte) error {
	field.Present = true
	if strings.TrimSpace(string(raw)) == "null" {
		field.Null = true
		return nil
	}
	return json.Unmarshal(raw, &field.Value)
}

type domainCreateRequest struct {
	Name              domainJSONField[string] `json:"name"`
	DisplayName       domainJSONField[string] `json:"displayName"`
	CanReceive        domainJSONField[bool]   `json:"canReceive"`
	CanSend           domainJSONField[bool]   `json:"canSend"`
	IsCatchAllEnabled domainJSONField[bool]   `json:"isCatchAllEnabled"`
}

type domainUpdateRequest struct {
	DisplayName       domainJSONField[string] `json:"displayName"`
	Status            domainJSONField[string] `json:"status"`
	CanReceive        domainJSONField[bool]   `json:"canReceive"`
	CanSend           domainJSONField[bool]   `json:"canSend"`
	IsCatchAllEnabled domainJSONField[bool]   `json:"isCatchAllEnabled"`
}

type domainVerificationRequest struct {
	VerificationToken domainJSONField[string] `json:"verificationToken"`
}

type domainCloudflareConfigRequest struct {
	APIToken        domainJSONField[string] `json:"apiToken"`
	ZoneID          domainJSONField[string] `json:"zoneId"`
	ClearSavedToken domainJSONField[bool]   `json:"clearSavedToken"`
}

type domainCatchAllRequest struct {
	IsCatchAllEnabled       domainJSONField[bool]            `json:"isCatchAllEnabled"`
	CatchAllTargetMailboxID domainJSONField[json.RawMessage] `json:"catchAllTargetMailboxId"`
}

type domainSendingConfigRequest struct {
	Provider        domainJSONField[string] `json:"provider"`
	FromNameDefault domainJSONField[string] `json:"fromNameDefault"`
	ReplyToDefault  domainJSONField[string] `json:"replyToDefault"`
	APIKey          domainJSONField[string] `json:"apiKey"`
}

type domainAliasCreateRequest struct {
	MailboxID      json.RawMessage         `json:"mailboxId"`
	AliasLocalPart domainJSONField[string] `json:"aliasLocalPart"`
}

type domainAliasUpdateRequest struct {
	Status domainJSONField[string] `json:"status"`
}

func (s *Server) registerDomainManagementRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /admin/domains", s.withAdministrator(s.listDomains))
	mux.HandleFunc("POST /admin/domains", s.withAdministrator(s.createDomain))
	mux.HandleFunc("GET /admin/domains/{id}", s.withAdministrator(s.getDomain))
	mux.HandleFunc("PATCH /admin/domains/{id}", s.withAdministrator(s.updateDomain))
	mux.HandleFunc("DELETE /admin/domains/{id}", s.withAdministrator(s.deleteDomain))
	mux.HandleFunc("POST /admin/domains/{id}/verify", s.withAdministrator(s.configureDomainVerification))
	mux.HandleFunc("POST /admin/domains/{id}/cloudflare-config", s.withAdministrator(s.saveDomainCloudflareConfig))
	mux.HandleFunc("POST /admin/domains/{id}/cloudflare-validate", s.withAdministratorProvider(s.validateDomainCloudflare))
	mux.HandleFunc("POST /admin/domains/{id}/catch-all", s.withAdministrator(s.configureDomainCatchAll))
	mux.HandleFunc("POST /admin/domains/{id}/sending-config", s.withAdministrator(s.saveDomainSendingConfig))
	mux.HandleFunc("GET /admin/domains/{id}/aliases", s.withAdministrator(s.listDomainAliases))
	mux.HandleFunc("POST /admin/domains/{id}/aliases", s.withAdministrator(s.createDomainAlias))
	mux.HandleFunc("PATCH /admin/domains/{id}/aliases/{aliasId}", s.withAdministrator(s.updateDomainAlias))
	mux.HandleFunc("DELETE /admin/domains/{id}/aliases/{aliasId}", s.withAdministrator(s.deleteDomainAlias))
}

func (s *Server) domainManagementStore() (domainManagementStore, error) {
	store, ok := s.store.(domainManagementStore)
	if !ok || store == nil {
		return nil, &requestError{Status: http.StatusServiceUnavailable, Code: "MANAGEMENT_STORE_UNAVAILABLE"}
	}
	return store, nil
}

func (s *Server) listDomains(w http.ResponseWriter, r *http.Request, _ Admin) {
	store, err := s.domainManagementStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	page, err := parseDomainBoundedQueryInt(r, "page", 1, 1, int(^uint(0)>>1))
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	pageSize, err := parseDomainBoundedQueryInt(r, "pageSize", 20, 1, 100)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	if status != "" {
		if err := validateManagementEnum("status", status, "PENDING", "ACTIVE", "DISABLED", "ERROR"); err != nil {
			s.writeRequestError(w, r, err)
			return
		}
	}
	result, err := store.ListDomains(r.Context(), domainListInput{
		Page: page, PageSize: pageSize, Keyword: strings.TrimSpace(r.URL.Query().Get("keyword")), Status: status,
	})
	if err != nil {
		s.writeStoreError(w, r, "list domains", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) getDomain(w http.ResponseWriter, r *http.Request, _ Admin) {
	store, id, ok := s.domainStoreAndID(w, r, "id")
	if !ok {
		return
	}
	result, err := store.GetDomain(r.Context(), id)
	if err != nil {
		s.writeStoreError(w, r, "get domain", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) createDomain(w http.ResponseWriter, r *http.Request, admin Admin) {
	store, err := s.domainManagementStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	var body domainCreateRequest
	if err := decodeDomainJSONObject(r, &body, false); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	input, err := parseDomainCreate(body)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	canApprove := admin.Role == "SUPER_ADMIN"
	if input.CanSend && !canApprove {
		s.writeRequestError(w, r, &requestError{Status: http.StatusForbidden, Code: "DOMAIN_SEND_APPROVAL_REQUIRED"})
		return
	}
	result, err := store.CreateDomain(r.Context(), input, admin.ID, canApprove)
	if err != nil {
		s.writeStoreError(w, r, "create domain", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) updateDomain(w http.ResponseWriter, r *http.Request, admin Admin) {
	store, id, ok := s.domainStoreAndID(w, r, "id")
	if !ok {
		return
	}
	var body domainUpdateRequest
	if err := decodeDomainJSONObject(r, &body, false); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	input, err := parseDomainUpdate(body)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	result, err := store.UpdateDomain(r.Context(), id, input, admin.Role == "SUPER_ADMIN")
	if err != nil {
		s.writeStoreError(w, r, "update domain", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) configureDomainVerification(w http.ResponseWriter, r *http.Request, _ Admin) {
	store, id, ok := s.domainStoreAndID(w, r, "id")
	if !ok {
		return
	}
	var body domainVerificationRequest
	if err := decodeDomainJSONObject(r, &body, true); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	var token *string
	if body.VerificationToken.Present {
		if body.VerificationToken.Null {
			s.writeRequestError(w, r, validationError("verificationToken must be a string"))
			return
		}
		value := strings.TrimSpace(body.VerificationToken.Value)
		if err := validateTextLength("verificationToken", value, 8, 1<<20); err != nil {
			s.writeRequestError(w, r, err)
			return
		}
		token = &value
	}
	result, err := store.ConfigureDomainVerification(r.Context(), id, token)
	if err != nil {
		s.writeStoreError(w, r, "configure domain verification", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) saveDomainCloudflareConfig(w http.ResponseWriter, r *http.Request, _ Admin) {
	store, id, ok := s.domainStoreAndID(w, r, "id")
	if !ok {
		return
	}
	var body domainCloudflareConfigRequest
	if err := decodeDomainJSONObject(r, &body, true); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	input, err := parseDomainCloudflareConfig(body)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	result, err := store.SaveDomainCloudflareConfig(r.Context(), id, input, s.cfg.EncryptionKey)
	if err != nil {
		s.writeStoreError(w, r, "save domain Cloudflare config", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) validateDomainCloudflare(w http.ResponseWriter, r *http.Request, _ Admin) {
	store, id, ok := s.domainStoreAndID(w, r, "id")
	if !ok {
		return
	}
	databaseCtx, cancelDatabase := s.databaseContext(r.Context())
	target, err := store.LoadDomainCloudflareValidation(databaseCtx, id, s.cfg.EncryptionKey)
	cancelDatabase()
	if err != nil {
		s.writeStoreError(w, r, "load domain Cloudflare config", err)
		return
	}
	result, err := validateCloudflareDomain(r.Context(), s.providerClient(), target, s.now())
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	databaseCtx, cancelDatabase = s.databaseContext(context.WithoutCancel(r.Context()))
	saved, err := store.SaveDomainCloudflareValidation(databaseCtx, id, target.ConfigFingerprint, result)
	cancelDatabase()
	if err != nil {
		s.writeStoreError(w, r, "save domain Cloudflare validation", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": saved})
}

func (s *Server) configureDomainCatchAll(w http.ResponseWriter, r *http.Request, _ Admin) {
	store, id, ok := s.domainStoreAndID(w, r, "id")
	if !ok {
		return
	}
	var body domainCatchAllRequest
	if err := decodeDomainJSONObject(r, &body, false); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if !body.IsCatchAllEnabled.Present || body.IsCatchAllEnabled.Null {
		s.writeRequestError(w, r, validationError("isCatchAllEnabled must be a boolean"))
		return
	}
	var mailboxID *int64
	if body.CatchAllTargetMailboxID.Present {
		if !body.CatchAllTargetMailboxID.Null {
			value, err := coercePositiveDomainID(body.CatchAllTargetMailboxID.Value, "catchAllTargetMailboxId")
			if err != nil {
				s.writeRequestError(w, r, err)
				return
			}
			mailboxID = &value
		}
	}
	result, err := store.ConfigureDomainCatchAll(r.Context(), id, domainCatchAllInput{
		IsCatchAllEnabled: body.IsCatchAllEnabled.Value, CatchAllTargetMailboxID: mailboxID,
	})
	if err != nil {
		s.writeStoreError(w, r, "configure domain catch-all", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) saveDomainSendingConfig(w http.ResponseWriter, r *http.Request, _ Admin) {
	store, id, ok := s.domainStoreAndID(w, r, "id")
	if !ok {
		return
	}
	var body domainSendingConfigRequest
	if err := decodeDomainJSONObject(r, &body, false); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	input, err := parseDomainSendingConfig(body)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	result, err := store.SaveDomainSendingConfig(r.Context(), id, input, s.cfg.EncryptionKey)
	if err != nil {
		s.writeStoreError(w, r, "save domain sending config", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) listDomainAliases(w http.ResponseWriter, r *http.Request, _ Admin) {
	store, id, ok := s.domainStoreAndID(w, r, "id")
	if !ok {
		return
	}
	mailboxID, err := parseOptionalDomainQueryID(r, "mailboxId")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	result, err := store.ListDomainAliases(r.Context(), id, mailboxID)
	if err != nil {
		s.writeStoreError(w, r, "list domain aliases", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) createDomainAlias(w http.ResponseWriter, r *http.Request, _ Admin) {
	store, id, ok := s.domainStoreAndID(w, r, "id")
	if !ok {
		return
	}
	var body domainAliasCreateRequest
	if err := decodeDomainJSONObject(r, &body, false); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	mailboxID, err := coercePositiveDomainID(body.MailboxID, "mailboxId")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if !body.AliasLocalPart.Present || body.AliasLocalPart.Null {
		s.writeRequestError(w, r, validationError("aliasLocalPart must be a string"))
		return
	}
	localPart := strings.ToLower(strings.TrimSpace(body.AliasLocalPart.Value))
	if err := validateTextLength("aliasLocalPart", localPart, 1, 255); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	result, err := store.CreateDomainAlias(r.Context(), id, domainAliasCreateInput{MailboxID: mailboxID, AliasLocalPart: localPart})
	if err != nil {
		s.writeStoreError(w, r, "create domain alias", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) updateDomainAlias(w http.ResponseWriter, r *http.Request, _ Admin) {
	store, id, ok := s.domainStoreAndID(w, r, "id")
	if !ok {
		return
	}
	aliasID, err := parsePositivePathID(r, "aliasId")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	var body domainAliasUpdateRequest
	if err := decodeDomainJSONObject(r, &body, true); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	var status *string
	if body.Status.Present {
		if body.Status.Null {
			s.writeRequestError(w, r, validationError("status must be a string"))
			return
		}
		value := body.Status.Value
		if err := validateManagementEnum("status", value, "ACTIVE", "DISABLED"); err != nil {
			s.writeRequestError(w, r, err)
			return
		}
		status = &value
	}
	result, err := store.UpdateDomainAlias(r.Context(), id, aliasID, status)
	if err != nil {
		s.writeStoreError(w, r, "update domain alias", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) deleteDomainAlias(w http.ResponseWriter, r *http.Request, _ Admin) {
	store, id, ok := s.domainStoreAndID(w, r, "id")
	if !ok {
		return
	}
	aliasID, err := parsePositivePathID(r, "aliasId")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if err := store.DeleteDomainAlias(r.Context(), id, aliasID); err != nil {
		s.writeStoreError(w, r, "delete domain alias", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]bool{"success": true}})
}

func (s *Server) deleteDomain(w http.ResponseWriter, r *http.Request, _ Admin) {
	store, id, ok := s.domainStoreAndID(w, r, "id")
	if !ok {
		return
	}
	if err := store.DeleteDomain(r.Context(), id); err != nil {
		s.writeStoreError(w, r, "delete domain", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]bool{"success": true}})
}

func (s *Server) domainStoreAndID(w http.ResponseWriter, r *http.Request, field string) (domainManagementStore, int64, bool) {
	store, err := s.domainManagementStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return nil, 0, false
	}
	id, err := parsePositivePathID(r, field)
	if err != nil {
		s.writeRequestError(w, r, err)
		return nil, 0, false
	}
	return store, id, true
}

func decodeDomainJSONObject(r *http.Request, target any, optional bool) error {
	var raw json.RawMessage
	if err := decodeJSONBody(r, &raw); err != nil {
		return err
	}
	trimmed := strings.TrimSpace(string(raw))
	if len(raw) == 0 || trimmed == "null" {
		if optional {
			return nil
		}
		return validationError("request body must be a JSON object")
	}
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return validationError("request body must be a JSON object")
	}
	if err := json.Unmarshal(raw, target); err != nil {
		return validationError("request body must be a JSON object")
	}
	return nil
}

func parseDomainCreate(body domainCreateRequest) (domainCreateInput, error) {
	if !body.Name.Present || body.Name.Null {
		return domainCreateInput{}, validationError("name must be a string")
	}
	name := strings.ToLower(strings.TrimSpace(body.Name.Value))
	if err := validateTextLength("name", name, 3, 255); err != nil {
		return domainCreateInput{}, err
	}
	displayName, _, err := domainNullableString(body.DisplayName, "displayName", false, 255)
	if err != nil {
		return domainCreateInput{}, err
	}
	canReceive, err := domainOptionalBool(body.CanReceive, "canReceive", true)
	if err != nil {
		return domainCreateInput{}, err
	}
	canSend, err := domainOptionalBool(body.CanSend, "canSend", false)
	if err != nil {
		return domainCreateInput{}, err
	}
	catchAll, err := domainOptionalBool(body.IsCatchAllEnabled, "isCatchAllEnabled", false)
	if err != nil {
		return domainCreateInput{}, err
	}
	return domainCreateInput{Name: name, DisplayName: displayName, CanReceive: canReceive, CanSend: canSend, IsCatchAllEnabled: catchAll}, nil
}

func parseDomainUpdate(body domainUpdateRequest) (domainUpdateInput, error) {
	displayName, displayPresent, err := domainNullableString(body.DisplayName, "displayName", true, 255)
	if err != nil {
		return domainUpdateInput{}, err
	}
	input := domainUpdateInput{DisplayNamePresent: displayPresent, DisplayName: displayName}
	if body.Status.Present {
		if body.Status.Null {
			return input, validationError("status must be a string")
		}
		value := body.Status.Value
		if err := validateManagementEnum("status", value, "PENDING", "ACTIVE", "DISABLED", "ERROR"); err != nil {
			return input, err
		}
		input.Status = &value
	}
	input.CanReceive, err = domainOptionalBoolPointer(body.CanReceive, "canReceive")
	if err != nil {
		return input, err
	}
	input.CanSend, err = domainOptionalBoolPointer(body.CanSend, "canSend")
	if err != nil {
		return input, err
	}
	input.IsCatchAllEnabled, err = domainOptionalBoolPointer(body.IsCatchAllEnabled, "isCatchAllEnabled")
	return input, err
}

func parseDomainCloudflareConfig(body domainCloudflareConfigRequest) (domainCloudflareConfigInput, error) {
	input := domainCloudflareConfigInput{APITokenPresent: body.APIToken.Present, ZoneIDPresent: body.ZoneID.Present}
	if body.APIToken.Present && !body.APIToken.Null {
		value := strings.TrimSpace(body.APIToken.Value)
		if err := validateTextLength("apiToken", value, 20, 1<<20); err != nil {
			return input, err
		}
		input.APIToken = &value
	}
	if body.ZoneID.Present && !body.ZoneID.Null {
		value := strings.TrimSpace(body.ZoneID.Value)
		if err := validateTextLength("zoneId", value, 8, 1<<20); err != nil {
			return input, err
		}
		input.ZoneID = &value
	}
	if body.ClearSavedToken.Present {
		if body.ClearSavedToken.Null {
			return input, validationError("clearSavedToken must be a boolean")
		}
		input.ClearSavedToken = body.ClearSavedToken.Value
	}
	return input, nil
}

func parseDomainSendingConfig(body domainSendingConfigRequest) (domainSendingConfigInput, error) {
	input := domainSendingConfigInput{Provider: "RESEND"}
	if body.Provider.Present {
		if body.Provider.Null || body.Provider.Value != "RESEND" {
			return input, validationError("provider contains an unsupported value")
		}
	}
	var err error
	input.FromNameDefault, input.FromNamePresent, err = domainNullableString(body.FromNameDefault, "fromNameDefault", true, 255)
	if err != nil {
		return input, err
	}
	if body.ReplyToDefault.Present && !body.ReplyToDefault.Null && strings.TrimSpace(body.ReplyToDefault.Value) == "" {
		return input, validationError("replyToDefault must be a valid email address")
	}
	input.ReplyToDefault, input.ReplyToPresent, err = domainNullableString(body.ReplyToDefault, "replyToDefault", true, 1<<20)
	if err != nil {
		return input, err
	}
	if input.ReplyToDefault != nil {
		if err := validateEmailAddress(*input.ReplyToDefault); err != nil {
			return input, err
		}
	}
	if body.APIKey.Present {
		if body.APIKey.Null {
			return input, validationError("apiKey must be a string")
		}
		value := strings.TrimSpace(body.APIKey.Value)
		if err := validateTextLength("apiKey", value, 8, 1<<20); err != nil {
			return input, err
		}
		input.APIKeyPresent = true
		input.APIKey = &value
	}
	return input, nil
}

func domainNullableString(field domainJSONField[string], name string, nullable bool, maximum int) (*string, bool, error) {
	if !field.Present {
		return nil, false, nil
	}
	if field.Null {
		if nullable {
			return nil, true, nil
		}
		return nil, true, validationError(name + " must be a string")
	}
	value := strings.TrimSpace(field.Value)
	if maximum > 0 && len([]rune(value)) > maximum {
		return nil, true, validationError(fmt.Sprintf("%s must contain at most %d characters", name, maximum))
	}
	if value == "" {
		return nil, true, nil
	}
	return &value, true, nil
}

func domainOptionalBool(field domainJSONField[bool], name string, fallback bool) (bool, error) {
	if !field.Present {
		return fallback, nil
	}
	if field.Null {
		return false, validationError(name + " must be a boolean")
	}
	return field.Value, nil
}

func domainOptionalBoolPointer(field domainJSONField[bool], name string) (*bool, error) {
	if !field.Present {
		return nil, nil
	}
	if field.Null {
		return nil, validationError(name + " must be a boolean")
	}
	value := field.Value
	return &value, nil
}

func coercePositiveDomainID(raw json.RawMessage, name string) (int64, error) {
	if len(raw) == 0 || strings.TrimSpace(string(raw)) == "null" {
		return 0, validationError(name + " must be a positive integer")
	}
	var value any
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.UseNumber()
	if err := decoder.Decode(&value); err != nil {
		return 0, validationError(name + " must be a positive integer")
	}
	var numeric float64
	switch typed := value.(type) {
	case json.Number:
		parsed, err := parseDomainCoercedNumber(string(typed))
		if err != nil {
			return 0, validationError(name + " must be a positive integer")
		}
		numeric = parsed
	case string:
		parsed, err := parseDomainCoercedNumber(typed)
		if err != nil {
			return 0, validationError(name + " must be a positive integer")
		}
		numeric = parsed
	case bool:
		if typed {
			numeric = 1
		}
	default:
		return 0, validationError(name + " must be a positive integer")
	}
	if numeric <= 0 || numeric > math.MaxInt64 || math.Trunc(numeric) != numeric {
		return 0, validationError(name + " must be a positive integer")
	}
	return int64(numeric), nil
}

func parseOptionalDomainQueryID(r *http.Request, name string) (*int64, error) {
	values, present := r.URL.Query()[name]
	if !present || len(values) == 0 {
		return nil, nil
	}
	raw, err := json.Marshal(values[0])
	if err != nil {
		return nil, validationError(name + " must be a positive integer")
	}
	value, err := coercePositiveDomainID(raw, name)
	if err != nil {
		return nil, err
	}
	return &value, nil
}

func parseDomainBoundedQueryInt(r *http.Request, name string, fallback, minimum, maximum int) (int, error) {
	values, present := r.URL.Query()[name]
	if !present || len(values) == 0 {
		return fallback, nil
	}
	numeric, err := parseDomainCoercedNumber(values[0])
	if err != nil || math.IsInf(numeric, 0) || math.IsNaN(numeric) || math.Trunc(numeric) != numeric || numeric < float64(minimum) || numeric > float64(maximum) {
		return 0, validationError(fmt.Sprintf("%s must be an integer between %d and %d", name, minimum, maximum))
	}
	return int(numeric), nil
}

func parseDomainCoercedNumber(raw string) (float64, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return 0, nil
	}
	lower := strings.ToLower(value)
	base := 0
	digits := ""
	switch {
	case strings.HasPrefix(lower, "0x"):
		base, digits = 16, lower[2:]
	case strings.HasPrefix(lower, "0b"):
		base, digits = 2, lower[2:]
	case strings.HasPrefix(lower, "0o"):
		base, digits = 8, lower[2:]
	}
	if base != 0 {
		parsed, err := strconv.ParseUint(digits, base, 64)
		return float64(parsed), err
	}
	return strconv.ParseFloat(value, 64)
}
