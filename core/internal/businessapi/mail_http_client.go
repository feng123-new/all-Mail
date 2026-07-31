package businessapi

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

func (s *Server) providerClient() *http.Client {
	if s.providerHTTPClient != nil {
		return s.providerHTTPClient
	}
	return &http.Client{Timeout: 30 * time.Second}
}

func providerHTTPFailure(code string, response *http.Response) error {
	body, _ := io.ReadAll(io.LimitReader(response.Body, 8192))
	message := strings.TrimSpace(string(body))
	if message == "" {
		message = response.Status
	}
	return providerFailure(code, fmt.Errorf("provider returned %d: %s", response.StatusCode, message))
}
