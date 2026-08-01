package businessapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/legacycrypto"
)

const (
	cloudflareAPIBaseURL = "https://api.cloudflare.com/client/v4"
	allMailWorkerName    = "allmail-edge"
)

type domainCloudflareConfigInput struct {
	APITokenPresent bool
	APIToken        *string
	ZoneIDPresent   bool
	ZoneID          *string
	ClearSavedToken bool
}

type domainDNSStatus struct {
	Provider                  *string                    `json:"provider,omitempty"`
	ExpectedMXConfigured      *bool                      `json:"expectedMxConfigured,omitempty"`
	ExpectedIngressConfigured *bool                      `json:"expectedIngressConfigured,omitempty"`
	Cloudflare                *domainCloudflareDNSStatus `json:"cloudflare,omitempty"`
}

type domainCloudflareDNSStatus struct {
	APITokenEncrypted *string                           `json:"apiTokenEncrypted"`
	TokenHint         *string                           `json:"tokenHint"`
	ZoneID            *string                           `json:"zoneId"`
	LastValidation    *domainCloudflareValidationResult `json:"lastValidation"`
	LastValidatedAt   *string                           `json:"lastValidatedAt"`
}

type domainSafeDNSStatus struct {
	Provider                  *string                        `json:"provider"`
	ExpectedMXConfigured      bool                           `json:"expectedMxConfigured"`
	ExpectedIngressConfigured bool                           `json:"expectedIngressConfigured"`
	Cloudflare                *domainSafeCloudflareDNSStatus `json:"cloudflare,omitempty"`
}

type domainSafeCloudflareDNSStatus struct {
	TokenHint       *string `json:"tokenHint"`
	ZoneID          *string `json:"zoneId"`
	LastValidatedAt *string `json:"lastValidatedAt"`
}

type domainCloudflareValidationCheck struct {
	Key     string    `json:"key"`
	Label   string    `json:"label"`
	Status  string    `json:"status"`
	Message string    `json:"message"`
	Details *[]string `json:"details,omitempty"`
}

type domainCloudflareValidationResult struct {
	Status             string                            `json:"status"`
	ZoneID             *string                           `json:"zoneId"`
	ZoneName           *string                           `json:"zoneName"`
	ZoneStatus         *string                           `json:"zoneStatus"`
	EmailRoutingStatus *string                           `json:"emailRoutingStatus"`
	LastValidatedAt    string                            `json:"lastValidatedAt"`
	Checks             []domainCloudflareValidationCheck `json:"checks"`
	ManualActions      []string                          `json:"manualActions"`
}

type domainCloudflareValidationView struct {
	HasSavedToken   bool                              `json:"hasSavedToken"`
	TokenHint       *string                           `json:"tokenHint"`
	ZoneID          *string                           `json:"zoneId"`
	LastValidation  *domainCloudflareValidationResult `json:"lastValidation"`
	LastValidatedAt *string                           `json:"lastValidatedAt"`
}

type domainCloudflareValidationTarget struct {
	DomainName        string
	CanReceive        bool
	IsCatchAllEnabled bool
	APIToken          string
	ZoneID            string
	ConfigFingerprint string
}

type cloudflareAPIEnvelope struct {
	Success bool            `json:"success"`
	Result  json.RawMessage `json:"result"`
	Errors  []struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"errors"`
}

type cloudflareZone struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Status      string   `json:"status"`
	NameServers []string `json:"name_servers"`
}

type cloudflareDNSRecord struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Name     string `json:"name"`
	Content  string `json:"content"`
	Priority int    `json:"priority"`
}

type cloudflareEmailRoutingSettings struct {
	Enabled bool   `json:"enabled"`
	Status  string `json:"status"`
	Name    string `json:"name"`
}

type cloudflareEmailRoutingDNSResult struct {
	Errors []struct {
		Code    string               `json:"code"`
		Missing *cloudflareDNSRecord `json:"missing"`
	} `json:"errors"`
	Record []cloudflareDNSRecord `json:"record"`
}

type cloudflareRoutingRule struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Enabled bool   `json:"enabled"`
	Actions []struct {
		Type  string   `json:"type"`
		Value []string `json:"value"`
	} `json:"actions"`
	Matchers []struct {
		Type  string `json:"type"`
		Field string `json:"field"`
		Value string `json:"value"`
	} `json:"matchers"`
}

func parseDomainDNSStatus(raw []byte) domainDNSStatus {
	if len(raw) == 0 {
		return domainDNSStatus{}
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(raw, &object); err != nil || object == nil {
		return domainDNSStatus{}
	}
	status := domainDNSStatus{}
	status.Provider = normalizedJSONOptionalString(object["provider"])
	status.ExpectedMXConfigured = optionalJSONBool(object["expectedMxConfigured"])
	status.ExpectedIngressConfigured = optionalJSONBool(object["expectedIngressConfigured"])
	var cloudflare map[string]json.RawMessage
	if err := json.Unmarshal(object["cloudflare"], &cloudflare); err == nil && cloudflare != nil {
		parsed := &domainCloudflareDNSStatus{
			APITokenEncrypted: normalizedJSONOptionalString(cloudflare["apiTokenEncrypted"]),
			TokenHint:         normalizedJSONOptionalString(cloudflare["tokenHint"]),
			ZoneID:            normalizedJSONOptionalString(cloudflare["zoneId"]),
			LastValidatedAt:   normalizedJSONOptionalString(cloudflare["lastValidatedAt"]),
		}
		var validation domainCloudflareValidationResult
		if err := json.Unmarshal(cloudflare["lastValidation"], &validation); err == nil && len(cloudflare["lastValidation"]) > 0 && strings.TrimSpace(string(cloudflare["lastValidation"])) != "null" {
			if validation.Checks == nil {
				validation.Checks = []domainCloudflareValidationCheck{}
			}
			if validation.ManualActions == nil {
				validation.ManualActions = []string{}
			}
			parsed.LastValidation = &validation
		}
		status.Cloudflare = parsed
	}
	return status
}

func normalizedJSONOptionalString(raw json.RawMessage) *string {
	var value string
	if len(raw) == 0 || json.Unmarshal(raw, &value) != nil {
		return nil
	}
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func optionalJSONBool(raw json.RawMessage) *bool {
	var value bool
	if len(raw) == 0 || json.Unmarshal(raw, &value) != nil {
		return nil
	}
	return &value
}

func saveCloudflareConfigToDomainDNS(current domainDNSStatus, input domainCloudflareConfigInput, encryptionKey string) (domainDNSStatus, error) {
	provider := current.Provider
	if provider == nil {
		value := "CLOUDFLARE"
		provider = &value
	}
	cloudflare := current.Cloudflare
	if cloudflare == nil {
		cloudflare = &domainCloudflareDNSStatus{}
	}
	next := &domainCloudflareDNSStatus{
		APITokenEncrypted: cloudflare.APITokenEncrypted,
		TokenHint:         cloudflare.TokenHint,
		ZoneID:            cloudflare.ZoneID,
		LastValidation:    cloudflare.LastValidation,
		LastValidatedAt:   cloudflare.LastValidatedAt,
	}
	if input.ZoneIDPresent {
		next.ZoneID = normalizedStringPointer(input.ZoneID)
	}
	if input.ClearSavedToken {
		next.APITokenEncrypted = nil
		next.TokenHint = nil
		next.LastValidation = nil
		next.LastValidatedAt = nil
	} else if token := normalizedStringPointer(input.APIToken); input.APITokenPresent && token != nil {
		encrypted, err := legacycrypto.Encrypt(encryptionKey, *token)
		if err != nil {
			return domainDNSStatus{}, fmt.Errorf("encrypt Cloudflare API token: %w", err)
		}
		next.APITokenEncrypted = &encrypted
		hint := buildCloudflareTokenHint(*token)
		next.TokenHint = &hint
	}
	return domainDNSStatus{
		Provider: provider, ExpectedMXConfigured: current.ExpectedMXConfigured,
		ExpectedIngressConfigured: current.ExpectedIngressConfigured, Cloudflare: next,
	}, nil
}

func normalizedStringPointer(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func buildCloudflareTokenHint(token string) string {
	token = strings.TrimSpace(token)
	if len(token) <= 4 {
		if token == "" {
			return "Saved Cloudflare token"
		}
		return "Saved token ending in " + token
	}
	return "Saved token ending in " + token[len(token)-4:]
}

func savedCloudflareToken(status domainDNSStatus, encryptionKey string) (string, error) {
	if status.Cloudflare == nil || status.Cloudflare.APITokenEncrypted == nil {
		return "", nil
	}
	value, err := legacycrypto.Decrypt(encryptionKey, *status.Cloudflare.APITokenEncrypted)
	if err != nil {
		return "", fmt.Errorf("decrypt Cloudflare API token: %w", err)
	}
	return value, nil
}

func safeDomainDNSStatus(status domainDNSStatus) *domainSafeDNSStatus {
	if status.Provider == nil && status.ExpectedMXConfigured == nil && status.ExpectedIngressConfigured == nil && status.Cloudflare == nil {
		return nil
	}
	result := &domainSafeDNSStatus{Provider: status.Provider}
	if status.ExpectedMXConfigured != nil {
		result.ExpectedMXConfigured = *status.ExpectedMXConfigured
	}
	if status.ExpectedIngressConfigured != nil {
		result.ExpectedIngressConfigured = *status.ExpectedIngressConfigured
	}
	if status.Cloudflare != nil {
		result.Cloudflare = &domainSafeCloudflareDNSStatus{
			TokenHint: status.Cloudflare.TokenHint, ZoneID: status.Cloudflare.ZoneID,
			LastValidatedAt: status.Cloudflare.LastValidatedAt,
		}
	}
	return result
}

func cloudflareValidationViewForDNS(status domainDNSStatus) domainCloudflareValidationView {
	view := domainCloudflareValidationView{}
	if status.Cloudflare == nil {
		return view
	}
	view.HasSavedToken = status.Cloudflare.APITokenEncrypted != nil
	view.TokenHint = status.Cloudflare.TokenHint
	view.ZoneID = status.Cloudflare.ZoneID
	view.LastValidation = status.Cloudflare.LastValidation
	view.LastValidatedAt = status.Cloudflare.LastValidatedAt
	return view
}

func domainCloudflareConfigFingerprint(status domainDNSStatus) string {
	encryptedToken := ""
	zoneID := ""
	if status.Cloudflare != nil {
		if status.Cloudflare.APITokenEncrypted != nil {
			encryptedToken = *status.Cloudflare.APITokenEncrypted
		}
		if status.Cloudflare.ZoneID != nil {
			zoneID = *status.Cloudflare.ZoneID
		}
	}
	digest := sha256.Sum256([]byte(encryptedToken + "\x00" + zoneID))
	return hex.EncodeToString(digest[:])
}

func mergeCloudflareValidationIntoDomainDNS(current domainDNSStatus, validation domainCloudflareValidationResult) domainDNSStatus {
	provider := current.Provider
	if provider == nil {
		value := "CLOUDFLARE"
		provider = &value
	}
	mxConfigured := false
	ingressConfigured := false
	for _, check := range validation.Checks {
		if check.Key == "mx-records" && check.Status == "pass" {
			mxConfigured = true
		}
		if check.Key == "worker-binding" && check.Status == "pass" {
			ingressConfigured = true
		}
	}
	cloudflare := &domainCloudflareDNSStatus{}
	if current.Cloudflare != nil {
		cloudflare.APITokenEncrypted = current.Cloudflare.APITokenEncrypted
		cloudflare.TokenHint = current.Cloudflare.TokenHint
		cloudflare.ZoneID = current.Cloudflare.ZoneID
	}
	if validation.ZoneID != nil {
		cloudflare.ZoneID = validation.ZoneID
	}
	cloudflare.LastValidation = &validation
	cloudflare.LastValidatedAt = &validation.LastValidatedAt
	return domainDNSStatus{
		Provider: provider, ExpectedMXConfigured: &mxConfigured,
		ExpectedIngressConfigured: &ingressConfigured, Cloudflare: cloudflare,
	}
}

func resolveCloudflareZoneCandidates(domainName string) []string {
	normalized := strings.ToLower(strings.TrimSpace(domainName))
	segments := make([]string, 0)
	for _, segment := range strings.Split(normalized, ".") {
		if segment != "" {
			segments = append(segments, segment)
		}
	}
	if len(segments) < 2 {
		if normalized == "" {
			return []string{}
		}
		return []string{normalized}
	}
	result := make([]string, 0, len(segments)-1)
	seen := make(map[string]struct{})
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

func fetchCloudflare[T any](ctx context.Context, client *http.Client, path, token string, query map[string]any) (T, error) {
	var zero T
	endpoint, err := url.Parse(cloudflareAPIBaseURL + path)
	if err != nil {
		return zero, fmt.Errorf("build Cloudflare URL: %w", err)
	}
	values := endpoint.Query()
	for key, value := range query {
		if value != nil {
			values.Set(key, fmt.Sprint(value))
		}
	}
	endpoint.RawQuery = values.Encode()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return zero, fmt.Errorf("create Cloudflare request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/json")
	response, err := client.Do(request)
	if err != nil {
		return zero, fmt.Errorf("perform Cloudflare request: %w", err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	if err != nil {
		return zero, fmt.Errorf("read Cloudflare response: %w", err)
	}
	var envelope cloudflareAPIEnvelope
	if err := json.Unmarshal(body, &envelope); err != nil {
		return zero, fmt.Errorf("decode Cloudflare response: %w", err)
	}
	message := ""
	if len(envelope.Errors) > 0 {
		message = strings.TrimSpace(envelope.Errors[0].Message)
	}
	if response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden {
		if message == "" {
			message = "Cloudflare token is invalid or lacks required permissions"
		}
		return zero, &requestError{Status: http.StatusBadRequest, Code: "CLOUDFLARE_AUTH_FAILED", Cause: errors.New(message)}
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 || !envelope.Success {
		if message == "" {
			message = "Cloudflare API request failed with status " + strconv.Itoa(response.StatusCode)
		}
		return zero, &requestError{Status: http.StatusBadGateway, Code: "CLOUDFLARE_API_REQUEST_FAILED", Cause: errors.New(message)}
	}
	var result T
	if err := json.Unmarshal(envelope.Result, &result); err != nil {
		return zero, fmt.Errorf("decode Cloudflare result: %w", err)
	}
	return result, nil
}

func resolveCloudflareZone(ctx context.Context, client *http.Client, token, domainName, zoneID string) (cloudflareZone, error) {
	if zoneID != "" {
		return fetchCloudflare[cloudflareZone](ctx, client, "/zones/"+url.PathEscape(zoneID), token, nil)
	}
	for _, candidate := range resolveCloudflareZoneCandidates(domainName) {
		zones, err := fetchCloudflare[[]cloudflareZone](ctx, client, "/zones", token, map[string]any{"name": candidate, "per_page": 1})
		if err != nil {
			return cloudflareZone{}, err
		}
		for _, zone := range zones {
			if strings.ToLower(zone.Name) == candidate {
				return zone, nil
			}
		}
	}
	return cloudflareZone{}, &requestError{Status: http.StatusNotFound, Code: "CLOUDFLARE_ZONE_NOT_FOUND"}
}

func validateCloudflareDomain(ctx context.Context, client *http.Client, target domainCloudflareValidationTarget, now time.Time) (domainCloudflareValidationResult, error) {
	zone, err := resolveCloudflareZone(ctx, client, target.APIToken, target.DomainName, target.ZoneID)
	if err != nil {
		return domainCloudflareValidationResult{}, err
	}
	var emailRouting cloudflareEmailRoutingSettings
	var emailRoutingDNS cloudflareEmailRoutingDNSResult
	var mxRecords []cloudflareDNSRecord
	var txtRecords []cloudflareDNSRecord
	var rules []cloudflareRoutingRule
	errorsByRequest := make([]error, 5)
	var wait sync.WaitGroup
	wait.Add(5)
	go func() {
		defer wait.Done()
		emailRouting, errorsByRequest[0] = fetchCloudflare[cloudflareEmailRoutingSettings](ctx, client, "/zones/"+url.PathEscape(zone.ID)+"/email/routing", target.APIToken, nil)
	}()
	go func() {
		defer wait.Done()
		emailRoutingDNS, errorsByRequest[1] = fetchCloudflare[cloudflareEmailRoutingDNSResult](ctx, client, "/zones/"+url.PathEscape(zone.ID)+"/email/routing/dns", target.APIToken, nil)
	}()
	go func() {
		defer wait.Done()
		mxRecords, errorsByRequest[2] = fetchCloudflare[[]cloudflareDNSRecord](ctx, client, "/zones/"+url.PathEscape(zone.ID)+"/dns_records", target.APIToken, map[string]any{"type": "MX", "per_page": 100})
	}()
	go func() {
		defer wait.Done()
		txtRecords, errorsByRequest[3] = fetchCloudflare[[]cloudflareDNSRecord](ctx, client, "/zones/"+url.PathEscape(zone.ID)+"/dns_records", target.APIToken, map[string]any{"type": "TXT", "per_page": 200})
	}()
	go func() {
		defer wait.Done()
		rules, errorsByRequest[4] = fetchCloudflare[[]cloudflareRoutingRule](ctx, client, "/zones/"+url.PathEscape(zone.ID)+"/email/routing/rules", target.APIToken, map[string]any{"enabled": true, "per_page": 100})
	}()
	wait.Wait()
	for _, requestErr := range errorsByRequest {
		if requestErr != nil {
			return domainCloudflareValidationResult{}, requestErr
		}
	}

	missingMX := false
	missingSPF := false
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
	hasSPF := hasCloudflareTXTRecord(txtRecords, func(record cloudflareDNSRecord) bool {
		return strings.ToLower(record.Name) == zoneName && strings.Contains(strings.ToLower(record.Content), "v=spf1")
	})
	hasDMARC := hasCloudflareTXTRecord(txtRecords, func(record cloudflareDNSRecord) bool {
		return strings.ToLower(record.Name) == "_dmarc."+zoneName && strings.Contains(strings.ToLower(record.Content), "v=dmarc1")
	})
	hasDKIM := hasCloudflareTXTRecord(txtRecords, func(record cloudflareDNSRecord) bool {
		name := strings.ToLower(record.Name)
		return strings.Contains(name, "._domainkey.") && strings.HasSuffix(name, "."+zoneName)
	})
	worker := summarizeCloudflareWorkerRules(rules)
	mxDetails := make([]string, 0, len(mxRecords))
	for _, record := range mxRecords {
		name := record.Name
		if name == "" {
			name = "@"
		}
		mxDetails = append(mxDetails, name+" \u2192 "+record.Content)
	}
	workerDetails := append([]string(nil), worker.RuleNames...)
	checks := []domainCloudflareValidationCheck{
		{
			Key: "zone-status", Label: "Zone status", Status: chooseCloudflareStatus(zone.Status == "active", "pass", "fail"),
			Message: cloudflareZoneStatusMessage(zone), Details: optionalCloudflareDetails(zone.NameServers),
		},
		{
			Key: "email-routing", Label: "Email Routing",
			Status:  chooseRequiredCloudflareStatus(emailRouting.Enabled && emailRouting.Status == "ready", target.CanReceive),
			Message: cloudflareEmailRoutingMessage(emailRouting),
		},
		{
			Key: "mx-records", Label: "MX records",
			Status:  chooseRequiredCloudflareStatus(!missingMX && len(mxRecords) > 0, target.CanReceive),
			Message: chooseCloudflareMessage(!missingMX && len(mxRecords) > 0, "Required inbound MX records are present.", "Cloudflare still reports missing inbound MX records."),
			Details: &mxDetails,
		},
		{
			Key: "spf-record", Label: "SPF record",
			Status:  chooseRequiredCloudflareStatus(!missingSPF && hasSPF, target.CanReceive),
			Message: chooseCloudflareMessage(!missingSPF && hasSPF, "Inbound SPF TXT record is present.", "Cloudflare still reports a missing SPF TXT record."),
		},
		{
			Key: "worker-binding", Label: "Worker binding", Status: worker.Status(), Message: worker.Message(), Details: &workerDetails,
		},
		{
			Key: "catch-all", Label: "Catch-all route",
			Status:  cloudflareCatchAllStatus(target.IsCatchAllEnabled, worker.HasCatchAllWorker),
			Message: cloudflareCatchAllMessage(target.IsCatchAllEnabled, worker.HasCatchAllWorker),
		},
		{
			Key: "dmarc", Label: "DMARC record", Status: chooseCloudflareStatus(hasDMARC, "pass", "warn"),
			Message: chooseCloudflareMessage(hasDMARC, "A DMARC TXT record is present.", "No DMARC TXT record was found. This is recommended for sender reputation, but not required for inbound routing."),
		},
		{
			Key: "dkim", Label: "DKIM record", Status: chooseCloudflareStatus(hasDKIM, "pass", "warn"),
			Message: chooseCloudflareMessage(hasDKIM, "At least one DKIM TXT record is present.", "No DKIM TXT record was found. For outbound mail, DKIM usually comes from your sending provider rather than Cloudflare Email Routing."),
		},
	}
	manualActions := dedupeCloudflareStrings([]string{
		chooseCloudflareAction(zone.Status != "active", "Update the registrar nameservers to the Cloudflare nameservers shown for this zone, then wait for the zone status to become active."),
		chooseCloudflareAction(!(emailRouting.Enabled && emailRouting.Status == "ready"), "Open Cloudflare Dashboard \u2192 Email Routing and complete or repair Email Routing until the status becomes ready."),
		chooseCloudflareAction(!worker.HasExpectedWorker, "Bind a custom address or catch-all rule to worker "+allMailWorkerName+" in Cloudflare Email Routing."),
		chooseCloudflareAction(target.IsCatchAllEnabled && !worker.HasCatchAllWorker, "Because this domain enables catch-all locally, create a matching catch-all Email Routing worker rule in Cloudflare."),
		chooseCloudflareAction(!hasDMARC, "Add a DMARC TXT record if you want stronger email policy visibility and better sender reputation hygiene."),
	})
	zoneID := zone.ID
	zoneNameValue := zone.Name
	zoneStatus := normalizedStringPointer(&zone.Status)
	routingStatus := normalizedStringPointer(&emailRouting.Status)
	return domainCloudflareValidationResult{
		Status: overallCloudflareStatus(checks), ZoneID: &zoneID, ZoneName: &zoneNameValue,
		ZoneStatus: zoneStatus, EmailRoutingStatus: routingStatus,
		LastValidatedAt: formatAPITime(now), Checks: checks, ManualActions: manualActions,
	}, nil
}

func hasCloudflareTXTRecord(records []cloudflareDNSRecord, predicate func(cloudflareDNSRecord) bool) bool {
	for _, record := range records {
		if record.Type == "TXT" && predicate(record) {
			return true
		}
	}
	return false
}

type cloudflareWorkerRuleSummary struct {
	HasWorkerRule     bool
	HasExpectedWorker bool
	HasCatchAllWorker bool
	RuleNames         []string
}

func summarizeCloudflareWorkerRules(rules []cloudflareRoutingRule) cloudflareWorkerRuleSummary {
	result := cloudflareWorkerRuleSummary{RuleNames: []string{}}
	for _, rule := range rules {
		hasWorker := false
		for _, action := range rule.Actions {
			if action.Type != "worker" {
				continue
			}
			hasWorker = true
			for _, value := range action.Value {
				if strings.Contains(value, allMailWorkerName) {
					result.HasExpectedWorker = true
				}
			}
		}
		if !hasWorker {
			continue
		}
		result.HasWorkerRule = true
		name := rule.Name
		if name == "" {
			name = rule.ID
		}
		if name == "" {
			name = "unnamed-rule"
		}
		result.RuleNames = append(result.RuleNames, name)
		for _, matcher := range rule.Matchers {
			if matcher.Type == "all" {
				result.HasCatchAllWorker = true
			}
		}
	}
	return result
}

func (summary cloudflareWorkerRuleSummary) Status() string {
	if summary.HasExpectedWorker {
		return "pass"
	}
	if summary.HasWorkerRule {
		return "warn"
	}
	return "fail"
}

func (summary cloudflareWorkerRuleSummary) Message() string {
	if summary.HasExpectedWorker {
		return "Email Routing rules are bound to worker " + allMailWorkerName + "."
	}
	if summary.HasWorkerRule {
		return "Email Routing rules use a worker, but not the expected all-Mail worker name."
	}
	return "No Email Routing rule is currently bound to a worker."
}

func optionalCloudflareDetails(values []string) *[]string {
	if len(values) == 0 {
		return nil
	}
	result := append([]string(nil), values...)
	return &result
}

func chooseCloudflareStatus(condition bool, yes, no string) string {
	if condition {
		return yes
	}
	return no
}

func chooseRequiredCloudflareStatus(passes, required bool) string {
	if passes {
		return "pass"
	}
	if required {
		return "fail"
	}
	return "warn"
}

func chooseCloudflareMessage(condition bool, yes, no string) string {
	if condition {
		return yes
	}
	return no
}

func cloudflareZoneStatusMessage(zone cloudflareZone) string {
	if zone.Status == "active" {
		return "Cloudflare zone is active and nameserver delegation has completed."
	}
	status := zone.Status
	if status == "" {
		status = "unknown"
	}
	return "Cloudflare zone is " + status + ". Nameserver delegation still needs attention."
}

func cloudflareEmailRoutingMessage(settings cloudflareEmailRoutingSettings) string {
	if settings.Enabled && settings.Status == "ready" {
		return "Email Routing is enabled and ready."
	}
	status := settings.Status
	if status == "" {
		status = "not ready"
	}
	return "Email Routing is " + status + " for this zone."
}

func cloudflareCatchAllStatus(enabled, hasRule bool) string {
	if enabled {
		return chooseCloudflareStatus(hasRule, "pass", "fail")
	}
	return chooseCloudflareStatus(hasRule, "info", "pass")
}

func cloudflareCatchAllMessage(enabled, hasRule bool) string {
	if enabled {
		return chooseCloudflareMessage(hasRule,
			"Catch-all is enabled locally and a Cloudflare catch-all worker rule exists.",
			"Catch-all is enabled locally, but Cloudflare does not show an all-address worker rule.")
	}
	return chooseCloudflareMessage(hasRule,
		"Cloudflare has a catch-all worker rule even though the local domain catch-all toggle is off.",
		"Catch-all is not required for this domain.")
}

func chooseCloudflareAction(condition bool, action string) string {
	if condition {
		return action
	}
	return ""
}

func dedupeCloudflareStrings(values []string) []string {
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
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

func overallCloudflareStatus(checks []domainCloudflareValidationCheck) string {
	status := "pass"
	for _, check := range checks {
		if check.Status == "fail" {
			return "fail"
		}
		if check.Status == "warn" {
			status = "warn"
		}
	}
	return status
}
