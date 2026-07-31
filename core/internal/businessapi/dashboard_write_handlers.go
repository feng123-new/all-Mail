package businessapi

import (
	"encoding/json"
	"net/http"
	"time"
)

const maxDashboardBatchDeleteIDs = 1000

type dashboardBatchDeleteRequest struct {
	IDs json.RawMessage `json:"ids"`
}

func (s *Server) registerDashboardWriteRoutes(mux *http.ServeMux) {
	mux.HandleFunc("DELETE /admin/dashboard/logs/{id}", s.withAdministrator(s.deleteDashboardLog))
	mux.HandleFunc("POST /admin/dashboard/logs/batch-delete", s.withAdministrator(s.batchDeleteDashboardLogs))
}

func (s *Server) deleteDashboardLog(w http.ResponseWriter, r *http.Request, admin Admin) {
	store, ok := s.store.(DashboardWriteStore)
	if !ok {
		s.writeRequestError(w, r, &requestError{Status: http.StatusServiceUnavailable, Code: "DASHBOARD_WRITE_STORE_UNAVAILABLE"})
		return
	}
	id, err := parsePositivePathID(r, "id")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	started := time.Now()
	deleted, err := store.DeleteDashboardLog(r.Context(), id, DashboardDeleteAudit{
		AdminID:      admin.ID,
		RequestID:    requestID(r),
		RequestIP:    requestClientIP(r),
		ResponseTime: time.Since(started).Milliseconds(),
	})
	if err != nil {
		s.writeStoreError(w, r, "delete Dashboard log", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]bool{"deleted": deleted}})
}

func (s *Server) batchDeleteDashboardLogs(w http.ResponseWriter, r *http.Request, admin Admin) {
	store, ok := s.store.(DashboardWriteStore)
	if !ok {
		s.writeRequestError(w, r, &requestError{Status: http.StatusServiceUnavailable, Code: "DASHBOARD_WRITE_STORE_UNAVAILABLE"})
		return
	}
	var body dashboardBatchDeleteRequest
	if err := decodeRequiredJSONObject(r, &body); err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	if len(body.IDs) == 0 || isJSONNull(body.IDs) {
		s.writeRequestError(w, r, validationError("ids must be a non-empty array of positive integers"))
		return
	}
	var ids []int64
	if err := json.Unmarshal(body.IDs, &ids); err != nil {
		s.writeRequestError(w, r, validationError("ids must be a non-empty array of positive integers"))
		return
	}
	ids = normalizePositiveIDs(ids)
	if len(ids) == 0 || len(ids) > maxDashboardBatchDeleteIDs {
		s.writeRequestError(w, r, validationError("ids must contain between 1 and 1000 unique positive integers"))
		return
	}
	started := time.Now()
	deleted, err := store.BatchDeleteDashboardLogs(r.Context(), ids, DashboardDeleteAudit{
		AdminID:      admin.ID,
		RequestID:    requestID(r),
		RequestIP:    requestClientIP(r),
		ResponseTime: time.Since(started).Milliseconds(),
	})
	if err != nil {
		s.writeStoreError(w, r, "batch delete Dashboard logs", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]int64{"deleted": deleted}})
}
