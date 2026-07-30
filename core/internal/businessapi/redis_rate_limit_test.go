package businessapi

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestRedisRateLimiterUsesAtomicEvalAndPing(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	commands := make(chan []string, 4)
	serverErr := make(chan error, 1)
	go func() {
		for handled := 0; handled < 2; handled++ {
			connection, acceptErr := listener.Accept()
			if acceptErr != nil {
				serverErr <- acceptErr
				return
			}
			command, readErr := readTestRESPCommand(bufio.NewReader(connection))
			if readErr != nil {
				_ = connection.Close()
				serverErr <- readErr
				return
			}
			commands <- command
			switch command[0] {
			case "PING":
				_, _ = connection.Write([]byte("+PONG\r\n"))
			case "EVAL":
				_, _ = connection.Write([]byte(":2\r\n"))
			default:
				_, _ = connection.Write([]byte("-ERR unexpected command\r\n"))
			}
			_ = connection.Close()
		}
		serverErr <- nil
	}()

	limiter, err := newRedisRateLimiter("redis://"+listener.Addr().String()+"/0", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if err := limiter.Ping(context.Background()); err != nil {
		t.Fatal(err)
	}
	count, err := limiter.Increment(context.Background(), "rate:test", 75*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("count = %d", count)
	}

	pingCommand := <-commands
	evalCommand := <-commands
	if len(pingCommand) != 1 || pingCommand[0] != "PING" {
		t.Fatalf("PING command = %#v", pingCommand)
	}
	if len(evalCommand) != 5 || evalCommand[0] != "EVAL" || evalCommand[2] != "1" || evalCommand[3] != "rate:test" || evalCommand[4] != "75" {
		t.Fatalf("EVAL command = %#v", evalCommand)
	}
	if !strings.Contains(evalCommand[1], "INCR") || !strings.Contains(evalCommand[1], "EXPIRE") {
		t.Fatalf("rate limit script = %q", evalCommand[1])
	}
	if err := <-serverErr; err != nil {
		t.Fatal(err)
	}
}

func TestRedisRateLimiterValidatesURLsAndRESP(t *testing.T) {
	if _, err := newRedisRateLimiter("http://redis:6379", time.Second); err == nil {
		t.Fatal("accepted HTTP Redis URL")
	}
	if _, err := newRedisRateLimiter("redis:///not-a-number", time.Second); err == nil {
		t.Fatal("accepted invalid Redis database")
	}
	limiter, err := newRedisRateLimiter("rediss://user:pass@[2001:db8::1]:6380/4", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if limiter.address != "[2001:db8::1]:6380" || limiter.database != 4 || limiter.username != "user" || limiter.password != "pass" || !limiter.secure {
		t.Fatalf("parsed limiter = %#v", limiter)
	}

	cases := []struct {
		wire string
		want any
		err  bool
	}{
		{"+PONG\r\n", "PONG", false},
		{":42\r\n", int64(42), false},
		{"$5\r\nhello\r\n", "hello", false},
		{"$-1\r\n", nil, false},
		{"-ERR failed\r\n", nil, true},
	}
	for _, tc := range cases {
		value, readErr := readRESP(bufio.NewReader(strings.NewReader(tc.wire)))
		if (readErr != nil) != tc.err || fmt.Sprint(value) != fmt.Sprint(tc.want) {
			t.Fatalf("readRESP(%q) = %#v, %v; want %#v, err=%v", tc.wire, value, readErr, tc.want, tc.err)
		}
	}
}

func readTestRESPCommand(reader *bufio.Reader) ([]string, error) {
	line, err := reader.ReadString('\n')
	if err != nil {
		return nil, err
	}
	if !strings.HasPrefix(line, "*") {
		return nil, fmt.Errorf("expected array, got %q", line)
	}
	count, err := strconv.Atoi(strings.TrimSpace(strings.TrimPrefix(line, "*")))
	if err != nil {
		return nil, err
	}
	values := make([]string, 0, count)
	for range count {
		lengthLine, err := reader.ReadString('\n')
		if err != nil {
			return nil, err
		}
		length, err := strconv.Atoi(strings.TrimSpace(strings.TrimPrefix(lengthLine, "$")))
		if err != nil {
			return nil, err
		}
		content := make([]byte, length+2)
		if _, err := io.ReadFull(reader, content); err != nil {
			return nil, err
		}
		values = append(values, string(content[:length]))
	}
	return values, nil
}
