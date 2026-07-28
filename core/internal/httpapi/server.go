package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/config"
)

type Server struct {
	cfg       config.Config
	logger    *slog.Logger
	startedAt time.Time
	proxy     *httputil.ReverseProxy
	requests  atomic.Uint64
}

func New(cfg config.Config, logger *slog.Logger) (*Server, error) {
	server := &Server{cfg: cfg, logger: logger, startedAt: time.Now()}
	if cfg.LegacyAPIURL != "" {
		target, err := cfg.LegacyURL()
		if err != nil {
			return nil, err
		}
		server.proxy = newLegacyProxy(target, logger)
	}
	return server, nil
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.health)
	mux.HandleFunc("/livez", s.livez)
	mux.HandleFunc("/readyz", s.readyz)
	mux.HandleFunc("/metrics", s.metrics)
	mux.HandleFunc("/", s.route)
	return s.withCommonHeaders(mux)
}

func (s *Server) Run(ctx context.Context) error {
	httpServer := &http.Server{
		Addr:              s.cfg.Address(),
		Handler:           s.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       90 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		s.logger.Info("Go API runtime listening", "address", httpServer.Addr, "legacy_api", s.cfg.LegacyAPIURL)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
		close(errCh)
	}()

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), s.cfg.ShutdownTimeout)
		defer cancel()
		return httpServer.Shutdown(shutdownCtx)
	case err := <-errCh:
		return err
	}
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]any{
			"status":           "ok",
			"runtime":          "go-migration-bridge",
			"legacyConfigured": s.proxy != nil,
		},
	})
}

func (s *Server) livez(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]string{"status": "alive"}})
}

func (s *Server) readyz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.ReadyTimeout)
	defer cancel()

	checks := map[string]string{}
	ready := true
	if s.cfg.DatabaseURL != "" {
		if err := checkTCPURL(ctx, s.cfg.DatabaseURL, "5432"); err != nil {
			ready = false
			checks["postgres"] = err.Error()
		} else {
			checks["postgres"] = "ok"
		}
	} else {
		checks["postgres"] = "not-configured"
	}
	if s.cfg.RedisURL != "" {
		if err := checkTCPURL(ctx, s.cfg.RedisURL, "6379"); err != nil {
			ready = false
			checks["redis"] = err.Error()
		} else {
			checks["redis"] = "ok"
		}
	} else {
		checks["redis"] = "not-configured"
	}
	if s.proxy != nil {
		if err := checkLegacy(ctx, s.cfg.LegacyAPIURL); err != nil {
			ready = false
			checks["legacyApi"] = err.Error()
		} else {
			checks["legacyApi"] = "ok"
		}
	} else {
		checks["legacyApi"] = "not-configured"
	}

	status := http.StatusOK
	state := "ready"
	if !ready {
		status = http.StatusServiceUnavailable
		state = "not-ready"
	}
	writeJSON(w, status, map[string]any{"success": ready, "data": map[string]any{"status": state, "checks": checks}})
}

func (s *Server) metrics(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	fmt.Fprintf(w, "# HELP allmail_go_uptime_seconds Go bridge process uptime.\n")
	fmt.Fprintf(w, "# TYPE allmail_go_uptime_seconds gauge\n")
	fmt.Fprintf(w, "allmail_go_uptime_seconds %.0f\n", time.Since(s.startedAt).Seconds())
	fmt.Fprintf(w, "# HELP allmail_go_http_requests_total Requests observed by the Go bridge.\n")
	fmt.Fprintf(w, "# TYPE allmail_go_http_requests_total counter\n")
	fmt.Fprintf(w, "allmail_go_http_requests_total %d\n", s.requests.Load())
}

func (s *Server) route(w http.ResponseWriter, r *http.Request) {
	if isBackendPath(r.URL.Path) {
		if s.proxy == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{
				"success":   false,
				"requestId": requestID(r),
				"error": map[string]string{
					"code":    "GO_ROUTE_NOT_MIGRATED",
					"message": "This route has not been migrated and LEGACY_API_URL is not configured.",
				},
			})
			return
		}
		s.proxy.ServeHTTP(w, r)
		return
	}
	s.serveSPA(w, r)
}

func (s *Server) serveSPA(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.NotFound(w, r)
		return
	}
	cleanPath := filepath.Clean(strings.TrimPrefix(r.URL.Path, "/"))
	if cleanPath == "." {
		cleanPath = "index.html"
	}
	candidate := filepath.Join(s.cfg.StaticDir, cleanPath)
	if !isWithin(candidate, s.cfg.StaticDir) {
		http.NotFound(w, r)
		return
	}
	if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
		if contentType := mime.TypeByExtension(filepath.Ext(candidate)); contentType != "" {
			w.Header().Set("Content-Type", contentType)
		}
		http.ServeFile(w, r, candidate)
		return
	}
	index := filepath.Join(s.cfg.StaticDir, "index.html")
	if _, err := os.Stat(index); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			writeJSON(w, http.StatusNotFound, map[string]any{"success": false, "error": map[string]string{"code": "FRONTEND_NOT_BUILT"}})
			return
		}
		http.Error(w, "failed to inspect frontend assets", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeFile(w, r, index)
}

func (s *Server) withCommonHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.requests.Add(1)
		id := strings.TrimSpace(r.Header.Get("X-Request-Id"))
		if id == "" {
			id = newRequestID()
			r.Header.Set("X-Request-Id", id)
		}
		w.Header().Set("X-Request-Id", id)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'")
		next.ServeHTTP(w, r)
	})
}

func newLegacyProxy(target *url.URL, logger *slog.Logger) *httputil.ReverseProxy {
	proxy := httputil.NewSingleHostReverseProxy(target)
	originalDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		originalDirector(req)
		req.Header.Set("X-All-Mail-Migration-Bridge", "go")
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		logger.Error("legacy API proxy failed", "request_id", requestID(r), "path", r.URL.Path, "error", err)
		writeJSON(w, http.StatusBadGateway, map[string]any{
			"success":   false,
			"requestId": requestID(r),
			"error": map[string]string{"code": "LEGACY_API_UNAVAILABLE"},
		})
	}
	return proxy
}

func isBackendPath(path string) bool {
	prefixes := []string{"/admin", "/api", "/mail/api", "/ingress", "/oauth"}
	for _, prefix := range prefixes {
		if path == prefix || strings.HasPrefix(path, prefix+"/") {
			return true
		}
	}
	return false
}

func checkTCPURL(ctx context.Context, rawURL, defaultPort string) error {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return err
	}
	host := parsed.Hostname()
	port := parsed.Port()
	if port == "" {
		port = defaultPort
	}
	if host == "" {
		return errors.New("missing host")
	}
	dialer := net.Dialer{}
	conn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(host, port))
	if err != nil {
		return err
	}
	return conn.Close()
}

func checkLegacy(ctx context.Context, baseURL string) error {
	target, err := url.Parse(baseURL)
	if err != nil {
		return err
	}
	target.Path = "/health"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return err
	}
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("legacy health returned %d", response.StatusCode)
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func newRequestID() string {
	buffer := make([]byte, 12)
	if _, err := rand.Read(buffer); err != nil {
		return fmt.Sprintf("go-%d", time.Now().UnixNano())
	}
	return "go-" + hex.EncodeToString(buffer)
}

func requestID(r *http.Request) string {
	return r.Header.Get("X-Request-Id")
}

func isWithin(path, root string) bool {
	absolutePath, err := filepath.Abs(path)
	if err != nil {
		return false
	}
	absoluteRoot, err := filepath.Abs(root)
	if err != nil {
		return false
	}
	relative, err := filepath.Rel(absoluteRoot, absolutePath)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}
