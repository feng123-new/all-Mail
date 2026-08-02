#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    content = read(path)
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one occurrence, found {count}: {old[:120]!r}")
    write(path, content.replace(old, new, 1))


def replace_all(path: str, old: str, new: str, minimum: int = 1) -> None:
    content = read(path)
    count = content.count(old)
    if count < minimum:
        raise RuntimeError(f"{path}: expected at least {minimum} occurrences, found {count}: {old[:120]!r}")
    write(path, content.replace(old, new))


def replace_in_function(path: str, function: str, old: str, new: str) -> None:
    content = read(path)
    start = content.index(f"func {function}(")
    next_start = content.find("\nfunc ", start + 1)
    end = len(content) if next_start < 0 else next_start
    block = content[start:end]
    count = block.count(old)
    if count != 1:
        raise RuntimeError(f"{path}:{function}: expected one occurrence, found {count}: {old[:100]!r}")
    block = block.replace(old, new, 1)
    write(path, content[:start] + block + content[end:])


write(
    "core/internal/config/database_url.go",
    r'''package config

import (
	"errors"
	"fmt"
	"os"
	"strings"
)

const maxDatabaseURLFileBytes = 4096

func loadRuntimeDatabaseURL(runtime string) (string, error) {
	raw := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	path := strings.TrimSpace(os.Getenv("DATABASE_URL_FILE"))
	if raw != "" && path != "" {
		return "", fmt.Errorf("%s must configure only one of DATABASE_URL or DATABASE_URL_FILE", runtime)
	}
	if path != "" {
		content, err := os.ReadFile(path)
		if err != nil {
			return "", fmt.Errorf("read DATABASE_URL_FILE for %s: %w", runtime, err)
		}
		if len(content) > maxDatabaseURLFileBytes {
			return "", fmt.Errorf("DATABASE_URL_FILE for %s is too large", runtime)
		}
		raw = strings.TrimSpace(string(content))
	}
	if raw == "" {
		return "", fmt.Errorf("DATABASE_URL_FILE or DATABASE_URL is required for %s", runtime)
	}
	if strings.ContainsAny(raw, "\r\n") {
		return "", errors.New("database URL must be a single line")
	}
	return raw, nil
}
''',
)

write(
    "core/internal/config/database_url_test.go",
    r'''package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadRuntimeDatabaseURLPrefersAnExclusiveSecretFile(t *testing.T) {
	clearEnv(t, "DATABASE_URL", "DATABASE_URL_FILE")
	path := filepath.Join(t.TempDir(), "database-url")
	if err := os.WriteFile(path, []byte("postgresql://api:secret@postgres/allmail\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("DATABASE_URL_FILE", path)
	value, err := loadRuntimeDatabaseURL("test runtime")
	if err != nil || value != "postgresql://api:secret@postgres/allmail" {
		t.Fatalf("database URL = %q, %v", value, err)
	}
	t.Setenv("DATABASE_URL", "postgresql://owner:secret@postgres/allmail")
	if _, err := loadRuntimeDatabaseURL("test runtime"); err == nil {
		t.Fatal("simultaneous raw and file database URLs were accepted")
	}
}
''',
)

replace_once(
    "core/internal/config/business_api.go",
    '''\tredisURL, err := loadRedisURLWithPasswordFile(strings.TrimSpace(os.Getenv("REDIS_URL")), runtimeEnvironment)\n\tif err != nil {\n\t\treturn GoBusinessAPIConfig{}, err\n\t}\n\n\tcfg := GoBusinessAPIConfig{''',
    '''\tredisURL, err := loadRedisURLWithPasswordFile(strings.TrimSpace(os.Getenv("REDIS_URL")), runtimeEnvironment)\n\tif err != nil {\n\t\treturn GoBusinessAPIConfig{}, err\n\t}\n\tdatabaseURL, err := loadRuntimeDatabaseURL("the Go business API")\n\tif err != nil {\n\t\treturn GoBusinessAPIConfig{}, err\n\t}\n\n\tcfg := GoBusinessAPIConfig{''',
)
replace_once(
    "core/internal/config/business_api.go",
    '''\t\tDatabaseURL:            strings.TrimSpace(os.Getenv("DATABASE_URL")),''',
    '''\t\tDatabaseURL:            databaseURL,''',
)
replace_once(
    "core/internal/config/business_api.go",
    '''\tif cfg.DatabaseURL == "" {\n\t\treturn GoBusinessAPIConfig{}, errors.New("DATABASE_URL is required for the Go business API")\n\t}\n''',
    "",
)

replace_in_function(
    "core/internal/config/config.go",
    "LoadForwarding",
    '''\tencryptionKey, err := loadEncryptionKeyFile()\n\tif err != nil {\n\t\treturn ForwardingConfig{}, err\n\t}\n\tcfg := ForwardingConfig{''',
    '''\tencryptionKey, err := loadEncryptionKeyFile()\n\tif err != nil {\n\t\treturn ForwardingConfig{}, err\n\t}\n\tdatabaseURL, err := loadRuntimeDatabaseURL("the forwarding worker")\n\tif err != nil {\n\t\treturn ForwardingConfig{}, err\n\t}\n\tcfg := ForwardingConfig{''',
)
replace_in_function(
    "core/internal/config/config.go",
    "LoadForwarding",
    '''\t\tDatabaseURL:       strings.TrimSpace(os.Getenv("DATABASE_URL")),''',
    '''\t\tDatabaseURL:       databaseURL,''',
)
replace_in_function(
    "core/internal/config/config.go",
    "LoadRetention",
    '''\tshutdownSeconds, err := envInt("SHUTDOWN_TIMEOUT_SECONDS", 15)\n\tif err != nil {\n\t\treturn RetentionConfig{}, err\n\t}\n\tcfg := RetentionConfig{''',
    '''\tshutdownSeconds, err := envInt("SHUTDOWN_TIMEOUT_SECONDS", 15)\n\tif err != nil {\n\t\treturn RetentionConfig{}, err\n\t}\n\tdatabaseURL, err := loadRuntimeDatabaseURL("the retention worker")\n\tif err != nil {\n\t\treturn RetentionConfig{}, err\n\t}\n\tcfg := RetentionConfig{''',
)
replace_in_function(
    "core/internal/config/config.go",
    "LoadRetention",
    '''\t\tDatabaseURL:       strings.TrimSpace(os.Getenv("DATABASE_URL")),''',
    '''\t\tDatabaseURL:       databaseURL,''',
)

replace_once(
    "core/internal/secretstate/secretstate.go",
    '''\tRedisPassword      string\n\tCreatedKeys        []string''',
    '''\tRedisPassword      string\n\tDatabaseAPIPassword        string\n\tDatabaseForwardingPassword string\n\tDatabaseRetentionPassword  string\n\tCreatedKeys                []string''',
)
replace_once(
    "core/internal/secretstate/secretstate.go",
    '''\tif value := strings.TrimSpace(existingRuntime["REDIS_PASSWORD"]); !isMissing(value) {\n\t\tpersisted["REDIS_PASSWORD"] = value\n\t}\n''',
    '''\tfor _, key := range []string{\n\t\t"REDIS_PASSWORD",\n\t\t"DATABASE_API_PASSWORD",\n\t\t"DATABASE_FORWARDING_PASSWORD",\n\t\t"DATABASE_RETENTION_PASSWORD",\n\t} {\n\t\tif value := strings.TrimSpace(existingRuntime[key]); !isMissing(value) {\n\t\t\tpersisted[key] = value\n\t\t}\n\t}\n''',
)
replace_once(
    "core/internal/secretstate/secretstate.go",
    '''\tif err := validateRuntimeSecrets(state.JWTSecret, state.EncryptionKey, state.RedisPassword); err != nil {\n\t\treturn State{}, err\n\t}\n''',
    '''\tresolvePostCutoverSecret := func(key string) (string, error) {\n\t\tvalue := strings.TrimSpace(persisted[key])\n\t\tif !isMissing(value) {\n\t\t\treturn value, nil\n\t\t}\n\t\tvalue, err := randomHex(32)\n\t\tif err != nil {\n\t\t\treturn "", err\n\t\t}\n\t\tpersisted[key] = value\n\t\tstate.CreatedKeys = append(state.CreatedKeys, key)\n\t\treturn value, nil\n\t}\n\tstate.DatabaseAPIPassword, err = resolvePostCutoverSecret("DATABASE_API_PASSWORD")\n\tif err != nil {\n\t\treturn State{}, err\n\t}\n\tstate.DatabaseForwardingPassword, err = resolvePostCutoverSecret("DATABASE_FORWARDING_PASSWORD")\n\tif err != nil {\n\t\treturn State{}, err\n\t}\n\tstate.DatabaseRetentionPassword, err = resolvePostCutoverSecret("DATABASE_RETENTION_PASSWORD")\n\tif err != nil {\n\t\treturn State{}, err\n\t}\n\tif err := validateRuntimeSecrets(\n\t\tstate.JWTSecret,\n\t\tstate.EncryptionKey,\n\t\tstate.RedisPassword,\n\t\tstate.DatabaseAPIPassword,\n\t\tstate.DatabaseForwardingPassword,\n\t\tstate.DatabaseRetentionPassword,\n\t); err != nil {\n\t\treturn State{}, err\n\t}\n''',
)
replace_once(
    "core/internal/secretstate/secretstate.go",
    '''\tkeys := []string{"JWT_SECRET", "ENCRYPTION_KEY", "REDIS_PASSWORD", "ADMIN_USERNAME", "ADMIN_PASSWORD"}''',
    '''\tkeys := []string{\n\t\t"JWT_SECRET", "ENCRYPTION_KEY", "REDIS_PASSWORD",\n\t\t"DATABASE_API_PASSWORD", "DATABASE_FORWARDING_PASSWORD", "DATABASE_RETENTION_PASSWORD",\n\t\t"ADMIN_USERNAME", "ADMIN_PASSWORD",\n\t}''',
)
replace_once(
    "core/internal/secretstate/secretstate.go",
    '''func validateRuntimeSecrets(jwtSecret, encryptionKey, redisPassword string) error {''',
    '''func validateRuntimeSecrets(jwtSecret, encryptionKey, redisPassword, apiDatabasePassword, forwardingDatabasePassword, retentionDatabasePassword string) error {''',
)
replace_once(
    "core/internal/secretstate/secretstate.go",
    '''\tif len(strings.TrimSpace(redisPassword)) < 32 || isMissing(redisPassword) {\n\t\treturn errors.New("REDIS_PASSWORD must contain at least 32 non-placeholder characters")\n\t}\n\treturn nil\n}''',
    '''\tif len(strings.TrimSpace(redisPassword)) < 32 || isMissing(redisPassword) {\n\t\treturn errors.New("REDIS_PASSWORD must contain at least 32 non-placeholder characters")\n\t}\n\tfor name, value := range map[string]string{\n\t\t"DATABASE_API_PASSWORD": apiDatabasePassword,\n\t\t"DATABASE_FORWARDING_PASSWORD": forwardingDatabasePassword,\n\t\t"DATABASE_RETENTION_PASSWORD": retentionDatabasePassword,\n\t} {\n\t\tif len(strings.TrimSpace(value)) < 32 || isMissing(value) {\n\t\t\treturn fmt.Errorf("%s must contain at least 32 non-placeholder characters", name)\n\t\t}\n\t}\n\treturn nil\n}''',
)
replace_once(
    "core/internal/secretstate/secretstate_test.go",
    '''len(first.CreatedKeys) != 2''',
    '''len(first.CreatedKeys) != 5''',
)

write(
    "core/internal/initialize/database_roles.go",
    r'''package initialize

import (
	"context"
	"fmt"
	"net/url"
	"strings"

	"github.com/feng123-new/all-Mail/core/internal/secretstate"
	"github.com/jackc/pgx/v5"
)

const (
	databaseAPIRole        = "allmail_api"
	databaseForwardingRole = "allmail_forwarding"
	databaseRetentionRole  = "allmail_retention"
)

type RuntimeDatabaseExports struct {
	API        string
	Forwarding string
	Retention  string
}

type runtimeDatabaseRole struct {
	Name     string
	Password string
}

func ProvisionRuntimeDatabaseRoles(ctx context.Context, ownerDatabaseURL string, state secretstate.State, exports RuntimeDatabaseExports) error {
	if strings.TrimSpace(exports.API) == "" && strings.TrimSpace(exports.Forwarding) == "" && strings.TrimSpace(exports.Retention) == "" {
		return nil
	}
	if strings.TrimSpace(exports.API) == "" || strings.TrimSpace(exports.Forwarding) == "" || strings.TrimSpace(exports.Retention) == "" {
		return fmt.Errorf("all runtime database URL export files are required when database role provisioning is enabled")
	}
	parsed, err := url.Parse(ownerDatabaseURL)
	if err != nil || parsed.Host == "" || parsed.User == nil {
		return fmt.Errorf("parse owner database URL for runtime role provisioning")
	}
	roles := []runtimeDatabaseRole{
		{Name: databaseAPIRole, Password: state.DatabaseAPIPassword},
		{Name: databaseForwardingRole, Password: state.DatabaseForwardingPassword},
		{Name: databaseRetentionRole, Password: state.DatabaseRetentionPassword},
	}
	for _, role := range roles {
		if len(strings.TrimSpace(role.Password)) < 32 {
			return fmt.Errorf("runtime database password for %s is missing", role.Name)
		}
	}

	connection, err := pgx.Connect(ctx, ownerDatabaseURL)
	if err != nil {
		return fmt.Errorf("connect database role provisioner: %w", err)
	}
	defer connection.Close(context.Background())
	tx, err := connection.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin database role provisioning: %w", err)
	}
	defer tx.Rollback(context.Background())

	var owner, database string
	if err := tx.QueryRow(ctx, `SELECT current_user, current_database()`).Scan(&owner, &database); err != nil {
		return fmt.Errorf("resolve database owner identity: %w", err)
	}
	for _, role := range roles {
		if err := ensureRuntimeDatabaseRole(ctx, tx, role); err != nil {
			return err
		}
	}

	databaseIdentifier := pgx.Identifier{database}.Sanitize()
	ownerIdentifier := pgx.Identifier{owner}.Sanitize()
	apiIdentifier := pgx.Identifier{databaseAPIRole}.Sanitize()
	forwardingIdentifier := pgx.Identifier{databaseForwardingRole}.Sanitize()
	retentionIdentifier := pgx.Identifier{databaseRetentionRole}.Sanitize()

	statements := []string{
		fmt.Sprintf(`REVOKE CONNECT, TEMPORARY ON DATABASE %s FROM PUBLIC`, databaseIdentifier),
		`REVOKE CREATE ON SCHEMA public FROM PUBLIC`,
	}
	for _, roleIdentifier := range []string{apiIdentifier, forwardingIdentifier, retentionIdentifier} {
		statements = append(statements,
			fmt.Sprintf(`GRANT CONNECT ON DATABASE %s TO %s`, databaseIdentifier, roleIdentifier),
			fmt.Sprintf(`REVOKE ALL PRIVILEGES ON SCHEMA public FROM %s`, roleIdentifier),
			fmt.Sprintf(`GRANT USAGE ON SCHEMA public TO %s`, roleIdentifier),
			fmt.Sprintf(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %s`, roleIdentifier),
			fmt.Sprintf(`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %s`, roleIdentifier),
		)
	}
	statements = append(statements,
		fmt.Sprintf(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %s`, apiIdentifier),
		fmt.Sprintf(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO %s`, apiIdentifier),
		fmt.Sprintf(`ALTER DEFAULT PRIVILEGES FOR ROLE %s IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %s`, ownerIdentifier, apiIdentifier),
		fmt.Sprintf(`ALTER DEFAULT PRIVILEGES FOR ROLE %s IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO %s`, ownerIdentifier, apiIdentifier),
		fmt.Sprintf(`GRANT SELECT, UPDATE ON TABLE mailbox_forward_jobs, inbound_messages TO %s`, forwardingIdentifier),
		fmt.Sprintf(`GRANT SELECT ON TABLE domain_mailboxes, domains, domain_sending_configs TO %s`, forwardingIdentifier),
		fmt.Sprintf(`GRANT SELECT, DELETE ON TABLE api_logs TO %s`, retentionIdentifier),
	)
	for _, statement := range statements {
		if _, err := tx.Exec(ctx, statement); err != nil {
			return fmt.Errorf("apply runtime database privilege: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit runtime database roles: %w", err)
	}

	for _, export := range []struct {
		Path string
		Role runtimeDatabaseRole
	}{
		{Path: exports.API, Role: roles[0]},
		{Path: exports.Forwarding, Role: roles[1]},
		{Path: exports.Retention, Role: roles[2]},
	} {
		value := runtimeDatabaseURL(parsed, export.Role)
		if err := secretstate.WriteSecretFile(export.Path, value); err != nil {
			return err
		}
	}
	return nil
}

func ensureRuntimeDatabaseRole(ctx context.Context, tx pgx.Tx, role runtimeDatabaseRole) error {
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1)`, role.Name).Scan(&exists); err != nil {
		return fmt.Errorf("inspect runtime database role %s: %w", role.Name, err)
	}
	identifier := pgx.Identifier{role.Name}.Sanitize()
	password := quoteSQLLiteral(role.Password)
	command := fmt.Sprintf(`CREATE ROLE %s WITH LOGIN PASSWORD %s NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`, identifier, password)
	if exists {
		command = fmt.Sprintf(`ALTER ROLE %s WITH LOGIN PASSWORD %s NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`, identifier, password)
	}
	if _, err := tx.Exec(ctx, command); err != nil {
		return fmt.Errorf("configure runtime database role %s: %w", role.Name, err)
	}
	if _, err := tx.Exec(ctx, fmt.Sprintf(`ALTER ROLE %s SET search_path = public`, identifier)); err != nil {
		return fmt.Errorf("set runtime database search path for %s: %w", role.Name, err)
	}
	return nil
}

func runtimeDatabaseURL(owner *url.URL, role runtimeDatabaseRole) string {
	copyURL := *owner
	copyURL.User = url.UserPassword(role.Name, role.Password)
	return copyURL.String()
}

func quoteSQLLiteral(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}
''',
)

write(
    "core/internal/initialize/database_roles_test.go",
    r'''package initialize

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
''',
)

replace_once(
    "core/internal/initialize/initialize.go",
    '''\tRedisPasswordExportFile string\n\tEnvironment             map[string]string''',
    '''\tRedisPasswordExportFile string\n\tAPIDatabaseURLExportFile        string\n\tForwardingDatabaseURLExportFile string\n\tRetentionDatabaseURLExportFile  string\n\tEnvironment                     map[string]string''',
)
replace_once(
    "core/internal/initialize/initialize.go",
    '''\t\tRedisPasswordExportFile: strings.TrimSpace(os.Getenv("ALL_MAIL_EXPORT_REDIS_PASSWORD_FILE")),\n\t\tEnvironment:             currentEnvironment(),''',
    '''\t\tRedisPasswordExportFile: strings.TrimSpace(os.Getenv("ALL_MAIL_EXPORT_REDIS_PASSWORD_FILE")),\n\t\tAPIDatabaseURLExportFile: strings.TrimSpace(os.Getenv("ALL_MAIL_EXPORT_API_DATABASE_URL_FILE")),\n\t\tForwardingDatabaseURLExportFile: strings.TrimSpace(os.Getenv("ALL_MAIL_EXPORT_FORWARDING_DATABASE_URL_FILE")),\n\t\tRetentionDatabaseURLExportFile: strings.TrimSpace(os.Getenv("ALL_MAIL_EXPORT_RETENTION_DATABASE_URL_FILE")),\n\t\tEnvironment: currentEnvironment(),''',
)
replace_once(
    "core/internal/initialize/initialize.go",
    '''\t\tif err := SchemaOnly(ctx, cfg.Migration, logger); err != nil {\n\t\t\treturn err\n\t\t}\n\t\tverifiedBefore, err := VerifyCiphertexts''',
    '''\t\tif err := SchemaOnly(ctx, cfg.Migration, logger); err != nil {\n\t\t\treturn err\n\t\t}\n\t\tif err := ProvisionRuntimeDatabaseRoles(ctx, cfg.Migration.DatabaseURL, state, RuntimeDatabaseExports{\n\t\t\tAPI: cfg.APIDatabaseURLExportFile,\n\t\t\tForwarding: cfg.ForwardingDatabaseURLExportFile,\n\t\t\tRetention: cfg.RetentionDatabaseURLExportFile,\n\t\t}); err != nil {\n\t\t\treturn err\n\t\t}\n\t\tverifiedBefore, err := VerifyCiphertexts''',
)

# Shared bcrypt policy.
for path in [
    "core/internal/businessapi/auth_handlers.go",
    "core/internal/businessapi/mailbox_auth_handlers.go",
    "core/internal/businessapi/management_common.go",
]:
    content = read(path).replace('\t"unicode/utf8"\n', '')
    write(path, content)

replace_once(
    "core/internal/businessapi/auth_handlers.go",
    '''\t"github.com/feng123-new/all-Mail/core/internal/legacycrypto"\n''',
    '''\t"github.com/feng123-new/all-Mail/core/internal/legacycrypto"\n\t"github.com/feng123-new/all-Mail/core/internal/passwordpolicy"\n''',
)
replace_once(
    "core/internal/businessapi/auth_handlers.go",
    '''\tif utf8.RuneCountInString(body.NewPassword) < 8 {\n\t\ts.writeRequestError(w, r, validationError("newPassword must contain at least 8 characters"))\n\t\treturn\n\t}\n''',
    '''\tif err := passwordpolicy.Validate("newPassword", body.NewPassword, 8); err != nil {\n\t\ts.writeRequestError(w, r, validationError(err.Error()))\n\t\treturn\n\t}\n''',
)
replace_once(
    "core/internal/businessapi/mailbox_auth_handlers.go",
    '''\t"github.com/feng123-new/all-Mail/core/internal/legacycrypto"\n''',
    '''\t"github.com/feng123-new/all-Mail/core/internal/legacycrypto"\n\t"github.com/feng123-new/all-Mail/core/internal/passwordpolicy"\n''',
)
replace_once(
    "core/internal/businessapi/mailbox_auth_handlers.go",
    '''\tif utf8.RuneCountInString(body.NewPassword) < 8 {\n\t\ts.writeRequestError(w, r, validationError("newPassword must contain at least 8 characters"))\n\t\treturn\n\t}\n''',
    '''\tif err := passwordpolicy.Validate("newPassword", body.NewPassword, 8); err != nil {\n\t\ts.writeRequestError(w, r, validationError(err.Error()))\n\t\treturn\n\t}\n''',
)
replace_once(
    "core/internal/businessapi/management_common.go",
    '''\t"github.com/jackc/pgx/v5"\n''',
    '''\t"github.com/feng123-new/all-Mail/core/internal/passwordpolicy"\n\t"github.com/jackc/pgx/v5"\n''',
)
replace_once(
    "core/internal/businessapi/management_common.go",
    '''\tif utf8.RuneCountInString(password) < 8 || utf8.RuneCountInString(password) > 1024 {\n\t\treturn "", validationError("password must contain between 8 and 1024 characters")\n\t}\n''',
    '''\tif err := passwordpolicy.Validate("password", password, 8); err != nil {\n\t\treturn "", validationError(err.Error())\n\t}\n''',
)
replace_once(
    "core/internal/initialize/bootstrap_admin.go",
    '''\t"github.com/feng123-new/all-Mail/core/internal/secretstate"\n''',
    '''\t"github.com/feng123-new/all-Mail/core/internal/passwordpolicy"\n\t"github.com/feng123-new/all-Mail/core/internal/secretstate"\n''',
)
replace_once(
    "core/internal/initialize/bootstrap_admin.go",
    '''\tif len(password) < 8 || strings.ContainsAny(password, "\\r\\n") {\n\t\treturn adminCredential{}, errors.New("ADMIN_PASSWORD must contain at least 8 characters without line breaks")\n\t}\n''',
    '''\tif strings.ContainsAny(password, "\\r\\n") {\n\t\treturn adminCredential{}, errors.New("ADMIN_PASSWORD must not contain line breaks")\n\t}\n\tif err := passwordpolicy.Validate("ADMIN_PASSWORD", password, 8); err != nil {\n\t\treturn adminCredential{}, err\n\t}\n''',
)
replace_once(
    "core/internal/initialize/preflight.go",
    '''\t"strings"\n)''',
    '''\t"strings"\n\n\t"github.com/feng123-new/all-Mail/core/internal/passwordpolicy"\n)''',
)
replace_once(
    "core/internal/initialize/preflight.go",
    '''\tif password != "" && !hasPlaceholderPrefix(strings.ToLower(password)) && len(password) < 8 {\n\t\treturn errors.New("ADMIN_PASSWORD must contain at least 8 characters")\n\t}\n''',
    '''\tif password != "" && !hasPlaceholderPrefix(strings.ToLower(password)) {\n\t\tif err := passwordpolicy.Validate("ADMIN_PASSWORD", password, 8); err != nil {\n\t\t\treturn err\n\t\t}\n\t}\n''',
)
replace_once(
    "core/internal/secretstate/secretstate.go",
    '''\t"time"\n)''',
    '''\t"time"\n\n\t"github.com/feng123-new/all-Mail/core/internal/passwordpolicy"\n)''',
)
replace_once(
    "core/internal/secretstate/secretstate.go",
    '''\tif !isMissing(password) && len(password) < 8 {\n\t\treturn errors.New("ADMIN_PASSWORD must contain at least 8 characters")\n\t}\n''',
    '''\tif !isMissing(password) {\n\t\tif err := passwordpolicy.Validate("ADMIN_PASSWORD", password, 8); err != nil {\n\t\t\treturn err\n\t\t}\n\t}\n''',
)

# Browser origin protection and clickjacking headers.
write(
    "core/internal/businessapi/browser_origin.go",
    r'''package businessapi

import (
	"net/http"
	"net/url"
	"strings"
)

func (s *Server) withBrowserOriginProtection(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}
		if strings.EqualFold(strings.TrimSpace(r.Header.Get("Sec-Fetch-Site")), "cross-site") {
			s.writeRequestError(w, r, &requestError{Status: http.StatusForbidden, Code: "CSRF_ORIGIN_INVALID"})
			return
		}
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		if origin == "" {
			// Non-browser API clients commonly omit Origin. Browser cross-site
			// requests are still rejected through Origin or Sec-Fetch-Site.
			next.ServeHTTP(w, r)
			return
		}
		if !requestOriginMatches(r, origin) {
			s.writeRequestError(w, r, &requestError{Status: http.StatusForbidden, Code: "CSRF_ORIGIN_INVALID"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func requestOriginMatches(r *http.Request, rawOrigin string) bool {
	if rawOrigin == "null" {
		return false
	}
	origin, err := url.Parse(rawOrigin)
	if err != nil || origin.Scheme == "" || origin.Host == "" || origin.User != nil || origin.RawQuery != "" || origin.Fragment != "" || (origin.Path != "" && origin.Path != "/") {
		return false
	}
	scheme := firstForwardedValue(r.Header.Get("X-Forwarded-Proto"))
	if scheme == "" {
		scheme = "http"
		if r.TLS != nil {
			scheme = "https"
		}
	}
	host := firstForwardedValue(r.Header.Get("X-Forwarded-Host"))
	if host == "" {
		host = r.Host
	}
	return strings.EqualFold(origin.Scheme, scheme) && strings.EqualFold(origin.Host, host)
}

func firstForwardedValue(value string) string {
	value, _, _ = strings.Cut(value, ",")
	return strings.TrimSpace(value)
}
''',
)
write(
    "core/internal/businessapi/browser_origin_test.go",
    r'''package businessapi

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/feng123-new/all-Mail/core/internal/config"
)

func TestBrowserOriginProtectionRejectsCrossSiteWrites(t *testing.T) {
	server := newWithStore(config.GoBusinessAPIConfig{}, slog.New(slog.NewTextHandler(io.Discard, nil)), nil)
	for _, configure := range []func(*http.Request){
		func(request *http.Request) { request.Header.Set("Origin", "https://evil.example") },
		func(request *http.Request) { request.Header.Set("Sec-Fetch-Site", "cross-site") },
	} {
		request := httptest.NewRequest(http.MethodPost, "http://mail.example/admin/auth/login", strings.NewReader(`{}`))
		request.Header.Set("Content-Type", "application/json")
		configure(request)
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), "CSRF_ORIGIN_INVALID") {
			t.Fatalf("cross-site response = %d %s", response.Code, response.Body.String())
		}
	}
}

func TestBrowserOriginProtectionAllowsSameOriginAndNonBrowserClients(t *testing.T) {
	server := newWithStore(config.GoBusinessAPIConfig{}, slog.New(slog.NewTextHandler(io.Discard, nil)), nil)
	for _, origin := range []string{"https://mail.example", ""} {
		request := httptest.NewRequest(http.MethodPost, "http://internal/admin/auth/login", strings.NewReader(`{}`))
		request.Host = "mail.example"
		request.Header.Set("X-Forwarded-Proto", "https")
		request.Header.Set("X-Forwarded-Host", "mail.example")
		request.Header.Set("Content-Type", "application/json")
		if origin != "" {
			request.Header.Set("Origin", origin)
		}
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code == http.StatusForbidden {
			t.Fatalf("allowed client was rejected: %s", response.Body.String())
		}
	}
}
''',
)
replace_once(
    "core/internal/businessapi/server.go",
    '''\treturn s.withRequestMetadata(mux)''',
    '''\treturn s.withRequestMetadata(s.withBrowserOriginProtection(mux))''',
)
replace_once(
    "core/internal/httpapi/server.go",
    '''\t\tw.Header().Set("X-Content-Type-Options", "nosniff")\n\t\tw.Header().Set("Referrer-Policy", "same-origin")''',
    '''\t\tw.Header().Set("X-Content-Type-Options", "nosniff")\n\t\tw.Header().Set("X-Frame-Options", "DENY")\n\t\tw.Header().Set("Referrer-Policy", "same-origin")''',
)
replace_once(
    "core/internal/httpapi/server.go",
    '''"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'",''',
    '''"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",''',
)
content = read("core/internal/httpapi/server_test.go")
insert = r'''
func TestGatewaySetsClickjackingAndCSPHeaders(t *testing.T) {
	server := mustGateway(t, config.APIConfig{
		StaticDir:       writeStaticIndex(t),
		ReadyTimeout:    time.Second,
		ShutdownTimeout: time.Second,
	}, "")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/", nil))
	if response.Header().Get("X-Frame-Options") != "DENY" {
		t.Fatalf("X-Frame-Options = %q", response.Header().Get("X-Frame-Options"))
	}
	if csp := response.Header().Get("Content-Security-Policy"); !strings.Contains(csp, "frame-ancestors 'none'") || !strings.Contains(csp, "form-action 'self'") {
		t.Fatalf("Content-Security-Policy = %q", csp)
	}
}

'''
marker = "func TestInvalidIncomingRequestIDIsReplaced"
if marker not in content or "TestGatewaySetsClickjackingAndCSPHeaders" in content:
    raise RuntimeError("unable to insert gateway header test")
write("core/internal/httpapi/server_test.go", content.replace(marker, insert + marker, 1))

# OAuth scope policy and JSON-only client-secret parsing.
replace_once(
    "core/internal/businessapi/mail_oauth_handlers.go",
    '''\t"os"\n''',
    "",
)
replace_once(
    "core/internal/businessapi/mail_oauth_handlers.go",
    '''\t"time"\n)''',
    '''\t"time"\n\n\t"github.com/feng123-new/all-Mail/core/internal/oauthscope"\n)''',
)
replace_once(
    "core/internal/businessapi/mail_oauth_handlers.go",
    '''\tgoogleDefaultScopes    = "openid email profile https://www.googleapis.com/auth/gmail.modify https://mail.google.com/"\n\tmicrosoftDefaultScopes = "offline_access openid profile email https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send"''',
    '''\tgoogleDefaultScopes    = "openid email profile https://www.googleapis.com/auth/gmail.readonly"\n\tmicrosoftDefaultScopes = "offline_access openid profile email https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Read"''',
)
replace_once(
    "core/internal/businessapi/mail_oauth_handlers.go",
    '''\tScopes       json.RawMessage `json:"scopes"`\n\tTenant       json.RawMessage `json:"tenant"`''',
    '''\tScopes       json.RawMessage `json:"scopes"`\n\tScopeProfile json.RawMessage `json:"scopeProfile"`\n\tTenant       json.RawMessage `json:"tenant"`''',
)
replace_once(
    "core/internal/businessapi/mail_oauth_handlers.go",
    '''type googleClientSecretRequest struct {\n\tFilePath    *string `json:"filePath"`\n\tJSONText    *string `json:"jsonText"`''',
    '''type googleClientSecretRequest struct {\n\tJSONText    *string `json:"jsonText"`''',
)
replace_once(
    "core/internal/businessapi/mail_oauth_handlers.go",
    '''\tif jsonText == "" && body.FilePath != nil && strings.TrimSpace(*body.FilePath) != "" {\n\t\tfile, err := os.Open(strings.TrimSpace(*body.FilePath))\n\t\tif err != nil {\n\t\t\ts.writeRequestError(w, r, &requestError{Status: http.StatusBadRequest, Code: "GOOGLE_CLIENT_SECRET_PATH_UNREADABLE", Cause: err})\n\t\t\treturn\n\t\t}\n\t\tcontent, readErr := io.ReadAll(io.LimitReader(file, 1<<20))\n\t\tcloseErr := file.Close()\n\t\tif readErr != nil || closeErr != nil {\n\t\t\ts.writeRequestError(w, r, &requestError{Status: http.StatusBadRequest, Code: "GOOGLE_CLIENT_SECRET_PATH_UNREADABLE", Cause: errors.Join(readErr, closeErr)})\n\t\t\treturn\n\t\t}\n\t\tjsonText = string(content)\n\t}\n''',
    "",
)
replace_once(
    "core/internal/businessapi/mail_oauth_handlers.go",
    '''\tscopes, scopesPresent, err := decodeNullableString(body.Scopes, "scopes")\n\tif err != nil {\n\t\ts.writeRequestError(w, r, err)\n\t\treturn\n\t}\n\tif scopes != nil {\n\t\tnormalized := strings.Join(strings.Fields(*scopes), " ")\n\t\tscopes = &normalized\n\t}\n''',
    '''\tscopes, scopesPresent, err := decodeNullableString(body.Scopes, "scopes")\n\tif err != nil {\n\t\ts.writeRequestError(w, r, err)\n\t\treturn\n\t}\n\tscopeProfile, scopeProfilePresent, err := decodeNullableString(body.ScopeProfile, "scopeProfile")\n\tif err != nil {\n\t\ts.writeRequestError(w, r, err)\n\t\treturn\n\t}\n\tif scopeProfilePresent && scopesPresent {\n\t\ts.writeRequestError(w, r, validationError("scopeProfile and scopes are mutually exclusive"))\n\t\treturn\n\t}\n\tif scopeProfilePresent {\n\t\tif scopeProfile == nil || strings.TrimSpace(*scopeProfile) == "" {\n\t\t\ts.writeRequestError(w, r, validationError("scopeProfile is required when supplied"))\n\t\t\treturn\n\t\t}\n\t\tprofile, parseErr := oauthscope.ParseProfile(*scopeProfile)\n\t\tif parseErr != nil {\n\t\t\ts.writeRequestError(w, r, validationError(parseErr.Error()))\n\t\t\treturn\n\t\t}\n\t\tnormalized, normalizeErr := oauthscope.Canonical(provider, profile)\n\t\tif normalizeErr != nil {\n\t\t\ts.writeRequestError(w, r, validationError(normalizeErr.Error()))\n\t\t\treturn\n\t\t}\n\t\tscopes = &normalized\n\t\tscopesPresent = true\n\t} else if scopes != nil {\n\t\tnormalized, _, normalizeErr := oauthscope.Normalize(provider, *scopes)\n\t\tif normalizeErr != nil {\n\t\t\ts.writeRequestError(w, r, validationError(normalizeErr.Error()))\n\t\t\treturn\n\t\t}\n\t\tscopes = &normalized\n\t}\n''',
)
replace_once(
    "core/internal/businessapi/mail_oauth_handlers.go",
    '''func oauthScopes(config oauthProviderConfig) string {\n\tif strings.TrimSpace(config.Scopes) != "" {\n\t\treturn strings.Join(strings.Fields(config.Scopes), " ")\n\t}\n\tif config.Provider == "GMAIL" {\n\t\treturn googleDefaultScopes\n\t}\n\treturn microsoftDefaultScopes\n}''',
    '''func oauthScopes(config oauthProviderConfig) string {\n\tnormalized, _, err := oauthscope.Normalize(config.Provider, config.Scopes)\n\tif err == nil {\n\t\treturn normalized\n\t}\n\tif config.Provider == "GMAIL" {\n\t\treturn googleDefaultScopes\n\t}\n\treturn microsoftDefaultScopes\n}''',
)

replace_once(
    "core/internal/businessapi/mail_oauth_config_store.go",
    '''\t"github.com/feng123-new/all-Mail/core/internal/legacycrypto"\n''',
    '''\t"github.com/feng123-new/all-Mail/core/internal/legacycrypto"\n\t"github.com/feng123-new/all-Mail/core/internal/oauthscope"\n''',
)
replace_once(
    "core/internal/businessapi/mail_oauth_config_store.go",
    '''\tScopes          *string `json:"scopes"`\n\tTenant          *string `json:"tenant"`''',
    '''\tScopes          *string `json:"scopes"`\n\tScopeProfile    string  `json:"scopeProfile"`\n\tTenant          *string `json:"tenant"`''',
)
old_summary = '''func oauthConfigSummary(row oauthProviderConfigRow, found bool) oauthProviderConfigSummary {\n\tif !found {\n\t\treturn oauthProviderConfigSummary{Provider: row.Provider, Source: "none"}\n\t}\n\treturn oauthProviderConfigSummary{\n\t\tProvider:        row.Provider,\n\t\tConfigured:      row.ClientID.Valid && strings.TrimSpace(row.ClientID.String) != "" && row.EncryptedClientSecret.Valid && strings.TrimSpace(row.EncryptedClientSecret.String) != "" && row.RedirectURI.Valid && strings.TrimSpace(row.RedirectURI.String) != "",\n\t\tSource:          "database",\n\t\tClientID:        nullableStringValue(row.ClientID),\n\t\tRedirectURI:     nullableStringValue(row.RedirectURI),\n\t\tScopes:          nullableStringValue(row.Scopes),\n\t\tTenant:          nullableStringValue(row.Tenant),\n\t\tHasClientSecret: row.EncryptedClientSecret.Valid && strings.TrimSpace(row.EncryptedClientSecret.String) != "",\n\t}\n}'''
new_summary = '''func oauthConfigSummary(row oauthProviderConfigRow, found bool) oauthProviderConfigSummary {\n\tnormalizedScopes, profile, scopeErr := oauthscope.Normalize(row.Provider, row.Scopes.String)\n\tif !found {\n\t\tnormalizedScopes, _ = oauthscope.Canonical(row.Provider, oauthscope.Minimal)\n\t\tprofile = oauthscope.Minimal\n\t\treturn oauthProviderConfigSummary{Provider: row.Provider, Source: "none", Scopes: &normalizedScopes, ScopeProfile: string(profile)}\n\t}\n\tvar scopes *string\n\tif scopeErr == nil {\n\t\tscopes = &normalizedScopes\n\t}\n\treturn oauthProviderConfigSummary{\n\t\tProvider:        row.Provider,\n\t\tConfigured:      scopeErr == nil && row.ClientID.Valid && strings.TrimSpace(row.ClientID.String) != "" && row.EncryptedClientSecret.Valid && strings.TrimSpace(row.EncryptedClientSecret.String) != "" && row.RedirectURI.Valid && strings.TrimSpace(row.RedirectURI.String) != "",\n\t\tSource:          "database",\n\t\tClientID:        nullableStringValue(row.ClientID),\n\t\tRedirectURI:     nullableStringValue(row.RedirectURI),\n\t\tScopes:          scopes,\n\t\tScopeProfile:    string(profile),\n\t\tTenant:          nullableStringValue(row.Tenant),\n\t\tHasClientSecret: row.EncryptedClientSecret.Valid && strings.TrimSpace(row.EncryptedClientSecret.String) != "",\n\t}\n}'''
replace_once("core/internal/businessapi/mail_oauth_config_store.go", old_summary, new_summary)
replace_once(
    "core/internal/businessapi/mail_oauth_config_store.go",
    '''\tconfig := oauthProviderConfig{\n\t\tProvider:    row.Provider,\n\t\tClientID:    strings.TrimSpace(row.ClientID.String),\n\t\tRedirectURI: strings.TrimSpace(row.RedirectURI.String),\n\t\tScopes:      strings.TrimSpace(row.Scopes.String),\n\t\tTenant:      strings.TrimSpace(row.Tenant.String),\n\t}\n''',
    '''\tnormalizedScopes, _, scopeErr := oauthscope.Normalize(row.Provider, row.Scopes.String)\n\tif scopeErr != nil {\n\t\treturn oauthProviderConfig{}, false, &requestError{Status: http.StatusServiceUnavailable, Code: "OAUTH_SCOPE_POLICY_INVALID", Cause: scopeErr}\n\t}\n\tconfig := oauthProviderConfig{\n\t\tProvider:    row.Provider,\n\t\tClientID:    strings.TrimSpace(row.ClientID.String),\n\t\tRedirectURI: strings.TrimSpace(row.RedirectURI.String),\n\t\tScopes:      normalizedScopes,\n\t\tTenant:      strings.TrimSpace(row.Tenant.String),\n\t}\n''',
)

replace_once(
    "core/internal/initialize/import_environment.go",
    '''\t"github.com/feng123-new/all-Mail/core/internal/legacycrypto"\n''',
    '''\t"github.com/feng123-new/all-Mail/core/internal/legacycrypto"\n\t"github.com/feng123-new/all-Mail/core/internal/oauthscope"\n''',
)
replace_once(
    "core/internal/initialize/import_environment.go",
    '''\tif err := backfillOAuthAuthority(ctx, transaction); err != nil {''',
    '''\tif err := normalizeStoredOAuthScopes(ctx, transaction); err != nil {\n\t\treturn ImportSummary{}, err\n\t}\n\tif err := backfillOAuthAuthority(ctx, transaction); err != nil {''',
)
replace_once(
    "core/internal/initialize/import_environment.go",
    '''\tresult := &oauthImport{\n\t\tProvider:     provider,\n\t\tClientID:     clientID,\n\t\tClientSecret: clientSecret,\n\t\tRedirectURI:  redirectURI,\n\t\tScopes:       normalizeScopes(environment[prefix+"_OAUTH_SCOPES"]),\n\t}\n''',
    '''\tnormalizedScopes, _, err := oauthscope.Normalize(provider, environment[prefix+"_OAUTH_SCOPES"])\n\tif err != nil {\n\t\treturn nil, fmt.Errorf("%s OAuth scopes: %w", provider, err)\n\t}\n\tresult := &oauthImport{\n\t\tProvider:     provider,\n\t\tClientID:     clientID,\n\t\tClientSecret: clientSecret,\n\t\tRedirectURI:  redirectURI,\n\t\tScopes:       &normalizedScopes,\n\t}\n''',
)
replace_once(
    "core/internal/initialize/import_environment.go",
    '''\tnormalizedCurrentScopes := normalizeScopes(value(currentScopes))\n\tnormalizedCurrentTenant := pointer(strings.TrimSpace(value(currentTenant)))''',
    '''\tcurrentScopesValue, _, err := oauthscope.Normalize(desired.Provider, value(currentScopes))\n\tif err != nil {\n\t\treturn fmt.Errorf("normalize %s OAuth database scopes: %w", desired.Provider, err)\n\t}\n\tnormalizedCurrentScopes := &currentScopesValue\n\tnormalizedCurrentTenant := pointer(strings.TrimSpace(value(currentTenant)))''',
)
normalizer = r'''
func normalizeStoredOAuthScopes(ctx context.Context, tx pgx.Tx) error {
	rows, err := tx.Query(ctx, `SELECT id, provider::text, COALESCE(scopes, '') FROM provider_oauth_configs ORDER BY id`)
	if err != nil {
		return fmt.Errorf("list stored OAuth scopes: %w", err)
	}
	type storedScope struct {
		ID       int64
		Provider string
		Scopes   string
	}
	var records []storedScope
	for rows.Next() {
		var record storedScope
		if err := rows.Scan(&record.ID, &record.Provider, &record.Scopes); err != nil {
			rows.Close()
			return fmt.Errorf("scan stored OAuth scope: %w", err)
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return fmt.Errorf("iterate stored OAuth scopes: %w", err)
	}
	rows.Close()
	for _, record := range records {
		normalized, _, err := oauthscope.Normalize(record.Provider, record.Scopes)
		if err != nil {
			return fmt.Errorf("normalize stored %s OAuth scopes: %w", record.Provider, err)
		}
		if normalized == strings.TrimSpace(record.Scopes) {
			continue
		}
		if _, err := tx.Exec(ctx, `UPDATE provider_oauth_configs SET scopes = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, record.ID, normalized); err != nil {
			return fmt.Errorf("update stored %s OAuth scopes: %w", record.Provider, err)
		}
	}
	return nil
}

'''
content = read("core/internal/initialize/import_environment.go")
marker = "func backfillOAuthAuthority"
if marker not in content or "func normalizeStoredOAuthScopes" in content:
    raise RuntimeError("unable to insert stored OAuth scope normalizer")
write("core/internal/initialize/import_environment.go", content.replace(marker, normalizer + marker, 1))

write(
    "core/internal/businessapi/oauth_scope_policy_test.go",
    r'''package businessapi

import (
	"strings"
	"testing"
)

func TestOAuthDefaultScopesAreLeastPrivilege(t *testing.T) {
	google := oauthScopes(oauthProviderConfig{Provider: "GMAIL"})
	if !strings.Contains(google, "gmail.readonly") || strings.Contains(google, "gmail.modify") || strings.Contains(google, "mail.google.com") {
		t.Fatalf("Google default scopes = %q", google)
	}
	microsoft := oauthScopes(oauthProviderConfig{Provider: "OUTLOOK"})
	if !strings.Contains(microsoft, "Mail.Read") || strings.Contains(microsoft, "Mail.ReadWrite") || strings.Contains(microsoft, "Mail.Send") {
		t.Fatalf("Microsoft default scopes = %q", microsoft)
	}
}
''',
)

# Web contracts and least-privilege fallback values.
replace_once(
    "web/src/pages/emails/index.tsx",
    '''const DEFAULT_GOOGLE_OAUTH_SCOPES =\n\t"openid email profile https://www.googleapis.com/auth/gmail.modify https://mail.google.com/";\nconst DEFAULT_OUTLOOK_OAUTH_SCOPES =\n\t"offline_access openid profile email https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Contacts.ReadWrite https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/MailboxSettings.ReadWrite";''',
    '''const DEFAULT_GOOGLE_OAUTH_SCOPES =\n\t"openid email profile https://www.googleapis.com/auth/gmail.readonly";\nconst DEFAULT_OUTLOOK_OAUTH_SCOPES =\n\t"offline_access openid profile email https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Read";''',
)
replace_all(
    "web/src/api/auth.ts",
    '''\t\t\t\tscopes: string | null;\n\t\t\t\ttenant: string | null;''',
    '''\t\t\t\tscopes: string | null;\n\t\t\t\tscopeProfile: "minimal" | "send" | "manage" | "full";\n\t\t\t\ttenant: string | null;''',
    minimum=2,
)
replace_all(
    "web/src/api/auth.ts",
    '''\t\t\t\tscopes: string | null;\n\t\t\t\ttenant: string | null;''',
    '''\t\t\t\tscopes: string | null;\n\t\t\t\tscopeProfile: "minimal" | "send" | "manage" | "full";\n\t\t\t\ttenant: string | null;''',
    minimum=0,
) if False else None
# Add scopeProfile to save payload/result structures without forcing the current UI to change.
content = read("web/src/api/auth.ts")
content = content.replace(
    '''\t\t\tscopes?: string | null;\n\t\t\ttenant?: string | null;''',
    '''\t\t\tscopes?: string | null;\n\t\t\tscopeProfile?: "minimal" | "send" | "manage" | "full";\n\t\t\ttenant?: string | null;''',
)
content = content.replace(
    '''\t\t\t\tscopes?: string | null;\n\t\t\t\ttenant?: string | null;''',
    '''\t\t\t\tscopes?: string | null;\n\t\t\t\tscopeProfile?: "minimal" | "send" | "manage" | "full";\n\t\t\t\ttenant?: string | null;''',
)
content = content.replace('\t\tfilePath?: string | null;\n', '')
content = content.replace('\t\t\t\tfilePath?: string | null;\n', '')
write("web/src/api/auth.ts", content)

print("PR42-43 core implementation applied")
