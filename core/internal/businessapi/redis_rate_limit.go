package businessapi

import (
	"bufio"
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const rateLimitScript = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return current
`

const replayReleaseScript = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`

type RateLimiter interface {
	Ping(context.Context) error
	Increment(context.Context, string, time.Duration) (int64, error)
	Close()
}

type redisRateLimiter struct {
	address  string
	username string
	password string
	database int
	secure   bool
	timeout  time.Duration
}

type allowAllRateLimiter struct{}

func (allowAllRateLimiter) Ping(context.Context) error { return nil }
func (allowAllRateLimiter) Increment(context.Context, string, time.Duration) (int64, error) {
	return 1, nil
}
func (allowAllRateLimiter) Reserve(context.Context, string, string, time.Duration) (bool, error) {
	return true, nil
}
func (allowAllRateLimiter) Release(context.Context, string, string) error { return nil }
func (allowAllRateLimiter) Close()                                        {}

func newRedisRateLimiter(rawURL string, timeout time.Duration) (*redisRateLimiter, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return nil, fmt.Errorf("parse Go business REDIS_URL: %w", err)
	}
	if parsed.Scheme != "redis" && parsed.Scheme != "rediss" {
		return nil, errors.New("REDIS_URL must use redis or rediss")
	}
	if parsed.Host == "" {
		return nil, errors.New("REDIS_URL must include a host")
	}
	address := parsed.Host
	if _, _, err := net.SplitHostPort(address); err != nil {
		address = net.JoinHostPort(parsed.Hostname(), "6379")
	}

	username := ""
	password := ""
	if parsed.User != nil {
		username = parsed.User.Username()
		password, _ = parsed.User.Password()
	}
	database := 0
	if path := strings.Trim(strings.TrimSpace(parsed.Path), "/"); path != "" {
		database, err = strconv.Atoi(path)
		if err != nil || database < 0 {
			return nil, errors.New("REDIS_URL database must be a non-negative integer")
		}
	}
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	return &redisRateLimiter{
		address:  address,
		username: username,
		password: password,
		database: database,
		secure:   parsed.Scheme == "rediss",
		timeout:  timeout,
	}, nil
}

func (c *redisRateLimiter) Close() {}

func (c *redisRateLimiter) Ping(ctx context.Context) error {
	response, err := c.command(ctx, "PING")
	if err != nil {
		return fmt.Errorf("ping Go business Redis: %w", err)
	}
	value, ok := response.(string)
	if !ok || strings.ToUpper(value) != "PONG" {
		return fmt.Errorf("ping Go business Redis returned %#v", response)
	}
	return nil
}

func (c *redisRateLimiter) Increment(ctx context.Context, key string, ttl time.Duration) (int64, error) {
	seconds := int64(ttl / time.Second)
	if seconds < 1 {
		seconds = 1
	}
	response, err := c.command(ctx, "EVAL", rateLimitScript, "1", key, strconv.FormatInt(seconds, 10))
	if err != nil {
		return 0, fmt.Errorf("increment API key rate limit: %w", err)
	}
	count, ok := response.(int64)
	if !ok {
		return 0, fmt.Errorf("increment API key rate limit returned %#v", response)
	}
	return count, nil
}

func (c *redisRateLimiter) Set(ctx context.Context, key, value string, ttl time.Duration) error {
	seconds := int64(ttl / time.Second)
	if seconds < 1 {
		seconds = 1
	}
	response, err := c.command(ctx, "SET", key, value, "EX", strconv.FormatInt(seconds, 10))
	if err != nil {
		return fmt.Errorf("set OAuth state: %w", err)
	}
	status, ok := response.(string)
	if !ok || strings.ToUpper(status) != "OK" {
		return fmt.Errorf("set OAuth state returned %#v", response)
	}
	return nil
}

func (c *redisRateLimiter) TTL(ctx context.Context, key string) (time.Duration, error) {
	response, err := c.command(ctx, "TTL", key)
	if err != nil {
		return 0, fmt.Errorf("read Redis key TTL: %w", err)
	}
	seconds, ok := response.(int64)
	if !ok {
		return 0, fmt.Errorf("read Redis key TTL returned %#v", response)
	}
	if seconds <= 0 {
		return 0, nil
	}
	return time.Duration(seconds) * time.Second, nil
}

func (c *redisRateLimiter) Delete(ctx context.Context, keys ...string) error {
	if len(keys) == 0 {
		return nil
	}
	command := append([]string{"DEL"}, keys...)
	response, err := c.command(ctx, command...)
	if err != nil {
		return fmt.Errorf("delete Redis keys: %w", err)
	}
	if _, ok := response.(int64); !ok {
		return fmt.Errorf("delete Redis keys returned %#v", response)
	}
	return nil
}

func (c *redisRateLimiter) Get(ctx context.Context, key string) (string, bool, error) {
	response, err := c.command(ctx, "GET", key)
	if err != nil {
		return "", false, fmt.Errorf("get OAuth state: %w", err)
	}
	if response == nil {
		return "", false, nil
	}
	value, ok := response.(string)
	if !ok {
		return "", false, fmt.Errorf("get OAuth state returned %#v", response)
	}
	return value, true, nil
}

func (c *redisRateLimiter) Take(ctx context.Context, key string) (string, bool, error) {
	response, err := c.command(ctx, "GETDEL", key)
	if err != nil {
		return "", false, fmt.Errorf("take OAuth state: %w", err)
	}
	if response == nil {
		return "", false, nil
	}
	value, ok := response.(string)
	if !ok {
		return "", false, fmt.Errorf("take OAuth state returned %#v", response)
	}
	return value, true, nil
}

func (c *redisRateLimiter) Reserve(
	ctx context.Context,
	key string,
	value string,
	ttl time.Duration,
) (bool, error) {
	seconds := int64(ttl / time.Second)
	if seconds < 1 {
		seconds = 1
	}
	response, err := c.command(ctx, "SET", key, value, "EX", strconv.FormatInt(seconds, 10), "NX")
	if err != nil {
		return false, fmt.Errorf("reserve ingress replay key: %w", err)
	}
	if response == nil {
		return false, nil
	}
	status, ok := response.(string)
	if !ok || strings.ToUpper(status) != "OK" {
		return false, fmt.Errorf("reserve ingress replay key returned %#v", response)
	}
	return true, nil
}

func (c *redisRateLimiter) Release(ctx context.Context, key, value string) error {
	response, err := c.command(ctx, "EVAL", replayReleaseScript, "1", key, value)
	if err != nil {
		return fmt.Errorf("release ingress replay key: %w", err)
	}
	if _, ok := response.(int64); !ok {
		return fmt.Errorf("release ingress replay key returned %#v", response)
	}
	return nil
}

func (c *redisRateLimiter) command(ctx context.Context, command ...string) (any, error) {
	connection, err := c.dial(ctx)
	if err != nil {
		return nil, err
	}
	defer connection.Close()

	deadline := time.Now().Add(c.timeout)
	if contextDeadline, ok := ctx.Deadline(); ok && contextDeadline.Before(deadline) {
		deadline = contextDeadline
	}
	if err := connection.SetDeadline(deadline); err != nil {
		return nil, err
	}
	reader := bufio.NewReader(connection)
	writer := bufio.NewWriter(connection)

	if c.password != "" || c.username != "" {
		auth := []string{"AUTH"}
		if c.username != "" {
			auth = append(auth, c.username, c.password)
		} else {
			auth = append(auth, c.password)
		}
		if err := writeRESPCommand(writer, auth...); err != nil {
			return nil, err
		}
		if err := writer.Flush(); err != nil {
			return nil, err
		}
		if _, err := readRESP(reader); err != nil {
			return nil, fmt.Errorf("Redis AUTH failed: %w", err)
		}
	}
	if c.database > 0 {
		if err := writeRESPCommand(writer, "SELECT", strconv.Itoa(c.database)); err != nil {
			return nil, err
		}
		if err := writer.Flush(); err != nil {
			return nil, err
		}
		if _, err := readRESP(reader); err != nil {
			return nil, fmt.Errorf("Redis SELECT failed: %w", err)
		}
	}
	if err := writeRESPCommand(writer, command...); err != nil {
		return nil, err
	}
	if err := writer.Flush(); err != nil {
		return nil, err
	}
	return readRESP(reader)
}

func (c *redisRateLimiter) dial(ctx context.Context) (net.Conn, error) {
	dialer := &net.Dialer{Timeout: c.timeout, KeepAlive: 30 * time.Second}
	if !c.secure {
		return dialer.DialContext(ctx, "tcp", c.address)
	}
	return (&tls.Dialer{
		NetDialer: dialer,
		Config:    &tls.Config{MinVersion: tls.VersionTLS12, ServerName: hostWithoutPort(c.address)},
	}).DialContext(ctx, "tcp", c.address)
}

func hostWithoutPort(address string) string {
	host, _, err := net.SplitHostPort(address)
	if err == nil {
		return host
	}
	return strings.Trim(address, "[]")
}

func writeRESPCommand(writer *bufio.Writer, values ...string) error {
	if _, err := fmt.Fprintf(writer, "*%d\r\n", len(values)); err != nil {
		return err
	}
	for _, value := range values {
		if _, err := fmt.Fprintf(writer, "$%d\r\n%s\r\n", len(value), value); err != nil {
			return err
		}
	}
	return nil
}

func readRESP(reader *bufio.Reader) (any, error) {
	prefix, err := reader.ReadByte()
	if err != nil {
		return nil, err
	}
	line, err := readRESPLine(reader)
	if err != nil {
		return nil, err
	}
	switch prefix {
	case '+':
		return line, nil
	case '-':
		return nil, errors.New(line)
	case ':':
		value, err := strconv.ParseInt(line, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("parse Redis integer %q: %w", line, err)
		}
		return value, nil
	case '$':
		length, err := strconv.Atoi(line)
		if err != nil {
			return nil, fmt.Errorf("parse Redis bulk length %q: %w", line, err)
		}
		if length == -1 {
			return nil, nil
		}
		if length < 0 || length > 16*1024*1024 {
			return nil, fmt.Errorf("invalid Redis bulk length %d", length)
		}
		content := make([]byte, length+2)
		if _, err := io.ReadFull(reader, content); err != nil {
			return nil, err
		}
		if content[length] != '\r' || content[length+1] != '\n' {
			return nil, errors.New("Redis bulk response is not CRLF terminated")
		}
		return string(content[:length]), nil
	default:
		return nil, fmt.Errorf("unsupported Redis response prefix %q", prefix)
	}
}

func readRESPLine(reader *bufio.Reader) (string, error) {
	line, err := reader.ReadString('\n')
	if err != nil {
		return "", err
	}
	if !strings.HasSuffix(line, "\r\n") {
		return "", errors.New("Redis response line is not CRLF terminated")
	}
	return strings.TrimSuffix(line, "\r\n"), nil
}
