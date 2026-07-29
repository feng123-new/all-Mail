package readiness

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/config"
)

func TestBridgeReadinessRejectsMissingDependencies(t *testing.T) {
	prober := Prober{
		Postgres: func(context.Context, string) error { return nil },
		Redis:    func(context.Context, string) error { return nil },
		Legacy:   func(context.Context, string) error { return nil },
	}
	report := prober.Check(context.Background(), config.APIConfig{Mode: config.APIModeBridge})
	if report.Ready {
		t.Fatal("bridge readiness unexpectedly succeeded without dependencies")
	}
	for _, name := range []string{"postgres", "redis", "legacyApi"} {
		if report.Checks[name] != "required-but-not-configured" {
			t.Fatalf("%s check = %q", name, report.Checks[name])
		}
	}
}

func TestBridgeReadinessRunsAllProtocolProbes(t *testing.T) {
	called := map[string]int{}
	prober := Prober{
		Postgres: func(context.Context, string) error { called["postgres"]++; return nil },
		Redis:    func(context.Context, string) error { called["redis"]++; return nil },
		Legacy:   func(context.Context, string) error { called["legacy"]++; return nil },
	}
	cfg := config.APIConfig{
		Mode:         config.APIModeBridge,
		DatabaseURL:  "postgresql://user:password@postgres/database",
		RedisURL:     "redis://redis:6379/0",
		LegacyAPIURL: "http://legacy-api:3100",
	}
	report := prober.Check(context.Background(), cfg)
	if !report.Ready {
		t.Fatalf("report = %#v", report)
	}
	for _, name := range []string{"postgres", "redis", "legacy"} {
		if called[name] != 1 {
			t.Fatalf("%s probe calls = %d", name, called[name])
		}
	}
}

func TestStaticReadinessRequiresBuiltIndex(t *testing.T) {
	directory := t.TempDir()
	prober := Prober{}
	report := prober.Check(context.Background(), config.APIConfig{Mode: config.APIModeStatic, StaticDir: directory})
	if report.Ready {
		t.Fatal("static readiness succeeded without index.html")
	}
	if err := os.WriteFile(filepath.Join(directory, "index.html"), []byte("ok"), 0o600); err != nil {
		t.Fatal(err)
	}
	report = prober.Check(context.Background(), config.APIConfig{Mode: config.APIModeStatic, StaticDir: directory})
	if !report.Ready {
		t.Fatalf("report = %#v", report)
	}
}

func TestRedisProbeRejectsPlainHTTPService(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()

	done := make(chan struct{})
	go func() {
		defer close(done)
		connection, acceptErr := listener.Accept()
		if acceptErr != nil {
			return
		}
		defer connection.Close()
		reader := bufio.NewReader(connection)
		_, _ = reader.ReadString('\n')
		_, _ = fmt.Fprint(connection, "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n")
	}()

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := checkRedis(ctx, "redis://"+listener.Addr().String()+"/0"); err == nil {
		t.Fatal("Redis probe accepted a plain HTTP service")
	}
	<-done
}

func TestPostgresProbeRejectsNonPostgresURL(t *testing.T) {
	if err := checkPostgres(context.Background(), "http://127.0.0.1:5432/database"); err == nil {
		t.Fatal("PostgreSQL probe accepted an HTTP URL")
	}
}
