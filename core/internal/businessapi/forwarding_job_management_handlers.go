package businessapi

import (
	"net/http"
	"strconv"
	"strings"
)

type managedForwardingJobListInput struct {
	Page      int
	PageSize  int
	Status    string
	Mode      string
	MailboxID *int64
	DomainID  *int64
	Keyword   string
}

func (s *Server) registerForwardingJobManagementRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /admin/forwarding-jobs", s.withAdministrator(s.listManagedForwardingJobs))
	mux.HandleFunc("GET /admin/forwarding-jobs/{id}", s.withAdministrator(s.getManagedForwardingJob))
	mux.HandleFunc("POST /admin/forwarding-jobs/{id}/requeue", s.withAdministrator(s.requeueManagedForwardingJob))
}

func (s *Server) listManagedForwardingJobs(w http.ResponseWriter, r *http.Request, _ Admin) {
	store, err := s.managementStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
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
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	if status != "" {
		if err := validateManagementEnum("status", status, "PENDING", "RUNNING", "SENT", "FAILED", "SKIPPED"); err != nil {
			s.writeRequestError(w, r, err)
			return
		}
	}
	mode := strings.TrimSpace(r.URL.Query().Get("mode"))
	if mode != "" {
		if err := validateManagementEnum("mode", mode, "COPY", "MOVE"); err != nil {
			s.writeRequestError(w, r, err)
			return
		}
	}
	mailboxID, err := parseOptionalPositiveQueryID(r, "mailboxId")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	domainID, err := parseOptionalPositiveQueryID(r, "domainId")
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	keyword := strings.TrimSpace(r.URL.Query().Get("keyword"))
	if r.URL.Query().Has("keyword") {
		if err := validateTextLength("keyword", keyword, 1, 255); err != nil {
			s.writeRequestError(w, r, err)
			return
		}
	}
	result, err := store.listManagedForwardingJobs(r.Context(), managedForwardingJobListInput{
		Page: page, PageSize: pageSize, Status: status, Mode: mode,
		MailboxID: mailboxID, DomainID: domainID, Keyword: keyword,
	})
	if err != nil {
		s.writeStoreError(w, r, "list forwarding jobs", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) getManagedForwardingJob(w http.ResponseWriter, r *http.Request, _ Admin) {
	store, err := s.managementStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	id, err := parseForwardingJobPathID(r)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	result, err := store.getManagedForwardingJob(r.Context(), id)
	if err != nil {
		s.writeStoreError(w, r, "get forwarding job", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (s *Server) requeueManagedForwardingJob(w http.ResponseWriter, r *http.Request, _ Admin) {
	store, err := s.managementStore()
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	id, err := parseForwardingJobPathID(r)
	if err != nil {
		s.writeRequestError(w, r, err)
		return
	}
	result, err := store.requeueManagedForwardingJob(r.Context(), id)
	if err != nil {
		s.writeStoreError(w, r, "requeue forwarding job", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func parseForwardingJobPathID(r *http.Request) (int64, error) {
	id, err := strconv.ParseInt(strings.TrimSpace(r.PathValue("id")), 10, 64)
	if err != nil {
		return 0, &requestError{Status: http.StatusBadRequest, Code: "FORWARDING_JOB_INVALID_ID"}
	}
	return id, nil
}
