package businessapi

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/legacycrypto"
)

const (
	managedCloudflareAPIBase = "https://api.cloudflare.com/client/v4"
	managedCloudflareWorker  = "allmail-edge"
)

type managedDomainDNSStatus struct {
	Provider                  *string                        `json:"provider,omitempty"`
	ExpectedMXConfigured      *bool                          `json:"expectedMxConfigured,omitempty"`
	ExpectedIngressConfigured *bool                          `json:"expectedIngressConfigured,omitempty"`
	Cloudflare                *managedDomainCloudflareConfig `json:"cloudflare,omitempty"`
}

type managedDomainCloudflareConfig struct {
	APITokenEncrypted *string                            `json:"apiTokenEncrypted,omitempty"`
	TokenHint         *string                            `json:"tokenHint,omitempty"`
	ZoneID            *string                            `json:"zoneId,omitempty"`
	LastValidation    *managedCloudflareValidationResult `json:"lastValidation,omitempty"`
	LastValidatedAt   *string                            `json:"lastValidatedAt,omitempty"`
}

type managedCloudflareValidationCheck struct {
	Key     string   `json:"key"`
	Label   string   `json:"label"`
	Status  string   `json:"status"`
	Message string   `json:"message"`
	Details []string `json:"details,omitempty"`
}

type managedCloudflareValidationResult struct {
	Status             string                             `json:"status"`
	ZoneID             *string                            `json:"zoneId"`
	ZoneName           *string                            `json:"zoneName"`
	ZoneStatus         *string                            `json:"zoneStatus"`
	EmailRoutingStatus *string                            `json:"emailRoutingStatus"`
	LastValidatedAt    string                             `json:"lastValidatedAt"`
	Checks             []managedCloudflareValidationCheck `json:"checks"`
	ManualActions      []string                           `json:"manualActions"`
}

type saveManagedDomainCloudflareRequest struct {
	APIToken        json.RawMessage `json:"apiToken"`
	ZoneID          json.RawMessage `json:"zoneId"`
	ClearSavedToken *bool           `json:"clearSavedToken"`
}

type managedCloudflareEnvelope[T any] struct {
	Success bool                        `json:"success"`
	Result  T                           `json:"result"`
	Errors  []managedCloudflareAPIError `json:"errors"`
}

type managedCloudflareAPIError struct {
	Code    any    `json:"code"`
	Message string `json:"message"`
}

type managedCloudflareZone struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Status      string   `json:"status"`
	NameServers []string `json:"name_servers"`
}

type managedCloudflareDNSRecord struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Name     string `json:"name"`
	Content  string `json:"content"`
	Priority int    `json:"priority"`
}

type managedCloudflareEmailRoutingSettings struct {
	Enabled bool   `json:"enabled"`
	Status  string `json:"status"`
	Name    string `json:"name"`
}

type managedCloudflareEmailRoutingDNSError struct {
	Code    string                      `json:"code"`
	Missing *managedCloudflareDNSRecord `json:"missing"`
}

type managedCloudflareEmailRoutingDNSResult struct {
	Errors []managedCloudflareEmailRoutingDNSError `json:"errors"`
	Record []managedCloudflareDNSRecord            `json:"record"`
}

type managedCloudflareRoutingAction struct {
	Type  string   `json:"type"`
	Value []string `json:"value"`
}

type managedCloudflareRoutingMatcher struct {
	Type  string `json:"type"`
	Field string `json:"field"`
	Value string `json:"value"`
}

type managedCloudflareRoutingRule struct {
	ID       string                            `json:"id"`
	Name     string                            `json:"name"`
	Enabled  bool                              `json:"enabled"`
	Actions  []managedCloudflareRoutingAction  `json:"actions"`
	Matchers []managedCloudflareRoutingMatcher `json:"matchers"`
}

func parseManagedDomainDNSStatus(raw []byte) managedDomainDNSStatus {
	var status managedDomainDNSStatus
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return status
	}
	if err := json.Unmarshal(raw, &status); err != nil {
		return managedDomainDNSStatus{}
	}
	normalizeManagedDomainDNSStatus(&status)
	return status
}

func normalizeManagedDomainDNSStatus(status *managedDomainDNSStatus) {
	status.Provider = normalizeManagedDNSOptionalString(status.Provider)
	if status.Cloudflare == nil {
		return
	}
	status.Cloudflare.APITokenEncrypted = normalizeManagedDNSOptionalString(status.Cloudflare.APITokenEncrypted)
	status.Cloudflare.TokenHint = normalizeManagedDNSOptionalString(status.Cloudflare.TokenHint)
	status.Cloudflare.ZoneID = normalizeManagedDNSOptionalString(status.Cloudflare.ZoneID)
	status.Cloudflare.LastValidatedAt = normalizeManagedDNSOptionalString(status.Cloudflare.LastValidatedAt)
}

func normalizeManagedDNSOptionalString(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func safeManagedDomainDNSStatus(status managedDomainDNSStatus) any {
	if status.Provider == nil && status.ExpectedMXConfigured == nil && status.ExpectedIngressConfigured == nil && status.Cloudflare == nil {
		return nil
	}
	result := map[string]any{
		"provider":                  nullableManagedDNSString(status.Provider),
		"expectedMxConfigured":      managedDNSBoolOrFalse(status.ExpectedMXConfigured),
		"expectedIngressConfigured": managedDNSBoolOrFalse(status.ExpectedIngressConfigured),
	}
	if status.Cloudflare != nil {
		result["cloudflare"] = map[string]any{
			"tokenHint":       nullableManagedDNSString(status.Cloudflare.TokenHint),
			"zoneId":          nullableManagedDNSString(status.Cloudflare.ZoneID),
			"lastValidatedAt": nullableManagedDNSString(status.Cloudflare.LastValidatedAt),
		}
	}
	return result
}

func managedDomainCloudflareView(status managedDomainDNSStatus) map[string]any {
	view := map[string]any{
		"hasSavedToken":   false,
		"tokenHint":       nil,
		"zoneId":          nil,
		"lastValidation":  nil,
		"lastValidatedAt": nil,
	}
	if status.Cloudflare == nil {
		return view
	}
	view["hasSavedToken"] = status.Cloudflare.APITokenEncrypted != nil
	view["tokenHint"] = nullableManagedDNSString(status.Cloudflare.TokenHint)
	view["zoneId"] = nullableManagedDNSString(status.Cloudflare.ZoneID)
	view["lastValidation"] = status.Cloudflare.LastValidation
	view["lastValidatedAt"] = nullableManagedDNSString(status.Cloudflare.LastValidatedAt)
	return view
}

func managedDNSBoolOrFalse(value *bool) bool {
	return value != nil && *value
}

func nullableManagedDNSString(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}

func (s *Server) saveManagedDomainCloudflareConfig(w http.ResponseWriter, r *http.Request, _ Admin) {
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
	var body saveManagedDomainCloudflareRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	apiToken, apiTokenPresent, err := decodeNullableString(body.APIToken, "apiToken")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if apiToken != nil {
		if err := validateTextLength("apiToken", *apiToken, 20, 4096); err != nil {
			s.writeRequestError(w, r, err)
			return
		}
	}
	zoneID, zoneIDPresent, err := decodeNullableString(body.ZoneID, "zoneId")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if zoneID != nil {
		if err := validateTextLength("zoneId", *zoneID, 8, 255); err != nil {
			s.writeRequestError(w, r, err)
			return
		}
	}
	currentRaw, err := store.loadManagedDomainDNSStatus(r.Context(), id)
	if err != nil {
		s.writeStoreError(w, r, "load domain Cloudflare config", err)
		return
	}
	status := parseManagedDomainDNSStatus(currentRaw)
	if status.Provider == nil {
		status.Provider = managedDNSStringPointer("CLOUDFLARE")
	}
	if status.Cloudflare == nil {
		status.Cloudflare = &managedDomainCloudflareConfig{}
	}
	clearSavedToken := body.ClearSavedToken != nil && *body.ClearSavedToken
	if clearSavedToken {
		status.Cloudflare.APITokenEncrypted = nil
		status.Cloudflare.TokenHint = nil
		status.Cloudflare.LastValidation = nil
		status.Cloudflare.LastValidatedAt = nil
	} else if apiTokenPresent && apiToken != nil {
		encrypted, err := legacycrypto.Encrypt(s.cfg.EncryptionKey, *apiToken)
		if err != nil {
			s.writeRequestError(w, r, &requestError{Status: http.StatusInternalServerError, Code: "SECRET_ENCRYPTION_FAILED", Cause: err})
			return
		}
		status.Cloudflare.APITokenEncrypted = &encrypted
		hint := buildManagedCloudflareTokenHint(*apiToken)
		status.Cloudflare.TokenHint = &hint
	}
	if zoneIDPresent {
		status.Cloudflare.ZoneID = zoneID
	}
	updatedAt, err := store.saveManagedDomainDNSStatus(r.Context(), id, status)
	if err != nil {
		s.writeStoreError(w, r, "save domain Cloudflare config", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]any{
		"id": id, "updatedAt": formatAPITime(updatedAt),
		"dnsStatus":            safeManagedDomainDNSStatus(status),
		"cloudflareValidation": managedDomainCloudflareView(status),
	}})
}

func (s *Server) validateManagedDomainCloudflare(w http.ResponseWriter, r *http.Request, _ Admin) {
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
	name, canReceive, catchAll, raw, err := store.loadManagedDomainCloudflareValidationInput(r.Context(), id)
	if err != nil {
		s.writeStoreError(w, r, "load domain Cloudflare validation input", err)
		return
	}
	status := parseManagedDomainDNSStatus(raw)
	if status.Cloudflare == nil || status.Cloudflare.APITokenEncrypted == nil {
		s.writeRequestError(w, r, &requestError{Status: http.StatusBadRequest, Code: "CLOUDFLARE_TOKEN_REQUIRED"})
		return
	}
	apiToken, err := legacycrypto.Decrypt(s.cfg.EncryptionKey, *status.Cloudflare.APITokenEncrypted)
	if err != nil {
		s.writeRequestError(w, r, &requestError{Status: http.StatusInternalServerError, Code: "SECRET_DECRYPTION_FAILED", Cause: err})
		return
	}
	validation, err := validateManagedCloudflareDomain(r.Context(), s.providerClient(), managedCloudflareValidationOptions{
		DomainName: name, CanReceive: canReceive, IsCatchAllEnabled: catchAll,
		APIToken: apiToken, ZoneID: status.Cloudflare.ZoneID, Now: s.now(),
	})
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	status.Provider = managedDNSStringPointer("CLOUDFLARE")
	status.ExpectedMXConfigured = managedDNSBoolPointer(managedCloudflareCheckPassed(validation.Checks, "mx-records"))
	status.ExpectedIngressConfigured = managedDNSBoolPointer(managedCloudflareCheckPassed(validation.Checks, "worker-binding"))
	status.Cloudflare.LastValidation = &validation
	status.Cloudflare.LastValidatedAt = &validation.LastValidatedAt
	if validation.ZoneID != nil {
		status.Cloudflare.ZoneID = validation.ZoneID
	}
	updatedAt, err := store.saveManagedDomainDNSStatus(r.Context(), id, status)
	if err != nil {
		s.writeStoreError(w, r, "save domain Cloudflare validation", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]any{
		"id": id, "updatedAt": formatAPITime(updatedAt),
		"dnsStatus":            safeManagedDomainDNSStatus(status),
		"cloudflareValidation": managedDomainCloudflareView(status),
	}})
}

func (s *PostgresStore) loadManagedDomainDNSStatus(ctx context.Context, id int64) ([]byte, error) {
	var raw []byte
	if err := s.pool.QueryRow(ctx, `SELECT COALESCE(dns_status, 'null'::jsonb) FROM domains WHERE id = $1`, id).Scan(&raw); err != nil {
		if errorsIsNoRows(err) {
			return nil, managementNotFound("DOMAIN_NOT_FOUND")
		}
		return nil, fmt.Errorf("load domain DNS status: %w", err)
	}
	return raw, nil
}

func (s *PostgresStore) loadManagedDomainCloudflareValidationInput(ctx context.Context, id int64) (string, bool, bool, []byte, error) {
	var name string
	var canReceive, catchAll bool
	var raw []byte
	if err := s.pool.QueryRow(ctx, `
		SELECT name, can_receive, is_catch_all_enabled, COALESCE(dns_status, 'null'::jsonb)
		FROM domains WHERE id = $1
	`, id).Scan(&name, &canReceive, &catchAll, &raw); err != nil {
		if errorsIsNoRows(err) {
			return "", false, false, nil, managementNotFound("DOMAIN_NOT_FOUND")
		}
		return "", false, false, nil, fmt.Errorf("load domain Cloudflare validation input: %w", err)
	}
	return name, canReceive, catchAll, raw, nil
}

func (s *PostgresStore) saveManagedDomainDNSStatus(ctx context.Context, id int64, status managedDomainDNSStatus) (time.Time, error) {
	encoded, err := encodeManagedDomainDNSStatus(status)
	if err != nil {
		return time.Time{}, err
	}
	var updatedAt time.Time
	if err := s.pool.QueryRow(ctx, `
		UPDATE domains SET dns_status = $2::jsonb, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1 RETURNING updated_at
	`, id, string(encoded)).Scan(&updatedAt); err != nil {
		if errorsIsNoRows(err) {
			return time.Time{}, managementNotFound("DOMAIN_NOT_FOUND")
		}
		return time.Time{}, fmt.Errorf("save domain DNS status: %w", err)
	}
	return updatedAt, nil
}

func buildManagedCloudflareTokenHint(apiToken string) string {
	trimmed := strings.TrimSpace(apiToken)
	if trimmed == "" {
		return "Saved Cloudflare token"
	}
	suffix := trimmed
	if len(suffix) > 4 {
		suffix = suffix[len(suffix)-4:]
	}
	return "Saved token ending in " + suffix
}

func resolveManagedCloudflareZoneCandidates(domainName string) []string {
	normalized := strings.ToLower(strings.TrimSpace(domainName))
	segments := strings.FieldsFunc(normalized, func(r rune) bool { return r == '.' })
	if len(segments) < 2 {
		if normalized == "" {
			return nil
		}
		return []string{normalized}
	}
	seen := make(map[string]struct{}, len(segments)-1)
	result := make([]string, 0, len(segments)-1)
	for index := 0; index <= len(segments)-2; index++ {
		candidate := strings.Join(segments[index:], ".")
		if _, ok := seen[candidate]; ok {
			continue
		}
		seen[candidate] = struct{}{}
		result = append(result, candidate)
	}
	return result
}

type managedCloudflareValidationOptions struct {
	DomainName        string
	CanReceive        bool
	IsCatchAllEnabled bool
	APIToken          string
	ZoneID            *string
	Now               time.Time
}

func validateManagedCloudflareDomain(ctx context.Context, client *http.Client, options managedCloudflareValidationOptions) (managedCloudflareValidationResult, error) {
	zone, err := resolveManagedCloudflareZone(ctx, client, options.APIToken, options.DomainName, options.ZoneID)
	if err != nil {
		return managedCloudflareValidationResult{}, err
	}
	emailRouting, err := fetchManagedCloudflare[managedCloudflareEmailRoutingSettings](ctx, client, "/zones/"+url.PathEscape(zone.ID)+"/email/routing", options.APIToken, nil)
	if err != nil {
		return managedCloudflareValidationResult{}, err
	}
	emailRoutingDNS, err := fetchManagedCloudflare[managedCloudflareEmailRoutingDNSResult](ctx, client, "/zones/"+url.PathEscape(zone.ID)+"/email/routing/dns", options.APIToken, nil)
	if err != nil {
		return managedCloudflareValidationResult{}, err
	}
	mxRecords, err := fetchManagedCloudflare[[]managedCloudflareDNSRecord](ctx, client, "/zones/"+url.PathEscape(zone.ID)+"/dns_records", options.APIToken, map[string]string{"type": "MX", "per_page": "100"})
	if err != nil {
		return managedCloudflareValidationResult{}, err
	}
	txtRecords, err := fetchManagedCloudflare[[]managedCloudflareDNSRecord](ctx, client, "/zones/"+url.PathEscape(zone.ID)+"/dns_records", options.APIToken, map[string]string{"type": "TXT", "per_page": "200"})
	if err != nil {
		return managedCloudflareValidationResult{}, err
	}
	rules, err := fetchManagedCloudflare[[]managedCloudflareRoutingRule](ctx, client, "/zones/"+url.PathEscape(zone.ID)+"/email/routing/rules", options.APIToken, map[string]string{"enabled": "true", "per_page": "100"})
	if err != nil {
		return managedCloudflareValidationResult{}, err
	}

	missingMX, missingSPF := false, false
	for _, entry := range emailRoutingDNS.Errors {
		if entry.Missing == nil {
			continue
		}
		if entry.Missing.Type == "MX" {
			missingMX = true
		}
		if entry.Missing.Type == "TXT" && strings.Contains(strings.ToLower(entry.Missing.Content), "spf") {
			missingSPF = true
		}
	}
	zoneName := strings.ToLower(zone.Name)
	hasSPF, hasDMARC, hasDKIM := false, false, false
	for _, record := range txtRecords {
		if record.Type != "TXT" {
			continue
		}
		name := strings.ToLower(record.Name)
		content := strings.ToLower(record.Content)
		if name == zoneName && strings.Contains(content, "v=spf1") {
			hasSPF = true
		}
		if name == "_dmarc."+zoneName && strings.Contains(content, "v=dmarc1") {
			hasDMARC = true
		}
		if strings.Contains(name, "._domainkey.") && strings.HasSuffix(name, "."+zoneName) {
			hasDKIM = true
		}
	}
	worker := summarizeManagedCloudflareWorkerRules(rules)
	checks := []managedCloudflareValidationCheck{
		managedCloudflareZoneStatusCheck(zone),
		managedCloudflareEmailRoutingCheck(emailRouting, options.CanReceive),
		managedCloudflareMXCheck(mxRecords, missingMX, options.CanReceive),
		managedCloudflareSPFCheck(hasSPF, missingSPF, options.CanReceive),
		managedCloudflareWorkerCheck(worker),
		managedCloudflareCatchAllCheck(worker, options.IsCatchAllEnabled),
		managedCloudflareDMARCCheck(hasDMARC),
		managedCloudflareDKIMCheck(hasDKIM),
	}
	manualActions := dedupeManagedStrings([]string{
		managedConditional(zone.Status != "active", "Update the registrar nameservers to the Cloudflare nameservers shown for this zone, then wait for the zone status to become active."),
		managedConditional(!(emailRouting.Enabled && emailRouting.Status == "ready"), "Open Cloudflare Dashboard → Email Routing and complete or repair Email Routing until the status becomes ready."),
		managedConditional(!worker.HasExpectedWorker, "Bind a custom address or catch-all rule to worker "+managedCloudflareWorker+" in Cloudflare Email Routing."),
		managedConditional(options.IsCatchAllEnabled && !worker.HasCatchAllWorker, "Because this domain enables catch-all locally, create a matching catch-all Email Routing worker rule in Cloudflare."),
		managedConditional(!hasDMARC, "Add a DMARC TXT record if you want stronger email policy visibility and better sender reputation hygiene."),
	})
	now := options.Now
	if now.IsZero() {
		now = time.Now()
	}
	zoneID, zoneNameValue := zone.ID, zone.Name
	return managedCloudflareValidationResult{
		Status: managedCloudflareOverallStatus(checks), ZoneID: &zoneID, ZoneName: &zoneNameValue,
		ZoneStatus: managedDNSNonEmptyString(zone.Status), EmailRoutingStatus: managedDNSNonEmptyString(emailRouting.Status),
		LastValidatedAt: formatAPITime(now), Checks: checks, ManualActions: manualActions,
	}, nil
}

func fetchManagedCloudflare[T any](ctx context.Context, client *http.Client, path, apiToken string, query map[string]string) (T, error) {
	var zero T
	endpoint, err := url.Parse(managedCloudflareAPIBase + path)
	if err != nil {
		return zero, &requestError{Status: http.StatusBadGateway, Code: "CLOUDFLARE_API_REQUEST_FAILED", Cause: err}
	}
	values := endpoint.Query()
	for key, value := range query {
		values.Set(key, value)
	}
	endpoint.RawQuery = values.Encode()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return zero, &requestError{Status: http.StatusBadGateway, Code: "CLOUDFLARE_API_REQUEST_FAILED", Cause: err}
	}
	request.Header.Set("Authorization", "Bearer "+apiToken)
	request.Header.Set("Content-Type", "application/json")
	response, err := client.Do(request)
	if err != nil {
		return zero, &requestError{Status: http.StatusBadGateway, Code: "CLOUDFLARE_API_REQUEST_FAILED", Cause: err}
	}
	defer response.Body.Close()
	payloadBytes, err := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	if err != nil {
		return zero, &requestError{Status: http.StatusBadGateway, Code: "CLOUDFLARE_API_REQUEST_FAILED", Cause: err}
	}
	var envelope managedCloudflareEnvelope[T]
	if err := json.Unmarshal(payloadBytes, &envelope); err != nil {
		return zero, &requestError{Status: http.StatusBadGateway, Code: "CLOUDFLARE_API_REQUEST_FAILED", Cause: fmt.Errorf("decode Cloudflare response: %w", err)}
	}
	message := ""
	if len(envelope.Errors) > 0 {
		message = strings.TrimSpace(envelope.Errors[0].Message)
	}
	if response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden {
		if message == "" {
			message = "Cloudflare token is invalid or lacks required permissions"
		}
		return zero, &requestError{Status: http.StatusBadRequest, Code: "CLOUDFLARE_AUTH_FAILED", Cause: fmt.Errorf("%s", message)}
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 || !envelope.Success {
		if message == "" {
			message = fmt.Sprintf("Cloudflare API request failed with status %d", response.StatusCode)
		}
		return zero, &requestError{Status: http.StatusBadGateway, Code: "CLOUDFLARE_API_REQUEST_FAILED", Cause: fmt.Errorf("%s", message)}
	}
	return envelope.Result, nil
}

func resolveManagedCloudflareZone(ctx context.Context, client *http.Client, apiToken, domainName string, zoneID *string) (managedCloudflareZone, error) {
	if zoneID != nil {
		return fetchManagedCloudflare[managedCloudflareZone](ctx, client, "/zones/"+url.PathEscape(*zoneID), apiToken, nil)
	}
	for _, candidate := range resolveManagedCloudflareZoneCandidates(domainName) {
		zones, err := fetchManagedCloudflare[[]managedCloudflareZone](ctx, client, "/zones", apiToken, map[string]string{"name": candidate, "per_page": "1"})
		if err != nil {
			return managedCloudflareZone{}, err
		}
		for _, zone := range zones {
			if strings.EqualFold(zone.Name, candidate) {
				return zone, nil
			}
		}
	}
	return managedCloudflareZone{}, &requestError{Status: http.StatusNotFound, Code: "CLOUDFLARE_ZONE_NOT_FOUND"}
}

type managedCloudflareWorkerSummary struct {
	HasWorkerRule     bool
	HasExpectedWorker bool
	HasCatchAllWorker bool
	WorkerRuleNames   []string
}

func summarizeManagedCloudflareWorkerRules(rules []managedCloudflareRoutingRule) managedCloudflareWorkerSummary {
	result := managedCloudflareWorkerSummary{WorkerRuleNames: make([]string, 0)}
	for _, rule := range rules {
		hasWorker := false
		for _, action := range rule.Actions {
			if action.Type != "worker" {
				continue
			}
			hasWorker = true
			for _, value := range action.Value {
				if strings.Contains(value, managedCloudflareWorker) {
					result.HasExpectedWorker = true
				}
			}
		}
		if !hasWorker {
			continue
		}
		result.HasWorkerRule = true
		name := strings.TrimSpace(rule.Name)
		if name == "" {
			name = strings.TrimSpace(rule.ID)
		}
		if name == "" {
			name = "unnamed-rule"
		}
		result.WorkerRuleNames = append(result.WorkerRuleNames, name)
		for _, matcher := range rule.Matchers {
			if matcher.Type == "all" {
				result.HasCatchAllWorker = true
			}
		}
	}
	return result
}

func managedCloudflareZoneStatusCheck(zone managedCloudflareZone) managedCloudflareValidationCheck {
	status := "fail"
	message := "Cloudflare zone is " + managedValueOr(zone.Status, "unknown") + ". Nameserver delegation still needs attention."
	if zone.Status == "active" {
		status = "pass"
		message = "Cloudflare zone is active and nameserver delegation has completed."
	}
	return managedCloudflareValidationCheck{Key: "zone-status", Label: "Zone status", Status: status, Message: message, Details: zone.NameServers}
}

func managedCloudflareEmailRoutingCheck(settings managedCloudflareEmailRoutingSettings, canReceive bool) managedCloudflareValidationCheck {
	ready := settings.Enabled && settings.Status == "ready"
	status := "warn"
	if ready {
		status = "pass"
	} else if canReceive {
		status = "fail"
	}
	message := "Email Routing is " + managedValueOr(settings.Status, "not ready") + " for this zone."
	if ready {
		message = "Email Routing is enabled and ready."
	}
	return managedCloudflareValidationCheck{Key: "email-routing", Label: "Email Routing", Status: status, Message: message}
}

func managedCloudflareMXCheck(records []managedCloudflareDNSRecord, missing, canReceive bool) managedCloudflareValidationCheck {
	pass := !missing && len(records) > 0
	status := "warn"
	if pass {
		status = "pass"
	} else if canReceive {
		status = "fail"
	}
	message := "Cloudflare still reports missing inbound MX records."
	if pass {
		message = "Required inbound MX records are present."
	}
	details := make([]string, 0, len(records))
	for _, record := range records {
		details = append(details, managedValueOr(record.Name, "@")+" → "+record.Content)
	}
	return managedCloudflareValidationCheck{Key: "mx-records", Label: "MX records", Status: status, Message: message, Details: details}
}

func managedCloudflareSPFCheck(hasSPF, missing, canReceive bool) managedCloudflareValidationCheck {
	pass := !missing && hasSPF
	status := "warn"
	if pass {
		status = "pass"
	} else if canReceive {
		status = "fail"
	}
	message := "Cloudflare still reports a missing SPF TXT record."
	if pass {
		message = "Inbound SPF TXT record is present."
	}
	return managedCloudflareValidationCheck{Key: "spf-record", Label: "SPF record", Status: status, Message: message}
}

func managedCloudflareWorkerCheck(summary managedCloudflareWorkerSummary) managedCloudflareValidationCheck {
	status, message := "fail", "No Email Routing rule is currently bound to a worker."
	if summary.HasExpectedWorker {
		status, message = "pass", "Email Routing rules are bound to worker "+managedCloudflareWorker+"."
	} else if summary.HasWorkerRule {
		status, message = "warn", "Email Routing rules use a worker, but not the expected all-Mail worker name."
	}
	return managedCloudflareValidationCheck{Key: "worker-binding", Label: "Worker binding", Status: status, Message: message, Details: summary.WorkerRuleNames}
}

func managedCloudflareCatchAllCheck(summary managedCloudflareWorkerSummary, enabled bool) managedCloudflareValidationCheck {
	status, message := "pass", "Catch-all is not required for this domain."
	if enabled {
		if summary.HasCatchAllWorker {
			message = "Catch-all is enabled locally and a Cloudflare catch-all worker rule exists."
		} else {
			status, message = "fail", "Catch-all is enabled locally, but Cloudflare does not show an all-address worker rule."
		}
	} else if summary.HasCatchAllWorker {
		status, message = "info", "Cloudflare has a catch-all worker rule even though the local domain catch-all toggle is off."
	}
	return managedCloudflareValidationCheck{Key: "catch-all", Label: "Catch-all route", Status: status, Message: message}
}

func managedCloudflareDMARCCheck(has bool) managedCloudflareValidationCheck {
	if has {
		return managedCloudflareValidationCheck{Key: "dmarc", Label: "DMARC record", Status: "pass", Message: "A DMARC TXT record is present."}
	}
	return managedCloudflareValidationCheck{Key: "dmarc", Label: "DMARC record", Status: "warn", Message: "No DMARC TXT record was found. This is recommended for sender reputation, but not required for inbound routing."}
}

func managedCloudflareDKIMCheck(has bool) managedCloudflareValidationCheck {
	if has {
		return managedCloudflareValidationCheck{Key: "dkim", Label: "DKIM record", Status: "pass", Message: "At least one DKIM TXT record is present."}
	}
	return managedCloudflareValidationCheck{Key: "dkim", Label: "DKIM record", Status: "warn", Message: "No DKIM TXT record was found. For outbound mail, DKIM usually comes from your sending provider rather than Cloudflare Email Routing."}
}

func managedCloudflareOverallStatus(checks []managedCloudflareValidationCheck) string {
	for _, check := range checks {
		if check.Status == "fail" {
			return "fail"
		}
	}
	for _, check := range checks {
		if check.Status == "warn" {
			return "warn"
		}
	}
	return "pass"
}

func managedCloudflareCheckPassed(checks []managedCloudflareValidationCheck, key string) bool {
	for _, check := range checks {
		if check.Key == key {
			return check.Status == "pass"
		}
	}
	return false
}

func managedConditional(condition bool, value string) string {
	if condition {
		return value
	}
	return ""
}

func dedupeManagedStrings(values []string) []string {
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

func managedValueOr(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func managedDNSNonEmptyString(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func managedDNSStringPointer(value string) *string { return &value }
func managedDNSBoolPointer(value bool) *bool       { return &value }
