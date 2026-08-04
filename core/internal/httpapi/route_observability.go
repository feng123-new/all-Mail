package httpapi

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/routeownership"
)

const (
	routeOwnerHeader  = "X-All-Mail-Route-Owner"
	routeFamilyHeader = "X-All-Mail-Route-Family"
)

type routeContextKey struct{}

type statusResponseWriter struct {
	http.ResponseWriter
	status int
	owner  string
	family string
}

func (w *statusResponseWriter) ensureRouteHeaders() {
	w.Header().Set(routeOwnerHeader, w.owner)
	w.Header().Set(routeFamilyHeader, w.family)
}

func (w *statusResponseWriter) WriteHeader(status int) {
	if w.status != 0 {
		return
	}
	w.status = status
	w.ensureRouteHeaders()
	w.ResponseWriter.WriteHeader(status)
}

func (w *statusResponseWriter) Write(content []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	w.ensureRouteHeaders()
	return w.ResponseWriter.Write(content)
}

func (w *statusResponseWriter) Flush() {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	w.ensureRouteHeaders()
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (w *statusResponseWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

func (s *Server) observeRoutes(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		route := s.routes.Match(r.Method, r.URL.Path)
		if route.ID == "system-metrics" && len(s.cfg.MetricsAllowedCIDRs) > 0 {
			peer, err := remoteAddress(r.RemoteAddr)
			if err != nil || !s.cfg.AllowsMetrics(peer) {
				http.NotFound(w, r)
				return
			}
		}

		s.routeMetrics.begin(route)
		startedAt := time.Now()

		r.Header.Del(routeOwnerHeader)
		r.Header.Del(routeFamilyHeader)
		w.Header().Set(routeOwnerHeader, string(route.Owner))
		w.Header().Set(routeFamilyHeader, route.ID)
		r = r.WithContext(context.WithValue(r.Context(), routeContextKey{}, route))
		observed := &statusResponseWriter{
			ResponseWriter: w,
			owner:          string(route.Owner),
			family:         route.ID,
		}
		next.ServeHTTP(observed, r)
		observed.ensureRouteHeaders()
		s.routeMetrics.observe(route, r.Method, observed.status, time.Since(startedAt))
	})
}

func routeFromContext(ctx context.Context) (routeownership.Route, bool) {
	route, ok := ctx.Value(routeContextKey{}).(routeownership.Route)
	return route, ok
}

func validateGatewayManifest(manifest *routeownership.Manifest) error {
	required := map[string]string{
		"/health":  "system-health",
		"/livez":   "system-liveness",
		"/readyz":  "system-readiness",
		"/metrics": "system-metrics",
	}
	for path, family := range required {
		route := manifest.Match(http.MethodGet, path)
		if route.ID != family || route.Owner != routeownership.OwnerGo || route.Match != routeownership.MatchExact {
			return fmt.Errorf("route ownership manifest must declare %s as exact Go route %s", path, family)
		}
	}
	fallback := manifest.Match(http.MethodGet, "/__allmail_spa_route_probe__")
	if fallback.ID != "spa" || fallback.Owner != routeownership.OwnerGo || fallback.Match != routeownership.MatchFallback {
		return fmt.Errorf("route ownership manifest must declare a Go-owned spa fallback")
	}
	return nil
}
