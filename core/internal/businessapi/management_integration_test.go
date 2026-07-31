package businessapi

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"
)

func TestPostgresAPIKeyAndExternalRouteIntegrationManagement(t *testing.T) {
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
	rootUsername := "management-root-" + suffix
	var rootAdminID int64
	if err := store.pool.QueryRow(ctx, `
		INSERT INTO admins (username, password_hash, role, status, must_change_password, two_factor_enabled, session_version, created_at, updated_at)
		VALUES ($1, 'fixture', 'SUPER_ADMIN', 'ACTIVE', FALSE, FALSE, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		RETURNING id
	`, rootUsername).Scan(&rootAdminID); err != nil {
		t.Fatal(err)
	}
	var domainID, emailID int64
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cleanupCancel()
		if domainID > 0 {
			_, _ = store.pool.Exec(cleanupCtx, `DELETE FROM domains WHERE id = $1`, domainID)
		}
		if emailID > 0 {
			_, _ = store.pool.Exec(cleanupCtx, `DELETE FROM email_accounts WHERE id = $1`, emailID)
		}
		_, _ = store.pool.Exec(cleanupCtx, `DELETE FROM email_groups WHERE name LIKE $1`, "management-group-"+suffix+"%")
		_, _ = store.pool.Exec(cleanupCtx, `DELETE FROM mailbox_users WHERE username LIKE $1`, "management-user-"+suffix+"%")
		_, _ = store.pool.Exec(cleanupCtx, `DELETE FROM admins WHERE username LIKE $1`, "management-%-"+suffix)
		_, _ = store.pool.Exec(cleanupCtx, `DELETE FROM admins WHERE id = $1`, rootAdminID)
	}()

	adminHash, err := hashManagementPassword("Management-Password-123!")
	if err != nil {
		t.Fatal(err)
	}
	createdAdmin, err := store.createManagedAdmin(ctx, "management-admin-"+suffix, adminHash, nil, "ADMIN")
	if err != nil {
		t.Fatal(err)
	}
	updatedRole := "SUPER_ADMIN"
	updatedStatus := "ACTIVE"
	updatedAdmin, err := store.updateManagedAdmin(ctx, createdAdmin.ID, updateAdminManagementRequest{
		Role: &updatedRole, Status: &updatedStatus,
	}, nil, false, nil)
	if err != nil {
		t.Fatal(err)
	}
	if updatedAdmin.Role != "SUPER_ADMIN" {
		t.Fatalf("updated administrator role = %q", updatedAdmin.Role)
	}
	if err := store.deleteManagedAdmin(ctx, createdAdmin.ID); err != nil {
		t.Fatal(err)
	}

	group, err := store.createManagedEmailGroup(ctx, "management-group-"+suffix, nil, "GRAPH_FIRST")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.pool.QueryRow(ctx, `
		INSERT INTO email_accounts (email, provider, auth_type, status, group_id, created_at, updated_at)
		VALUES ($1, 'GMAIL', 'GOOGLE_OAUTH', 'ACTIVE', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		RETURNING id
	`, "management-"+suffix+"@example.net").Scan(&emailID); err != nil {
		t.Fatal(err)
	}
	count, err := store.mutateManagedEmailGroupAssignments(ctx, group.ID, []int64{emailID}, true)
	if err != nil || count != 1 {
		t.Fatalf("assign group count=%d err=%v", count, err)
	}
	detail, err := store.getManagedEmailGroup(ctx, group.ID)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Count == nil {
		t.Fatal("group detail omitted count")
	}
	if err := store.deleteManagedEmailGroup(ctx, group.ID); err != nil {
		t.Fatal(err)
	}

	if err := store.pool.QueryRow(ctx, `
		INSERT INTO domains (name, status, can_receive, can_send, created_by_admin_id, created_at, updated_at)
		VALUES ($1, 'ACTIVE', TRUE, FALSE, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		RETURNING id
	`, "management-"+suffix+".example", rootAdminID).Scan(&domainID); err != nil {
		t.Fatal(err)
	}
	userHash, err := hashManagementPassword("Mailbox-Password-123!")
	if err != nil {
		t.Fatal(err)
	}
	mailboxUser, err := store.createManagedMailboxUser(ctx, "management-user-"+suffix, nil, userHash, nil)
	if err != nil {
		t.Fatal(err)
	}
	mailbox, err := store.createManagedDomainMailbox(ctx, managedDomainMailboxCreateInput{
		DomainID: domainID,
		LocalPart: "inbox",
		CanLogin: true,
		ProvisioningMode: "MANUAL",
		OwnerUserID: &mailboxUser.ID,
		MemberUserIDs: nil,
		ForwardMode: "DISABLED",
	})
	if err != nil {
		t.Fatal(err)
	}
	mailboxID, ok := mailbox["id"].(int64)
	if !ok || mailboxID <= 0 {
		t.Fatalf("mailbox id = %#v", mailbox["id"])
	}
	added, err := store.addManagedMailboxUserMailboxes(ctx, mailboxUser.ID, []int64{mailboxID})
	if err != nil {
		t.Fatal(err)
	}
	if added["totalAccessible"].(int64) != 1 {
		t.Fatalf("accessible mailbox count = %#v", added)
	}
	copyMode := "COPY"
	forwardTo := "target@example.net"
	updatedMailbox, err := store.updateManagedDomainMailbox(ctx, mailboxID, managedDomainMailboxUpdateInput{
		ForwardMode: &copyMode,
		ForwardToPresent: true,
		ForwardTo: &forwardTo,
	})
	if err != nil {
		t.Fatal(err)
	}
	if updatedMailbox["forwardMode"] != "COPY" {
		t.Fatalf("updated mailbox = %#v", updatedMailbox)
	}
	batchResult, err := store.batchCreateManagedDomainMailboxes(ctx, managedDomainMailboxBatchCreateInput{
		managedDomainMailboxCreateInput: managedDomainMailboxCreateInput{
			DomainID: domainID,
			CanLogin: false,
			ProvisioningMode: "API_POOL",
			ForwardMode: "DISABLED",
		},
		LocalParts: []string{"pool1", "pool2"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if batchResult["createdCount"].(int) != 2 {
		t.Fatalf("batch create result = %#v", batchResult)
	}
	mode := "API_POOL"
	deleted, err := store.batchDeleteManagedDomainMailboxes(ctx, managedDomainMailboxBatchDeleteInput{DomainID: &domainID, ProvisioningMode: &mode})
	if err != nil {
		t.Fatal(err)
	}
	if deleted["deletedCount"].(int) != 2 {
		t.Fatalf("batch delete result = %#v", deleted)
	}
	if err := store.deleteManagedDomainMailbox(ctx, mailboxID); err != nil {
		t.Fatal(err)
	}
	if err := store.deleteManagedMailboxUser(ctx, mailboxUser.ID); err != nil {
		t.Fatal(err)
	}
}
