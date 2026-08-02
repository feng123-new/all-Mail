package initialize

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

// Keep this list explicit and fail closed. New application tables must be
// reviewed and added here before the long-running API can access them. Schema
// and compatibility ledgers are intentionally absent.
var apiBusinessTables = []string{
	"admins",
	"api_keys",
	"provider_oauth_configs",
	"email_groups",
	"email_accounts",
	"email_usage",
	"api_logs",
	"domains",
	"domain_sending_configs",
	"mailbox_users",
	"domain_mailboxes",
	"domain_mailbox_usage",
	"mailbox_memberships",
	"mailbox_aliases",
	"ingress_endpoints",
	"inbound_messages",
	"mailbox_forward_jobs",
	"outbound_messages",
}

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

	var database string
	if err := tx.QueryRow(ctx, `SELECT current_database()`).Scan(&database); err != nil {
		return fmt.Errorf("resolve database identity: %w", err)
	}
	for _, role := range roles {
		if err := ensureRuntimeDatabaseRole(ctx, tx, role); err != nil {
			return err
		}
	}

	databaseIdentifier := pgx.Identifier{database}.Sanitize()
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
		fmt.Sprintf(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %s TO %s`, sanitizedTableList(apiBusinessTables), apiIdentifier),
		fmt.Sprintf(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO %s`, apiIdentifier),
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

func sanitizedTableList(tables []string) string {
	identifiers := make([]string, 0, len(tables))
	for _, table := range tables {
		identifiers = append(identifiers, pgx.Identifier{table}.Sanitize())
	}
	return strings.Join(identifiers, ", ")
}

func runtimeDatabaseURL(owner *url.URL, role runtimeDatabaseRole) string {
	copyURL := *owner
	copyURL.User = url.UserPassword(role.Name, role.Password)
	return copyURL.String()
}

func quoteSQLLiteral(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}
