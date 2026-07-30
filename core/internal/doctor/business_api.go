package doctor

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/feng123-new/all-Mail/core/internal/config"
)

func GoBusinessAPI(ctx context.Context, cfg config.GoBusinessAPIConfig) error {
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		fmt.Sprintf("http://127.0.0.1:%d/readyz", cfg.Port),
		nil,
	)
	if err != nil {
		return err
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return fmt.Errorf("Go business API readiness request failed: %w", err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 32*1024))
	if err != nil {
		return fmt.Errorf("read Go business API readiness response: %w", err)
	}
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("Go business API readiness returned %d: %s", response.StatusCode, string(body))
	}
	var envelope struct {
		Success bool `json:"success"`
		Data    struct {
			Status string `json:"status"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		return fmt.Errorf("decode Go business API readiness response: %w", err)
	}
	if !envelope.Success || envelope.Data.Status != "ready" {
		return fmt.Errorf("Go business API readiness reported status %q", envelope.Data.Status)
	}
	return nil
}
