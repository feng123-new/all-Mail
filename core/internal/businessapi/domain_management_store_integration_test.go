package businessapi

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/feng123-new/all-Mail/core/internal/legacycrypto"
)

func TestPostgresDomainManagementLifecycleAndEncryptedConfigs(t *testing.T) {
	databaseURL := os.Getenv("ALLMAIL_GO_BUSINESS_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("ALLMAIL_GO_BUSINESS_TEST_DATABASE_URL is not configured")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	store, err := NewPostgresStore(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	const encryptionKey = "test-encryption-key-1234567890ab"
	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	domainName := "go-domain-" + suffix + ".example.com"
	var adminID, domainID int64
	if err := store.pool.QueryRow(ctx, `
		INSERT INTO admins (username, password_hash, role, status, must_change_password, two_factor_enabled, session_version, created_at, updated_at)
		VALUES ($1, 'fixture', 'SUPER_ADMIN', 'ACTIVE', FALSE, FALSE, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		RETURNING id
	`, "go-domain-admin-"+suffix).Scan(&adminID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cleanupCancel()
		if domainID > 0 {
			_, _ = store.pool.Exec(cleanupCtx, `DELETE FROM domains WHERE id = $1`, domainID)
		}
		_, _ = store.pool.Exec(cleanupCtx, `DELETE FROM admins WHERE id = $1`, adminID)
	}()

	_, err = store.CreateDomain(ctx, domainCreateInput{Name: "blocked-" + domainName, CanReceive: true, CanSend: true}, adminID, false)
	requestErr, ok := err.(*requestError)
	if !ok || requestErr.Code != "DOMAIN_SEND_APPROVAL_REQUIRED" {
		t.Fatalf("unapproved create error = %#v", err)
	}
	var blockedCount int64
	if err := store.pool.QueryRow(ctx, `SELECT COUNT(*)::bigint FROM domains WHERE name = $1`, "blocked-"+domainName).Scan(&blockedCount); err != nil || blockedCount != 0 {
		t.Fatalf("unapproved domain count = %d, %v", blockedCount, err)
	}

	created, err := store.CreateDomain(ctx, domainCreateInput{
		Name: domainName, CanReceive: true, CanSend: true, IsCatchAllEnabled: false,
	}, adminID, true)
	if err != nil {
		t.Fatal(err)
	}
	domainID = created.ID
	if created.Name != domainName || created.Status != "PENDING" || created.VerificationToken == nil || len(*created.VerificationToken) != 24 || !created.CanSend {
		t.Fatalf("created domain = %#v", created)
	}
	var sendApproved bool
	var approvalSource *string
	if err := store.pool.QueryRow(ctx, `SELECT send_approved, send_approval_source FROM domains WHERE id = $1`, domainID).Scan(&sendApproved, &approvalSource); err != nil || !sendApproved || approvalSource == nil || *approvalSource != "super-admin-create" {
		t.Fatalf("send approval = %v %v, %v", sendApproved, approvalSource, err)
	}

	list, err := store.ListDomains(ctx, domainListInput{Page: 1, PageSize: 20, Keyword: suffix})
	if err != nil || list.Total != 1 || len(list.List) != 1 || list.List[0].ID != domainID {
		t.Fatalf("domain list = %#v, %v", list, err)
	}
	displayName := "Go managed domain"
	active := "ACTIVE"
	updated, err := store.UpdateDomain(ctx, domainID, domainUpdateInput{
		DisplayNamePresent: true, DisplayName: &displayName, Status: &active,
	}, true)
	if err != nil || updated.DisplayName == nil || *updated.DisplayName != displayName || updated.Status != active {
		t.Fatalf("updated domain = %#v, %v", updated, err)
	}

	verificationToken := "verification-token-123"
	verification, err := store.ConfigureDomainVerification(ctx, domainID, &verificationToken)
	if err != nil || verification.VerificationToken != verificationToken {
		t.Fatalf("verification = %#v, %v", verification, err)
	}
	cloudflareToken := "cloudflare-token-1234567890"
	zoneID := "zone_12345678"
	cloudflareConfig, err := store.SaveDomainCloudflareConfig(ctx, domainID, domainCloudflareConfigInput{
		APITokenPresent: true, APIToken: &cloudflareToken, ZoneIDPresent: true, ZoneID: &zoneID,
	}, encryptionKey)
	if err != nil || !cloudflareConfig.CloudflareValidation.HasSavedToken || cloudflareConfig.CloudflareValidation.ZoneID == nil || *cloudflareConfig.CloudflareValidation.ZoneID != zoneID {
		t.Fatalf("Cloudflare config = %#v, %v", cloudflareConfig, err)
	}
	var rawDNS []byte
	if err := store.pool.QueryRow(ctx, `SELECT dns_status FROM domains WHERE id = $1`, domainID).Scan(&rawDNS); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(rawDNS), cloudflareToken) {
		t.Fatalf("dns_status exposed plaintext token: %s", rawDNS)
	}
	var persisted domainDNSStatus
	if err := json.Unmarshal(rawDNS, &persisted); err != nil || persisted.Cloudflare == nil || persisted.Cloudflare.APITokenEncrypted == nil {
		t.Fatalf("persisted DNS status = %#v, %v", persisted, err)
	}
	decryptedToken, err := legacycrypto.Decrypt(encryptionKey, *persisted.Cloudflare.APITokenEncrypted)
	if err != nil || decryptedToken != cloudflareToken {
		t.Fatalf("decrypted Cloudflare token = %q, %v", decryptedToken, err)
	}
	validationTarget, err := store.LoadDomainCloudflareValidation(ctx, domainID, encryptionKey)
	if err != nil {
		t.Fatal(err)
	}
	replacementZoneID := "zone_87654321"
	if _, err := store.SaveDomainCloudflareConfig(ctx, domainID, domainCloudflareConfigInput{ZoneIDPresent: true, ZoneID: &replacementZoneID}, encryptionKey); err != nil {
		t.Fatal(err)
	}
	validationZoneID := zoneID
	_, err = store.SaveDomainCloudflareValidation(ctx, domainID, validationTarget.ConfigFingerprint, domainCloudflareValidationResult{
		Status: "pass", ZoneID: &validationZoneID, LastValidatedAt: "2026-08-01T12:00:00.000Z",
		Checks: []domainCloudflareValidationCheck{}, ManualActions: []string{},
	})
	requestErr, ok = err.(*requestError)
	if !ok || requestErr.Code != "CLOUDFLARE_CONFIG_CHANGED" || requestErr.Status != 409 {
		t.Fatalf("stale Cloudflare validation error = %#v", err)
	}
	if _, err := store.SaveDomainCloudflareConfig(ctx, domainID, domainCloudflareConfigInput{ZoneIDPresent: true, ZoneID: &zoneID}, encryptionKey); err != nil {
		t.Fatal(err)
	}

	var mailboxID int64
	if err := store.pool.QueryRow(ctx, `
		INSERT INTO domain_mailboxes (
			domain_id, local_part, address, status, provisioning_mode, can_login, is_catch_all_target,
			forward_mode, created_at, updated_at
		)
		VALUES ($1, 'inbox', $2, 'ACTIVE', 'MANUAL', TRUE, FALSE, 'DISABLED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		RETURNING id
	`, domainID, "inbox@"+domainName).Scan(&mailboxID); err != nil {
		t.Fatal(err)
	}
	catchAll, err := store.ConfigureDomainCatchAll(ctx, domainID, domainCatchAllInput{IsCatchAllEnabled: true, CatchAllTargetMailboxID: &mailboxID})
	if err != nil || !catchAll.IsCatchAllEnabled || catchAll.CatchAllTargetMailboxID == nil || *catchAll.CatchAllTargetMailboxID != mailboxID {
		t.Fatalf("catch-all = %#v, %v", catchAll, err)
	}

	resendKey := "resend-api-key-123456"
	fromName := "Operations"
	replyTo := "reply@example.com"
	sending, err := store.SaveDomainSendingConfig(ctx, domainID, domainSendingConfigInput{
		Provider: "RESEND", APIKeyPresent: true, APIKey: &resendKey,
		FromNamePresent: true, FromNameDefault: &fromName, ReplyToPresent: true, ReplyToDefault: &replyTo,
	}, encryptionKey)
	if err != nil || sending.Provider != "RESEND" || sending.Status != "ACTIVE" {
		t.Fatalf("sending config = %#v, %v", sending, err)
	}
	var encryptedResendKey string
	if err := store.pool.QueryRow(ctx, `SELECT api_key_encrypted FROM domain_sending_configs WHERE domain_id = $1`, domainID).Scan(&encryptedResendKey); err != nil {
		t.Fatal(err)
	}
	decryptedResendKey, err := legacycrypto.Decrypt(encryptionKey, encryptedResendKey)
	if err != nil || decryptedResendKey != resendKey {
		t.Fatalf("decrypted Resend key = %q, %v", decryptedResendKey, err)
	}

	alias, err := store.CreateDomainAlias(ctx, domainID, domainAliasCreateInput{MailboxID: mailboxID, AliasLocalPart: "sales"})
	if err != nil || alias.AliasAddress != "sales@"+domainName || alias.Status != "ACTIVE" {
		t.Fatalf("created alias = %#v, %v", alias, err)
	}
	aliases, err := store.ListDomainAliases(ctx, domainID, &mailboxID)
	if err != nil || len(aliases) != 1 || aliases[0].Mailbox == nil || aliases[0].Mailbox.ID != mailboxID {
		t.Fatalf("aliases = %#v, %v", aliases, err)
	}
	disabled := "DISABLED"
	alias, err = store.UpdateDomainAlias(ctx, domainID, alias.ID, &disabled)
	if err != nil || alias.Status != disabled {
		t.Fatalf("updated alias = %#v, %v", alias, err)
	}
	if err := store.DeleteDomainAlias(ctx, domainID, alias.ID); err != nil {
		t.Fatal(err)
	}

	detail, err := store.GetDomain(ctx, domainID)
	if err != nil || len(detail.Mailboxes) != 1 || len(detail.SendingConfigs) != 1 || !detail.CloudflareValidation.HasSavedToken {
		t.Fatalf("domain detail = %#v, %v", detail, err)
	}
	if err := store.DeleteDomain(ctx, domainID); err == nil {
		t.Fatal("deleted a domain that still had a mailbox")
	} else if requestErr, ok := err.(*requestError); !ok || requestErr.Code != "DOMAIN_NOT_EMPTY" {
		t.Fatalf("non-empty deletion error = %#v", err)
	}
	if err := store.deleteManagedDomainMailbox(ctx, mailboxID); err != nil {
		t.Fatal(err)
	}
	if err := store.DeleteDomain(ctx, domainID); err != nil {
		t.Fatal(err)
	}
	domainID = 0
}
