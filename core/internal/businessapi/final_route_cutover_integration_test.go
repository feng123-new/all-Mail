package businessapi

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"
)

func TestPostgresAPIKeyAndExternalRouteIntegrationFinalRouteCutover(t *testing.T) {
	databaseURL := os.Getenv("ALLMAIL_GO_BUSINESS_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("ALLMAIL_GO_BUSINESS_TEST_DATABASE_URL is not configured")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	store, err := NewPostgresStore(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	var adminID, mailboxUserID, domainID int64
	if err := store.pool.QueryRow(ctx, `
		INSERT INTO admins (
			username, password_hash, role, status, must_change_password,
			two_factor_enabled, session_version, created_at, updated_at
		)
		VALUES ($1, 'fixture', 'SUPER_ADMIN', 'ACTIVE', FALSE, FALSE, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		RETURNING id
	`, "final-cutover-admin-"+suffix).Scan(&adminID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cleanupCancel()
		_, _ = store.pool.Exec(cleanupCtx, `
			UPDATE domains
			SET catch_all_target_mailbox_id = NULL
			WHERE created_by_admin_id = $1
		`, adminID)
		_, _ = store.pool.Exec(cleanupCtx, `DELETE FROM domains WHERE created_by_admin_id = $1`, adminID)
		_, _ = store.pool.Exec(cleanupCtx, `DELETE FROM mailbox_users WHERE username = $1`, "final-cutover-user-"+suffix)
		_, _ = store.pool.Exec(cleanupCtx, `DELETE FROM admins WHERE id = $1`, adminID)
	}()

	domainName := "final-cutover-" + suffix + ".example.test"
	domain, err := store.createManagedDomain(ctx, managedDomainCreateInput{
		Name: domainName, CanReceive: true, CanSend: true,
		VerificationToken: "final-cutover-verification-token", CreatedByAdminID: adminID,
	})
	if err != nil {
		t.Fatal(err)
	}
	var ok bool
	domainID, ok = domain["id"].(int64)
	if !ok || domainID <= 0 {
		t.Fatalf("created domain id = %#v", domain["id"])
	}
	active := "ACTIVE"
	displayName := "Final cutover fixture"
	updatedDomain, err := store.updateManagedDomain(ctx, domainID, managedDomainUpdateInput{
		DisplayName: &displayName, DisplayNamePresent: true, Status: &active, CanApproveSend: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if updatedDomain["status"] != "ACTIVE" || updatedDomain["displayName"] != displayName {
		t.Fatalf("updated domain = %#v", updatedDomain)
	}
	if _, err := store.configureManagedDomainVerification(ctx, domainID, "replacement-verification-token"); err != nil {
		t.Fatal(err)
	}

	if err := store.pool.QueryRow(ctx, `
		INSERT INTO mailbox_users (
			username, password_hash, status, must_change_password,
			two_factor_enabled, session_version, created_at, updated_at
		)
		VALUES ($1, 'fixture', 'ACTIVE', FALSE, FALSE, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		RETURNING id
	`, "final-cutover-user-"+suffix).Scan(&mailboxUserID); err != nil {
		t.Fatal(err)
	}
	var mailboxID int64
	if err := store.pool.QueryRow(ctx, `
		INSERT INTO domain_mailboxes (
			domain_id, local_part, address, status, provisioning_mode,
			can_login, owner_user_id, forward_mode, created_at, updated_at
		)
		VALUES ($1, 'portal', $2, 'ACTIVE', 'MANUAL', TRUE, $3, 'DISABLED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		RETURNING id
	`, domainID, "portal@"+domainName, mailboxUserID).Scan(&mailboxID); err != nil {
		t.Fatal(err)
	}
	catchAll, err := store.configureManagedDomainCatchAll(ctx, domainID, true, &mailboxID)
	if err != nil {
		t.Fatal(err)
	}
	if catchAll["catchAllTargetMailboxId"] != mailboxID {
		t.Fatalf("catch-all = %#v", catchAll)
	}

	encryptedKey := "fixture-encrypted-resend-key"
	fromName := "Final fixture"
	replyTo := "reply@" + domainName
	config, err := store.saveManagedDomainSendingConfig(ctx, domainID, managedDomainSendingConfigInput{
		Provider: "RESEND", EncryptedAPIKey: &encryptedKey,
		FromNameDefault: &fromName, FromNamePresent: true,
		ReplyToDefault: &replyTo, ReplyToPresent: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if config["provider"] != "RESEND" || config["replyToDefault"] != replyTo {
		t.Fatalf("sending config = %#v", config)
	}

	alias, err := store.createManagedDomainAlias(ctx, domainID, mailboxID, "alias")
	if err != nil {
		t.Fatal(err)
	}
	aliasID, ok := alias["id"].(int64)
	if !ok || aliasID <= 0 {
		t.Fatalf("created alias = %#v", alias)
	}
	aliases, err := store.listManagedDomainAliases(ctx, domainID, &mailboxID)
	if err != nil || len(aliases) != 1 {
		t.Fatalf("aliases = %#v, err=%v", aliases, err)
	}
	disabled := "DISABLED"
	if _, err := store.updateManagedDomainAlias(ctx, domainID, aliasID, &disabled); err != nil {
		t.Fatal(err)
	}

	var inboundID int64
	if err := store.pool.QueryRow(ctx, `
		INSERT INTO inbound_messages (
			domain_id, mailbox_id, matched_address, final_address, delivery_key,
			message_id_header, from_address, to_address, subject, text_preview,
			html_preview, verification_code, route_kind, received_at, storage_status,
			attachments_meta, headers_json, portal_state, created_at, updated_at
		)
		VALUES (
			$1, $2, $3, $3, $4, '<fixture@example.test>', 'sender@example.test', $3,
			'Final cutover inbound', 'verification code 483921', '<p>verification code 483921</p>',
			'483921', 'EXACT', CURRENT_TIMESTAMP, 'STORED',
			'[{"filename":"fixture.txt"}]'::jsonb, '{"x-fixture":"true"}'::jsonb,
			'VISIBLE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
		)
		RETURNING id
	`, domainID, mailboxID, "portal@"+domainName, "final-cutover-delivery-"+suffix).Scan(&inboundID); err != nil {
		t.Fatal(err)
	}
	var forwardingJobID int64
	if err := store.pool.QueryRow(ctx, `
		INSERT INTO mailbox_forward_jobs (
			inbound_message_id, mailbox_id, mode, forward_to, status,
			attempt_count, last_error, next_attempt_at, processed_at, created_at, updated_at
		)
		VALUES ($1, $2, 'COPY', 'forward@example.test', 'FAILED', 3, 'fixture failure', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		RETURNING id
	`, inboundID, mailboxID).Scan(&forwardingJobID); err != nil {
		t.Fatal(err)
	}
	var outboundID, unscopedOutboundID int64
	if err := store.pool.QueryRow(ctx, `
		INSERT INTO outbound_messages (
			domain_id, mailbox_id, provider_message_id, from_address, to_addresses,
			subject, html_body, text_body, status, created_at, updated_at
		)
		VALUES ($1, $2, 'provider-fixture', $3, '["recipient@example.test"]'::jsonb,
			'Final cutover outbound', '<p>sent</p>', 'sent', 'SENT', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		RETURNING id
	`, domainID, mailboxID, "portal@"+domainName).Scan(&outboundID); err != nil {
		t.Fatal(err)
	}
	if err := store.pool.QueryRow(ctx, `
		INSERT INTO outbound_messages (
			domain_id, mailbox_id, from_address, to_addresses, subject, status, created_at, updated_at
		)
		VALUES ($1, NULL, $2, '["recipient@example.test"]'::jsonb, 'Unscoped outbound', 'SENT', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		RETURNING id
	`, domainID, "admin@"+domainName).Scan(&unscopedOutboundID); err != nil {
		t.Fatal(err)
	}

	domains, err := store.listManagedDomains(ctx, 1, 20, suffix, "ACTIVE")
	if err != nil || domains["total"].(int64) < 1 {
		t.Fatalf("domain list = %#v, err=%v", domains, err)
	}
	if detail, err := store.getManagedDomain(ctx, domainID); err != nil || detail["name"] != domainName {
		t.Fatalf("domain detail = %#v, err=%v", detail, err)
	}

	messages, err := store.listManagedDomainMessages(ctx, managedDomainMessageListInput{
		Page: 1, PageSize: 20, DomainID: &domainID, MailboxID: &mailboxID, UnreadOnly: true,
	})
	if err != nil || messages["total"].(int64) != 1 {
		t.Fatalf("message list = %#v, err=%v", messages, err)
	}
	message, err := store.getManagedDomainMessage(ctx, inboundID)
	if err != nil || message["verificationCode"] != "483921" {
		t.Fatalf("message detail = %#v, err=%v", message, err)
	}

	jobs, err := store.listManagedForwardingJobs(ctx, managedForwardingJobListInput{
		Page: 1, PageSize: 20, Status: "FAILED", MailboxID: &mailboxID, DomainID: &domainID,
	})
	if err != nil || jobs["total"].(int64) != 1 {
		t.Fatalf("forwarding jobs = %#v, err=%v", jobs, err)
	}
	if job, err := store.getManagedForwardingJob(ctx, forwardingJobID); err != nil || job["status"] != "FAILED" {
		t.Fatalf("forwarding job detail = %#v, err=%v", job, err)
	}
	if requeued, err := store.requeueManagedForwardingJob(ctx, forwardingJobID); err != nil || requeued["status"] != "PENDING" {
		t.Fatalf("requeued job = %#v, err=%v", requeued, err)
	}

	sent, err := store.ListMailboxPortalSentMessages(ctx, MailboxPortalSentMessageListInput{
		MailboxUserID: mailboxUserID, MailboxID: mailboxID, Page: 1, PageSize: 20,
	})
	if err != nil || sent["total"].(int64) != 1 {
		t.Fatalf("portal sent list = %#v, err=%v", sent, err)
	}
	if sentMessage, err := store.GetMailboxPortalSentMessage(ctx, outboundID, mailboxUserID); err != nil || sentMessage["subject"] != "Final cutover outbound" {
		t.Fatalf("portal sent detail = %#v, err=%v", sentMessage, err)
	}
	if _, err := store.GetMailboxPortalSentMessage(ctx, unscopedOutboundID, mailboxUserID); err != errNotFound {
		t.Fatalf("unscoped outbound access error = %v", err)
	}
	portalJobs, err := store.ListMailboxPortalForwardingJobs(ctx, MailboxPortalForwardingJobListInput{
		MailboxUserID: mailboxUserID, MailboxID: &mailboxID, Page: 1, PageSize: 20,
	})
	if err != nil || portalJobs["total"].(int64) != 1 {
		t.Fatalf("portal forwarding jobs = %#v, err=%v", portalJobs, err)
	}
	forwardTarget := "new-forward@example.test"
	updatedMailbox, err := store.UpdateMailboxPortalForwarding(ctx, MailboxPortalForwardingUpdateInput{
		MailboxUserID: mailboxUserID, MailboxID: mailboxID, ForwardMode: "MOVE", ForwardTo: &forwardTarget,
	})
	if err != nil || updatedMailbox["forwardMode"] != "MOVE" || updatedMailbox["sendReady"] != true {
		t.Fatalf("portal forwarding update = %#v, err=%v", updatedMailbox, err)
	}
	if sendMailbox, err := store.GetMailboxPortalSendMailbox(ctx, mailboxUserID, mailboxID); err != nil || sendMailbox.DomainID != domainID {
		t.Fatalf("portal send mailbox = %#v, err=%v", sendMailbox, err)
	}

	deleted, err := store.deleteManagedDomainMessages(ctx, []int64{inboundID})
	if err != nil || deleted["deleted"].(int64) != 1 {
		t.Fatalf("message deletion = %#v, err=%v", deleted, err)
	}
	if err := store.deleteManagedDomainAlias(ctx, domainID, aliasID); err != nil {
		t.Fatal(err)
	}

	emptyDomain, err := store.createManagedDomain(ctx, managedDomainCreateInput{
		Name: "final-cutover-empty-" + suffix + ".example.test", CanReceive: true,
		VerificationToken: "empty-domain-verification-token", CreatedByAdminID: adminID,
	})
	if err != nil {
		t.Fatal(err)
	}
	emptyDomainID, ok := emptyDomain["id"].(int64)
	if !ok || emptyDomainID <= 0 {
		t.Fatalf("empty domain = %#v", emptyDomain)
	}
	if err := store.deleteManagedDomain(ctx, emptyDomainID); err != nil {
		t.Fatal(err)
	}
}
