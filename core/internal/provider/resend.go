package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type SendRequest struct {
	From           string   `json:"from"`
	To             []string `json:"to"`
	Subject        string   `json:"subject"`
	HTML           string   `json:"html,omitempty"`
	Text           string   `json:"text,omitempty"`
	ReplyTo        string   `json:"reply_to,omitempty"`
	IdempotencyKey string   `json:"-"`
}

type SendResult struct {
	ID string
}

type HTTPError struct {
	StatusCode int
	Code       string
	Message    string
}

func (e *HTTPError) Error() string {
	if e == nil {
		return "<nil>"
	}
	if e.Code != "" {
		return fmt.Sprintf("Resend returned %d (%s): %s", e.StatusCode, e.Code, e.Message)
	}
	return fmt.Sprintf("Resend returned %d: %s", e.StatusCode, e.Message)
}

func (e *HTTPError) Retryable() bool {
	if e == nil {
		return false
	}
	return e.StatusCode == http.StatusRequestTimeout ||
		e.StatusCode == http.StatusTooManyRequests ||
		e.StatusCode >= http.StatusInternalServerError
}

type ResendClient struct {
	baseURL string
	http    *http.Client
}

func NewResendClient(baseURL string, client *http.Client) *ResendClient {
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	return &ResendClient{baseURL: strings.TrimRight(baseURL, "/"), http: client}
}

func (c *ResendClient) Send(ctx context.Context, apiKey string, input SendRequest) (SendResult, error) {
	payload, err := json.Marshal(input)
	if err != nil {
		return SendResult{}, fmt.Errorf("encode Resend request: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/emails", bytes.NewReader(payload))
	if err != nil {
		return SendResult{}, fmt.Errorf("create Resend request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+apiKey)
	request.Header.Set("Content-Type", "application/json")
	if input.IdempotencyKey != "" {
		request.Header.Set("Idempotency-Key", input.IdempotencyKey)
	}

	response, err := c.http.Do(request)
	if err != nil {
		return SendResult{}, fmt.Errorf("send Resend request: %w", err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return SendResult{}, fmt.Errorf("read Resend response: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var failure struct {
			Code    string `json:"code"`
			Name    string `json:"name"`
			Message string `json:"message"`
		}
		_ = json.Unmarshal(body, &failure)
		if strings.TrimSpace(failure.Message) == "" {
			failure.Message = http.StatusText(response.StatusCode)
		}
		code := strings.TrimSpace(failure.Code)
		if code == "" {
			code = strings.TrimSpace(failure.Name)
		}
		return SendResult{}, &HTTPError{
			StatusCode: response.StatusCode,
			Code:       code,
			Message:    failure.Message,
		}
	}
	var success struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(body, &success); err != nil {
		return SendResult{}, fmt.Errorf("decode Resend response: %w", err)
	}
	if strings.TrimSpace(success.ID) == "" {
		return SendResult{}, fmt.Errorf("decode Resend response: missing message id")
	}
	return SendResult{ID: success.ID}, nil
}
