package businessapi

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type verifiedMailboxJWT struct {
	MailboxUserID  int64
	SessionVersion int64
}

func authenticateMailbox(
	ctx context.Context,
	request *http.Request,
	store MailboxAuthenticationStore,
	secret string,
	now time.Time,
) (MailboxIdentity, error) {
	identity, err := authenticateMailboxIdentity(ctx, request, store, secret, now)
	if err != nil {
		return MailboxIdentity{}, err
	}
	if identity.MustChangePassword {
		return MailboxIdentity{}, &requestError{Status: http.StatusForbidden, Code: "PASSWORD_CHANGE_REQUIRED"}
	}
	return identity, nil
}

func authenticateMailboxIdentity(
	ctx context.Context,
	request *http.Request,
	store MailboxAuthenticationStore,
	secret string,
	now time.Time,
) (MailboxIdentity, error) {
	token := extractMailboxToken(request)
	if token == "" {
		return MailboxIdentity{}, &requestError{Status: http.StatusUnauthorized, Code: "UNAUTHORIZED"}
	}
	claims, err := verifyMailboxJWT(token, secret, now)
	if err != nil {
		return MailboxIdentity{}, &requestError{Status: http.StatusUnauthorized, Code: "INVALID_MAILBOX_TOKEN", Cause: err}
	}
	if store == nil {
		return MailboxIdentity{}, &requestError{Status: http.StatusServiceUnavailable, Code: "MAILBOX_AUTHENTICATION_BACKEND_UNAVAILABLE"}
	}
	identity, err := store.FindMailboxIdentity(ctx, claims.MailboxUserID)
	if errors.Is(err, errNotFound) {
		return MailboxIdentity{}, &requestError{Status: http.StatusUnauthorized, Code: "INVALID_MAILBOX_TOKEN"}
	}
	if err != nil {
		return MailboxIdentity{}, &requestError{Status: http.StatusInternalServerError, Code: "INTERNAL_ERROR", Cause: err}
	}
	if claims.SessionVersion != identity.SessionVersion {
		return MailboxIdentity{}, &requestError{Status: http.StatusUnauthorized, Code: "INVALID_MAILBOX_TOKEN"}
	}
	if identity.Status != "ACTIVE" {
		return MailboxIdentity{}, &requestError{Status: http.StatusForbidden, Code: "ACCOUNT_DISABLED"}
	}
	return identity, nil
}

func extractMailboxToken(request *http.Request) string {
	if cookie, err := request.Cookie("mailbox_token"); err == nil && strings.TrimSpace(cookie.Value) != "" {
		return strings.TrimSpace(cookie.Value)
	}
	authorization := strings.TrimSpace(request.Header.Get("Authorization"))
	if strings.HasPrefix(authorization, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(authorization, "Bearer "))
	}
	return ""
}

func verifyMailboxJWT(token, secret string, now time.Time) (verifiedMailboxJWT, error) {
	payload, err := verifyJWT(token, secret, now, mailboxJWTAudience)
	if err != nil {
		return verifiedMailboxJWT{}, err
	}
	mailboxUserID, err := strconv.ParseInt(payload.Subject, 10, 64)
	if err != nil || mailboxUserID <= 0 {
		return verifiedMailboxJWT{}, errors.New("JWT subject is invalid")
	}
	if payload.MailboxUserID != 0 && payload.MailboxUserID != mailboxUserID {
		return verifiedMailboxJWT{}, errors.New("JWT mailbox user id does not match subject")
	}
	return verifiedMailboxJWT{MailboxUserID: mailboxUserID, SessionVersion: payload.SessionVersion}, nil
}
