package domain

import (
	"errors"
	"fmt"
	"time"
)

type JobStatus string

const (
	JobPending   JobStatus = "PENDING"
	JobRunning   JobStatus = "RUNNING"
	JobRetry     JobStatus = "RETRY"
	JobSucceeded JobStatus = "SUCCEEDED"
	JobDead      JobStatus = "DEAD"
	JobCanceled  JobStatus = "CANCELED"
	JobSkipped   JobStatus = "SKIPPED"
)

type ProviderErrorKind string

const (
	ProviderAuthReauth       ProviderErrorKind = "AUTH_REAUTH"
	ProviderPermissionDenied ProviderErrorKind = "PERMISSION_DENIED"
	ProviderThrottled        ProviderErrorKind = "THROTTLED"
	ProviderTransientNetwork ProviderErrorKind = "TRANSIENT_NETWORK"
	ProviderRemoteError      ProviderErrorKind = "PROVIDER_ERROR"
	ProviderCursorInvalid    ProviderErrorKind = "CURSOR_INVALID"
	ProviderFolderNotFound   ProviderErrorKind = "FOLDER_NOT_FOUND"
	ProviderTLSCertificate   ProviderErrorKind = "TLS_CERTIFICATE"
	ProviderMessageParse     ProviderErrorKind = "MESSAGE_PARSE"
	ProviderPermanentConfig  ProviderErrorKind = "PERMANENT_CONFIG"
)

type ProviderError struct {
	Kind       ProviderErrorKind
	Operation  string
	Provider   string
	RetryAfter time.Duration
	Err        error
}

func (e *ProviderError) Error() string {
	if e == nil {
		return "<nil>"
	}
	return fmt.Sprintf("%s %s %s: %v", e.Provider, e.Operation, e.Kind, e.Err)
}

func (e *ProviderError) Unwrap() error { return e.Err }

func IsRetryable(err error) bool {
	var providerErr *ProviderError
	if !errors.As(err, &providerErr) {
		return true
	}
	switch providerErr.Kind {
	case ProviderThrottled, ProviderTransientNetwork, ProviderRemoteError:
		return true
	default:
		return false
	}
}

type SyncCursor struct {
	EmailAccountID int64
	FolderKey      string
	Provider       string
	CursorType     string
	UIDValidity    *int64
	LastUID        *int64
	HighestModSeq  *int64
	GmailHistoryID *string
	GraphDeltaLink *string
	Generation     int
	Version        int
	UpdatedAt      time.Time
}
