package businessapi

import (
	"net/http"
	"net/url"
	"strings"
)

func (s *Server) withBrowserOriginProtection(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}
		if strings.EqualFold(strings.TrimSpace(r.Header.Get("Sec-Fetch-Site")), "cross-site") {
			s.writeRequestError(w, r, &requestError{Status: http.StatusForbidden, Code: "CSRF_ORIGIN_INVALID"})
			return
		}
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		if origin == "" {
			// Non-browser API clients commonly omit Origin. Browser cross-site
			// requests are still rejected through Origin or Sec-Fetch-Site.
			next.ServeHTTP(w, r)
			return
		}
		if !requestOriginMatches(r, origin) {
			s.writeRequestError(w, r, &requestError{Status: http.StatusForbidden, Code: "CSRF_ORIGIN_INVALID"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func requestOriginMatches(r *http.Request, rawOrigin string) bool {
	if rawOrigin == "null" {
		return false
	}
	origin, err := url.Parse(rawOrigin)
	if err != nil || origin.Scheme == "" || origin.Host == "" || origin.User != nil || origin.RawQuery != "" || origin.Fragment != "" || (origin.Path != "" && origin.Path != "/") {
		return false
	}
	scheme := firstForwardedValue(r.Header.Get("X-Forwarded-Proto"))
	if scheme == "" {
		scheme = "http"
		if r.TLS != nil {
			scheme = "https"
		}
	}
	host := firstForwardedValue(r.Header.Get("X-Forwarded-Host"))
	if host == "" {
		host = r.Host
	}
	return strings.EqualFold(origin.Scheme, scheme) && strings.EqualFold(origin.Host, host)
}

func firstForwardedValue(value string) string {
	value, _, _ = strings.Cut(value, ",")
	return strings.TrimSpace(value)
}
