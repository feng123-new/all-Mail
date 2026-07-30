package businessapi

import (
	"encoding/json"
	"net/http"
	"strings"
)

type createAPIKeyRequest struct {
	Name             string           `json:"name"`
	RateLimit        *int             `json:"rateLimit"`
	ExpiresAt        json.RawMessage  `json:"expiresAt"`
	Permissions      *map[string]bool `json:"permissions"`
	AllowedGroupIDs  *[]int64         `json:"allowedGroupIds"`
	AllowedEmailIDs  *[]int64         `json:"allowedEmailIds"`
	AllowedDomainIDs *[]int64         `json:"allowedDomainIds"`
}

type updateAPIKeyRequest struct {
	Name             *string          `json:"name"`
	RateLimit        *int             `json:"rateLimit"`
	Status           *string          `json:"status"`
	ExpiresAt        json.RawMessage  `json:"expiresAt"`
	Permissions      *map[string]bool `json:"permissions"`
	AllowedGroupIDs  *[]int64         `json:"allowedGroupIds"`
	AllowedEmailIDs  *[]int64         `json:"allowedEmailIds"`
	AllowedDomainIDs *[]int64         `json:"allowedDomainIds"`
}

type updateAssignedEmailsRequest struct {
	EmailIDs []int64 `json:"emailIds"`
	GroupID  *int64  `json:"groupId"`
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
	for _, suffix := range []string{"allocation-stats", "usage"} {
		mux.HandleFunc("GET /admin/api-keys/{id}/"+suffix, s.withAdministrator(s.apiKeyAllocationStats))
	}
	for _, suffix := range []string{"allocation-reset", "reset-pool"} {
		mux.HandleFunc("POST /admin/api-keys/{id}/"+suffix, s.withAdministrator(s.resetAPIKeyAllocation))
	}
	for _, suffix := range []string{"assigned-mailboxes", "pool-emails"} {
		mux.HandleFunc("GET /admin/api-keys/{id}/"+suffix, s.withAdministrator(s.getAssignedEmails))
		mux.HandleFunc("PUT /admin/api-keys/{id}/"+suffix, s.withAdministrator(s.updateAssignedEmails))
	}
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
	if err := decodeJSONBody(r, &body); err != nil {
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
	permissions := map[string]bool(nil)
	if body.Permissions != nil {
		permissions, err = normalizePermissions(*body.Permissions)
		if err != nil {
			s.writeRequestError(w, r, validationError(err.Error()))
			return
		}
	}
	input := APIKeyCreateInput{
		Name: body.Name, RateLimit: rateLimit, ExpiresAt: expiresAt, Permissions: permissions,
		AllowedGroupIDs:  normalizedIDs(body.AllowedGroupIDs),
		AllowedEmailIDs:  normalizedIDs(body.AllowedEmailIDs),
		AllowedDomainIDs: normalizedIDs(body.AllowedDomainIDs),
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
	if err := decodeJSONBody(r, &body); err != nil {
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
	if body.Permissions != nil {
		input.Permissions, err = normalizePermissions(*body.Permissions)
		if err != nil {
			s.writeRequestError(w, r, validationError(err.Error()))
			return
		}
		input.PermissionsSet = true
	}
	if body.AllowedGroupIDs != nil {
		if err := validatePositiveIDs("allowedGroupIds", body.AllowedGroupIDs); err != nil {
			s.writeRequestError(w, r, err)
			return
		}
		input.AllowedGroupIDsSet, input.AllowedGroupIDs = true, normalizePositiveIDs(*body.AllowedGroupIDs)
	}
	if body.AllowedEmailIDs != nil {
		if err := validatePositiveIDs("allowedEmailIds", body.AllowedEmailIDs); err != nil {
			s.writeRequestError(w, r, err)
			return
		}
		input.AllowedEmailIDsSet, input.AllowedEmailIDs = true, normalizePositiveIDs(*body.AllowedEmailIDs)
	}
	if body.AllowedDomainIDs != nil {
		if err := validatePositiveIDs("allowedDomainIds", body.AllowedDomainIDs); err != nil {
			s.writeRequestError(w, r, err)
			return
		}
		input.AllowedDomainIDsSet, input.AllowedDomainIDs = true, normalizePositiveIDs(*body.AllowedDomainIDs)
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
	if err := decodeJSONBody(r, &body); err != nil {
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
	if err := decodeJSONBody(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if body.GroupID != nil && *body.GroupID <= 0 {
		s.writeRequestError(w, r, validationError("groupId must be a positive integer"))
		return
	}
	if err := validatePositiveIDs("emailIds", &body.EmailIDs); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	result, err := s.apiKeyStore.UpdateAssignedEmails(r.Context(), id, normalizePositiveIDs(body.EmailIDs), body.GroupID)
	if err != nil {
		s.writeStoreError(w, r, "update assigned emails", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func normalizedIDs(values *[]int64) []int64 {
	if values == nil {
		return nil
	}
	return normalizePositiveIDs(*values)
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
