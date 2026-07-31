package businessapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/config"
)

type Server struct {
	cfg                config.GoBusinessAPIConfig
	logger             *slog.Logger
	store              Store
	apiKeyStore        APIKeyStore
	domainMailboxStore DomainMailboxStore
	ingressStore       IngressStore
	rateLimiter        RateLimiter
	replayProtector    ReplayProtector
	now                func() time.Time
	ownStore           bool
	ownRateLimiter     bool
}

func New(ctx context.Context, cfg config.GoBusinessAPIConfig, logger *slog.Logger) (*Server, error) {
	storeCtx, cancel := context.WithTimeout(ctx, cfg.ReadyTimeout)
	defer cancel()
	store, err := NewPostgresStore(storeCtx, cfg.DatabaseURL)
	if err != nil {
		return nil, err
	}
	limiter, err := newRedisRateLimiter(cfg.RedisURL, cfg.ReadyTimeout)
	if err != nil {
		store.Close()
		return nil, err
	}
	if err := limiter.Ping(storeCtx); err != nil {
		store.Close()
		return nil, err
	}
	return &Server{
		cfg:                cfg,
		logger:             logger,
		store:              store,
		apiKeyStore:        store,
		domainMailboxStore: store,
		ingressStore:       store,
		rateLimiter:        limiter,
		replayProtector:    limiter,
		now:                time.Now,
		ownStore:           true,
		ownRateLimiter:     true,
	}, nil
}

func newWithStore(cfg config.GoBusinessAPIConfig, logger *slog.Logger, store Store) *Server {
	apiKeyStore, _ := store.(APIKeyStore)
	domainMailboxStore, _ := store.(DomainMailboxStore)
	return newWithDependencies(cfg, logger, store, apiKeyStore, domainMailboxStore, allowAllRateLimiter{})
}

func newWithDependencies(
	cfg config.GoBusinessAPIConfig,
	logger *slog.Logger,
	store Store,
	apiKeyStore APIKeyStore,
	domainMailboxStore DomainMailboxStore,
	rateLimiter RateLimiter,
) *Server {
	if rateLimiter == nil {
		rateLimiter = allowAllRateLimiter{}
	}
	ingressStore, _ := store.(IngressStore)
	replayProtector, _ := rateLimiter.(ReplayProtector)
	if replayProtector == nil {
		replayProtector = allowAllReplayProtector{}
	}
	return &Server{
		cfg:                cfg,
		logger:             logger,
		store:              store,
		apiKeyStore:        apiKeyStore,
		domainMailboxStore: domainMailboxStore,
		ingressStore:       ingressStore,
		rateLimiter:        rateLimiter,
		replayProtector:    replayProtector,
		now:                time.Now,
	}
}

func (s *Server) Close() {
	if s.ownRateLimiter && s.rateLimiter != nil {
		s.rateLimiter.Close()
	}
	if s.ownStore && s.store != nil {
		s.store.Close()
	}
}

func (s *Server) Run(ctx context.Context) error {
	httpServer := &http.Server{
		Addr:              s.cfg.Address(),
		Handler:           s.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       90 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		s.logger.Info("private Go business API listening", "address", httpServer.Addr)
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

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.health)
	mux.HandleFunc("GET /readyz", s.readyz)
	mux.HandleFunc("GET /admin/dashboard/stats", s.withAdministrator(s.dashboardStats))
	mux.HandleFunc("GET /admin/dashboard/api-trend", s.withAdministrator(s.dashboardTrend))
	mux.HandleFunc("GET /admin/dashboard/logs", s.withAdministrator(s.dashboardLogs))
	s.registerDashboardWriteRoutes(mux)
	s.registerAPIKeyRoutes(mux)
	s.registerExternalRoutes(mux)
	s.registerIngressRoutes(mux)
	s.registerAdminManagementRoutes(mux)
	s.registerEmailGroupManagementRoutes(mux)
	s.registerDomainMailboxManagementRoutes(mux)
	s.registerMailboxUserManagementRoutes(mux)
	mux.HandleFunc("/", s.notFound)
	return s.withRequestMetadata(mux)
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]string{
			"status":  "ok",
			"runtime": "go-business-api",
		},
	})
}

func (s *Server) readyz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.ReadyTimeout)
	defer cancel()
	checks := map[string]string{"postgres": "ok", "redis": "ok"}
	ready := true
	if err := s.store.Ping(ctx); err != nil {
		ready = false
		checks["postgres"] = "unavailable"
		s.logger.Error("Go business PostgreSQL readiness failed", "request_id", requestID(r), "error", err)
	}
	if s.rateLimiter == nil {
		ready = false
		checks["redis"] = "not-configured"
	} else if err := s.rateLimiter.Ping(ctx); err != nil {
		ready = false
		checks["redis"] = "unavailable"
		s.logger.Error("Go business Redis readiness failed", "request_id", requestID(r), "error", err)
	}
	status := http.StatusOK
	state := "ready"
	if !ready {
		status = http.StatusServiceUnavailable
		state = "not-ready"
	}
	writeJSON(w, status, map[string]any{
		"success": ready,
		"data": map[string]any{
			"status": state,
			"checks": checks,
		},
	})
}

func (s *Server) withAdministrator(next func(http.ResponseWriter, *http.Request, Admin)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), s.cfg.QueryTimeout)
		defer cancel()
		admin, err := authenticateAdmin(ctx, r, s.store, s.cfg.JWTSecret, s.now())
		if err != nil {
			s.writeRequestError(w, r, err)
			return
		}
		next(w, r.WithContext(ctx), admin)
	}
}

func (s *Server) dashboardStats(w http.ResponseWriter, r *http.Request, _ Admin) {
	result, err := s.store.DashboardStats(r.Context())
	if err != nil {
		s.writeStoreError(w, r, "query Dashboard statistics", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) dashboardTrend(w http.ResponseWriter, r *http.Request, _ Admin) {
	days, err := parseBoundedQueryInt(r, "days", 7, 1, 90)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	result, err := s.store.DashboardTrend(r.Context(), days)
	if err != nil {
		s.writeStoreError(w, r, "query Dashboard API trend", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) dashboardLogs(w http.ResponseWriter, r *http.Request, _ Admin) {
	page, err := parseBoundedQueryInt(r, "page", 1, 1, 1_000_000)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	pageSize, err := parseBoundedQueryInt(r, "pageSize", 20, 1, 100)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	action := strings.TrimSpace(r.URL.Query().Get("action"))
	if len(action) > 50 {
		s.writeRequestError(w, r, validationError("action must contain at most 50 characters"))
		return
	}
	result, err := s.store.DashboardLogs(r.Context(), DashboardLogInput{
		Page: page, PageSize: pageSize, Action: action,
	})
	if err != nil {
		s.writeStoreError(w, r, "query Dashboard logs", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) notFound(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotFound, requestID(r), "NOT_FOUND", nil)
}

func (s *Server) withRequestMetadata(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := normalizeRequestID(r.Header.Get("X-Request-Id"))
		if id == "" {
			id = newRequestID()
		}
		r.Header.Set("X-Request-Id", id)
		w.Header().Set("X-Request-Id", id)
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		next.ServeHTTP(w, r)
	})
}

func (s *Server) writeRequestError(w http.ResponseWriter, r *http.Request, err error) {
	var requestErr *requestError
	if errors.As(err, &requestErr) {
		if requestErr.Cause != nil && requestErr.Status >= 500 {
			s.logger.Error("Go business request failed", "request_id", requestID(r), "code", requestErr.Code, "error", requestErr.Cause)
		}
		writeError(w, requestErr.Status, requestID(r), requestErr.Code, nil)
		return
	}
	s.logger.Error("Go business request failed", "request_id", requestID(r), "error", err)
	writeError(w, http.StatusInternalServerError, requestID(r), "INTERNAL_ERROR", nil)
}

func (s *Server) writeStoreError(w http.ResponseWriter, r *http.Request, operation string, err error) {
	var requestErr *requestError
	if errors.As(err, &requestErr) {
		s.writeRequestError(w, r, requestErr)
		return
	}
	s.logger.Error(operation, "request_id", requestID(r), "error", err)
	writeError(w, http.StatusInternalServerError, requestID(r), "INTERNAL_ERROR", nil)
}

func parseBoundedQueryInt(r *http.Request, name string, fallback, minimum, maximum int) (int, error) {
	raw := strings.TrimSpace(r.URL.Query().Get(name))
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < minimum || value > maximum {
		return 0, validationError(fmt.Sprintf("%s must be an integer between %d and %d", name, minimum, maximum))
	}
	return value, nil
}

func validationError(message string) error {
	return &requestError{Status: http.StatusBadRequest, Code: "VALIDATION_ERROR", Cause: errors.New(message)}
}

func writeError(w http.ResponseWriter, status int, id, code string, details any) {
	writeJSON(w, status, map[string]any{
		"success":   false,
		"requestId": id,
		"error": map[string]any{
			"code":    code,
			"details": details,
		},
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func requestID(r *http.Request) string {
	return r.Header.Get("X-Request-Id")
}

func newRequestID() string {
	buffer := make([]byte, 12)
	if _, err := rand.Read(buffer); err != nil {
		return fmt.Sprintf("go-business-%d", time.Now().UnixNano())
	}
	return "go-business-" + hex.EncodeToString(buffer)
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
