package readiness

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/config"
	"github.com/jackc/pgx/v5"
)

type Probe func(context.Context, string) error

type Prober struct {
	Postgres Probe
	Redis    Probe
	Legacy   Probe
}

type Report struct {
	Ready  bool              `json:"ready"`
	Checks map[string]string `json:"checks"`
}

func Default() Prober {
	return Prober{
		Postgres: checkPostgres,
		Redis:    checkRedis,
		Legacy:   checkLegacy,
	}
}

func (p Prober) Check(ctx context.Context, cfg config.Config) Report {
	report := Report{Ready: true, Checks: map[string]string{}}

	switch cfg.APIMode {
	case config.APIModeBridge:
		p.runRequired(ctx, &report, "postgres", cfg.DatabaseURL, p.Postgres)
		p.runRequired(ctx, &report, "redis", cfg.RedisURL, p.Redis)
		p.runRequired(ctx, &report, "legacyApi", cfg.LegacyAPIURL, p.Legacy)
	case config.APIModeStatic:
		index := filepath.Join(cfg.StaticDir, "index.html")
		if info, err := os.Stat(index); err != nil || info.IsDir() {
			report.Ready = false
			report.Checks["staticAssets"] = "index.html unavailable"
		} else {
			report.Checks["staticAssets"] = "ok"
		}
	default:
		report.Ready = false
		report.Checks["mode"] = fmt.Sprintf("unsupported mode %q", cfg.APIMode)
	}

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

func checkPostgres(ctx context.Context, databaseURL string) error {
	parsed, err := url.Parse(databaseURL)
	if err != nil {
		return fmt.Errorf("parse database URL: %w", err)
	}
	if parsed.Scheme != "postgres" && parsed.Scheme != "postgresql" {
		return fmt.Errorf("unsupported PostgreSQL URL scheme %q", parsed.Scheme)
	}

	connection, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		return fmt.Errorf("connect to PostgreSQL: %w", err)
	}
	defer connection.Close(context.Background())

	var databaseName string
	if err := connection.QueryRow(ctx, "SELECT current_database()").Scan(&databaseName); err != nil {
		return fmt.Errorf("PostgreSQL readiness query failed: %w", err)
	}
	if strings.TrimSpace(databaseName) == "" {
		return errors.New("PostgreSQL query returned no database name")
	}
	return nil
}

func checkRedis(ctx context.Context, redisURL string) error {
	parsed, err := url.Parse(redisURL)
	if err != nil {
		return fmt.Errorf("parse Redis URL: %w", err)
	}
	if parsed.Scheme != "redis" && parsed.Scheme != "rediss" {
		return fmt.Errorf("unsupported Redis URL scheme %q", parsed.Scheme)
	}

	host := parsed.Hostname()
	if host == "" {
		return errors.New("Redis URL has no host")
	}
	port := parsed.Port()
	if port == "" {
		port = "6379"
	}
	address := net.JoinHostPort(host, port)

	var connection net.Conn
	if parsed.Scheme == "rediss" {
		dialer := &tls.Dialer{Config: &tls.Config{MinVersion: tls.VersionTLS12, ServerName: host}}
		connection, err = dialer.DialContext(ctx, "tcp", address)
	} else {
		connection, err = (&net.Dialer{}).DialContext(ctx, "tcp", address)
	}
	if err != nil {
		return fmt.Errorf("connect to Redis: %w", err)
	}
	defer connection.Close()

	if deadline, ok := ctx.Deadline(); ok {
		_ = connection.SetDeadline(deadline)
	} else {
		_ = connection.SetDeadline(time.Now().Add(5 * time.Second))
	}

	reader := bufio.NewReader(connection)
	writer := bufio.NewWriter(connection)
	username := ""
	password := ""
	if parsed.User != nil {
		username = parsed.User.Username()
		password, _ = parsed.User.Password()
	}
	if password != "" {
		args := []string{"AUTH", password}
		if username != "" {
			args = []string{"AUTH", username, password}
		}
		if err := redisCommand(reader, writer, args...); err != nil {
			return fmt.Errorf("Redis AUTH failed: %w", err)
		}
	}

	database := strings.TrimPrefix(parsed.EscapedPath(), "/")
	if database == "" {
		database = parsed.Query().Get("db")
	}
	if database != "" && database != "0" {
		if _, err := strconv.Atoi(database); err != nil {
			return fmt.Errorf("invalid Redis database %q", database)
		}
		if err := redisCommand(reader, writer, "SELECT", database); err != nil {
			return fmt.Errorf("Redis SELECT failed: %w", err)
		}
	}

	response, err := redisCommandValue(reader, writer, "PING")
	if err != nil {
		return fmt.Errorf("Redis PING failed: %w", err)
	}
	if strings.ToUpper(response) != "PONG" {
		return fmt.Errorf("Redis PING returned %q", response)
	}
	return nil
}

func redisCommand(reader *bufio.Reader, writer *bufio.Writer, args ...string) error {
	_, err := redisCommandValue(reader, writer, args...)
	return err
}

func redisCommandValue(reader *bufio.Reader, writer *bufio.Writer, args ...string) (string, error) {
	if _, err := fmt.Fprintf(writer, "*%d\r\n", len(args)); err != nil {
		return "", err
	}
	for _, arg := range args {
		if _, err := fmt.Fprintf(writer, "$%d\r\n%s\r\n", len(arg), arg); err != nil {
			return "", err
		}
	}
	if err := writer.Flush(); err != nil {
		return "", err
	}
	return readRESP(reader)
}

func readRESP(reader *bufio.Reader) (string, error) {
	prefix, err := reader.ReadByte()
	if err != nil {
		return "", err
	}
	line, err := reader.ReadString('\n')
	if err != nil {
		return "", err
	}
	line = strings.TrimSuffix(strings.TrimSuffix(line, "\n"), "\r")

	switch prefix {
	case '+', ':':
		return line, nil
	case '-':
		return "", errors.New(line)
	case '$':
		length, parseErr := strconv.Atoi(line)
		if parseErr != nil || length < -1 {
			return "", fmt.Errorf("invalid Redis bulk length %q", line)
		}
		if length == -1 {
			return "", nil
		}
		buffer := make([]byte, length+2)
		if _, err := io.ReadFull(reader, buffer); err != nil {
			return "", err
		}
		if string(buffer[length:]) != "\r\n" {
			return "", errors.New("invalid Redis bulk terminator")
		}
		return string(buffer[:length]), nil
	default:
		return "", fmt.Errorf("unexpected Redis response prefix %q", prefix)
	}
}

func checkLegacy(ctx context.Context, baseURL string) error {
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
		return fmt.Errorf("legacy readiness returned %d: %s", response.StatusCode, compactOutput(body))
	}
	var envelope struct {
		Success bool `json:"success"`
		Data    struct {
			Status string `json:"status"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		return fmt.Errorf("decode legacy readiness: %w", err)
	}
	if !envelope.Success || envelope.Data.Status != "ready" {
		return fmt.Errorf("legacy readiness reported status %q", envelope.Data.Status)
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
