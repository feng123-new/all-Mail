package businessapi

import "time"

const (
	actionExternalAllocateMailbox        = "external_allocate_mailbox"
	actionExternalReadLatestMessage      = "external_read_latest_message"
	actionExternalReadMessageText        = "external_read_message_text"
	actionExternalListMessages           = "external_list_messages"
	actionExternalClearMailbox           = "external_clear_mailbox"
	actionExternalListMailboxes          = "external_list_mailboxes"
	actionExternalMailboxAllocationStats = "external_mailbox_allocation_stats"
	actionExternalMailboxAllocationReset = "external_mailbox_allocation_reset"
	actionDomainAllocateMailbox          = "domain_allocate_mailbox"
	actionDomainReadLatestMessage        = "domain_read_latest_message"
	actionDomainReadMessageText          = "domain_read_message_text"
	actionDomainListMessages             = "domain_list_messages"
	actionDomainListMailboxes            = "domain_list_mailboxes"
	actionDomainMailboxAllocationStats   = "domain_mailbox_allocation_stats"
	actionDomainMailboxAllocationReset   = "domain_mailbox_allocation_reset"
)

type APIKeyPrincipal struct {
	ID          int64
	Name        string
	RateLimit   int
	Status      string
	ExpiresAt   *time.Time
	Permissions map[string]bool
}

type APIKeyScope struct {
	AllowedGroupIDs  []int64
	AllowedEmailIDs  []int64
	AllowedDomainIDs []int64
}

type APIKeyListInput struct {
	Page     int
	PageSize int
	Status   string
	Keyword  string
}

type APIKeyList struct {
	List     []APIKeyListItem `json:"list"`
	Total    int64            `json:"total"`
	Page     int              `json:"page"`
	PageSize int              `json:"pageSize"`
}

type APIKeyCreator struct {
	Username string `json:"username"`
}

type APIKeyListItem struct {
	ID            int64          `json:"id"`
	Name          string         `json:"name"`
	KeyPrefix     string         `json:"keyPrefix"`
	RateLimit     int            `json:"rateLimit"`
	Status        string         `json:"status"`
	ExpiresAt     *string        `json:"expiresAt"`
	LastUsedAt    *string        `json:"lastUsedAt"`
	UsageCount    int64          `json:"usageCount"`
	CreatedAt     string         `json:"createdAt"`
	Creator       *APIKeyCreator `json:"creator"`
	CreatedByName *string        `json:"createdByName,omitempty"`
}

type APIKeyDetails struct {
	ID               int64           `json:"id"`
	Name             string          `json:"name"`
	KeyPrefix        string          `json:"keyPrefix"`
	RateLimit        int             `json:"rateLimit"`
	Status           string          `json:"status"`
	ExpiresAt        *string         `json:"expiresAt"`
	LastUsedAt       *string         `json:"lastUsedAt"`
	UsageCount       int64           `json:"usageCount"`
	Permissions      map[string]bool `json:"permissions,omitempty"`
	AllowedGroupIDs  []int64         `json:"allowedGroupIds"`
	AllowedEmailIDs  []int64         `json:"allowedEmailIds"`
	AllowedDomainIDs []int64         `json:"allowedDomainIds"`
	CreatedAt        string          `json:"createdAt"`
	UpdatedAt        string          `json:"updatedAt"`
	Creator          *APIKeyCreator  `json:"creator"`
	CreatedByName    *string         `json:"createdByName,omitempty"`
}

type APIKeyCreated struct {
	ID               int64           `json:"id"`
	Name             string          `json:"name"`
	KeyPrefix        string          `json:"keyPrefix"`
	RateLimit        int             `json:"rateLimit"`
	Status           string          `json:"status"`
	ExpiresAt        *string         `json:"expiresAt"`
	Permissions      map[string]bool `json:"permissions,omitempty"`
	AllowedGroupIDs  []int64         `json:"allowedGroupIds"`
	AllowedEmailIDs  []int64         `json:"allowedEmailIds"`
	AllowedDomainIDs []int64         `json:"allowedDomainIds"`
	CreatedAt        string          `json:"createdAt"`
	Key              string          `json:"key"`
}

type APIKeyUpdated struct {
	ID               int64           `json:"id"`
	Name             string          `json:"name"`
	KeyPrefix        string          `json:"keyPrefix"`
	RateLimit        int             `json:"rateLimit"`
	Status           string          `json:"status"`
	ExpiresAt        *string         `json:"expiresAt"`
	Permissions      map[string]bool `json:"permissions,omitempty"`
	AllowedGroupIDs  []int64         `json:"allowedGroupIds"`
	AllowedEmailIDs  []int64         `json:"allowedEmailIds"`
	AllowedDomainIDs []int64         `json:"allowedDomainIds"`
	UpdatedAt        string          `json:"updatedAt"`
}

type APIKeyCreateInput struct {
	Name             string
	RateLimit        int
	ExpiresAt        *time.Time
	Permissions      map[string]bool
	AllowedGroupIDs  []int64
	AllowedEmailIDs  []int64
	AllowedDomainIDs []int64
}

type APIKeyUpdateInput struct {
	NameSet             bool
	Name                string
	RateLimitSet        bool
	RateLimit           int
	StatusSet           bool
	Status              string
	ExpiresAtSet        bool
	ExpiresAt           *time.Time
	PermissionsSet      bool
	Permissions         map[string]bool
	AllowedGroupIDsSet  bool
	AllowedGroupIDs     []int64
	AllowedEmailIDsSet  bool
	AllowedEmailIDs     []int64
	AllowedDomainIDsSet bool
	AllowedDomainIDs    []int64
}

type AllocationStats struct {
	Total     int64 `json:"total"`
	Used      int64 `json:"used"`
	Remaining int64 `json:"remaining"`
}

type AssignedEmail struct {
	ID        int64   `json:"id"`
	Email     string  `json:"email"`
	Provider  string  `json:"provider"`
	Used      bool    `json:"used"`
	GroupID   *int64  `json:"groupId"`
	GroupName *string `json:"groupName"`
}

type EmailAllocation struct {
	ID    int64  `json:"id"`
	Email string `json:"email"`
}

type ExternalMailbox struct {
	Email    string  `json:"email"`
	Provider string  `json:"provider"`
	Status   string  `json:"status"`
	Group    *string `json:"group"`
}

type ExternalMailboxList struct {
	Total  int               `json:"total"`
	Emails []ExternalMailbox `json:"emails"`
}

type DomainSelector struct {
	DomainID *int64
	Domain   string
	BatchTag string
}

type DomainMailboxAllocation struct {
	ID                     int64             `json:"id"`
	Email                  string            `json:"email"`
	LocalPart              string            `json:"localPart"`
	BatchTag               *string           `json:"batchTag"`
	DomainID               int64             `json:"domainId"`
	DomainName             string            `json:"domainName"`
	ProviderProfile        string            `json:"providerProfile"`
	RepresentativeProtocol string            `json:"representativeProtocol"`
	SecondaryProtocols     []string          `json:"secondaryProtocols"`
	ProfileSummaryHint     string            `json:"profileSummaryHint"`
	CapabilitySummary      CapabilitySummary `json:"capabilitySummary"`
}

type DomainMailboxItem struct {
	DomainMailboxAllocation
	Used bool `json:"used"`
}

type DomainMailboxList struct {
	Total     int                 `json:"total"`
	Mailboxes []DomainMailboxItem `json:"mailboxes"`
}

type CapabilitySummary struct {
	ReadInbox    bool     `json:"readInbox"`
	ReadJunk     bool     `json:"readJunk"`
	ReadSent     bool     `json:"readSent"`
	ClearMailbox bool     `json:"clearMailbox"`
	SendMail     bool     `json:"sendMail"`
	UsesOAuth    bool     `json:"usesOAuth"`
	ReceiveMail  bool     `json:"receiveMail"`
	APIAccess    bool     `json:"apiAccess"`
	Forwarding   bool     `json:"forwarding"`
	Search       bool     `json:"search"`
	RefreshToken bool     `json:"refreshToken"`
	Webhook      bool     `json:"webhook"`
	AliasSupport bool     `json:"aliasSupport"`
	Modes        []string `json:"modes"`
}

type DomainMessage struct {
	ID               string  `json:"id"`
	From             string  `json:"from"`
	To               string  `json:"to"`
	Subject          string  `json:"subject"`
	Text             string  `json:"text"`
	HTML             string  `json:"html"`
	VerificationCode *string `json:"verificationCode"`
	RouteKind        *string `json:"routeKind"`
	Date             string  `json:"date"`
}

type DomainMessageList struct {
	Email                  string            `json:"email"`
	MailboxID              int64             `json:"mailboxId"`
	DomainID               int64             `json:"domainId"`
	DomainName             string            `json:"domainName"`
	Count                  int               `json:"count"`
	ProviderProfile        string            `json:"providerProfile"`
	RepresentativeProtocol string            `json:"representativeProtocol"`
	SecondaryProtocols     []string          `json:"secondaryProtocols"`
	ProfileSummaryHint     string            `json:"profileSummaryHint"`
	CapabilitySummary      CapabilitySummary `json:"capabilitySummary"`
	Messages               []DomainMessage   `json:"messages"`
}

func formatOptionalAPITime(value *time.Time) *string {
	if value == nil {
		return nil
	}
	formatted := formatAPITime(*value)
	return &formatted
}
