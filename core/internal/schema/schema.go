package schema

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
)

const schemaLockSQL = "SELECT pg_advisory_xact_lock(421337, 240728);"

//go:embed migrations/*.sql
var migrationFiles embed.FS

type Descriptor struct {
	Position int
	ID       string
	SQL      string
	Checksum string
}

type legacyMigration struct {
	Name     string
	Checksum string
}

var migrationOrder = []string{
	"20260315_multi_provider_support",
	"20260319_email_mailbox_status_and_log_cleanup",
	"20260324_admin_must_change_password",
	"202603261600_expand_mail_provider_enum",
	"202603271820_expand_mail_provider_enum_for_custom_and_global_imap",
	"202603291000_forwarding_execution_v1",
	"202603311330_ingress_delivery_dedupe",
	"202604021420_outbound_last_error",
	"202604071700_email_account_login_password",
	"202607281200_forwarding_claim_lease_v1", // gitleaks:allow -- deterministic migration identifier
	"202607301200_admin_2fa_integrity",
	"202607301700_durable_environment_config",
	"20260731_api_key_explicit_permissions",
	"20260731_revocable_sessions",
}

var migrationChecksums = map[string]string{
	"20260315_multi_provider_support":                                   "80a4099364f1c7e531dda9495ad828100bdec89c69c78d6d2a414b852c783a99",
	"20260319_email_mailbox_status_and_log_cleanup":                     "8f868ad2a1230324b14dab93386394f42ed1b4c5bd51e230cad4c7e04e46c85a",
	"20260324_admin_must_change_password":                               "ac4230729eb6c18aa8107407a227e5487ab9cb7e61c6e983323332cf1876b2fd",
	"202603261600_expand_mail_provider_enum":                            "16b4795ef8052f1872d8037b8a62fd4033f746317fbc22d2a7d0fbda0f059e5b",
	"202603271820_expand_mail_provider_enum_for_custom_and_global_imap": "c5d4f225527c6f959c22dfb5be6071ae780f7b7ed71549a19270294f12d2f44f",
	"202603291000_forwarding_execution_v1":                              "79771cc68281c3e2e577b8d2b030256ac6beb05867e109e6442c91efef74e1af",
	"202603311330_ingress_delivery_dedupe":                              "4c88874026b0ab360e4b48945fe219bf09b1d51bcb866a47dbb96dbf2a25d86e",
	"202604021420_outbound_last_error":                                  "1b4ba9b43e8d5de4668b63cbc49338b5ba9e661fade71d37712badaf8a426ec5",
	"202604071700_email_account_login_password":                         "1ed81ad8f78f609c2e6d2f92b3924d5c49f4831287999f93d23c219b713a2088",
	"202607281200_forwarding_claim_lease_v1":                            "46061fed9445c4f621ac0b0476b4ef7911870da783b8a6815f198edfa09c62e3",
	"202607301200_admin_2fa_integrity":                                  "4bd66fdd12a0579c296931cef853454c3807bd3eaede08225d837020872c6435",
	"202607301700_durable_environment_config":                           "902c0afd34649dd67b1c6cf0412f5fa637f69747201db6b2108303a41169f530",
	"20260731_api_key_explicit_permissions":                             "84421012fd399eb4eee3c55fd54d5502830bdb8b6940e45cdbce3bcdf032cc39",
	"20260731_revocable_sessions":                                       "c12f43fceaf1775662bbc4656c43ecf28723a67de2bc81e455806b79870ac4ec",
}

var businessTables = []string{
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

var enumContract = map[string][]string{
	"Role":                          {"SUPER_ADMIN", "ADMIN"},
	"Status":                        {"ACTIVE", "DISABLED"},
	"DomainStatus":                  {"PENDING", "ACTIVE", "DISABLED", "ERROR"},
	"MailboxUserStatus":             {"ACTIVE", "DISABLED"},
	"MailboxRole":                   {"OWNER", "MEMBER", "VIEWER"},
	"DomainMailboxStatus":           {"ACTIVE", "DISABLED", "SUSPENDED"},
	"DomainMailboxProvisioningMode": {"MANUAL", "API_POOL"},
	"ForwardMode":                   {"DISABLED", "COPY", "MOVE"},
	"PortalState":                   {"VISIBLE", "FORWARDED_HIDDEN"},
	"ForwardJobStatus":              {"PENDING", "RUNNING", "SENT", "FAILED", "SKIPPED"},
	"MessageStorageStatus":          {"PENDING", "STORED", "FAILED"},
	"SendStatus":                    {"PENDING", "SENT", "FAILED", "CANCELED"},
	"EmailStatus":                   {"ACTIVE", "ERROR", "DISABLED"},
	"MailFetchStrategy":             {"GRAPH_FIRST", "IMAP_FIRST", "GRAPH_ONLY", "IMAP_ONLY"},
	"MailAuthType":                  {"MICROSOFT_OAUTH", "GOOGLE_OAUTH", "APP_PASSWORD"},
	"SendProvider":                  {"RESEND"},
	"MailProvider": {
		"OUTLOOK", "GMAIL", "QQ", "NETEASE_163", "NETEASE_126", "ICLOUD", "YAHOO", "ZOHO",
		"ALIYUN", "AMAZON_WORKMAIL", "FASTMAIL", "AOL", "GMX", "MAILCOM", "YANDEX", "CUSTOM_IMAP_SMTP",
	},
}

func Manifest() ([]Descriptor, error) {
	result := make([]Descriptor, 0, len(migrationOrder))
	for index, id := range migrationOrder {
		content, err := migrationFiles.ReadFile("migrations/" + id + ".sql")
		if err != nil {
			return nil, fmt.Errorf("read embedded schema migration %s: %w", id, err)
		}
		digest := sha256.Sum256(content)
		checksum := hex.EncodeToString(digest[:])
		if expected := migrationChecksums[id]; checksum != expected {
			return nil, fmt.Errorf("embedded schema migration %s checksum changed: %s", id, checksum)
		}
		result = append(result, Descriptor{
			Position: index + 1,
			ID:       id,
			SQL:      string(content),
			Checksum: checksum,
		})
	}
	return result, nil
}

func HasApplicationSchema(ctx context.Context, databaseURL string) (bool, error) {
	connection, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		return false, fmt.Errorf("connect schema inventory: %w", err)
	}
	defer connection.Close(context.Background())
	var exists bool
	if err := connection.QueryRow(ctx, `SELECT to_regclass('public.admins') IS NOT NULL`).Scan(&exists); err != nil {
		return false, fmt.Errorf("inspect application schema: %w", err)
	}
	return exists, nil
}

func ApplyPrismaHistory(ctx context.Context, databaseURL string, logger *slog.Logger) error {
	descriptors, err := Manifest()
	if err != nil {
		return err
	}
	connectionConfig, err := pgx.ParseConfig(databaseURL)
	if err != nil {
		return fmt.Errorf("parse schema database URL: %w", err)
	}
	connectionConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	connection, err := pgx.ConnectConfig(ctx, connectionConfig)
	if err != nil {
		return fmt.Errorf("connect schema database: %w", err)
	}
	defer connection.Close(context.Background())

	transaction, err := connection.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin schema transaction: %w", err)
	}
	defer transaction.Rollback(context.Background())
	if _, err := transaction.Exec(ctx, schemaLockSQL); err != nil {
		return fmt.Errorf("acquire schema lock: %w", err)
	}
	if _, err := transaction.Exec(ctx, canonicalLedgerSQL); err != nil {
		return fmt.Errorf("initialize canonical schema ledger: %w", err)
	}

	canonical, err := loadCanonicalLedger(ctx, transaction)
	if err != nil {
		return err
	}
	if len(canonical) > 0 {
		if err := validateCanonicalPrefix(canonical, descriptors); err != nil {
			return err
		}
		legacy, _, err := loadPrismaLedger(ctx, transaction)
		if err != nil {
			return err
		}
		if err := validateLegacyPrefix(legacy, descriptors); err != nil {
			return err
		}
		if err := applyPending(ctx, transaction, descriptors[len(canonical):], "executed", logger); err != nil {
			return err
		}
	} else {
		legacy, ledgerExists, err := loadPrismaLedger(ctx, transaction)
		if err != nil {
			return err
		}
		var applicationExists bool
		if err := transaction.QueryRow(ctx, `SELECT to_regclass('public.admins') IS NOT NULL`).Scan(&applicationExists); err != nil {
			return fmt.Errorf("classify schema database: %w", err)
		}
		switch {
		case ledgerExists && len(legacy) > 0:
			if err := validateLegacyPrefix(legacy, descriptors); err != nil {
				return err
			}
			for index := range legacy {
				if err := validatePostcondition(ctx, transaction, descriptors[index].ID); err != nil {
					return fmt.Errorf("validate adopted Prisma migration %s: %w", descriptors[index].ID, err)
				}
				if err := recordCanonical(ctx, transaction, descriptors[index], "adopted-prisma-ledger"); err != nil {
					return err
				}
			}
			if err := applyPending(ctx, transaction, descriptors[len(legacy):], "executed", logger); err != nil {
				return err
			}
		case applicationExists:
			if err := validateFinalContract(ctx, transaction, descriptors); err != nil {
				return fmt.Errorf("ledgerless database is not a complete Prisma schema: %w", err)
			}
			for _, descriptor := range descriptors {
				if err := recordCanonical(ctx, transaction, descriptor, "adopted-catalog"); err != nil {
					return err
				}
			}
		default:
			if err := ensurePrismaLedger(ctx, transaction); err != nil {
				return err
			}
			if err := applyPending(ctx, transaction, descriptors, "executed", logger); err != nil {
				return err
			}
		}
	}

	if err := validateFinalContract(ctx, transaction, descriptors); err != nil {
		return err
	}
	if err := ensurePrismaLedger(ctx, transaction); err != nil {
		return err
	}
	for _, descriptor := range descriptors {
		if err := recordPrismaCompatibility(ctx, transaction, descriptor); err != nil {
			return err
		}
	}
	if err := transaction.Commit(ctx); err != nil {
		return fmt.Errorf("commit schema transaction: %w", err)
	}
	return nil
}

func AdoptRuntimeLedger(ctx context.Context, databaseURL, directory string) error {
	entries, err := os.ReadDir(directory)
	if err != nil {
		return fmt.Errorf("read runtime migration directory: %w", err)
	}
	files := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".sql") {
			files = append(files, entry.Name())
		}
	}
	sort.Strings(files)
	connection, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		return fmt.Errorf("connect runtime ledger adoption: %w", err)
	}
	defer connection.Close(context.Background())
	transaction, err := connection.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin runtime ledger adoption: %w", err)
	}
	defer transaction.Rollback(context.Background())
	if _, err := transaction.Exec(ctx, schemaLockSQL); err != nil {
		return fmt.Errorf("acquire runtime ledger adoption lock: %w", err)
	}
	if _, err := transaction.Exec(ctx, canonicalLedgerSQL); err != nil {
		return fmt.Errorf("initialize canonical schema ledger: %w", err)
	}
	if err := validateRuntimeContract(ctx, transaction); err != nil {
		return err
	}
	for index, file := range files {
		id := strings.TrimSuffix(file, filepath.Ext(file))
		content, err := os.ReadFile(filepath.Join(directory, file))
		if err != nil {
			return fmt.Errorf("read runtime migration %s: %w", file, err)
		}
		digest := sha256.Sum256([]byte(strings.TrimSpace(string(content))))
		checksum := hex.EncodeToString(digest[:])
		var storedChecksum string
		if err := transaction.QueryRow(ctx, `SELECT checksum FROM runtime_migrations WHERE name = $1`, id).Scan(&storedChecksum); err != nil {
			return fmt.Errorf("read runtime migration ledger %s: %w", id, err)
		}
		if storedChecksum != checksum {
			return fmt.Errorf("runtime migration checksum mismatch for %s", id)
		}
		position := 1000 + index + 1
		commandTag, err := transaction.Exec(ctx, `
			INSERT INTO allmail_schema_migrations (position, migration_id, checksum, outcome)
			VALUES ($1, $2, $3, 'adopted-runtime-ledger')
			ON CONFLICT (migration_id) DO NOTHING
		`, position, "go/"+id, checksum)
		if err != nil {
			return fmt.Errorf("record runtime migration %s in canonical ledger: %w", id, err)
		}
		if commandTag.RowsAffected() == 0 {
			var currentPosition int
			var currentChecksum string
			if err := transaction.QueryRow(ctx, `
				SELECT position, checksum FROM allmail_schema_migrations WHERE migration_id = $1
			`, "go/"+id).Scan(&currentPosition, &currentChecksum); err != nil {
				return fmt.Errorf("verify canonical runtime migration %s: %w", id, err)
			}
			if currentPosition != position || currentChecksum != checksum {
				return fmt.Errorf("canonical runtime migration drift for %s", id)
			}
		}
	}
	if err := transaction.Commit(ctx); err != nil {
		return fmt.Errorf("commit runtime ledger adoption: %w", err)
	}
	return nil
}

func validateRuntimeContract(ctx context.Context, tx pgx.Tx) error {
	var fingerprint string
	if err := tx.QueryRow(ctx, runtimeCatalogFingerprintSQL).Scan(&fingerprint); err != nil {
		return fmt.Errorf("calculate runtime schema fingerprint: %w", err)
	}
	if fingerprint != expectedRuntimeCatalogFingerprint {
		return fmt.Errorf("runtime schema fingerprint mismatch: %s", fingerprint)
	}
	var incompleteOAuthAuthority bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM email_accounts AS account
			JOIN provider_oauth_configs AS provider
			  ON account.provider::text = provider.provider::text
			 AND account.client_id = provider.client_id
			WHERE account.auth_type::text IN ('MICROSOFT_OAUTH', 'GOOGLE_OAUTH')
			  AND (
				(COALESCE(provider.tenant, '') <> '' AND COALESCE(account.provider_config->>'oauthTenant', '') = '')
				OR (COALESCE(provider.scopes, '') <> '' AND COALESCE(account.provider_config->>'oauthScopes', '') = '')
			  )
		)
	`).Scan(&incompleteOAuthAuthority); err != nil {
		return fmt.Errorf("validate OAuth authority backfill: %w", err)
	}
	if incompleteOAuthAuthority {
		return errors.New("runtime OAuth authority backfill is incomplete")
	}
	return nil
}

func applyPending(ctx context.Context, tx pgx.Tx, descriptors []Descriptor, outcome string, logger *slog.Logger) error {
	for _, descriptor := range descriptors {
		logger.Info("applying business schema migration", "migration", descriptor.ID)
		if _, err := tx.Exec(ctx, descriptor.SQL); err != nil {
			return fmt.Errorf("apply schema migration %s: %w", descriptor.ID, err)
		}
		if err := validatePostcondition(ctx, tx, descriptor.ID); err != nil {
			return fmt.Errorf("validate schema migration %s: %w", descriptor.ID, err)
		}
		if err := recordCanonical(ctx, tx, descriptor, outcome); err != nil {
			return err
		}
	}
	return nil
}

func loadCanonicalLedger(ctx context.Context, tx pgx.Tx) ([]legacyMigration, error) {
	rows, err := tx.Query(ctx, `SELECT migration_id, checksum FROM allmail_schema_migrations WHERE position < 1000 ORDER BY position`)
	if err != nil {
		return nil, fmt.Errorf("read canonical schema ledger: %w", err)
	}
	defer rows.Close()
	var result []legacyMigration
	for rows.Next() {
		var item legacyMigration
		if err := rows.Scan(&item.Name, &item.Checksum); err != nil {
			return nil, fmt.Errorf("scan canonical schema ledger: %w", err)
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func loadPrismaLedger(ctx context.Context, tx pgx.Tx) ([]legacyMigration, bool, error) {
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT to_regclass('public._prisma_migrations') IS NOT NULL`).Scan(&exists); err != nil {
		return nil, false, fmt.Errorf("inspect Prisma ledger: %w", err)
	}
	if !exists {
		return nil, false, nil
	}
	var unresolved int
	if err := tx.QueryRow(ctx, `
		SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL
	`).Scan(&unresolved); err != nil {
		return nil, true, fmt.Errorf("inspect unresolved Prisma migrations: %w", err)
	}
	if unresolved > 0 {
		return nil, true, fmt.Errorf("Prisma migration ledger contains %d unresolved migration(s)", unresolved)
	}
	rows, err := tx.Query(ctx, `
		SELECT migration_name, checksum
		FROM _prisma_migrations
		WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
		ORDER BY started_at, migration_name
	`)
	if err != nil {
		return nil, true, fmt.Errorf("read Prisma migration ledger: %w", err)
	}
	defer rows.Close()
	var result []legacyMigration
	for rows.Next() {
		var item legacyMigration
		if err := rows.Scan(&item.Name, &item.Checksum); err != nil {
			return nil, true, fmt.Errorf("scan Prisma migration ledger: %w", err)
		}
		result = append(result, item)
	}
	return result, true, rows.Err()
}

func validateCanonicalPrefix(applied []legacyMigration, descriptors []Descriptor) error {
	if len(applied) > len(descriptors) {
		return errors.New("canonical schema ledger is newer than this runtime")
	}
	for index, item := range applied {
		if item.Name != descriptors[index].ID || item.Checksum != descriptors[index].Checksum {
			return fmt.Errorf("canonical schema ledger drift at position %d", index+1)
		}
	}
	return nil
}

func validateLegacyPrefix(applied []legacyMigration, descriptors []Descriptor) error {
	if len(applied) > len(descriptors) {
		return errors.New("Prisma schema ledger is newer than this runtime")
	}
	for index, item := range applied {
		if item.Name != descriptors[index].ID {
			return fmt.Errorf("Prisma migration history is not a known prefix at position %d: %s", index+1, item.Name)
		}
		if item.Checksum != descriptors[index].Checksum {
			return fmt.Errorf("Prisma migration checksum mismatch for %s", item.Name)
		}
	}
	return nil
}

func recordCanonical(ctx context.Context, tx pgx.Tx, descriptor Descriptor, outcome string) error {
	if _, err := tx.Exec(ctx, `
		INSERT INTO allmail_schema_migrations (position, migration_id, checksum, outcome)
		VALUES ($1, $2, $3, $4)
	`, descriptor.Position, descriptor.ID, descriptor.Checksum, outcome); err != nil {
		return fmt.Errorf("record canonical schema migration %s: %w", descriptor.ID, err)
	}
	return nil
}

func ensurePrismaLedger(ctx context.Context, tx pgx.Tx) error {
	if _, err := tx.Exec(ctx, prismaLedgerSQL); err != nil {
		return fmt.Errorf("initialize Prisma compatibility ledger: %w", err)
	}
	return nil
}

func recordPrismaCompatibility(ctx context.Context, tx pgx.Tx, descriptor Descriptor) error {
	var currentChecksum string
	err := tx.QueryRow(ctx, `SELECT checksum FROM _prisma_migrations WHERE migration_name = $1 AND rolled_back_at IS NULL`, descriptor.ID).Scan(&currentChecksum)
	if err == nil {
		if currentChecksum != descriptor.Checksum {
			return fmt.Errorf("Prisma compatibility checksum drift for %s", descriptor.ID)
		}
		return nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("read Prisma compatibility row %s: %w", descriptor.ID, err)
	}
	id, err := randomUUID()
	if err != nil {
		return fmt.Errorf("generate Prisma compatibility migration id: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO _prisma_migrations (
			id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count
		) VALUES ($1, $2, CURRENT_TIMESTAMP, $3, NULL, NULL, CURRENT_TIMESTAMP, 1)
	`, id, descriptor.Checksum, descriptor.ID); err != nil {
		return fmt.Errorf("record Prisma compatibility migration %s: %w", descriptor.ID, err)
	}
	return nil
}

func validateFinalContract(ctx context.Context, tx pgx.Tx, descriptors []Descriptor) error {
	for _, descriptor := range descriptors {
		if err := validatePostcondition(ctx, tx, descriptor.ID); err != nil {
			return fmt.Errorf("final schema contract failed at %s: %w", descriptor.ID, err)
		}
	}
	for _, table := range businessTables {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT to_regclass($1) IS NOT NULL`, "public."+table).Scan(&exists); err != nil {
			return fmt.Errorf("inspect required table %s: %w", table, err)
		}
		if !exists {
			return fmt.Errorf("required table %s is missing", table)
		}
	}
	for enumName, expected := range enumContract {
		rows, err := tx.Query(ctx, `
			SELECT enumlabel
			FROM pg_enum
			JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
			JOIN pg_namespace ON pg_namespace.oid = pg_type.typnamespace
			WHERE pg_namespace.nspname = current_schema() AND pg_type.typname = $1
			ORDER BY enumsortorder
		`, enumName)
		if err != nil {
			return fmt.Errorf("inspect enum %s: %w", enumName, err)
		}
		var actual []string
		for rows.Next() {
			var value string
			if err := rows.Scan(&value); err != nil {
				rows.Close()
				return fmt.Errorf("scan enum %s: %w", enumName, err)
			}
			actual = append(actual, value)
		}
		rows.Close()
		if strings.Join(actual, "\x00") != strings.Join(expected, "\x00") {
			return fmt.Errorf("enum %s values differ: %v", enumName, actual)
		}
	}
	var fingerprint string
	if err := tx.QueryRow(ctx, catalogFingerprintSQL).Scan(&fingerprint); err != nil {
		return fmt.Errorf("calculate business schema fingerprint: %w", err)
	}
	if fingerprint != expectedCatalogFingerprint {
		return fmt.Errorf("business schema fingerprint mismatch: %s", fingerprint)
	}
	return nil
}

func validatePostcondition(ctx context.Context, tx pgx.Tx, id string) error {
	var valid bool
	query := ""
	switch id {
	case "20260315_multi_provider_support":
		query = `SELECT to_regclass('admins') IS NOT NULL AND to_regclass('outbound_messages') IS NOT NULL`
	case "20260319_email_mailbox_status_and_log_cleanup":
		query = columnExistsSQL("email_accounts", "mailbox_status")
	case "20260324_admin_must_change_password":
		query = columnExistsSQL("admins", "must_change_password")
	case "202603261600_expand_mail_provider_enum":
		query = enumContainsSQL("MailProvider", "ALIYUN")
	case "202603271820_expand_mail_provider_enum_for_custom_and_global_imap":
		query = enumContainsSQL("MailProvider", "CUSTOM_IMAP_SMTP")
	case "202603291000_forwarding_execution_v1":
		query = `SELECT to_regclass('mailbox_forward_jobs') IS NOT NULL AND ` + columnExistsSQLExpression("inbound_messages", "portal_state")
	case "202603311330_ingress_delivery_dedupe":
		query = `SELECT ` + columnNotNullSQLExpression("inbound_messages", "delivery_key") + ` AND to_regclass('inbound_messages_domain_id_delivery_key_key') IS NOT NULL`
	case "202604021420_outbound_last_error":
		query = columnExistsSQL("outbound_messages", "last_error")
	case "202604071700_email_account_login_password":
		query = `SELECT ` + columnExistsSQLExpression("email_accounts", "account_login_password") + ` AND NOT EXISTS (
			SELECT 1 FROM email_accounts WHERE auth_type::text IN ('MICROSOFT_OAUTH', 'GOOGLE_OAUTH') AND password IS NOT NULL
		)`
	case "202607281200_forwarding_claim_lease_v1":
		query = `SELECT ` + columnExistsSQLExpression("mailbox_forward_jobs", "claim_token") + ` AND ` + columnExistsSQLExpression("mailbox_forward_jobs", "lease_expires_at") + ` AND to_regclass('mailbox_forward_jobs_go_claim_idx') IS NOT NULL`
	case "202607301200_admin_2fa_integrity":
		query = constraintExistsSQL("admins", "admins_two_factor_secret_required")
	case "202607301700_durable_environment_config":
		query = `SELECT ` + columnExistsSQLExpression("domains", "send_approved") + ` AND ` + columnExistsSQLExpression("domains", "send_approved_at") + ` AND ` + columnExistsSQLExpression("domains", "send_approval_source") + ` AND ` + columnExistsSQLExpression("ingress_endpoints", "signing_secret_encrypted") + ` AND ` + constraintExistsSQLExpression("ingress_endpoints", "ingress_endpoint_secret_requires_hash") + ` AND NOT EXISTS (
			SELECT 1 FROM domains
			WHERE can_send = true
			  AND (send_approved = false OR send_approved_at IS NULL OR send_approval_source IS NULL)
		)`
	case "20260731_api_key_explicit_permissions":
		query = `SELECT NOT EXISTS (SELECT 1 FROM api_keys WHERE permissions IS NULL OR permissions = '{}'::jsonb)`
	case "20260731_revocable_sessions":
		query = `SELECT ` + columnNotNullSQLExpression("admins", "session_version") + ` AND ` + columnNotNullSQLExpression("mailbox_users", "session_version") + ` AND ` + constraintExistsSQLExpression("admins", "admins_session_version_positive") + ` AND ` + constraintExistsSQLExpression("mailbox_users", "mailbox_users_session_version_positive") + ` AND to_regprocedure('all_mail_bump_admin_session_version()') IS NOT NULL AND to_regprocedure('all_mail_bump_mailbox_user_session_version()') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'admins_bump_session_version' AND NOT tgisinternal) AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'mailbox_users_bump_session_version' AND NOT tgisinternal)`
	default:
		return fmt.Errorf("unknown schema migration %s", id)
	}
	if err := tx.QueryRow(ctx, query).Scan(&valid); err != nil {
		return err
	}
	if !valid {
		return errors.New("postcondition is not satisfied")
	}
	return nil
}

func columnExistsSQL(table, column string) string {
	return "SELECT " + columnExistsSQLExpression(table, column)
}

func columnExistsSQLExpression(table, column string) string {
	return fmt.Sprintf(`EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '%s' AND column_name = '%s')`, table, column)
}

func columnNotNullSQLExpression(table, column string) string {
	return fmt.Sprintf(`EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '%s' AND column_name = '%s' AND is_nullable = 'NO')`, table, column)
}

func enumContainsSQL(enumName, value string) string {
	return fmt.Sprintf(`SELECT EXISTS (SELECT 1 FROM pg_enum JOIN pg_type ON pg_type.oid = pg_enum.enumtypid WHERE pg_type.typname = '%s' AND enumlabel = '%s')`, enumName, value)
}

func constraintExistsSQL(table, constraint string) string {
	return "SELECT " + constraintExistsSQLExpression(table, constraint)
}

func constraintExistsSQLExpression(table, constraint string) string {
	return fmt.Sprintf(`EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '%s'::regclass AND conname = '%s')`, table, constraint)
}

func randomUUID() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		value[0:4], value[4:6], value[6:8], value[8:10], value[10:16]), nil
}

const canonicalLedgerSQL = `
CREATE TABLE IF NOT EXISTS allmail_schema_migrations (
    position integer NOT NULL UNIQUE,
    migration_id text PRIMARY KEY,
    checksum char(64) NOT NULL,
    outcome text NOT NULL CHECK (outcome IN ('executed', 'adopted-prisma-ledger', 'adopted-runtime-ledger', 'adopted-catalog')),
    applied_at timestamptz NOT NULL DEFAULT now()
);
`

const prismaLedgerSQL = `
CREATE TABLE IF NOT EXISTS _prisma_migrations (
    id varchar(36) PRIMARY KEY,
    checksum varchar(64) NOT NULL,
    finished_at timestamptz,
    migration_name varchar(255) NOT NULL,
    logs text,
    rolled_back_at timestamptz,
    started_at timestamptz NOT NULL DEFAULT now(),
    applied_steps_count integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS allmail_prisma_migration_name_active_key
    ON _prisma_migrations (migration_name) WHERE rolled_back_at IS NULL;
`

const expectedCatalogFingerprint = "3015ccb01658e3ad91a7acda8697059a"

const expectedRuntimeCatalogFingerprint = "ea5b5dbf10912a942f7b4010cf41909b"

const catalogFingerprintSQL = `
WITH owned(name) AS (
    VALUES
        ('admins'), ('api_keys'), ('provider_oauth_configs'), ('email_groups'),
        ('email_accounts'), ('email_usage'), ('api_logs'), ('domains'),
        ('domain_sending_configs'), ('mailbox_users'), ('domain_mailboxes'),
        ('domain_mailbox_usage'), ('mailbox_memberships'), ('mailbox_aliases'),
        ('ingress_endpoints'), ('inbound_messages'), ('mailbox_forward_jobs'),
        ('outbound_messages')
), objects(kind, identity, definition) AS (
    SELECT
        'column',
        columns.table_name || '.' || lpad(columns.ordinal_position::text, 3, '0') || '.' || columns.column_name,
        concat_ws('|', columns.data_type, columns.udt_name, columns.is_nullable,
            columns.character_maximum_length::text, columns.numeric_precision::text,
            columns.numeric_scale::text, columns.datetime_precision::text,
            columns.column_default)
    FROM information_schema.columns
    JOIN owned ON owned.name = columns.table_name
    WHERE columns.table_schema = 'public'

    UNION ALL
    SELECT
        'constraint',
        relation.relname || '.' || constraint_row.conname,
        constraint_row.contype::text || '|' || pg_get_constraintdef(constraint_row.oid, true)
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    JOIN owned ON owned.name = relation.relname
    WHERE namespace.nspname = 'public'

    UNION ALL
    SELECT 'index', indexes.tablename || '.' || indexes.indexname, indexes.indexdef
    FROM pg_indexes AS indexes
    JOIN owned ON owned.name = indexes.tablename
    WHERE indexes.schemaname = 'public'

    UNION ALL
    SELECT
        'enum',
        type_row.typname || '.' || lpad(enum_row.enumsortorder::text, 6, '0'),
        enum_row.enumlabel
    FROM pg_enum AS enum_row
    JOIN pg_type AS type_row ON type_row.oid = enum_row.enumtypid
    JOIN pg_namespace AS namespace ON namespace.oid = type_row.typnamespace
    WHERE namespace.nspname = 'public'

    UNION ALL
    SELECT 'function', procedure.proname, pg_get_functiondef(procedure.oid)
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname IN ('all_mail_bump_admin_session_version', 'all_mail_bump_mailbox_user_session_version')

    UNION ALL
    SELECT 'trigger', relation.relname || '.' || trigger_row.tgname, pg_get_triggerdef(trigger_row.oid, true)
    FROM pg_trigger AS trigger_row
    JOIN pg_class AS relation ON relation.oid = trigger_row.tgrelid
    JOIN owned ON owned.name = relation.relname
    WHERE NOT trigger_row.tgisinternal
)
SELECT md5(string_agg(kind || '|' || identity || '|' || definition, E'\n' ORDER BY kind, identity))
FROM objects;
`

const runtimeCatalogFingerprintSQL = `
WITH owned(name) AS (
    VALUES
        ('runtime_heartbeats'), ('mailbox_sync_cursors'), ('mailbox_sync_jobs'),
        ('outbound_delivery_jobs'), ('job_attempts'), ('outbox_events'),
        ('runtime_oauth_states'), ('runtime_ingress_replays'),
        ('runtime_rate_limits'), ('runtime_login_attempts')
), objects(kind, identity, definition) AS (
    SELECT
        'column',
        columns.table_name || '.' || lpad(columns.ordinal_position::text, 3, '0') || '.' || columns.column_name,
        concat_ws('|', columns.data_type, columns.udt_name, columns.is_nullable,
            columns.character_maximum_length::text, columns.numeric_precision::text,
            columns.numeric_scale::text, columns.datetime_precision::text,
            columns.column_default)
    FROM information_schema.columns
    JOIN owned ON owned.name = columns.table_name
    WHERE columns.table_schema = 'public'

    UNION ALL
    SELECT
        'constraint',
        relation.relname || '.' || constraint_row.conname,
        constraint_row.contype::text || '|' ||
            replace(replace(replace(
                pg_get_constraintdef(constraint_row.oid, true),
                '::character varying::text', ''
            ), '::character varying', ''), '::text[]', '')
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    JOIN owned ON owned.name = relation.relname
    WHERE namespace.nspname = 'public'

    UNION ALL
    SELECT 'index', indexes.tablename || '.' || indexes.indexname, indexes.indexdef
    FROM pg_indexes AS indexes
    JOIN owned ON owned.name = indexes.tablename
    WHERE indexes.schemaname = 'public'
)
SELECT md5(string_agg(kind || '|' || identity || '|' || definition, E'\n' ORDER BY kind, identity))
FROM objects;
`
