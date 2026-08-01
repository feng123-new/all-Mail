package businessapi

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	maxDomainMessageTextPatternBytes = 4 << 10
	maxDomainMessageTextOutputBytes  = 1 << 20
	maxDomainMessageTextCharacters   = maxDomainMessageTextOutputBytes + 1
)

type domainMessageTextStore interface {
	GetLatestDomainMessageText(context.Context, int64, string, int) (string, bool, error)
}

type domainMessageTextInput struct {
	Email string `json:"email"`
	Match string `json:"match"`
}

func (s *Server) registerDomainMessageTextRoutes(mux *http.ServeMux) {
	for _, path := range []string{"/api/domain-mail/messages/text", "/api/domain-mail/mail_text"} {
		mux.HandleFunc(path, s.withDomainMessageTextAPIKey(s.readDomainMessageText))
	}
}

func (s *Server) withDomainMessageTextAPIKey(next func(http.ResponseWriter, *http.Request, APIKeyPrincipal)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), s.cfg.QueryTimeout)
		defer cancel()
		principal, err := s.authenticateAPIKey(ctx, r)
		if err != nil {
			s.writeRequestError(w, r, err)
			return
		}
		next(w, r.WithContext(ctx), principal)
	}
}

func (s *Server) readDomainMessageText(w http.ResponseWriter, r *http.Request, principal APIKeyPrincipal) {
	started := time.Now()
	if !permissionAllowed(principal.Permissions, actionDomainReadMessageText) {
		s.finishDomainMessageTextError(
			w,
			r,
			principal,
			started,
			&requestError{Status: http.StatusForbidden, Code: "FORBIDDEN_PERMISSION"},
		)
		return
	}
	input, err := parseDomainMessageTextInput(r)
	if err != nil {
		s.finishDomainMessageTextError(w, r, principal, started, err)
		return
	}
	store, ok := s.domainMailboxStore.(domainMessageTextStore)
	if !ok || store == nil {
		s.finishDomainMessageTextError(
			w,
			r,
			principal,
			started,
			&requestError{Status: http.StatusServiceUnavailable, Code: "DOMAIN_MESSAGE_STORE_UNAVAILABLE"},
		)
		return
	}
	content, found, err := store.GetLatestDomainMessageText(
		r.Context(),
		principal.ID,
		input.Email,
		maxDomainMessageTextCharacters,
	)
	if err != nil {
		s.finishDomainMessageTextError(w, r, principal, started, err)
		return
	}
	if !found {
		s.logExternalCall(r, principal.ID, nil, actionDomainReadMessageText, http.StatusNotFound, started)
		writeDomainMessageText(w, http.StatusNotFound, "Error: No messages found")
		return
	}

	content = truncateDomainMessageText(content, maxDomainMessageTextOutputBytes)
	if input.Match != "" {
		matched, found, err := matchMessageText(content, input.Match, false)
		if err != nil {
			s.finishDomainMessageTextError(
				w,
				r,
				principal,
				started,
				&requestError{Status: http.StatusBadRequest, Code: "INVALID_MATCH_REGEX", Cause: err},
			)
			return
		}
		if !found {
			s.logExternalCall(r, principal.ID, nil, actionDomainReadMessageText, http.StatusNotFound, started)
			writeDomainMessageText(w, http.StatusNotFound, "Error: No match found")
			return
		}
		content = matched
	}

	s.logExternalCall(r, principal.ID, nil, actionDomainReadMessageText, http.StatusOK, started)
	writeDomainMessageText(w, http.StatusOK, content)
}

func parseDomainMessageTextInput(r *http.Request) (domainMessageTextInput, error) {
	var input domainMessageTextInput
	if r.Method == http.MethodGet {
		input.Email = r.URL.Query().Get("email")
		input.Match = r.URL.Query().Get("match")
	} else if err := decodeJSONBody(r, &input); err != nil {
		return domainMessageTextInput{}, err
	}
	input.Email = strings.TrimSpace(input.Email)
	input.Match = strings.TrimSpace(input.Match)
	if len(input.Email) > 255 {
		return domainMessageTextInput{}, validationError("email must be a valid email address")
	}
	if err := validateEmailAddress(input.Email); err != nil {
		return domainMessageTextInput{}, err
	}
	if len(input.Match) > maxDomainMessageTextPatternBytes {
		return domainMessageTextInput{}, &requestError{Status: http.StatusBadRequest, Code: "INVALID_MATCH_REGEX"}
	}
	return input, nil
}

func truncateDomainMessageText(value string, maximumBytes int) string {
	if maximumBytes < 1 {
		return ""
	}
	if len(value) <= maximumBytes {
		return value
	}
	end := maximumBytes
	for end > 0 && !utf8.ValidString(value[:end]) {
		end--
	}
	return value[:end]
}

func (s *Server) finishDomainMessageTextError(
	w http.ResponseWriter,
	r *http.Request,
	principal APIKeyPrincipal,
	started time.Time,
	err error,
) {
	status := statusForError(err)
	s.logExternalCall(r, principal.ID, nil, actionDomainReadMessageText, status, started)
	writeDomainMessageText(w, status, "Error: "+domainMessageTextErrorMessage(err))
}

func domainMessageTextErrorMessage(err error) string {
	var requestErr *requestError
	if !errors.As(err, &requestErr) {
		return "Unknown error"
	}
	switch requestErr.Code {
	case "FORBIDDEN_PERMISSION":
		return "API Key has no permission for action: domain_read_message_text"
	case "INVALID_MATCH_REGEX":
		return "Invalid regular expression supplied in match"
	case "DOMAIN_MAILBOX_NOT_FOUND":
		return "Domain API mailbox not found"
	case "DOMAIN_FORBIDDEN":
		return "This API Key cannot access this domain mailbox"
	case "DOMAIN_MAILBOX_DISABLED":
		return "This domain mailbox is not active for receiving"
	case "API_KEY_NOT_FOUND":
		return "API Key not found"
	case "DOMAIN_MESSAGE_STORE_UNAVAILABLE":
		return "Domain message store unavailable"
	case "VALIDATION_ERROR":
		if requestErr.Cause != nil {
			return requestErr.Cause.Error()
		}
	}
	return "Unknown error"
}

func writeDomainMessageText(w http.ResponseWriter, status int, content string) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(content))
}
