package businessapi

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"
)

const forwardingJobLastErrorPreviewLimit = 160

type forwardingJobListInput struct {
	Page      int
	PageSize  int
	Status    string
	Mode      string
	MailboxID *int64
	DomainID  *int64
	Keyword   string
}

type forwardingJobCommon struct {
	ID                string  `json:"id"`
	InboundMessageID  string  `json:"inboundMessageId"`
	MailboxID         *int64  `json:"mailboxId"`
	DomainID          int64   `json:"domainId"`
	Mode              string  `json:"mode"`
	ForwardTo         string  `json:"forwardTo"`
	Status            string  `json:"status"`
	AttemptCount      int     `json:"attemptCount"`
	LastError         *string `json:"lastError"`
	ProviderMessageID *string `json:"providerMessageId"`
	NextAttemptAt     *string `json:"nextAttemptAt"`
	ProcessedAt       *string `json:"processedAt"`
	CreatedAt         string  `json:"createdAt"`
	UpdatedAt         string  `json:"updatedAt"`
}

type forwardingJobMailboxSummary struct {
	ID               int64  `json:"id"`
	Address          string `json:"address"`
	ProvisioningMode string `json:"provisioningMode"`
}

type forwardingJobMailboxDetail struct {
	ID               int64   `json:"id"`
	Address          string  `json:"address"`
	ProvisioningMode string  `json:"provisioningMode"`
	ForwardMode      string  `json:"forwardMode"`
	ForwardTo        *string `json:"forwardTo"`
}

type forwardingJobDomainSummary struct {
	ID         int64  `json:"id"`
	Name       string `json:"name"`
	CanSend    bool   `json:"canSend"`
	CanReceive bool   `json:"canReceive"`
}

type forwardingJobInboundSummary struct {
	ID             string  `json:"id"`
	FromAddress    string  `json:"fromAddress"`
	Subject        *string `json:"subject"`
	MatchedAddress string  `json:"matchedAddress"`
	FinalAddress   string  `json:"finalAddress"`
	RouteKind      *string `json:"routeKind"`
	ReceivedAt     string  `json:"receivedAt"`
	PortalState    string  `json:"portalState"`
}

type forwardingJobInboundDetail struct {
	forwardingJobInboundSummary
	HasTextPreview bool `json:"hasTextPreview"`
	HasHTMLPreview bool `json:"hasHtmlPreview"`
}

type forwardingJobListItem struct {
	forwardingJobCommon
	Mailbox        *forwardingJobMailboxSummary `json:"mailbox"`
	Domain         forwardingJobDomainSummary   `json:"domain"`
	InboundMessage forwardingJobInboundSummary  `json:"inboundMessage"`
}

type forwardingJobListResult struct {
	List     []forwardingJobListItem `json:"list"`
	Total    int64                   `json:"total"`
	Page     int                     `json:"page"`
	PageSize int                     `json:"pageSize"`
}

type forwardingJobDetail struct {
	forwardingJobCommon
	Mailbox        *forwardingJobMailboxDetail `json:"mailbox"`
	Domain         forwardingJobDomainSummary  `json:"domain"`
	InboundMessage forwardingJobInboundDetail  `json:"inboundMessage"`
}

type forwardingJobRequeueResult struct {
	ID                string  `json:"id"`
	Status            string  `json:"status"`
	AttemptCount      int     `json:"attemptCount"`
	LastError         *string `json:"lastError"`
	ProviderMessageID *string `json:"providerMessageId"`
	NextAttemptAt     string  `json:"nextAttemptAt"`
	ProcessedAt       *string `json:"processedAt"`
	UpdatedAt         string  `json:"updatedAt"`
}

type forwardingJobAdminStore interface {
	ListForwardingJobs(context.Context, forwardingJobListInput) (forwardingJobListResult, error)
	GetForwardingJob(context.Context, int64) (forwardingJobDetail, error)
	RequeueForwardingJob(context.Context, int64, time.Time) (forwardingJobRequeueResult, error)
}

func (s *Server) registerForwardingJobRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /admin/forwarding-jobs", s.withAdministrator(s.listForwardingJobs))
	mux.HandleFunc("GET /admin/forwarding-jobs/{id}", s.withAdministrator(s.getForwardingJob))
	mux.HandleFunc("POST /admin/forwarding-jobs/{id}/requeue", s.withAdministrator(s.requeueForwardingJob))
}

func (s *Server) forwardingJobAdminStore() (forwardingJobAdminStore, error) {
	store, ok := s.store.(forwardingJobAdminStore)
	if !ok || store == nil {
		return nil, &requestError{Status: http.StatusServiceUnavailable, Code: "FORWARDING_JOB_STORE_UNAVAILABLE"}
	}
	return store, nil
}

func (s *Server) listForwardingJobs(w http.ResponseWriter, r *http.Request, _ Admin) {
	store, err := s.forwardingJobAdminStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	input, err := parseForwardingJobListInput(r)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	result, err := store.ListForwardingJobs(r.Context(), input)
	if err != nil {
		s.writeStoreError(w, r, "list forwarding jobs", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) getForwardingJob(w http.ResponseWriter, r *http.Request, _ Admin) {
	store, err := s.forwardingJobAdminStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	id, err := parseForwardingJobID(r.PathValue("id"))
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	result, err := store.GetForwardingJob(r.Context(), id)
	if err != nil {
		s.writeStoreError(w, r, "get forwarding job", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) requeueForwardingJob(w http.ResponseWriter, r *http.Request, _ Admin) {
	store, err := s.forwardingJobAdminStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	id, err := parseForwardingJobID(r.PathValue("id"))
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	result, err := store.RequeueForwardingJob(r.Context(), id, s.now().UTC())
	if err != nil {
		s.writeStoreError(w, r, "requeue forwarding job", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func parseForwardingJobListInput(r *http.Request) (forwardingJobListInput, error) {
	query := r.URL.Query()
	page, err := parseForwardingJobIntegerQuery(query["page"], "page", 1, 1, math.MaxInt)
	if err != nil {
		return forwardingJobListInput{}, err
	}
	pageSize, err := parseForwardingJobIntegerQuery(query["pageSize"], "pageSize", 20, 1, 100)
	if err != nil {
		return forwardingJobListInput{}, err
	}
	if page > math.MaxInt/pageSize {
		return forwardingJobListInput{}, validationError("page is too large")
	}
	status, err := parseForwardingJobEnumQuery(query["status"], "status", "PENDING", "RUNNING", "SENT", "FAILED", "SKIPPED")
	if err != nil {
		return forwardingJobListInput{}, err
	}
	mode, err := parseForwardingJobEnumQuery(query["mode"], "mode", "COPY", "MOVE")
	if err != nil {
		return forwardingJobListInput{}, err
	}
	mailboxID, err := parseForwardingJobIDQuery(query["mailboxId"], "mailboxId")
	if err != nil {
		return forwardingJobListInput{}, err
	}
	domainID, err := parseForwardingJobIDQuery(query["domainId"], "domainId")
	if err != nil {
		return forwardingJobListInput{}, err
	}
	keyword, err := parseForwardingJobKeyword(query["keyword"])
	if err != nil {
		return forwardingJobListInput{}, err
	}
	return forwardingJobListInput{
		Page: page, PageSize: pageSize, Status: status, Mode: mode,
		MailboxID: mailboxID, DomainID: domainID, Keyword: keyword,
	}, nil
}

func parseForwardingJobIntegerQuery(values []string, field string, fallback, minimum, maximum int) (int, error) {
	if values == nil {
		return fallback, nil
	}
	if len(values) != 1 {
		return 0, validationError(field + " must be an integer")
	}
	raw := strings.TrimSpace(values[0])
	if raw == "" {
		raw = "0"
	}
	number, err := strconv.ParseFloat(raw, 64)
	if err != nil || math.IsInf(number, 0) || math.IsNaN(number) || math.Trunc(number) != number ||
		number < float64(minimum) || number > float64(maximum) || number >= math.Exp2(strconv.IntSize-1) {
		return 0, validationError(fmt.Sprintf("%s must be an integer between %d and %d", field, minimum, maximum))
	}
	return int(number), nil
}

func parseForwardingJobEnumQuery(values []string, field string, allowed ...string) (string, error) {
	if values == nil {
		return "", nil
	}
	if len(values) != 1 {
		return "", validationError(field + " contains an unsupported value")
	}
	for _, candidate := range allowed {
		if values[0] == candidate {
			return candidate, nil
		}
	}
	return "", validationError(field + " contains an unsupported value")
}

func parseForwardingJobIDQuery(values []string, field string) (*int64, error) {
	if values == nil {
		return nil, nil
	}
	if len(values) != 1 {
		return nil, validationError(field + " must be a positive integer")
	}
	raw := strings.TrimSpace(values[0])
	if raw == "" {
		raw = "0"
	}
	number, err := strconv.ParseFloat(raw, 64)
	if err != nil || math.IsInf(number, 0) || math.IsNaN(number) || math.Trunc(number) != number ||
		number <= 0 || number >= math.Exp2(63) {
		return nil, validationError(field + " must be a positive integer")
	}
	value := int64(number)
	return &value, nil
}

func parseForwardingJobKeyword(values []string) (string, error) {
	if values == nil {
		return "", nil
	}
	if len(values) != 1 {
		return "", validationError("keyword must contain between 1 and 255 characters")
	}
	value := strings.TrimSpace(values[0])
	length := len(utf16.Encode([]rune(value)))
	if length < 1 || length > 255 {
		return "", validationError("keyword must contain between 1 and 255 characters")
	}
	return value, nil
}

func parseForwardingJobID(raw string) (int64, error) {
	value, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
	if err != nil {
		return 0, &requestError{Status: http.StatusBadRequest, Code: "FORWARDING_JOB_INVALID_ID"}
	}
	return value, nil
}

func truncateForwardingJobLastError(value *string) *string {
	if value == nil {
		return nil
	}
	units := utf16.Encode([]rune(*value))
	if len(units) <= forwardingJobLastErrorPreviewLimit {
		result := *value
		return &result
	}
	result := string(utf16.Decode(units[:forwardingJobLastErrorPreviewLimit-1])) + "\u2026"
	return &result
}
