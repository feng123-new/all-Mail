package businessapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func (s *Server) withAPIKey(action string, next func(http.ResponseWriter, *http.Request, APIKeyPrincipal)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		ctx, cancel := context.WithTimeout(r.Context(), s.cfg.QueryTimeout)
		defer cancel()
		principal, err := s.authenticateAPIKey(ctx, r)
		if err != nil {
			s.writeRequestError(w, r, err)
			return
		}
		if !permissionAllowed(principal.Permissions, action) {
			s.logExternalCall(r, principal.ID, nil, action, http.StatusForbidden, started)
			s.writeRequestError(w, r, &requestError{Status: http.StatusForbidden, Code: "FORBIDDEN_PERMISSION"})
			return
		}
		next(w, r.WithContext(ctx), principal)
	}
}

func (s *Server) authenticateAPIKey(ctx context.Context, request *http.Request) (APIKeyPrincipal, error) {
	if s.apiKeyStore == nil {
		return APIKeyPrincipal{}, &requestError{Status: http.StatusServiceUnavailable, Code: "API_KEY_STORE_UNAVAILABLE"}
	}
	rawKey := extractAPIKey(request)
	if rawKey == "" {
		return APIKeyPrincipal{}, &requestError{Status: http.StatusUnauthorized, Code: "UNAUTHORIZED"}
	}
	digest := sha256.Sum256([]byte(rawKey))
	principal, err := s.apiKeyStore.FindAPIKeyByHash(ctx, hex.EncodeToString(digest[:]))
	if errors.Is(err, errNotFound) {
		return APIKeyPrincipal{}, &requestError{Status: http.StatusUnauthorized, Code: "INVALID_API_KEY"}
	}
	if err != nil {
		return APIKeyPrincipal{}, &requestError{Status: http.StatusInternalServerError, Code: "INTERNAL_ERROR", Cause: err}
	}
	if principal.Status != "ACTIVE" {
		return APIKeyPrincipal{}, &requestError{Status: http.StatusForbidden, Code: "API_KEY_DISABLED"}
	}
	now := s.now()
	if principal.ExpiresAt != nil && principal.ExpiresAt.Before(now) {
		return APIKeyPrincipal{}, &requestError{Status: http.StatusForbidden, Code: "API_KEY_EXPIRED"}
	}
	if principal.RateLimit > 0 {
		minuteBucket := now.Unix() / 60
		key := fmt.Sprintf("rate_limit:api_key:%d:%d", principal.ID, minuteBucket)
		count, err := s.rateLimiter.Increment(ctx, key, 60*time.Second)
		if err != nil {
			return APIKeyPrincipal{}, &requestError{
				Status: http.StatusServiceUnavailable,
				Code:   "RATE_LIMIT_BACKEND_UNAVAILABLE",
				Cause:  err,
			}
		}
		if count > int64(principal.RateLimit) {
			return APIKeyPrincipal{}, &requestError{Status: http.StatusTooManyRequests, Code: "RATE_LIMIT_EXCEEDED"}
		}
	}
	if err := s.apiKeyStore.TouchAPIKey(ctx, principal.ID, now); errors.Is(err, errNotFound) {
		return APIKeyPrincipal{}, &requestError{Status: http.StatusUnauthorized, Code: "INVALID_API_KEY"}
	} else if err != nil {
		return APIKeyPrincipal{}, &requestError{Status: http.StatusInternalServerError, Code: "INTERNAL_ERROR", Cause: err}
	}
	// Fastify historically applies rate limiting and usage accounting before the
	// per-action permission check. The wrapper performs the permission check after
	// this method returns so denied calls can also be written to api_logs.
	return principal, nil
}

func extractAPIKey(request *http.Request) string {
	if value := strings.TrimSpace(request.Header.Get("X-API-Key")); value != "" {
		return value
	}
	authorization := strings.TrimSpace(request.Header.Get("Authorization"))
	if strings.HasPrefix(authorization, "Bearer sk_") {
		return strings.TrimSpace(strings.TrimPrefix(authorization, "Bearer "))
	}
	return ""
}

func requestClientIP(request *http.Request) string {
	for _, value := range []string{request.Header.Get("X-Real-IP"), request.Header.Get("X-Forwarded-For")} {
		value = strings.TrimSpace(strings.Split(value, ",")[0])
		if address := net.ParseIP(value); address != nil {
			return address.String()
		}
	}
	host, _, err := net.SplitHostPort(request.RemoteAddr)
	if err == nil {
		return host
	}
	return strings.Trim(request.RemoteAddr, "[]")
}

func parsePositivePathID(request *http.Request, name string) (int64, error) {
	raw := strings.TrimSpace(request.PathValue(name))
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value <= 0 {
		return 0, validationError(name + " must be a positive integer")
	}
	return value, nil
}
