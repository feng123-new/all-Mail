package businessapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

const (
	oauthStateTTL  = 10 * time.Minute
	oauthResultTTL = 15 * time.Minute
)

type OAuthStateStore interface {
	Set(context.Context, string, string, time.Duration) error
	Get(context.Context, string) (string, bool, error)
	Take(context.Context, string) (string, bool, error)
}

type oauthStateRecord struct {
	AdminID   int64  `json:"adminId"`
	Provider  string `json:"provider"`
	GroupID   *int64 `json:"groupId,omitempty"`
	EmailID   *int64 `json:"emailId,omitempty"`
	CreatedAt int64  `json:"createdAt"`
}

type oauthCompletionResult struct {
	Provider string `json:"provider"`
	Status   string `json:"status"`
	Code     string `json:"code"`
	Email    string `json:"email,omitempty"`
	Action   string `json:"action,omitempty"`
}

type oauthStatusSnapshot struct {
	AdminID     int64                  `json:"adminId"`
	Provider    string                 `json:"provider"`
	Phase       string                 `json:"phase"`
	CreatedAt   int64                  `json:"createdAt"`
	ExpiresAt   int64                  `json:"expiresAt"`
	CompletedAt int64                  `json:"completedAt,omitempty"`
	Result      *oauthCompletionResult `json:"result,omitempty"`
}

func oauthPendingKey(state string) string { return "admin:oauth:state:" + state }
func oauthStatusKey(state string) string  { return "admin:oauth:status:" + state }

func (s *Server) requireOAuthStateStore() (OAuthStateStore, error) {
	if s.oauthStateStore == nil {
		return nil, &requestError{Status: http.StatusServiceUnavailable, Code: "OAUTH_STATE_BACKEND_UNAVAILABLE"}
	}
	return s.oauthStateStore, nil
}

func (s *Server) saveOAuthState(ctx context.Context, state string, record oauthStateRecord) error {
	store, err := s.requireOAuthStateStore()
	if err != nil {
		return err
	}
	payload, err := json.Marshal(record)
	if err != nil {
		return fmt.Errorf("encode OAuth state: %w", err)
	}
	if err := store.Set(ctx, oauthPendingKey(state), string(payload), oauthStateTTL); err != nil {
		return &requestError{Status: http.StatusServiceUnavailable, Code: "OAUTH_STATE_BACKEND_UNAVAILABLE", Cause: err}
	}
	return nil
}

func (s *Server) peekOAuthState(ctx context.Context, state string) (oauthStateRecord, bool, error) {
	store, err := s.requireOAuthStateStore()
	if err != nil {
		return oauthStateRecord{}, false, err
	}
	payload, found, err := store.Get(ctx, oauthPendingKey(state))
	if err != nil {
		return oauthStateRecord{}, false, &requestError{Status: http.StatusServiceUnavailable, Code: "OAUTH_STATE_BACKEND_UNAVAILABLE", Cause: err}
	}
	if !found {
		return oauthStateRecord{}, false, nil
	}
	var record oauthStateRecord
	if err := json.Unmarshal([]byte(payload), &record); err != nil {
		return oauthStateRecord{}, false, &requestError{Status: http.StatusServiceUnavailable, Code: "OAUTH_STATE_BACKEND_INVALID", Cause: err}
	}
	return record, true, nil
}

func (s *Server) takeOAuthState(ctx context.Context, state string) (oauthStateRecord, bool, error) {
	store, err := s.requireOAuthStateStore()
	if err != nil {
		return oauthStateRecord{}, false, err
	}
	payload, found, err := store.Take(ctx, oauthPendingKey(state))
	if err != nil {
		return oauthStateRecord{}, false, &requestError{Status: http.StatusServiceUnavailable, Code: "OAUTH_STATE_BACKEND_UNAVAILABLE", Cause: err}
	}
	if !found {
		return oauthStateRecord{}, false, nil
	}
	var record oauthStateRecord
	if err := json.Unmarshal([]byte(payload), &record); err != nil {
		return oauthStateRecord{}, false, &requestError{Status: http.StatusServiceUnavailable, Code: "OAUTH_STATE_BACKEND_INVALID", Cause: err}
	}
	return record, true, nil
}

func (s *Server) saveOAuthStatus(ctx context.Context, state string, snapshot oauthStatusSnapshot) error {
	store, err := s.requireOAuthStateStore()
	if err != nil {
		return err
	}
	payload, err := json.Marshal(snapshot)
	if err != nil {
		return fmt.Errorf("encode OAuth status: %w", err)
	}
	if err := store.Set(ctx, oauthStatusKey(state), string(payload), oauthResultTTL); err != nil {
		return &requestError{Status: http.StatusServiceUnavailable, Code: "OAUTH_STATE_BACKEND_UNAVAILABLE", Cause: err}
	}
	return nil
}

func (s *Server) getOAuthStatus(ctx context.Context, state string) (oauthStatusSnapshot, bool, error) {
	store, err := s.requireOAuthStateStore()
	if err != nil {
		return oauthStatusSnapshot{}, false, err
	}
	payload, found, err := store.Get(ctx, oauthStatusKey(state))
	if err != nil {
		return oauthStatusSnapshot{}, false, &requestError{Status: http.StatusServiceUnavailable, Code: "OAUTH_STATE_BACKEND_UNAVAILABLE", Cause: err}
	}
	if !found {
		return oauthStatusSnapshot{}, false, nil
	}
	var snapshot oauthStatusSnapshot
	if err := json.Unmarshal([]byte(payload), &snapshot); err != nil {
		return oauthStatusSnapshot{}, false, &requestError{Status: http.StatusServiceUnavailable, Code: "OAUTH_STATE_BACKEND_INVALID", Cause: err}
	}
	return snapshot, true, nil
}
