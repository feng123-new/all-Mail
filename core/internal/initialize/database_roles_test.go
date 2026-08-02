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

func TestAPIBusinessTableGrantExcludesMigrationLedgers(t *testing.T) {
	granted := make(map[string]struct{}, len(apiBusinessTables))
	for _, table := range apiBusinessTables {
		if _, exists := granted[table]; exists {
			t.Fatalf("duplicate API business table %q", table)
		}
		granted[table] = struct{}{}
	}
	for _, required := range []string{"admins", "provider_oauth_configs", "inbound_messages", "outbound_messages"} {
		if _, ok := granted[required]; !ok {
			t.Fatalf("API business table list omits %q", required)
		}
	}
	for _, forbidden := range []string{"allmail_schema_migrations", "_prisma_migrations", "runtime_migrations"} {
		if _, ok := granted[forbidden]; ok {
			t.Fatalf("migration ledger %q is writable by the API role", forbidden)
		}
	}
	if value := sanitizedTableList(apiBusinessTables); strings.Contains(value, "migrations") {
		t.Fatalf("sanitized API table grant includes a migration ledger: %s", value)
	}
}
