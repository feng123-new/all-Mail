package businessapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type managedDomainMailboxCreateInput struct {
	DomainID         int64
	LocalPart        string
	DisplayName      *string
	CanLogin         bool
	ProvisioningMode string
	BatchTag         *string
	QuotaMB          *int64
	PasswordHash     *string
	OwnerUserID      *int64
	MemberUserIDs    []int64
	ForwardMode      string
	ForwardTo        *string
}

type managedDomainMailboxBatchCreateInput struct {
	managedDomainMailboxCreateInput
	LocalParts    []string
	BindAPIKeyIDs []int64
}

type managedDomainMailboxUpdateInput struct {
	DisplayNamePresent      bool
	DisplayName             *string
	Status                  *string
	CanLogin                *bool
	ProvisioningMode        *string
	BatchTagPresent         bool
	BatchTag                *string
	QuotaMBPresent          bool
	QuotaMB                 *int64
	PasswordPresent         bool
	PasswordHash            *string
	OwnerUserIDPresent      bool
	OwnerUserID             *int64
	MemberUserIDsPresent    bool
	MemberUserIDs           []int64
	ForwardMode             *string
	ForwardToPresent        bool
	ForwardTo               *string
}

type managedDomainMailboxBatchDeleteInput struct {
	IDs              []int64
	DomainID         *int64
	BatchTag         *string
	ProvisioningMode *string
}

type createDomainMailboxManagementRequest struct {
	DomainID         int64           `json:"domainId"`
	LocalPart        string          `json:"localPart"`
	DisplayName      json.RawMessage `json:"displayName"`
	CanLogin         *bool           `json:"canLogin"`
	ProvisioningMode string          `json:"provisioningMode"`
	BatchTag         json.RawMessage `json:"batchTag"`
	QuotaMB          *int64          `json:"quotaMb"`
	Password         *string         `json:"password"`
	OwnerUserID      *int64          `json:"ownerUserId"`
	MemberUserIDs    []int64         `json:"memberUserIds"`
	ForwardMode      string          `json:"forwardMode"`
	ForwardTo        json.RawMessage `json:"forwardTo"`
}

type batchCreateDomainMailboxManagementRequest struct {
	DomainID         int64           `json:"domainId"`
	LocalParts       []string        `json:"localParts"`
	Prefix           *string         `json:"prefix"`
	Count            *int            `json:"count"`
	StartFrom        *int            `json:"startFrom"`
	Padding          *int            `json:"padding"`
	DisplayName      json.RawMessage `json:"displayName"`
	CanLogin         *bool           `json:"canLogin"`
	ProvisioningMode string          `json:"provisioningMode"`
	BatchTag         json.RawMessage `json:"batchTag"`
	QuotaMB          *int64          `json:"quotaMb"`
	Password         *string         `json:"password"`
	OwnerUserID      *int64          `json:"ownerUserId"`
	MemberUserIDs    []int64         `json:"memberUserIds"`
	ForwardMode      string          `json:"forwardMode"`
	ForwardTo        json.RawMessage `json:"forwardTo"`
	BindAPIKeyIDs    []int64         `json:"bindApiKeyIds"`
}

type updateDomainMailboxManagementRequest struct {
	DisplayName      json.RawMessage `json:"displayName"`
	Status           *string         `json:"status"`
	CanLogin         *bool           `json:"canLogin"`
	ProvisioningMode *string         `json:"provisioningMode"`
	BatchTag         json.RawMessage `json:"batchTag"`
	QuotaMB          json.RawMessage `json:"quotaMb"`
	Password         json.RawMessage `json:"password"`
	OwnerUserID      json.RawMessage `json:"ownerUserId"`
	MemberUserIDs    json.RawMessage `json:"memberUserIds"`
	ForwardMode      *string         `json:"forwardMode"`
	ForwardTo        json.RawMessage `json:"forwardTo"`
}

type batchDeleteDomainMailboxManagementRequest struct {
	IDs              []int64 `json:"ids"`
	DomainID         *int64   `json:"domainId"`
	BatchTag         *string  `json:"batchTag"`
	ProvisioningMode *string  `json:"provisioningMode"`
}

func (s *Server) registerDomainMailboxManagementRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /admin/domain-mailboxes", s.withAdministrator(s.listManagedDomainMailboxes))
	mux.HandleFunc("POST /admin/domain-mailboxes", s.withAdministrator(s.createManagedDomainMailbox))
	mux.HandleFunc("POST /admin/domain-mailboxes/batch-create", s.withAdministrator(s.batchCreateManagedDomainMailboxes))
	mux.HandleFunc("POST /admin/domain-mailboxes/batch-delete", s.withAdministrator(s.batchDeleteManagedDomainMailboxes))
	mux.HandleFunc("GET /admin/domain-mailboxes/{id}", s.withAdministrator(s.getManagedDomainMailbox))
	mux.HandleFunc("PATCH /admin/domain-mailboxes/{id}", s.withAdministrator(s.updateManagedDomainMailbox))
	mux.HandleFunc("DELETE /admin/domain-mailboxes/{id}", s.withAdministrator(s.deleteManagedDomainMailbox))
}

func (s *Server) listManagedDomainMailboxes(w http.ResponseWriter, r *http.Request, _ Admin) {
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
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	if status != "" {
		if err := validateManagementEnum("status", status, "ACTIVE", "DISABLED", "SUSPENDED"); err != nil {
			s.writeRequestError(w, r, err)
			return
		}
	}
	mode := strings.TrimSpace(r.URL.Query().Get("provisioningMode"))
	if mode != "" {
		if err := validateManagementEnum("provisioningMode", mode, "MANUAL", "API_POOL"); err != nil {
			s.writeRequestError(w, r, err)
			return
		}
	}
	keyword := strings.TrimSpace(r.URL.Query().Get("keyword"))
	batchTag := strings.TrimSpace(r.URL.Query().Get("batchTag"))
	result, err := store.listManagedDomainMailboxes(r.Context(), page, pageSize, domainID, keyword, status, batchTag, mode)
	if err != nil {
		s.writeStoreError(w, r, "list domain mailboxes", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) getManagedDomainMailbox(w http.ResponseWriter, r *http.Request, _ Admin) {
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
	result, err := store.getManagedDomainMailbox(r.Context(), id)
	if err != nil {
		s.writeStoreError(w, r, "get domain mailbox", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) createManagedDomainMailbox(w http.ResponseWriter, r *http.Request, _ Admin) {
	store, err := s.managementStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	var body createDomainMailboxManagementRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	input, err := parseManagedDomainMailboxCreate(body)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	result, err := store.createManagedDomainMailbox(r.Context(), input)
	if err != nil {
		s.writeStoreError(w, r, "create domain mailbox", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) batchCreateManagedDomainMailboxes(w http.ResponseWriter, r *http.Request, _ Admin) {
	store, err := s.managementStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	var body batchCreateDomainMailboxManagementRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	input, err := parseManagedDomainMailboxBatchCreate(body)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	result, err := store.batchCreateManagedDomainMailboxes(r.Context(), input)
	if err != nil {
		s.writeStoreError(w, r, "batch create domain mailboxes", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) updateManagedDomainMailbox(w http.ResponseWriter, r *http.Request, _ Admin) {
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
	var body updateDomainMailboxManagementRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	input, err := parseManagedDomainMailboxUpdate(body)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	result, err := store.updateManagedDomainMailbox(r.Context(), id, input)
	if err != nil {
		s.writeStoreError(w, r, "update domain mailbox", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) batchDeleteManagedDomainMailboxes(w http.ResponseWriter, r *http.Request, _ Admin) {
	store, err := s.managementStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	var body batchDeleteDomainMailboxManagementRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if err := requirePositiveIDs(body.IDs, "ids"); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	body.IDs = normalizeManagementIDs(body.IDs)
	if body.DomainID != nil && *body.DomainID <= 0 {
		s.writeRequestError(w, r, validationError("domainId must be a positive integer"))
		return
	}
	if body.ProvisioningMode != nil {
		if err := validateManagementEnum("provisioningMode", *body.ProvisioningMode, "MANUAL", "API_POOL"); err != nil {
			s.writeRequestError(w, r, err)
			return
		}
	}
	if len(body.IDs) == 0 && body.DomainID == nil && body.BatchTag == nil && body.ProvisioningMode == nil {
		s.writeRequestError(w, r, validationError("provide mailbox ids or at least one domain filter for batch delete"))
		return
	}
	var batchTag *string
	if body.BatchTag != nil {
		value := strings.TrimSpace(*body.BatchTag)
		if len(value) > 100 {
			s.writeRequestError(w, r, validationError("batchTag must contain at most 100 characters"))
			return
		}
		batchTag = &value
	}
	result, err := store.batchDeleteManagedDomainMailboxes(r.Context(), managedDomainMailboxBatchDeleteInput{
		IDs: body.IDs, DomainID: body.DomainID, BatchTag: batchTag, ProvisioningMode: body.ProvisioningMode,
	})
	if err != nil {
		s.writeStoreError(w, r, "batch delete domain mailboxes", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) deleteManagedDomainMailbox(w http.ResponseWriter, r *http.Request, _ Admin) {
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
	if err := store.deleteManagedDomainMailbox(r.Context(), id); err != nil {
		s.writeStoreError(w, r, "delete domain mailbox", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]bool{"success": true}})
}

func parseManagedDomainMailboxCreate(body createDomainMailboxManagementRequest) (managedDomainMailboxCreateInput, error) {
	if body.DomainID <= 0 {
		return managedDomainMailboxCreateInput{}, validationError("domainId must be a positive integer")
	}
	localPart := strings.ToLower(strings.TrimSpace(body.LocalPart))
	if err := validateTextLength("localPart", localPart, 1, 255); err != nil {
		return managedDomainMailboxCreateInput{}, err
	}
	displayName, _, err := decodeNullableString(body.DisplayName, "displayName")
	if err != nil {
		return managedDomainMailboxCreateInput{}, err
	}
	if displayName != nil && len(*displayName) > 255 {
		return managedDomainMailboxCreateInput{}, validationError("displayName must contain at most 255 characters")
	}
	batchTag, _, err := decodeNullableString(body.BatchTag, "batchTag")
	if err != nil {
		return managedDomainMailboxCreateInput{}, err
	}
	if batchTag != nil && len(*batchTag) > 100 {
		return managedDomainMailboxCreateInput{}, validationError("batchTag must contain at most 100 characters")
	}
	forwardTo, _, err := decodeNullableString(body.ForwardTo, "forwardTo")
	if err != nil {
		return managedDomainMailboxCreateInput{}, err
	}
	if forwardTo != nil {
		if err := validateEmailAddress(*forwardTo); err != nil {
			return managedDomainMailboxCreateInput{}, err
		}
	}
	mode := body.ProvisioningMode
	if mode == "" {
		mode = "MANUAL"
	}
	if err := validateManagementEnum("provisioningMode", mode, "MANUAL", "API_POOL"); err != nil {
		return managedDomainMailboxCreateInput{}, err
	}
	forwardMode := body.ForwardMode
	if forwardMode == "" {
		forwardMode = "DISABLED"
	}
	if err := validateManagementEnum("forwardMode", forwardMode, "DISABLED", "COPY", "MOVE"); err != nil {
		return managedDomainMailboxCreateInput{}, err
	}
	if forwardMode != "DISABLED" && forwardTo == nil {
		return managedDomainMailboxCreateInput{}, managementBadRequest("FORWARD_TARGET_REQUIRED", fmt.Errorf("forward target is required"))
	}
	if body.QuotaMB != nil && *body.QuotaMB <= 0 {
		return managedDomainMailboxCreateInput{}, validationError("quotaMb must be a positive integer")
	}
	if body.OwnerUserID != nil && *body.OwnerUserID <= 0 {
		return managedDomainMailboxCreateInput{}, validationError("ownerUserId must be a positive integer")
	}
	if err := requirePositiveIDs(body.MemberUserIDs, "memberUserIds"); err != nil {
		return managedDomainMailboxCreateInput{}, err
	}
	var passwordHash *string
	if body.Password != nil {
		hash, err := hashManagementPassword(*body.Password)
		if err != nil {
			return managedDomainMailboxCreateInput{}, err
		}
		passwordHash = &hash
	}
	canLogin := true
	if body.CanLogin != nil {
		canLogin = *body.CanLogin
	}
	return managedDomainMailboxCreateInput{
		DomainID: body.DomainID, LocalPart: localPart, DisplayName: displayName, CanLogin: canLogin,
		ProvisioningMode: mode, BatchTag: batchTag, QuotaMB: body.QuotaMB, PasswordHash: passwordHash,
		OwnerUserID: body.OwnerUserID, MemberUserIDs: normalizeManagementIDs(body.MemberUserIDs),
		ForwardMode: forwardMode, ForwardTo: forwardTo,
	}, nil
}

func parseManagedDomainMailboxBatchCreate(body batchCreateDomainMailboxManagementRequest) (managedDomainMailboxBatchCreateInput, error) {
	base, err := parseManagedDomainMailboxCreate(createDomainMailboxManagementRequest{
		DomainID: body.DomainID, LocalPart: "placeholder", DisplayName: body.DisplayName, CanLogin: body.CanLogin,
		ProvisioningMode: body.ProvisioningMode, BatchTag: body.BatchTag, QuotaMB: body.QuotaMB,
		Password: body.Password, OwnerUserID: body.OwnerUserID, MemberUserIDs: body.MemberUserIDs,
		ForwardMode: body.ForwardMode, ForwardTo: body.ForwardTo,
	})
	if err != nil {
		return managedDomainMailboxBatchCreateInput{}, err
	}
	if body.ProvisioningMode == "" {
		base.ProvisioningMode = "API_POOL"
	}
	if body.CanLogin == nil {
		base.CanLogin = false
	}
	localParts := make([]string, 0)
	if len(body.LocalParts) > 0 {
		if len(body.LocalParts) > 1000 {
			return managedDomainMailboxBatchCreateInput{}, validationError("localParts must contain at most 1000 values")
		}
		for _, raw := range body.LocalParts {
			value := strings.ToLower(strings.TrimSpace(raw))
			if err := validateTextLength("localParts", value, 1, 255); err != nil {
				return managedDomainMailboxBatchCreateInput{}, err
			}
			localParts = append(localParts, value)
		}
	} else {
		if body.Prefix == nil || body.Count == nil {
			return managedDomainMailboxBatchCreateInput{}, managementBadRequest("DOMAIN_MAILBOX_BATCH_INPUT_INVALID", fmt.Errorf("prefix and count are required"))
		}
		prefix := strings.ToLower(strings.TrimSpace(*body.Prefix))
		if err := validateTextLength("prefix", prefix, 1, 100); err != nil {
			return managedDomainMailboxBatchCreateInput{}, err
		}
		if *body.Count < 1 || *body.Count > 1000 {
			return managedDomainMailboxBatchCreateInput{}, validationError("count must be between 1 and 1000")
		}
		start := 1
		if body.StartFrom != nil {
			start = *body.StartFrom
		}
		padding := 0
		if body.Padding != nil {
			padding = *body.Padding
		}
		if start < 0 || padding < 0 || padding > 10 {
			return managedDomainMailboxBatchCreateInput{}, validationError("startFrom and padding contain invalid values")
		}
		for index := 0; index < *body.Count; index++ {
			number := strconv.Itoa(start + index)
			if padding > 0 {
				number = fmt.Sprintf("%0*d", padding, start+index)
			}
			localParts = append(localParts, prefix+number)
		}
	}
	localParts = normalizeManagementStrings(localParts)
	if len(localParts) == 0 {
		return managedDomainMailboxBatchCreateInput{}, managementBadRequest("DOMAIN_MAILBOX_LOCAL_PART_REQUIRED", fmt.Errorf("no local parts"))
	}
	if err := requirePositiveIDs(body.BindAPIKeyIDs, "bindApiKeyIds"); err != nil {
		return managedDomainMailboxBatchCreateInput{}, err
	}
	return managedDomainMailboxBatchCreateInput{
		managedDomainMailboxCreateInput: base,
		LocalParts: localParts,
		BindAPIKeyIDs: normalizeManagementIDs(body.BindAPIKeyIDs),
	}, nil
}

func parseManagedDomainMailboxUpdate(body updateDomainMailboxManagementRequest) (managedDomainMailboxUpdateInput, error) {
	input := managedDomainMailboxUpdateInput{Status: body.Status, CanLogin: body.CanLogin, ProvisioningMode: body.ProvisioningMode, ForwardMode: body.ForwardMode}
	var err error
	input.DisplayName, input.DisplayNamePresent, err = decodeNullableString(body.DisplayName, "displayName")
	if err != nil {
		return input, err
	}
	input.BatchTag, input.BatchTagPresent, err = decodeNullableString(body.BatchTag, "batchTag")
	if err != nil {
		return input, err
	}
	input.QuotaMB, input.QuotaMBPresent, err = decodeNullableInt64(body.QuotaMB, "quotaMb")
	if err != nil {
		return input, err
	}
	password, passwordPresent, err := decodeNullableString(body.Password, "password")
	if err != nil {
		return input, err
	}
	input.PasswordPresent = passwordPresent
	if password != nil {
		hash, err := hashManagementPassword(*password)
		if err != nil {
			return input, err
		}
		input.PasswordHash = &hash
	}
	input.OwnerUserID, input.OwnerUserIDPresent, err = decodeNullableInt64(body.OwnerUserID, "ownerUserId")
	if err != nil {
		return input, err
	}
	input.MemberUserIDs, input.MemberUserIDsPresent, err = decodeOptionalInt64Slice(body.MemberUserIDs, "memberUserIds", 1000)
	if err != nil {
		return input, err
	}
	input.ForwardTo, input.ForwardToPresent, err = decodeNullableString(body.ForwardTo, "forwardTo")
	if err != nil {
		return input, err
	}
	if input.DisplayName != nil && len(*input.DisplayName) > 255 {
		return input, validationError("displayName must contain at most 255 characters")
	}
	if input.BatchTag != nil && len(*input.BatchTag) > 100 {
		return input, validationError("batchTag must contain at most 100 characters")
	}
	if input.ForwardTo != nil {
		if err := validateEmailAddress(*input.ForwardTo); err != nil {
			return input, err
		}
	}
	if input.Status != nil {
		if err := validateManagementEnum("status", *input.Status, "ACTIVE", "DISABLED", "SUSPENDED"); err != nil {
			return input, err
		}
	}
	if input.ProvisioningMode != nil {
		if err := validateManagementEnum("provisioningMode", *input.ProvisioningMode, "MANUAL", "API_POOL"); err != nil {
			return input, err
		}
	}
	if input.ForwardMode != nil {
		if err := validateManagementEnum("forwardMode", *input.ForwardMode, "DISABLED", "COPY", "MOVE"); err != nil {
			return input, err
		}
	}
	return input, nil
}

func parseOptionalPositiveQueryID(r *http.Request, field string) (*int64, error) {
	raw := strings.TrimSpace(r.URL.Query().Get(field))
	if raw == "" {
		return nil, nil
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value <= 0 {
		return nil, validationError(field + " must be a positive integer")
	}
	return &value, nil
}

func normalizeManagementStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
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

func defaultBatchTag(domainName string, now time.Time) string {
	first := strings.Split(strings.ToLower(domainName), ".")[0]
	return fmt.Sprintf("%s-%d", first, now.UnixMilli())
}
