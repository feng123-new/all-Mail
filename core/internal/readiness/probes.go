package readiness

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/config"
)

type Probe func(context.Context, string) error

type Prober struct {
	BusinessAPI Probe
}

type Report struct {
	Ready  bool              `json:"ready"`
	Checks map[string]string `json:"checks"`
}

func Default() Prober {
	return Prober{BusinessAPI: checkBusinessAPI}
}

func (p Prober) Check(ctx context.Context, cfg config.APIConfig) Report {
	report := Report{Ready: true, Checks: map[string]string{}}
	index := filepath.Join(cfg.StaticDir, "index.html")
	if info, err := os.Stat(index); err != nil || info.IsDir() {
		report.Ready = false
		report.Checks["staticAssets"] = "index.html unavailable"
	} else {
		report.Checks["staticAssets"] = "ok"
	}
	p.runRequired(ctx, &report, "businessApi", cfg.BusinessAPIURL, p.BusinessAPI)
	return report
}

func (p Prober) runRequired(ctx context.Context, report *Report, name, target string, probe Probe) {
	if strings.TrimSpace(target) == "" {
		report.Ready = false
		report.Checks[name] = "required-but-not-configured"
		return
	}
	if probe == nil {
		report.Ready = false
		report.Checks[name] = "probe-not-configured"
		return
	}
	if err := probe(ctx, target); err != nil {
		report.Ready = false
		report.Checks[name] = redactProbeError(target, err)
		return
	}
	report.Checks[name] = "ok"
}

func checkBusinessAPI(ctx context.Context, baseURL string) error {
	target, err := url.Parse(baseURL)
	if err != nil {
		return err
	}
	target.Path = "/readyz"
	target.RawQuery = ""
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return err
	}
	client := &http.Client{Timeout: 5 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 16*1024))
	if err != nil {
		return err
	}
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("business API readiness returned %d: %s", response.StatusCode, compactOutput(body))
	}
	var envelope struct {
		Success bool `json:"success"`
		Data    struct {
			Status string `json:"status"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		return fmt.Errorf("decode business API readiness: %w", err)
	}
	if !envelope.Success || envelope.Data.Status != "ready" {
		return fmt.Errorf("business API readiness reported status %q", envelope.Data.Status)
	}
	return nil
}

func compactOutput(output []byte) string {
	text := strings.Join(strings.Fields(string(output)), " ")
	if text == "" {
		return "no diagnostic output"
	}
	if len(text) > 400 {
		return text[:400] + "..."
	}
	return text
}

func redactProbeError(target string, err error) string {
	message := err.Error()
	parsed, parseErr := url.Parse(target)
	if parseErr == nil && parsed.User != nil {
		redacted := *parsed
		redacted.User = url.UserPassword(parsed.User.Username(), "REDACTED")
		message = strings.ReplaceAll(message, target, redacted.String())
	}
	if len(message) > 500 {
		return message[:500] + "..."
	}
	return message
}
