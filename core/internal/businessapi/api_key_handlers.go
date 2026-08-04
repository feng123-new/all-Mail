package businessapi

import (
	"encoding/json"
	"net/http"
	"strings"
)

type createAPIKeyRequest struct {
	Name             string          `json:"name"`
	RateLimit        *int            `json:"rateLimit"`
	ExpiresAt        json.RawMessage `json:"expiresAt"`
	Permissions      json.RawMessage `json:"permissions"`
	AllowedGroupIDs  json.RawMessage `json:"allowedGroupIds"`
	AllowedEmailIDs  json.RawMessage `json:"allowedEmailIds"`
	AllowedDomainIDs json.RawMessage `json:"allowedDomainIds"`
}

type updateAPIKeyRequest struct {
	Name             *string         `json:"name"`
	RateLimit        *int            `json:"rateLimit"`
	Status           *string         `json:"status"`
	ExpiresAt        json.RawMessage `json:"expiresAt"`
	Permissions      json.RawMessage `json:"permissions"`
	AllowedGroupIDs  json.RawMessage `json:"allowedGroupIds"`
	AllowedEmailIDs  json.RawMessage `json:"allowedEmailIds"`
	AllowedDomainIDs json.RawMessage `json:"allowedDomainIds"`
}

type updateAssignedEmailsRequest struct {
	EmailIDs json.RawMessage `json:"emailIds"`
	GroupID  json.RawMessage `json:"groupId"`
}

type groupRequest struct {
	Group string `json:"group"`
}

func (s *Server) registerAPIKeyRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /admin/api-keys", s.withAdministrator(s.listAPIKeys))
	mux.HandleFunc("POST /admin/api-keys", s.withAdministrator(s.createAPIKey))
	mux.HandleFunc("GET /admin/api-keys/{id}", s.withAdministrator(s.getAPIKey))
	mux.HandleFunc("PUT /admin/api-keys/{id}", s.withAdministrator(s.updateAPIKey))
	mux.HandleFunc("DELETE /admin/api-keys/{id}", s.withAdministrator(s.deleteAPIKey))
	mux.HandleFunc("GET /admin/api-keys/{id}/allocation-stats", s.withAdministrator(s.apiKeyAllocationStats))
	mux.HandleFunc("GET /admin/api-keys/{id}/usage", s.withAdministrator(s.apiKeyAllocationStats))
	mux.HandleFunc("POST /admin/api-keys/{id}/allocation-reset", s.withAdministrator(s.resetAPIKeyAllocation))
	mux.HandleFunc("POST /admin/api-keys/{id}/reset-pool", s.withAdministrator(s.resetAPIKeyAllocation))
	mux.HandleFunc("GET /admin/api-keys/{id}/assigned-mailboxes", s.withAdministrator(s.getAssignedEmails))
	mux.HandleFunc("PUT /admin/api-keys/{id}/assigned-mailboxes", s.withAdministrator(s.updateAssignedEmails))
	mux.HandleFunc("GET /admin/api-keys/{id}/pool-emails", s.withAdministrator(s.getAssignedEmails))
	mux.HandleFunc("PUT /admin/api-keys/{id}/pool-emails", s.withAdministrator(s.updateAssignedEmails))
}

func (s *Server) listAPIKeys(w http.ResponseWriter, r *http.Request, _ Admin) {
	if s.apiKeyStore == nil {
		s.writeRequestError(w, r, &requestError{Status: http.StatusServiceUnavailable, Code: "API_KEY_STORE_UNAVAILABLE"})
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
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	if status != "" && status != "ACTIVE" && status != "DISABLED" {
		s.writeRequestError(w, r, validationError("status must be ACTIVE or DISABLED"))
		return
	}
	keyword := strings.TrimSpace(r.URL.Query().Get("keyword"))
	result, err := s.apiKeyStore.ListAPIKeys(r.Context(), APIKeyListInput{
		Page: page, PageSize: pageSize, Status: status, Keyword: keyword,
	})
	if err != nil {
		s.writeStoreError(w, r, "list API keys", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) createAPIKey(w http.ResponseWriter, r *http.Request, admin Admin) {
	var body createAPIKeyRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if err := validateTextLength("name", body.Name, 1, 100); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	rateLimit := 60
	if body.RateLimit != nil {
		rateLimit = *body.RateLimit
	}
	if rateLimit < 1 || rateLimit > 10_000 {
		s.writeRequestError(w, r, validationError("rateLimit must be between 1 and 10000"))
		return
	}
	expiresAt, _, err := parseNullableAPITime(body.ExpiresAt)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	permissions, _, err := parseOptionalPermissions(body.Permissions)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	scopes := map[string]json.RawMessage{
		"allowedGroupIds":  body.AllowedGroupIDs,
		"allowedEmailIds":  body.AllowedEmailIDs,
		"allowedDomainIds": body.AllowedDomainIDs,
	}
	parsedScopes := make(map[string][]int64, len(scopes))
	for name, raw := range scopes {
		values, _, err := parseOptionalPositiveJSONIDs(raw, name)
		if err != nil {
			s.writeRequestError(w, r, err)
			return
		}
		parsedScopes[name] = values
	}
	input := APIKeyCreateInput{
		Name: body.Name, RateLimit: rateLimit, ExpiresAt: expiresAt, Permissions: permissions,
		AllowedGroupIDs:  parsedScopes["allowedGroupIds"],
		AllowedEmailIDs:  parsedScopes["allowedEmailIds"],
		AllowedDomainIDs: parsedScopes["allowedDomainIds"],
	}
	result, err := s.apiKeyStore.CreateAPIKey(r.Context(), input, admin.ID)
	if err != nil {
		s.writeStoreError(w, r, "create API key", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) getAPIKey(w http.ResponseWriter, r *http.Request, _ Admin) {
	id, err := parsePositivePathID(r, "id")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	result, err := s.apiKeyStore.GetAPIKey(r.Context(), id)
	if err != nil {
		s.writeStoreError(w, r, "load API key", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) updateAPIKey(w http.ResponseWriter, r *http.Request, _ Admin) {
	id, err := parsePositivePathID(r, "id")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	var body updateAPIKeyRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	input := APIKeyUpdateInput{}
	if body.Name != nil {
		if err := validateTextLength("name", *body.Name, 1, 100); err != nil {
			s.writeRequestError(w, r, err)
			return
		}
		input.NameSet, input.Name = true, *body.Name
	}
	if body.RateLimit != nil {
		if *body.RateLimit < 1 || *body.RateLimit > 10_000 {
			s.writeRequestError(w, r, validationError("rateLimit must be between 1 and 10000"))
			return
		}
		input.RateLimitSet, input.RateLimit = true, *body.RateLimit
	}
	if body.Status != nil {
		if *body.Status != "ACTIVE" && *body.Status != "DISABLED" {
			s.writeRequestError(w, r, validationError("status must be ACTIVE or DISABLED"))
			return
		}
		input.StatusSet, input.Status = true, *body.Status
	}
	input.ExpiresAt, input.ExpiresAtSet, err = parseNullableAPITime(body.ExpiresAt)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	input.Permissions, input.PermissionsSet, err = parseOptionalPermissions(body.Permissions)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	input.AllowedGroupIDs, input.AllowedGroupIDsSet, err = parseOptionalPositiveJSONIDs(body.AllowedGroupIDs, "allowedGroupIds")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	input.AllowedEmailIDs, input.AllowedEmailIDsSet, err = parseOptionalPositiveJSONIDs(body.AllowedEmailIDs, "allowedEmailIds")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	input.AllowedDomainIDs, input.AllowedDomainIDsSet, err = parseOptionalPositiveJSONIDs(body.AllowedDomainIDs, "allowedDomainIds")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	result, err := s.apiKeyStore.UpdateAPIKey(r.Context(), id, input)
	if err != nil {
		s.writeStoreError(w, r, "update API key", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) deleteAPIKey(w http.ResponseWriter, r *http.Request, _ Admin) {
	id, err := parsePositivePathID(r, "id")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if err := s.apiKeyStore.DeleteAPIKey(r.Context(), id); err != nil {
		s.writeStoreError(w, r, "delete API key", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]string{"code": "API_KEY_DELETED"}})
}

func (s *Server) apiKeyAllocationStats(w http.ResponseWriter, r *http.Request, _ Admin) {
	id, err := parsePositivePathID(r, "id")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	result, err := s.apiKeyStore.EmailAllocationStats(r.Context(), id, strings.TrimSpace(r.URL.Query().Get("group")))
	if err != nil {
		s.writeStoreError(w, r, "query API key allocation statistics", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) resetAPIKeyAllocation(w http.ResponseWriter, r *http.Request, _ Admin) {
	id, err := parsePositivePathID(r, "id")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	var body groupRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if err := s.apiKeyStore.ResetEmailAllocations(r.Context(), id, strings.TrimSpace(body.Group)); err != nil {
		s.writeStoreError(w, r, "reset API key allocation", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]string{"code": "API_KEY_ALLOCATION_RESET"}})
}

func (s *Server) getAssignedEmails(w http.ResponseWriter, r *http.Request, _ Admin) {
	id, err := parsePositivePathID(r, "id")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	var groupID *int64
	if raw := strings.TrimSpace(r.URL.Query().Get("groupId")); raw != "" {
		value, parseErr := parsePositiveInt64(raw, "groupId")
		if parseErr != nil {
			s.writeRequestError(w, r, parseErr)
			return
		}
		groupID = &value
	}
	result, err := s.apiKeyStore.AssignedEmails(r.Context(), id, groupID)
	if err != nil {
		s.writeStoreError(w, r, "query assigned emails", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) updateAssignedEmails(w http.ResponseWriter, r *http.Request, _ Admin) {
	id, err := parsePositivePathID(r, "id")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	var body updateAssignedEmailsRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	emailIDs := []int64{}
	if len(body.EmailIDs) > 0 {
		if isJSONNull(body.EmailIDs) || json.Unmarshal(body.EmailIDs, &emailIDs) != nil {
			s.writeRequestError(w, r, validationError("emailIds must be an array of positive integers"))
			return
		}
	}
	if err := validatePositiveIDs("emailIds", &emailIDs); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	groupID, err := parseOptionalPositiveJSONID(body.GroupID, "groupId")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	result, err := s.apiKeyStore.UpdateAssignedEmails(r.Context(), id, normalizePositiveIDs(emailIDs), groupID)
	if err != nil {
		s.writeStoreError(w, r, "update assigned emails", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func parseOptionalPositiveJSONID(raw json.RawMessage, name string) (*int64, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	if isJSONNull(raw) {
		return nil, validationError(name + " must be a positive integer")
	}
	var value int64
	if err := json.Unmarshal(raw, &value); err != nil || value <= 0 {
		return nil, validationError(name + " must be a positive integer")
	}
	return &value, nil
}

func isJSONNull(raw json.RawMessage) bool {
	return strings.TrimSpace(string(raw)) == "null"
}

func parseOptionalPermissions(raw json.RawMessage) (map[string]bool, bool, error) {
	if len(raw) == 0 {
		return nil, false, nil
	}
	if isJSONNull(raw) {
		return nil, false, validationError("permissions must be an object")
	}
	var permissions map[string]bool
	if err := json.Unmarshal(raw, &permissions); err != nil {
		return nil, false, validationError("permissions must be an object of boolean values")
	}
	normalized, err := normalizePermissions(permissions)
	if err != nil {
		return nil, false, validationError(err.Error())
	}
	return normalized, true, nil
}

func parseOptionalPositiveJSONIDs(raw json.RawMessage, name string) ([]int64, bool, error) {
	if len(raw) == 0 {
		return nil, false, nil
	}
	if isJSONNull(raw) {
		return nil, false, validationError(name + " must be an array of positive integers")
	}
	var values []int64
	if err := json.Unmarshal(raw, &values); err != nil {
		return nil, false, validationError(name + " must be an array of positive integers")
	}
	if err := validatePositiveIDs(name, &values); err != nil {
		return nil, false, err
	}
	return normalizePositiveIDs(values), true, nil
}

func parsePositiveInt64(raw, name string) (int64, error) {
	var value int64
	if _, err := json.Number(raw).Int64(); err != nil {
		return 0, validationError(name + " must be a positive integer")
	} else {
		value, _ = json.Number(raw).Int64()
	}
	if value <= 0 {
		return 0, validationError(name + " must be a positive integer")
	}
	return value, nil
}

func validatePositiveIDs(name string, values *[]int64) error {
	if values == nil {
		return nil
	}
	for _, value := range *values {
		if value <= 0 {
			return validationError(name + " must contain only positive integers")
		}
	}
	return nil
}
