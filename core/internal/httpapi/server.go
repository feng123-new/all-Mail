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
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/config"
	"github.com/feng123-new/all-Mail/core/internal/readiness"
	"github.com/feng123-new/all-Mail/core/internal/routeownership"
)

type Server struct {
	cfg              config.APIConfig
	goBusinessAPIURL string
	logger           *slog.Logger
	startedAt        time.Time
	goBusinessProxy  *httputil.ReverseProxy
	prober           readiness.Prober
	routes           *routeownership.Manifest
	routeMetrics     *routeMetrics
	requests         atomic.Uint64
}

type proxyMetadata struct {
	ClientIP string
	Proto    string
	Host     string
}

type proxyMetadataContextKey struct{}

func New(cfg config.APIConfig, logger *slog.Logger) (*Server, error) {
	goBusinessAPIURL, err := config.LoadGoBusinessAPIURL()
	if err != nil {
		return nil, err
	}
	return newWithProber(cfg, goBusinessAPIURL, logger, readiness.Default())
}

func newWithProber(
	cfg config.APIConfig,
	goBusinessAPIURL string,
	logger *slog.Logger,
	prober readiness.Prober,
) (*Server, error) {
	routes, err := routeownership.LoadDefault()
	if err != nil {
		return nil, err
	}
	if err := validateGatewayManifest(routes); err != nil {
		return nil, err
	}
	server := &Server{
		cfg:              cfg,
		goBusinessAPIURL: goBusinessAPIURL,
		logger:           logger,
		startedAt:        time.Now(),
		prober:           prober,
		routes:           routes,
		routeMetrics:     newRouteMetrics(routes),
	}
	if goBusinessAPIURL != "" {
		target, err := url.Parse(goBusinessAPIURL)
		if err != nil {
			return nil, fmt.Errorf("parse GO_BUSINESS_API_URL: %w", err)
		}
		server.goBusinessProxy = newBusinessProxy(
			target,
			logger,
			server.routeMetrics,
		)
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
	return s.withCommonHeaders(s.observeRoutes(mux))
}

func (s *Server) Run(ctx context.Context) error {
	httpServer := &http.Server{
		Addr:              s.cfg.Address(),
		Handler:           s.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      gatewayWriteTimeout(s.cfg),
		IdleTimeout:       90 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		s.logger.Info(
			"Go API runtime listening",
			"address", httpServer.Addr,
			"go_business_api", s.goBusinessAPIURL,
			"trusted_proxy_cidrs", len(s.cfg.TrustedProxyCIDRs),
			"route_manifest_version", s.routes.Snapshot().Version,
			"route_manifest_sha256", s.routes.Digest(),
		)
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

func gatewayWriteTimeout(cfg config.APIConfig) time.Duration {
	return cfg.ProviderTimeout + 4*cfg.BusinessQueryTimeout + 10*time.Second
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	snapshot := s.routes.Snapshot()
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]any{
			"status":                  "ok",
			"runtime":                 "go-gateway",
			"goBusinessApiConfigured": s.goBusinessProxy != nil,
			"routeManifestVersion":    snapshot.Version,
			"routeManifestSHA256":     snapshot.SHA256,
			"routeManifestRouteCount": len(snapshot.Routes),
		},
	})
}

func (s *Server) livez(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"data":    map[string]string{"status": "alive"},
	})
}

func (s *Server) readyz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.ReadyTimeout)
	defer cancel()

	report := s.prober.Check(ctx, s.cfg, s.goBusinessAPIURL)
	report.Checks["routeOwnership"] = "ok"
	status := http.StatusOK
	state := "ready"
	if !report.Ready {
		status = http.StatusServiceUnavailable
		state = "not-ready"
	}
	writeJSON(w, status, map[string]any{
		"success": report.Ready,
		"data": map[string]any{
			"status": state,
			"checks": report.Checks,
		},
	})
}

func (s *Server) metrics(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	fmt.Fprintln(w, "# HELP allmail_go_uptime_seconds Go gateway process uptime.")
	fmt.Fprintln(w, "# TYPE allmail_go_uptime_seconds gauge")
	fmt.Fprintf(w, "allmail_go_uptime_seconds %.0f\n", time.Since(s.startedAt).Seconds())
	fmt.Fprintln(w, "# HELP allmail_go_http_requests_total Requests observed by the Go gateway.")
	fmt.Fprintln(w, "# TYPE allmail_go_http_requests_total counter")
	fmt.Fprintf(w, "allmail_go_http_requests_total %d\n", s.requests.Load())
	s.routeMetrics.writePrometheus(w)
}

func (s *Server) route(w http.ResponseWriter, r *http.Request) {
	route, ok := routeFromContext(r.Context())
	if !ok {
		route = s.routes.Match(r.Method, r.URL.Path)
	}

	switch route.Owner {
	case routeownership.OwnerGoBusinessAPI:
		s.proxyRoute(w, r, route, s.goBusinessProxy, "GO_BUSINESS_API_NOT_CONFIGURED", "This route family requires GO_BUSINESS_API_URL.")
	case routeownership.OwnerGo:
		s.serveSPA(w, r)
	default:
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"success":   false,
			"requestId": requestID(r),
			"error":     map[string]string{"code": "ROUTE_OWNER_INVALID"},
		})
	}
}

func (s *Server) proxyRoute(
	w http.ResponseWriter,
	r *http.Request,
	route routeownership.Route,
	proxy *httputil.ReverseProxy,
	missingCode string,
	missingMessage string,
) {
	if proxy == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"success":   false,
			"requestId": requestID(r),
			"error": map[string]string{
				"code":    missingCode,
				"message": missingMessage,
			},
		})
		return
	}
	proxy.ServeHTTP(w, r)
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
			writeJSON(w, http.StatusNotFound, map[string]any{
				"success": false,
				"error":   map[string]string{"code": "FRONTEND_NOT_BUILT"},
			})
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
		id := normalizeRequestID(r.Header.Get("X-Request-Id"))
		if id == "" {
			id = newRequestID()
		}
		metadata := s.resolveProxyMetadata(r)
		stripForwardingHeaders(r.Header)
		r.Header.Set("X-Request-Id", id)
		r = r.WithContext(context.WithValue(r.Context(), proxyMetadataContextKey{}, metadata))

		w.Header().Set("X-Request-Id", id)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		w.Header().Set(
			"Content-Security-Policy",
			"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
		)
		next.ServeHTTP(w, r)
	})
}

func (s *Server) resolveProxyMetadata(r *http.Request) proxyMetadata {
	peer, _ := remoteAddress(r.RemoteAddr)
	client := peer
	proto := "http"
	if r.TLS != nil {
		proto = "https"
	}
	if peer.IsValid() && s.cfg.TrustsProxy(peer) {
		if candidate, ok := trustedForwardedClient(r.Header); ok {
			client = candidate
		}
		if candidate := firstHeaderToken(r.Header.Get("X-Forwarded-Proto")); candidate == "http" || candidate == "https" {
			proto = candidate
		}
	}
	metadata := proxyMetadata{Proto: proto, Host: r.Host}
	if client.IsValid() {
		metadata.ClientIP = client.String()
	}
	return metadata
}

func newBusinessProxy(
	target *url.URL,
	logger *slog.Logger,
	metrics *routeMetrics,
) *httputil.ReverseProxy {
	proxy := &httputil.ReverseProxy{
		Rewrite: func(request *httputil.ProxyRequest) {
			request.SetURL(target)
			request.Out.Host = request.In.Host
			stripForwardingHeaders(request.Out.Header)
			metadata, _ := request.In.Context().Value(proxyMetadataContextKey{}).(proxyMetadata)
			if metadata.ClientIP != "" {
				request.Out.Header.Set("X-Forwarded-For", metadata.ClientIP)
				request.Out.Header.Set("X-Real-IP", metadata.ClientIP)
			}
			if metadata.Proto != "" {
				request.Out.Header.Set("X-Forwarded-Proto", metadata.Proto)
			}
			if metadata.Host != "" {
				request.Out.Header.Set("X-Forwarded-Host", metadata.Host)
			}
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			route, ok := routeFromContext(r.Context())
			if ok {
				metrics.proxyError(route)
			}
			logger.Error(
				"private business API proxy failed",
				"request_id", requestID(r),
				"upstream", routeownership.OwnerGoBusinessAPI,
				"route_family", route.ID,
				"path", r.URL.Path,
				"error", err,
			)
			writeJSON(w, http.StatusBadGateway, map[string]any{
				"success":   false,
				"requestId": requestID(r),
				"error":     map[string]string{"code": "GO_BUSINESS_API_UNAVAILABLE"},
			})
		},
	}
	return proxy
}

func stripForwardingHeaders(header http.Header) {
	for _, name := range []string{
		"Forwarded",
		"X-Forwarded-For",
		"X-Forwarded-Host",
		"X-Forwarded-Proto",
		"X-Real-IP",
		"CF-Connecting-IP",
	} {
		header.Del(name)
	}
}

func trustedForwardedClient(header http.Header) (netip.Addr, bool) {
	for _, value := range []string{header.Get("CF-Connecting-IP"), header.Get("X-Real-IP")} {
		if address, err := netip.ParseAddr(strings.TrimSpace(value)); err == nil {
			return address.Unmap(), true
		}
	}
	for _, value := range strings.Split(header.Get("X-Forwarded-For"), ",") {
		if address, err := netip.ParseAddr(strings.TrimSpace(value)); err == nil {
			return address.Unmap(), true
		}
	}
	return netip.Addr{}, false
}

func firstHeaderToken(value string) string {
	value, _, _ = strings.Cut(value, ",")
	return strings.ToLower(strings.TrimSpace(value))
}

func remoteAddress(remote string) (netip.Addr, error) {
	host, _, err := net.SplitHostPort(remote)
	if err != nil {
		host = strings.Trim(remote, "[]")
	}
	address, parseErr := netip.ParseAddr(host)
	if parseErr != nil {
		return netip.Addr{}, parseErr
	}
	return address.Unmap(), nil
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

func normalizeRequestID(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 128 {
		return ""
	}
	for _, character := range value {
		if (character >= 'a' && character <= 'z') ||
			(character >= 'A' && character <= 'Z') ||
			(character >= '0' && character <= '9') ||
			strings.ContainsRune("-_.:", character) {
			continue
		}
		return ""
	}
	return value
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
