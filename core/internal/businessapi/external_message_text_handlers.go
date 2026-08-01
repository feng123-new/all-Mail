package businessapi

import (
	"context"
	"errors"
	"net/http"
	"time"
)

func (s *Server) withExternalMessageTextAPIKey(next func(http.ResponseWriter, *http.Request, APIKeyPrincipal)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		databaseCtx, cancelDatabase := context.WithTimeout(r.Context(), s.cfg.QueryTimeout)
		principal, err := s.authenticateAPIKey(databaseCtx, r)
		cancelDatabase()
		if err != nil {
			s.writeRequestError(w, r, err)
			return
		}
		providerCtx, cancelProvider := context.WithTimeout(r.Context(), s.cfg.ProviderTimeout)
		defer cancelProvider()
		next(w, r.WithContext(providerCtx), principal)
	}
}

func (s *Server) readExternalMessageText(w http.ResponseWriter, r *http.Request, principal APIKeyPrincipal) {
	started := time.Now()
	if !permissionAllowed(principal.Permissions, actionExternalReadMessageText) {
		s.finishExternalMessageTextError(
			w,
			r,
			principal,
			nil,
			started,
			&requestError{Status: http.StatusForbidden, Code: "FORBIDDEN_PERMISSION"},
		)
		return
	}
	input, err := parseDomainMessageTextInput(r)
	if err != nil {
		s.finishExternalMessageTextError(w, r, principal, nil, started, err)
		return
	}
	store, err := s.managementStore()
	if err != nil {
		s.finishExternalMessageTextError(w, r, principal, nil, started, err)
		return
	}
	databaseCtx, cancelDatabase := s.databaseContext(r.Context())
	account, err := store.loadExternalMailAccountCredentials(databaseCtx, principal.ID, input.Email, s.cfg.EncryptionKey)
	cancelDatabase()
	if err != nil {
		s.finishExternalMessageTextError(w, r, principal, nil, started, err)
		return
	}
	if account.Status == "DISABLED" {
		s.finishExternalMessageTextError(
			w,
			r,
			principal,
			&account.ID,
			started,
			&requestError{Status: http.StatusForbidden, Code: "EMAIL_DISABLED"},
		)
		return
	}
	result, err := s.fetchAccountMailbox(r.Context(), account, "INBOX", 1, false)
	if err != nil {
		s.finishExternalMessageTextError(w, r, principal, &account.ID, started, err)
		return
	}
	if len(result.Messages) == 0 {
		s.logExternalCall(r, principal.ID, &account.ID, actionExternalReadMessageText, http.StatusOK, started)
		writeDomainMessageText(w, http.StatusOK, "Error: No messages found")
		return
	}
	content := truncateDomainMessageText(result.Messages[0].Text, maxDomainMessageTextOutputBytes)
	if input.Match != "" {
		matched, found, err := matchMessageText(content, input.Match, true)
		if err != nil {
			s.finishExternalMessageTextError(
				w,
				r,
				principal,
				&account.ID,
				started,
				&requestError{Status: http.StatusBadRequest, Code: "INVALID_MATCH_REGEX", Cause: err},
			)
			return
		}
		if !found {
			s.logExternalCall(r, principal.ID, &account.ID, actionExternalReadMessageText, http.StatusNotFound, started)
			writeDomainMessageText(w, http.StatusNotFound, "Error: No match found")
			return
		}
		content = matched
	}
	s.logExternalCall(r, principal.ID, &account.ID, actionExternalReadMessageText, http.StatusOK, started)
	writeDomainMessageText(w, http.StatusOK, content)
}

func (s *Server) finishExternalMessageTextError(
	w http.ResponseWriter,
	r *http.Request,
	principal APIKeyPrincipal,
	emailID *int64,
	started time.Time,
	err error,
) {
	status := statusForError(err)
	s.logExternalCall(r, principal.ID, emailID, actionExternalReadMessageText, status, started)
	writeDomainMessageText(w, status, "Error: "+externalMessageTextErrorMessage(err))
}

func externalMessageTextErrorMessage(err error) string {
	var requestErr *requestError
	if !errors.As(err, &requestErr) {
		return "Unknown error"
	}
	switch requestErr.Code {
	case "FORBIDDEN_PERMISSION":
		return "API Key has no permission for action: mail_text"
	case "INVALID_MATCH_REGEX":
		return "Invalid regex pattern"
	case "EMAIL_NOT_FOUND":
		return "Email account not found"
	case "EMAIL_DISABLED":
		return "Email account is disabled"
	case "VALIDATION_ERROR":
		if requestErr.Cause != nil {
			return requestErr.Cause.Error()
		}
	}
	if requestErr.Cause != nil {
		return requestErr.Cause.Error()
	}
	return "Unknown error"
}
