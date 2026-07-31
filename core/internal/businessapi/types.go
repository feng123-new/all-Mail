package businessapi

import "time"

const (
	adminJWTAudience       = "admin-console"
	adminRevealJWTAudience = "admin-email-secret-reveal"
	adminRevealJWTPurpose  = "external_password_reveal"
	adminRevealGrantTTL    = 10 * time.Minute
	allMailJWTIssuer       = "all-mail"
)

var errNotFound = &storeError{message: "record not found"}

type storeError struct {
	message string
}

func (e *storeError) Error() string {
	return e.message
}

type Admin struct {
	ID                 int64
	Username           string
	Role               string
	Status             string
	MustChangePassword bool
	SessionVersion     int64
	TwoFactorEnabled   bool
	TwoFactorSecret    *string
}

type DashboardStats struct {
	Emails     EmailStats      `json:"emails"`
	APIKeys    APIKeyStats     `json:"apiKeys"`
	DomainMail DomainMailStats `json:"domainMail"`
}

type EmailStats struct {
	Total  int64 `json:"total"`
	Active int64 `json:"active"`
	Error  int64 `json:"error"`
}

type APIKeyStats struct {
	Total       int64 `json:"total"`
	Active      int64 `json:"active"`
	TotalUsage  int64 `json:"totalUsage"`
	TodayActive int64 `json:"todayActive"`
}

type DomainMailStats struct {
	Domains          int64 `json:"domains"`
	ActiveDomains    int64 `json:"activeDomains"`
	Mailboxes        int64 `json:"mailboxes"`
	ActiveMailboxes  int64 `json:"activeMailboxes"`
	InboundMessages  int64 `json:"inboundMessages"`
	OutboundMessages int64 `json:"outboundMessages"`
}

type TrendPoint struct {
	Date  string `json:"date"`
	Count int64  `json:"count"`
}

type DashboardLogInput struct {
	Page     int
	PageSize int
	Action   string
}

type DashboardLogs struct {
	List     []DashboardLog `json:"list"`
	Total    int64          `json:"total"`
	Page     int            `json:"page"`
	PageSize int            `json:"pageSize"`
}

type DashboardLog struct {
	ID             int64   `json:"id"`
	Action         string  `json:"action"`
	APIKeyName     string  `json:"apiKeyName"`
	Email          string  `json:"email"`
	RequestIP      *string `json:"requestIp"`
	ResponseCode   *int32  `json:"responseCode"`
	ResponseTimeMS *int32  `json:"responseTimeMs"`
	RequestID      *string `json:"requestId"`
	CreatedAt      string  `json:"createdAt"`
}

func formatAPITime(value time.Time) string {
	return value.UTC().Format("2006-01-02T15:04:05.000Z")
}
