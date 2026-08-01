package businessapi

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/dlclark/regexp2/v2"
)

type messageTextInput struct {
	Email string `json:"email"`
	Match string `json:"match"`
}

func (s *Server) externalProviderMessageText(w http.ResponseWriter, r *http.Request, principal APIKeyPrincipal) {
	started := time.Now()
	if !s.requirePlainTextPermission(w, r, principal, actionExternalReadMessageText, started) {
		return
	}
	input, err := parseMessageTextInput(r, false)
	if err != nil {
		s.finishPlainTextExternalError(w, r, principal, actionExternalReadMessageText, nil, started, err)
		return
	}
	store, err := s.managementStore()
	if err != nil {
		s.finishPlainTextExternalError(w, r, principal, actionExternalReadMessageText, nil, started, err)
		return
	}
	databaseCtx, cancelDatabase := s.databaseContext(r.Context())
	account, err := store.loadExternalMailAccountCredentials(databaseCtx, principal.ID, input.Email, s.cfg.EncryptionKey)
	cancelDatabase()
	if err != nil {
		s.finishPlainTextExternalError(w, r, principal, actionExternalReadMessageText, nil, started, err)
		return
	}
	if account.Status == "DISABLED" {
		s.finishPlainTextExternalError(w, r, principal, actionExternalReadMessageText, &account.ID, started, &requestError{Status: http.StatusForbidden, Code: "EMAIL_DISABLED"})
		return
	}
	result, err := s.fetchAccountMailbox(r.Context(), account, "INBOX", 1, false)
	if err != nil {
		s.finishPlainTextExternalError(w, r, principal, actionExternalReadMessageText, &account.ID, started, err)
		return
	}
	s.logExternalCall(r, principal.ID, &account.ID, actionExternalReadMessageText, http.StatusOK, started)
	if len(result.Messages) == 0 {
		writePlainText(w, http.StatusOK, "Error: No messages found")
		return
	}
	content := result.Messages[0].Text
	if input.Match != "" {
		matched, err := extractMessageText(content, input.Match, true)
		if err != nil {
			status := http.StatusBadRequest
			message := "Error: Invalid regex pattern"
			if errors.Is(err, errMessageTextNoMatch) {
				status = http.StatusNotFound
				message = "Error: No match found"
			}
			writePlainText(w, status, message)
			return
		}
		content = matched
	}
	writePlainText(w, http.StatusOK, content)
}

func (s *Server) domainMessageText(w http.ResponseWriter, r *http.Request, principal APIKeyPrincipal) {
	started := time.Now()
	if !s.requirePlainTextPermission(w, r, principal, actionDomainReadMessageText, started) {
		return
	}
	input, err := parseMessageTextInput(r, true)
	if err != nil {
		s.finishPlainTextExternalError(w, r, principal, actionDomainReadMessageText, nil, started, err)
		return
	}
	result, err := s.domainMailboxStore.ListDomainMessages(r.Context(), principal.ID, input.Email, 1)
	if err != nil {
		s.finishPlainTextExternalError(w, r, principal, actionDomainReadMessageText, nil, started, err)
		return
	}
	if len(result.Messages) == 0 {
		s.logExternalCall(r, principal.ID, nil, actionDomainReadMessageText, http.StatusNotFound, started)
		writePlainText(w, http.StatusNotFound, "Error: No messages found")
		return
	}
	content := result.Messages[0].Text
	if content == "" {
		content = result.Messages[0].HTML
	}
	if input.Match != "" {
		matched, err := extractMessageText(content, input.Match, false)
		if err != nil {
			status := http.StatusBadRequest
			message := "Error: Invalid regular expression supplied in match"
			if errors.Is(err, errMessageTextNoMatch) {
				status = http.StatusNotFound
				message = "Error: No match found"
			}
			s.logExternalCall(r, principal.ID, nil, actionDomainReadMessageText, status, started)
			writePlainText(w, status, message)
			return
		}
		content = matched
	}
	s.logExternalCall(r, principal.ID, nil, actionDomainReadMessageText, http.StatusOK, started)
	writePlainText(w, http.StatusOK, content)
}

func parseMessageTextInput(r *http.Request, trimMatch bool) (messageTextInput, error) {
	var input messageTextInput
	if r.Method == http.MethodGet {
		input.Email = r.URL.Query().Get("email")
		input.Match = r.URL.Query().Get("match")
	} else if err := decodeRequiredJSONObject(r, &input); err != nil {
		return input, err
	}
	input.Email = strings.ToLower(strings.TrimSpace(input.Email))
	if err := validateEmailAddress(input.Email); err != nil {
		return input, err
	}
	if trimMatch {
		input.Match = strings.TrimSpace(input.Match)
	}
	return input, nil
}

const (
	messageTextPatternMaxBytes = 4096
	messageTextMatchTimeout    = 250 * time.Millisecond
)

var (
	errMessageTextNoMatch        = errors.New("message text did not match")
	errMessageTextPatternTooLong = errors.New("message text pattern is too long")
)

func extractMessageText(content, pattern string, firstCapture bool) (string, error) {
	if len(pattern) > messageTextPatternMaxBytes {
		return "", errMessageTextPatternTooLong
	}
	expression, err := regexp2.Compile(pattern, regexp2.ECMAScript)
	if err != nil {
		return "", err
	}
	expression.MatchTimeout = messageTextMatchTimeout
	match, err := expression.FindStringMatch(content)
	if err != nil {
		return "", err
	}
	if match == nil {
		return "", errMessageTextNoMatch
	}
	if firstCapture && match.GroupCount() > 1 {
		group := match.GroupByNumber(1)
		if group != nil && group.String() != "" {
			return group.String(), nil
		}
	}
	return match.String(), nil
}

func (s *Server) requirePlainTextPermission(
	w http.ResponseWriter,
	r *http.Request,
	principal APIKeyPrincipal,
	action string,
	started time.Time,
) bool {
	if permissionAllowed(principal.Permissions, action) {
		return true
	}
	s.logExternalCall(r, principal.ID, nil, action, http.StatusForbidden, started)
	writePlainText(w, http.StatusForbidden, fmt.Sprintf("Error: API Key has no permission for action: %s", action))
	return false
}

func (s *Server) finishPlainTextExternalError(
	w http.ResponseWriter,
	r *http.Request,
	principal APIKeyPrincipal,
	action string,
	emailID *int64,
	started time.Time,
	err error,
) {
	status := statusForError(err)
	s.logExternalCall(r, principal.ID, emailID, action, status, started)
	writePlainText(w, status, "Error: "+plainTextExternalErrorMessage(err))
}

func plainTextExternalErrorMessage(err error) string {
	var requestErr *requestError
	if !errors.As(err, &requestErr) {
		if err == nil {
			return "Unknown error"
		}
		return err.Error()
	}
	switch requestErr.Code {
	case "EMAIL_NOT_FOUND":
		return "Email account not found"
	case "EMAIL_DISABLED":
		return "Email account is disabled"
	case "EMAIL_ACCESS_DENIED":
		return "Email access denied"
	case "DOMAIN_MAILBOX_NOT_FOUND":
		return "Domain mailbox not found"
	case "DOMAIN_MAILBOX_DISABLED":
		return "Domain mailbox is disabled"
	case "DOMAIN_FORBIDDEN":
		return "Domain access denied"
	case "VALIDATION_ERROR":
		if requestErr.Cause != nil {
			return requestErr.Cause.Error()
		}
		return "Invalid request"
	default:
		if requestErr.Cause != nil && requestErr.Status >= http.StatusInternalServerError {
			return requestErr.Cause.Error()
		}
		return requestErr.Code
	}
}

func writePlainText(w http.ResponseWriter, status int, value string) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(value))
}
