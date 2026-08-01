package businessapi

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/feng123-new/all-Mail/core/internal/legacycrypto"
)

type createManagedDomainRequest struct {
	Name              string  `json:"name"`
	DisplayName       *string `json:"displayName"`
	CanReceive        *bool   `json:"canReceive"`
	CanSend           *bool   `json:"canSend"`
	IsCatchAllEnabled *bool   `json:"isCatchAllEnabled"`
}

type updateManagedDomainRequest struct {
	DisplayName       json.RawMessage `json:"displayName"`
	Status            *string         `json:"status"`
	CanReceive        *bool           `json:"canReceive"`
	CanSend           *bool           `json:"canSend"`
	IsCatchAllEnabled *bool           `json:"isCatchAllEnabled"`
}

type configureManagedDomainVerificationRequest struct {
	VerificationToken *string `json:"verificationToken"`
}

type configureManagedDomainCatchAllRequest struct {
	IsCatchAllEnabled       *bool           `json:"isCatchAllEnabled"`
	CatchAllTargetMailboxID json.RawMessage `json:"catchAllTargetMailboxId"`
}

type saveManagedDomainSendingConfigRequest struct {
	Provider        *string         `json:"provider"`
	FromNameDefault json.RawMessage `json:"fromNameDefault"`
	ReplyToDefault  json.RawMessage `json:"replyToDefault"`
	APIKey          *string         `json:"apiKey"`
}

type createManagedMailboxAliasRequest struct {
	MailboxID      int64  `json:"mailboxId"`
	AliasLocalPart string `json:"aliasLocalPart"`
}

type updateManagedMailboxAliasRequest struct {
	Status *string `json:"status"`
}

func (s *Server) registerDomainManagementRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /admin/domains", s.withAdministrator(s.listManagedDomains))
	mux.HandleFunc("POST /admin/domains", s.withAdministrator(s.createManagedDomain))
	mux.HandleFunc("GET /admin/domains/{id}", s.withAdministrator(s.getManagedDomain))
	mux.HandleFunc("PATCH /admin/domains/{id}", s.withAdministrator(s.updateManagedDomain))
	mux.HandleFunc("DELETE /admin/domains/{id}", s.withAdministrator(s.deleteManagedDomain))
	mux.HandleFunc("POST /admin/domains/{id}/verify", s.withAdministrator(s.configureManagedDomainVerification))
	mux.HandleFunc("POST /admin/domains/{id}/cloudflare-config", s.withAdministrator(s.saveManagedDomainCloudflareConfig))
	mux.HandleFunc("POST /admin/domains/{id}/cloudflare-validate", s.withAdministratorProvider(s.validateManagedDomainCloudflare))
	mux.HandleFunc("POST /admin/domains/{id}/catch-all", s.withAdministrator(s.configureManagedDomainCatchAll))
	mux.HandleFunc("POST /admin/domains/{id}/sending-config", s.withAdministrator(s.saveManagedDomainSendingConfig))
	mux.HandleFunc("GET /admin/domains/{id}/aliases", s.withAdministrator(s.listManagedDomainAliases))
	mux.HandleFunc("POST /admin/domains/{id}/aliases", s.withAdministrator(s.createManagedDomainAlias))
	mux.HandleFunc("PATCH /admin/domains/{id}/aliases/{aliasId}", s.withAdministrator(s.updateManagedDomainAlias))
	mux.HandleFunc("DELETE /admin/domains/{id}/aliases/{aliasId}", s.withAdministrator(s.deleteManagedDomainAlias))
}

func (s *Server) listManagedDomains(w http.ResponseWriter, r *http.Request, _ Admin) {
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
	keyword := strings.TrimSpace(r.URL.Query().Get("keyword"))
	if len(keyword) > 255 {
		s.writeRequestError(w, r, validationError("keyword must contain at most 255 characters"))
		return
	}
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	if status != "" {
		if err := validateManagementEnum("status", status, "PENDING", "ACTIVE", "DISABLED", "ERROR"); err != nil {
			s.writeRequestError(w, r, err)
			return
		}
	}
	result, err := store.listManagedDomains(r.Context(), page, pageSize, keyword, status)
	if err != nil {
		s.writeStoreError(w, r, "list domains", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) getManagedDomain(w http.ResponseWriter, r *http.Request, _ Admin) {
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
	result, err := store.getManagedDomain(r.Context(), id)
	if err != nil {
		s.writeStoreError(w, r, "get domain", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) createManagedDomain(w http.ResponseWriter, r *http.Request, admin Admin) {
	store, err := s.managementStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	var body createManagedDomainRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	body.Name = strings.ToLower(strings.TrimSpace(body.Name))
	if err := validateTextLength("name", body.Name, 3, 255); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if body.DisplayName != nil {
		value := strings.TrimSpace(*body.DisplayName)
		body.DisplayName = &value
		if err := validateTextLength("displayName", value, 0, 255); err != nil {
			s.writeRequestError(w, r, err)
			return
		}
	}
	canReceive := true
	if body.CanReceive != nil {
		canReceive = *body.CanReceive
	}
	canSend := false
	if body.CanSend != nil {
		canSend = *body.CanSend
	}
	catchAll := false
	if body.IsCatchAllEnabled != nil {
		catchAll = *body.IsCatchAllEnabled
	}
	if canSend && admin.Role != "SUPER_ADMIN" {
		s.writeRequestError(w, r, &requestError{Status: http.StatusForbidden, Code: "DOMAIN_SEND_APPROVAL_REQUIRED"})
		return
	}
	token, err := newManagedDomainVerificationToken()
	if err != nil {
		s.writeRequestError(w, r, &requestError{Status: http.StatusInternalServerError, Code: "VERIFICATION_TOKEN_GENERATION_FAILED", Cause: err})
		return
	}
	result, err := store.createManagedDomain(r.Context(), managedDomainCreateInput{
		Name: body.Name, DisplayName: normalizeOptionalManagementString(body.DisplayName),
		CanReceive: canReceive, CanSend: canSend, IsCatchAllEnabled: catchAll,
		VerificationToken: token, CreatedByAdminID: admin.ID,
	})
	if err != nil {
		s.writeStoreError(w, r, "create domain", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) updateManagedDomain(w http.ResponseWriter, r *http.Request, admin Admin) {
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
	var body updateManagedDomainRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	displayName, displayNamePresent, err := decodeNullableString(body.DisplayName, "displayName")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if displayName != nil {
		if err := validateTextLength("displayName", *displayName, 0, 255); err != nil {
			s.writeRequestError(w, r, err)
			return
		}
		displayName = normalizeOptionalManagementString(displayName)
	}
	if body.Status != nil {
		*body.Status = strings.TrimSpace(*body.Status)
		if err := validateManagementEnum("status", *body.Status, "PENDING", "ACTIVE", "DISABLED", "ERROR"); err != nil {
			s.writeRequestError(w, r, err)
			return
		}
	}
	result, err := store.updateManagedDomain(r.Context(), id, managedDomainUpdateInput{
		DisplayName: displayName, DisplayNamePresent: displayNamePresent,
		Status: body.Status, CanReceive: body.CanReceive, CanSend: body.CanSend,
		IsCatchAllEnabled: body.IsCatchAllEnabled, CanApproveSend: admin.Role == "SUPER_ADMIN",
	})
	if err != nil {
		s.writeStoreError(w, r, "update domain", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) configureManagedDomainVerification(w http.ResponseWriter, r *http.Request, _ Admin) {
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
	var body configureManagedDomainVerificationRequest
	if err := decodeJSONBody(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	var token string
	if body.VerificationToken != nil {
		token = strings.TrimSpace(*body.VerificationToken)
		if err := validateTextLength("verificationToken", token, 8, 255); err != nil {
			s.writeRequestError(w, r, err)
			return
		}
	} else {
		token, err = newManagedDomainVerificationToken()
		if err != nil {
			s.writeRequestError(w, r, &requestError{Status: http.StatusInternalServerError, Code: "VERIFICATION_TOKEN_GENERATION_FAILED", Cause: err})
			return
		}
	}
	result, err := store.configureManagedDomainVerification(r.Context(), id, token)
	if err != nil {
		s.writeStoreError(w, r, "configure domain verification", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) configureManagedDomainCatchAll(w http.ResponseWriter, r *http.Request, _ Admin) {
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
	var body configureManagedDomainCatchAllRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if body.IsCatchAllEnabled == nil {
		s.writeRequestError(w, r, validationError("isCatchAllEnabled is required"))
		return
	}
	targetID, _, err := decodeNullableInt64(body.CatchAllTargetMailboxID, "catchAllTargetMailboxId")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if *body.IsCatchAllEnabled && targetID == nil {
		s.writeRequestError(w, r, &requestError{Status: http.StatusBadRequest, Code: "CATCH_ALL_TARGET_REQUIRED"})
		return
	}
	result, err := store.configureManagedDomainCatchAll(r.Context(), id, *body.IsCatchAllEnabled, targetID)
	if err != nil {
		s.writeStoreError(w, r, "configure domain catch-all", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) saveManagedDomainSendingConfig(w http.ResponseWriter, r *http.Request, _ Admin) {
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
	var body saveManagedDomainSendingConfigRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	provider := "RESEND"
	if body.Provider != nil {
		provider = strings.TrimSpace(*body.Provider)
	}
	if err := validateManagementEnum("provider", provider, "RESEND"); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	fromName, fromNamePresent, err := decodeNullableString(body.FromNameDefault, "fromNameDefault")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if fromName != nil {
		if err := validateTextLength("fromNameDefault", *fromName, 0, 255); err != nil {
			s.writeRequestError(w, r, err)
			return
		}
		fromName = normalizeOptionalManagementString(fromName)
	}
	replyTo, replyToPresent, err := decodeNullableString(body.ReplyToDefault, "replyToDefault")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if replyTo != nil {
		if *replyTo != "" {
			if err := validateEmailAddress(*replyTo); err != nil {
				s.writeRequestError(w, r, err)
				return
			}
		}
		replyTo = normalizeOptionalManagementString(replyTo)
	}
	var encryptedAPIKey *string
	if body.APIKey != nil {
		value := strings.TrimSpace(*body.APIKey)
		if err := validateTextLength("apiKey", value, 8, 4096); err != nil {
			s.writeRequestError(w, r, err)
			return
		}
		encrypted, err := legacycrypto.Encrypt(s.cfg.EncryptionKey, value)
		if err != nil {
			s.writeRequestError(w, r, &requestError{Status: http.StatusInternalServerError, Code: "SECRET_ENCRYPTION_FAILED", Cause: err})
			return
		}
		encryptedAPIKey = &encrypted
	}
	result, err := store.saveManagedDomainSendingConfig(r.Context(), id, managedDomainSendingConfigInput{
		Provider: provider, EncryptedAPIKey: encryptedAPIKey,
		FromNameDefault: fromName, FromNamePresent: fromNamePresent,
		ReplyToDefault: replyTo, ReplyToPresent: replyToPresent,
	})
	if err != nil {
		s.writeStoreError(w, r, "save domain sending config", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) listManagedDomainAliases(w http.ResponseWriter, r *http.Request, _ Admin) {
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
	mailboxID, err := parseOptionalPositiveQueryID(r, "mailboxId")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	result, err := store.listManagedDomainAliases(r.Context(), id, mailboxID)
	if err != nil {
		s.writeStoreError(w, r, "list domain aliases", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) createManagedDomainAlias(w http.ResponseWriter, r *http.Request, _ Admin) {
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
	var body createManagedMailboxAliasRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if body.MailboxID <= 0 {
		s.writeRequestError(w, r, validationError("mailboxId must be a positive integer"))
		return
	}
	body.AliasLocalPart = strings.ToLower(strings.TrimSpace(body.AliasLocalPart))
	if err := validateTextLength("aliasLocalPart", body.AliasLocalPart, 1, 255); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	result, err := store.createManagedDomainAlias(r.Context(), id, body.MailboxID, body.AliasLocalPart)
	if err != nil {
		s.writeStoreError(w, r, "create domain alias", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) updateManagedDomainAlias(w http.ResponseWriter, r *http.Request, _ Admin) {
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
	aliasID, err := parsePositivePathID(r, "aliasId")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	var body updateManagedMailboxAliasRequest
	if err := decodeJSONBody(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if body.Status != nil {
		*body.Status = strings.TrimSpace(*body.Status)
		if err := validateManagementEnum("status", *body.Status, "ACTIVE", "DISABLED"); err != nil {
			s.writeRequestError(w, r, err)
			return
		}
	}
	result, err := store.updateManagedDomainAlias(r.Context(), id, aliasID, body.Status)
	if err != nil {
		s.writeStoreError(w, r, "update domain alias", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) deleteManagedDomainAlias(w http.ResponseWriter, r *http.Request, _ Admin) {
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
	aliasID, err := parsePositivePathID(r, "aliasId")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if err := store.deleteManagedDomainAlias(r.Context(), id, aliasID); err != nil {
		s.writeStoreError(w, r, "delete domain alias", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]bool{"success": true}})
}

func (s *Server) deleteManagedDomain(w http.ResponseWriter, r *http.Request, _ Admin) {
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
	if err := store.deleteManagedDomain(r.Context(), id); err != nil {
		s.writeStoreError(w, r, "delete domain", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]bool{"success": true}})
}

func newManagedDomainVerificationToken() (string, error) {
	buffer := make([]byte, 12)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return hex.EncodeToString(buffer), nil
}

func normalizeOptionalManagementString(value *string) *string {
	if value == nil {
		return nil
	}
	normalized := strings.TrimSpace(*value)
	if normalized == "" {
		return nil
	}
	return &normalized
}
