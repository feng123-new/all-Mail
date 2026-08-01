package businessapi

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"
)

func TestPostgresDomainMessageStorePreservesAdminAndTextCompatibility(t *testing.T) {
	databaseURL := os.Getenv("ALLMAIL_GO_BUSINESS_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("ALLMAIL_GO_BUSINESS_TEST_DATABASE_URL is not configured")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	store, err := NewPostgresStore(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	var adminID, domainID, mailboxID, apiKeyID int64
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		if domainID > 0 {
			_, _ = store.pool.Exec(cleanupCtx, `DELETE FROM domains WHERE id = $1`, domainID)
		}
		if apiKeyID > 0 {
			_, _ = store.pool.Exec(cleanupCtx, `DELETE FROM api_keys WHERE id = $1`, apiKeyID)
		}
		if adminID > 0 {
			_, _ = store.pool.Exec(cleanupCtx, `DELETE FROM admins WHERE id = $1`, adminID)
		}
	}()

	if err := store.pool.QueryRow(ctx, `
		INSERT INTO admins (username, password_hash, role, status, must_change_password, session_version, created_at, updated_at)
		VALUES ($1, 'fixture', 'SUPER_ADMIN', 'ACTIVE', FALSE, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		RETURNING id
	`, "domain-message-admin-"+suffix).Scan(&adminID); err != nil {
		t.Fatal(err)
	}
	if err := store.pool.QueryRow(ctx, `
		INSERT INTO domains (name, status, can_receive, can_send, created_by_admin_id, created_at, updated_at)
		VALUES ($1, 'ACTIVE', TRUE, TRUE, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		RETURNING id
	`, "domain-message-"+suffix+".example", adminID).Scan(&domainID); err != nil {
		t.Fatal(err)
	}
	mailboxAddress := "pool-" + suffix + "@example.test"
	if err := store.pool.QueryRow(ctx, `
		INSERT INTO domain_mailboxes (
			domain_id, local_part, address, status, provisioning_mode, updated_at
		)
		VALUES ($1, $2, $3, 'ACTIVE', 'API_POOL', CURRENT_TIMESTAMP)
		RETURNING id
	`, domainID, "pool-"+suffix, mailboxAddress).Scan(&mailboxID); err != nil {
		t.Fatal(err)
	}
	if err := store.pool.QueryRow(ctx, `
		INSERT INTO api_keys (
			name, key_hash, key_prefix, permissions, allowed_domain_ids,
			rate_limit, status, usage_count, created_by, created_at, updated_at
		)
		VALUES (
			$1, $2, 'fixture', '{"domain_read_message_text":true}'::jsonb, jsonb_build_array($3::bigint),
			60, 'ACTIVE', 0, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
		)
		RETURNING id
	`, "domain-message-key-"+suffix, fmt.Sprintf("%064x", time.Now().UnixNano()), domainID, adminID).Scan(&apiKeyID); err != nil {
		t.Fatal(err)
	}

	type messageFixture struct {
		mailboxID any
		text      any
		html      any
		portal    string
		isRead    bool
		isDeleted bool
		received  time.Time
	}
	fixtures := []messageFixture{
		{mailboxID: mailboxID, text: "older text", portal: "VISIBLE", received: time.Date(2026, 8, 1, 10, 0, 0, 0, time.UTC)},
		{mailboxID: nil, text: "unassigned text", portal: "VISIBLE", received: time.Date(2026, 8, 1, 11, 0, 0, 0, time.UTC)},
		{mailboxID: mailboxID, text: "", html: "<b>latest hidden html</b>", portal: "FORWARDED_HIDDEN", received: time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC)},
		{mailboxID: mailboxID, text: "deleted text", portal: "VISIBLE", isDeleted: true, received: time.Date(2026, 8, 1, 13, 0, 0, 0, time.UTC)},
	}
	messageIDs := make([]int64, len(fixtures))
	for index, fixture := range fixtures {
		if err := store.pool.QueryRow(ctx, `
			INSERT INTO inbound_messages (
				domain_id, mailbox_id, matched_address, final_address, delivery_key,
				from_address, to_address, subject, text_preview, html_preview,
				verification_code, route_kind, received_at, storage_status,
				attachments_meta, headers_json, is_read, is_deleted, portal_state,
				created_at, updated_at
			)
			VALUES (
				$1, $2, 'pool@example.test', 'pool@example.test', $3,
				'sender@example.net', 'pool@example.test', 'Subject', $4, $5,
				'654321', 'EXACT_MAILBOX', $6, 'STORED',
				'[{"name":"note.txt"}]'::jsonb, '{"x-test":"yes"}'::jsonb, $7, $8, $9,
				$6, $6
			)
			RETURNING id
		`, domainID, fixture.mailboxID, fmt.Sprintf("domain-message-%s-%d", suffix, index),
			fixture.text, fixture.html, fixture.received, fixture.isRead, fixture.isDeleted, fixture.portal,
		).Scan(&messageIDs[index]); err != nil {
			t.Fatal(err)
		}
	}

	domainFilter := domainID
	list, err := store.ListAdminDomainMessages(ctx, adminDomainMessageListInput{
		Page: 1, PageSize: 20, DomainID: &domainFilter, UnreadOnly: true,
	})
	if err != nil || list.Total != 3 || len(list.List) != 3 || list.List[0]["id"] != fmt.Sprint(messageIDs[2]) {
		t.Fatalf("admin list = %#v, %v", list, err)
	}
	if list.List[1]["id"] != fmt.Sprint(messageIDs[1]) || list.List[1]["mailbox"] != nil {
		t.Fatalf("nullable mailbox list row = %#v", list.List[1])
	}

	detail, err := store.GetAdminDomainMessage(ctx, messageIDs[3])
	if err != nil || detail["id"] != fmt.Sprint(messageIDs[3]) || detail["isDeleted"] != true || detail["isRead"] != false {
		t.Fatalf("deleted detail = %#v, %v", detail, err)
	}
	var detailRead bool
	if err := store.pool.QueryRow(ctx, `SELECT is_read FROM inbound_messages WHERE id = $1`, messageIDs[3]).Scan(&detailRead); err != nil || detailRead {
		t.Fatalf("admin detail changed read state = %v, %v", detailRead, err)
	}

	content, found, err := store.GetLatestDomainMessageText(ctx, apiKeyID, mailboxAddress, maxDomainMessageTextCharacters)
	if err != nil || !found || content != "<b>latest hidden html</b>" {
		t.Fatalf("latest text = %q, found=%v, err=%v", content, found, err)
	}
	var textRead bool
	if err := store.pool.QueryRow(ctx, `SELECT is_read FROM inbound_messages WHERE id = $1`, messageIDs[2]).Scan(&textRead); err != nil || textRead {
		t.Fatalf("text read changed message state = %v, %v", textRead, err)
	}

	deleteResult, err := store.DeleteAdminDomainMessages(ctx, []int64{messageIDs[2], messageIDs[3], messageIDs[3] + 10_000})
	if err != nil || deleteResult.Deleted != 1 || len(deleteResult.IDs) != 3 || deleteResult.IDs[2] != fmt.Sprint(messageIDs[3]+10_000) {
		t.Fatalf("soft delete result = %#v, %v", deleteResult, err)
	}
	var hiddenDeleted bool
	if err := store.pool.QueryRow(ctx, `SELECT is_deleted FROM inbound_messages WHERE id = $1`, messageIDs[2]).Scan(&hiddenDeleted); err != nil || !hiddenDeleted {
		t.Fatalf("hidden message deletion = %v, %v", hiddenDeleted, err)
	}

	if _, err := store.pool.Exec(ctx, `UPDATE api_keys SET allowed_domain_ids = jsonb_build_array($1::bigint) WHERE id = $2`, domainID+1_000_000, apiKeyID); err != nil {
		t.Fatal(err)
	}
	_, _, err = store.GetLatestDomainMessageText(ctx, apiKeyID, mailboxAddress, maxDomainMessageTextCharacters)
	var requestErr *requestError
	if !errors.As(err, &requestErr) || requestErr.Code != "DOMAIN_FORBIDDEN" || requestErr.Status != 403 {
		t.Fatalf("scoped text error = %v", err)
	}
}
