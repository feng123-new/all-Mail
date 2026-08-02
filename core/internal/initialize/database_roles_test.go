package initialize

import (
	"net/url"
	"strings"
	"testing"
)

func TestRuntimeDatabaseURLReplacesOnlyTheIdentity(t *testing.T) {
	owner, err := url.Parse("postgresql://owner:owner-password@postgres:5432/allmail?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	value := runtimeDatabaseURL(owner, runtimeDatabaseRole{Name: databaseAPIRole, Password: strings.Repeat("a", 32)})
	parsed, err := url.Parse(value)
	if err != nil {
		t.Fatal(err)
	}
	password, _ := parsed.User.Password()
	if parsed.User.Username() != databaseAPIRole || password != strings.Repeat("a", 32) || parsed.Host != "postgres:5432" || parsed.Query().Get("sslmode") != "disable" {
		t.Fatalf("runtime database URL = %q", value)
	}
}
