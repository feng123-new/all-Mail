package businessapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/legacycrypto"
)

func TestPostgresMailboxPortalStoreScopesListsAndAtomicallyMarksDetailRead(t *testing.T) {
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
	var adminID, domainID, userID int64
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		if domainID > 0 {
			_, _ = store.pool.Exec(cleanupCtx, `DELETE FROM domains WHERE id = $1`, domainID)
		}
		if userID > 0 {
			_, _ = store.pool.Exec(cleanupCtx, `DELETE FROM mailbox_users WHERE id = $1`, userID)
		}
		if adminID > 0 {
			_, _ = store.pool.Exec(cleanupCtx, `DELETE FROM admins WHERE id = $1`, adminID)
		}
	}()

	if err := store.pool.QueryRow(ctx, `
		INSERT INTO admins (username, password_hash, role, status, must_change_password, session_version, created_at, updated_at)
		VALUES ($1, 'fixture', 'SUPER_ADMIN', 'ACTIVE', FALSE, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		RETURNING id
	`, "portal-read-admin-"+suffix).Scan(&adminID); err != nil {
		t.Fatal(err)
	}
	if err := store.pool.QueryRow(ctx, `
		INSERT INTO domains (name, status, can_receive, can_send, created_by_admin_id, created_at, updated_at)
		VALUES ($1, 'ACTIVE', TRUE, TRUE, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		RETURNING id
	`, "portal-read-"+suffix+".example", adminID).Scan(&domainID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.pool.Exec(ctx, `
		INSERT INTO domain_sending_configs (domain_id, provider, api_key_encrypted, status, created_at, updated_at)
		VALUES ($1, 'RESEND', 'fixture', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
	`, domainID); err != nil {
		t.Fatal(err)
	}
	if err := store.pool.QueryRow(ctx, `
		INSERT INTO mailbox_users (username, password_hash, status, must_change_password, session_version, created_at, updated_at)
		VALUES ($1, 'fixture', 'ACTIVE', FALSE, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		RETURNING id
	`, "portal-read-user-"+suffix).Scan(&userID); err != nil {
		t.Fatal(err)
	}

	mailboxIDs := make([]int64, 4)
	for index, mailbox := range []struct {
		localPart string
		mode      string
		status    string
		ownerID   any
	}{
		{localPart: "owned", mode: "MANUAL", status: "ACTIVE", ownerID: userID},
		{localPart: "member", mode: "API_POOL", status: "ACTIVE"},
		{localPart: "other", mode: "MANUAL", status: "ACTIVE"},
		{localPart: "disabled", mode: "MANUAL", status: "DISABLED"},
	} {
		if err := store.pool.QueryRow(ctx, `
			INSERT INTO domain_mailboxes (
				domain_id, local_part, address, status, provisioning_mode, owner_user_id, updated_at
			)
			VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
			RETURNING id
		`, domainID, mailbox.localPart, mailbox.localPart+"-"+suffix+"@example.test", mailbox.status, mailbox.mode, mailbox.ownerID).Scan(&mailboxIDs[index]); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := store.pool.Exec(ctx, `
		INSERT INTO mailbox_memberships (mailbox_id, user_id, role, created_at, updated_at)
		VALUES ($1, $3, 'MEMBER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
		       ($2, $3, 'MEMBER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
	`, mailboxIDs[1], mailboxIDs[3], userID); err != nil {
		t.Fatal(err)
	}

	mailboxes, err := store.ListMailboxPortalMailboxes(ctx, userID)
	if err != nil || len(mailboxes) != 2 || mailboxes[0]["id"] != mailboxIDs[0] || mailboxes[1]["id"] != mailboxIDs[1] {
		t.Fatalf("portal mailboxes = %#v, %v", mailboxes, err)
	}
	if mailboxes[0]["sendReady"] != true || mailboxes[0]["providerProfile"] != "hosted-internal-manual" ||
		mailboxes[1]["providerProfile"] != "hosted-internal-api-pool" {
		t.Fatalf("portal mailbox enrichment = %#v", mailboxes)
	}

	type messageFixture struct {
		mailboxID any
		portal    string
		isDeleted bool
		isRead    bool
		received  time.Time
	}
	fixtures := []messageFixture{
		{mailboxID: mailboxIDs[0], portal: "VISIBLE", received: time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC)},
		{mailboxID: mailboxIDs[1], portal: "VISIBLE", isRead: true, received: time.Date(2026, 8, 1, 11, 0, 0, 0, time.UTC)},
		{mailboxID: mailboxIDs[0], portal: "FORWARDED_HIDDEN", received: time.Date(2026, 8, 1, 13, 0, 0, 0, time.UTC)},
		{mailboxID: mailboxIDs[0], portal: "VISIBLE", isDeleted: true, received: time.Date(2026, 8, 1, 14, 0, 0, 0, time.UTC)},
		{mailboxID: mailboxIDs[2], portal: "VISIBLE", received: time.Date(2026, 8, 1, 15, 0, 0, 0, time.UTC)},
		{mailboxID: nil, portal: "VISIBLE", received: time.Date(2026, 8, 1, 16, 0, 0, 0, time.UTC)},
	}
	messageIDs := make([]int64, len(fixtures))
	for index, fixture := range fixtures {
		if err := store.pool.QueryRow(ctx, `
			INSERT INTO inbound_messages (
				domain_id, mailbox_id, matched_address, final_address, delivery_key,
				message_id_header, from_address, to_address, subject, text_preview,
				html_preview, verification_code, route_kind, received_at, storage_status,
				raw_object_key, attachments_meta, headers_json, is_read, is_deleted,
				portal_state, created_at, updated_at
			)
			VALUES (
				$1, $2, 'inbox@example.test', 'inbox@example.test', $3,
				NULL, 'sender@example.net', 'inbox@example.test', 'Subject', 'hello',
				NULL, NULL, 'EXACT_MAILBOX', $4, 'STORED',
				NULL, '[{"name":"note.txt"}]'::jsonb, '{"x-test":"yes"}'::jsonb, $5, $6,
				$7, $4, $4
			)
			RETURNING id
		`, domainID, fixture.mailboxID, fmt.Sprintf("portal-read-%s-%d", suffix, index), fixture.received,
			fixture.isRead, fixture.isDeleted, fixture.portal).Scan(&messageIDs[index]); err != nil {
			t.Fatal(err)
		}
	}

	list, err := store.ListMailboxPortalMessages(ctx, MailboxPortalMessageListInput{
		Page: 1, PageSize: 20, MailboxUserID: userID,
	})
	if err != nil || list.Total != 2 || len(list.List) != 2 || list.List[0]["id"] != fmt.Sprint(messageIDs[0]) || list.List[1]["id"] != fmt.Sprint(messageIDs[1]) {
		t.Fatalf("portal message list = %#v, %v", list, err)
	}
	if _, err := store.pool.Exec(ctx, `DELETE FROM mailbox_memberships WHERE mailbox_id = $1 AND user_id = $2`, mailboxIDs[1], userID); err != nil {
		t.Fatal(err)
	}
	revokedMailboxes, err := store.ListMailboxPortalMailboxes(ctx, userID)
	if err != nil || len(revokedMailboxes) != 1 || revokedMailboxes[0]["id"] != mailboxIDs[0] {
		t.Fatalf("revoked membership mailbox list = %#v, %v", revokedMailboxes, err)
	}
	revokedMembership, err := store.ListMailboxPortalMessages(ctx, MailboxPortalMessageListInput{
		Page: 1, PageSize: 20, MailboxUserID: userID,
	})
	if err != nil || revokedMembership.Total != 1 || len(revokedMembership.List) != 1 || revokedMembership.List[0]["id"] != fmt.Sprint(messageIDs[0]) {
		t.Fatalf("revoked membership message list = %#v, %v", revokedMembership, err)
	}
	if _, err := store.GetMailboxPortalMessage(ctx, messageIDs[1], userID); !errors.Is(err, errNotFound) {
		t.Fatalf("revoked membership detail error = %v", err)
	}
	if _, err := store.pool.Exec(ctx, `UPDATE domains SET status = 'DISABLED' WHERE id = $1`, domainID); err != nil {
		t.Fatal(err)
	}
	disabledDomainMailboxes, err := store.ListMailboxPortalMailboxes(ctx, userID)
	if err != nil || len(disabledDomainMailboxes) != 0 {
		t.Fatalf("disabled domain mailbox list = %#v, %v", disabledDomainMailboxes, err)
	}
	disabledDomain, err := store.ListMailboxPortalMessages(ctx, MailboxPortalMessageListInput{
		Page: 1, PageSize: 20, MailboxUserID: userID,
	})
	if err != nil || disabledDomain.Total != 0 || len(disabledDomain.List) != 0 {
		t.Fatalf("disabled domain message list = %#v, %v", disabledDomain, err)
	}
	if _, err := store.GetMailboxPortalMessage(ctx, messageIDs[0], userID); !errors.Is(err, errNotFound) {
		t.Fatalf("disabled domain detail error = %v", err)
	}
	if _, err := store.pool.Exec(ctx, `UPDATE domains SET status = 'ACTIVE' WHERE id = $1`, domainID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.pool.Exec(ctx, `
		INSERT INTO mailbox_memberships (mailbox_id, user_id, role, created_at, updated_at)
		VALUES ($1, $2, 'MEMBER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
	`, mailboxIDs[1], userID); err != nil {
		t.Fatal(err)
	}
	unread, err := store.ListMailboxPortalMessages(ctx, MailboxPortalMessageListInput{
		Page: 1, PageSize: 20, UnreadOnly: true, MailboxUserID: userID,
	})
	if err != nil || unread.Total != 1 || len(unread.List) != 1 || unread.List[0]["id"] != fmt.Sprint(messageIDs[0]) {
		t.Fatalf("unread portal messages = %#v, %v", unread, err)
	}
	mailboxFilter := mailboxIDs[1]
	filtered, err := store.ListMailboxPortalMessages(ctx, MailboxPortalMessageListInput{
		Page: 1, PageSize: 20, MailboxID: &mailboxFilter, MailboxUserID: userID,
	})
	if err != nil || filtered.Total != 1 || filtered.List[0]["id"] != fmt.Sprint(messageIDs[1]) {
		t.Fatalf("filtered portal messages = %#v, %v", filtered, err)
	}

	detail, err := store.GetMailboxPortalMessage(ctx, messageIDs[0], userID)
	if err != nil || detail["id"] != fmt.Sprint(messageIDs[0]) || detail["isRead"] != true || detail["messageIdHeader"] != nil {
		t.Fatalf("portal detail = %#v, %v", detail, err)
	}
	var markedRead bool
	if err := store.pool.QueryRow(ctx, `SELECT is_read FROM inbound_messages WHERE id = $1`, messageIDs[0]).Scan(&markedRead); err != nil || !markedRead {
		t.Fatalf("authorized detail read state = %v, %v", markedRead, err)
	}
	for _, messageID := range messageIDs[2:] {
		if _, err := store.GetMailboxPortalMessage(ctx, messageID, userID); !errors.Is(err, errNotFound) {
			t.Fatalf("scoped message %d error = %v", messageID, err)
		}
	}
	var hiddenRead bool
	if err := store.pool.QueryRow(ctx, `SELECT is_read FROM inbound_messages WHERE id = $1`, messageIDs[2]).Scan(&hiddenRead); err != nil || hiddenRead {
		t.Fatalf("hidden message read state = %v, %v", hiddenRead, err)
	}
}

func TestPostgresMailboxPortalOperationStoreScopesHistoryForwardingAndSendConfig(t *testing.T) {
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

	const encryptionKey = "portal-operation-integration-key-0123456789"
	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	var adminID, domainID, userID, otherUserID int64
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		if domainID > 0 {
			_, _ = store.pool.Exec(cleanupCtx, `DELETE FROM domains WHERE id = $1`, domainID)
		}
		if userID > 0 || otherUserID > 0 {
			_, _ = store.pool.Exec(cleanupCtx, `DELETE FROM mailbox_users WHERE id = ANY($1::bigint[])`, []int64{userID, otherUserID})
		}
		if adminID > 0 {
			_, _ = store.pool.Exec(cleanupCtx, `DELETE FROM admins WHERE id = $1`, adminID)
		}
	}()

	if err := store.pool.QueryRow(ctx, `
		INSERT INTO admins (username, password_hash, role, status, must_change_password, session_version, created_at, updated_at)
		VALUES ($1, 'fixture', 'SUPER_ADMIN', 'ACTIVE', FALSE, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		RETURNING id
	`, "portal-operation-admin-"+suffix).Scan(&adminID); err != nil {
		t.Fatal(err)
	}
	domainName := "portal-operation-" + suffix + ".example"
	if err := store.pool.QueryRow(ctx, `
		INSERT INTO domains (name, status, can_receive, can_send, created_by_admin_id, created_at, updated_at)
		VALUES ($1, 'ACTIVE', TRUE, TRUE, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		RETURNING id
	`, domainName, adminID).Scan(&domainID); err != nil {
		t.Fatal(err)
	}
	encryptedAPIKey, err := legacycrypto.Encrypt(encryptionKey, "re_portal_fixture")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.pool.Exec(ctx, `
		INSERT INTO domain_sending_configs (
			domain_id, provider, api_key_encrypted, from_name_default, reply_to_default,
			status, created_at, updated_at
		)
		VALUES ($1, 'RESEND', $2, 'Portal Fixture', $3, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
	`, domainID, encryptedAPIKey, "reply@"+domainName); err != nil {
		t.Fatal(err)
	}
	for _, fixture := range []struct {
		username string
		id       *int64
	}{
		{username: "portal-operation-user-" + suffix, id: &userID},
		{username: "portal-operation-other-" + suffix, id: &otherUserID},
	} {
		if err := store.pool.QueryRow(ctx, `
			INSERT INTO mailbox_users (username, password_hash, status, must_change_password, session_version, created_at, updated_at)
			VALUES ($1, 'fixture', 'ACTIVE', FALSE, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
			RETURNING id
		`, fixture.username).Scan(fixture.id); err != nil {
			t.Fatal(err)
		}
	}

	mailboxIDs := make([]int64, 3)
	for index, fixture := range []struct {
		localPart string
		ownerID   any
	}{
		{localPart: "owned", ownerID: userID},
		{localPart: "member", ownerID: nil},
		{localPart: "other", ownerID: otherUserID},
	} {
		if err := store.pool.QueryRow(ctx, `
			INSERT INTO domain_mailboxes (
				domain_id, local_part, address, status, provisioning_mode, owner_user_id,
				forward_mode, updated_at
			)
			VALUES ($1, $2, $3, 'ACTIVE', 'MANUAL', $4, 'DISABLED', CURRENT_TIMESTAMP)
			RETURNING id
		`, domainID, fixture.localPart+suffix, fixture.localPart+"@"+domainName, fixture.ownerID).Scan(&mailboxIDs[index]); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := store.pool.Exec(ctx, `
		INSERT INTO mailbox_memberships (mailbox_id, user_id, role, created_at, updated_at)
		VALUES ($1, $2, 'MEMBER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
	`, mailboxIDs[1], userID); err != nil {
		t.Fatal(err)
	}

	outboundIDs := make([]int64, 3)
	for index, mailboxID := range []any{mailboxIDs[0], mailboxIDs[2], nil} {
		if err := store.pool.QueryRow(ctx, `
			INSERT INTO outbound_messages (
				domain_id, mailbox_id, provider_message_id, from_address, to_addresses,
				subject, html_body, text_body, status, last_error, created_at, updated_at
			)
			VALUES ($1, $2, $3, $4, '["target@example.net"]'::jsonb,
				'Subject', '<p>body</p>', 'body', 'SENT', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
			RETURNING id
		`, domainID, mailboxID, fmt.Sprintf("provider-%d", index), "owned@"+domainName).Scan(&outboundIDs[index]); err != nil {
			t.Fatal(err)
		}
	}

	sent, err := store.ListMailboxPortalSentMessages(ctx, userID, mailboxIDs[0], 1, 20)
	if err != nil {
		t.Fatal(err)
	}
	sentList, ok := sent["list"].([]map[string]any)
	if !ok || sent["total"] != int64(1) || len(sentList) != 1 || sentList[0]["id"] != fmt.Sprint(outboundIDs[0]) {
		t.Fatalf("scoped sent history = %#v", sent)
	}
	detail, err := store.GetMailboxPortalSentMessage(ctx, outboundIDs[0], userID)
	htmlBody, htmlBodyOK := detail["htmlBody"].(*string)
	if err != nil || detail["id"] != fmt.Sprint(outboundIDs[0]) || !htmlBodyOK || htmlBody == nil || *htmlBody != "<p>body</p>" {
		t.Fatalf("scoped sent detail = %#v, %v", detail, err)
	}
	for _, forbiddenID := range outboundIDs[1:] {
		if _, err := store.GetMailboxPortalSentMessage(ctx, forbiddenID, userID); !errors.Is(err, errNotFound) {
			t.Fatalf("forbidden sent detail %d error = %v", forbiddenID, err)
		}
	}

	inboundIDs := make([]int64, 2)
	for index, mailboxID := range []int64{mailboxIDs[1], mailboxIDs[2]} {
		if err := store.pool.QueryRow(ctx, `
			INSERT INTO inbound_messages (
				domain_id, mailbox_id, matched_address, final_address, delivery_key,
				from_address, to_address, subject, received_at, storage_status,
				is_read, is_deleted, portal_state, created_at, updated_at
			)
			VALUES ($1, $2, $3, $3, $4, 'sender@example.net', $3, 'Forward subject',
				CURRENT_TIMESTAMP, 'STORED', FALSE, FALSE, 'VISIBLE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
			RETURNING id
		`, domainID, mailboxID, "inbox@"+domainName, fmt.Sprintf("portal-operation-%s-%d", suffix, index)).Scan(&inboundIDs[index]); err != nil {
			t.Fatal(err)
		}
		if _, err := store.pool.Exec(ctx, `
			INSERT INTO mailbox_forward_jobs (
				inbound_message_id, mailbox_id, mode, forward_to, status,
				attempt_count, next_attempt_at, created_at, updated_at
			)
			VALUES ($1, $2, 'COPY', 'target@example.net', 'PENDING', 0,
				CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		`, inboundIDs[index], mailboxID); err != nil {
			t.Fatal(err)
		}
	}
	jobs, err := store.ListMailboxPortalForwardingJobs(ctx, userID, nil, 1, 5)
	if err != nil {
		t.Fatal(err)
	}
	jobList, ok := jobs["list"].([]map[string]any)
	if !ok || jobs["total"] != int64(1) || len(jobList) != 1 ||
		jobList[0]["inboundMessage"].(map[string]any)["id"] != fmt.Sprint(inboundIDs[0]) {
		t.Fatalf("scoped forwarding jobs = %#v", jobs)
	}

	resolved, err := store.loadMailboxPortalSendConfig(ctx, userID, mailboxIDs[0], encryptionKey)
	if err != nil || resolved.DomainID != domainID || resolved.MailboxID == nil || *resolved.MailboxID != mailboxIDs[0] ||
		resolved.MailboxAddress != "owned@"+domainName || resolved.APIKey != "re_portal_fixture" || resolved.FromName != "Portal Fixture" {
		t.Fatalf("portal send config = %#v, %v", resolved, err)
	}
	if _, err := store.loadMailboxPortalSendConfig(ctx, userID, mailboxIDs[2], encryptionKey); !requestErrorMatches(err, http.StatusForbidden, "FORBIDDEN_MAILBOX") {
		t.Fatalf("forbidden portal send config error = %v", err)
	}
	scopedPendingID, err := store.createPendingOutboundMessage(
		ctx, domainID, &mailboxIDs[1], &userID, "member@"+domainName,
		[]string{"target@example.net"}, "Portal subject", "", "body",
	)
	if err != nil || scopedPendingID <= 0 {
		t.Fatalf("authorized portal pending message id=%d error=%v", scopedPendingID, err)
	}
	scopedSent, err := store.completeOutboundMessage(ctx, scopedPendingID, "portal-provider-fixture", "SENT", "")
	if err != nil || scopedSent["status"] != "SENT" || scopedSent["providerMessageId"].(*string) == nil ||
		*scopedSent["providerMessageId"].(*string) != "portal-provider-fixture" {
		t.Fatalf("authorized portal sent message = %#v, %v", scopedSent, err)
	}
	if _, err := store.pool.Exec(ctx, `UPDATE domains SET can_send = FALSE WHERE id = $1`, domainID); err != nil {
		t.Fatal(err)
	}
	mailboxes, err := store.ListMailboxPortalMailboxes(ctx, userID)
	if err != nil || len(mailboxes) != 2 || mailboxes[0]["sendReady"] != false || mailboxes[1]["sendReady"] != false {
		t.Fatalf("receive-only mailbox send readiness = %#v, %v", mailboxes, err)
	}
	if _, err := store.loadMailboxPortalSendConfig(ctx, userID, mailboxIDs[0], encryptionKey); !requestErrorMatches(err, http.StatusBadRequest, "DOMAIN_SEND_DISABLED") {
		t.Fatalf("disabled-domain portal send config error = %v", err)
	}
	if _, err := store.pool.Exec(ctx, `UPDATE domains SET can_send = TRUE WHERE id = $1`, domainID); err != nil {
		t.Fatal(err)
	}

	forwarded, err := store.UpdateMailboxPortalForwarding(ctx, userID, mailboxIDs[1], "MOVE", stringPointer(" target@example.net "))
	if err != nil || forwarded["forwardMode"] != "MOVE" || forwarded["forwardTo"] != "target@example.net" {
		t.Fatalf("forwarding update = %#v, %v", forwarded, err)
	}
	if _, err := store.pool.Exec(ctx, `DELETE FROM mailbox_memberships WHERE mailbox_id = $1 AND user_id = $2`, mailboxIDs[1], userID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.UpdateMailboxPortalForwarding(ctx, userID, mailboxIDs[1], "COPY", stringPointer("other@example.net")); !requestErrorMatches(err, http.StatusForbidden, "FORBIDDEN_MAILBOX") {
		t.Fatalf("revoked forwarding update error = %v", err)
	}
	if _, err := store.createPendingOutboundMessage(
		ctx, domainID, &mailboxIDs[1], &userID, "member@"+domainName,
		[]string{"target@example.net"}, "Subject", "", "body",
	); !requestErrorMatches(err, http.StatusForbidden, "FORBIDDEN_MAILBOX") {
		t.Fatalf("revoked portal pending message error = %v", err)
	}
	var mode, target string
	if err := store.pool.QueryRow(ctx, `SELECT forward_mode::text, forward_to FROM domain_mailboxes WHERE id = $1`, mailboxIDs[1]).Scan(&mode, &target); err != nil {
		t.Fatal(err)
	}
	if mode != "MOVE" || target != "target@example.net" {
		t.Fatalf("revoked forwarding mutation persisted mode=%q target=%q", mode, target)
	}
}

func requestErrorMatches(err error, status int, code string) bool {
	var requestErr *requestError
	return errors.As(err, &requestErr) && requestErr.Status == status && requestErr.Code == code
}
