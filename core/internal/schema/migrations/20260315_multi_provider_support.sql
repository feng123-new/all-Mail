CREATE SCHEMA IF NOT EXISTS "public";

CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'ADMIN');
CREATE TYPE "Status" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "DomainStatus" AS ENUM ('PENDING', 'ACTIVE', 'DISABLED', 'ERROR');
CREATE TYPE "MailboxUserStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "MailboxRole" AS ENUM ('OWNER', 'MEMBER', 'VIEWER');
CREATE TYPE "DomainMailboxStatus" AS ENUM ('ACTIVE', 'DISABLED', 'SUSPENDED');
CREATE TYPE "DomainMailboxProvisioningMode" AS ENUM ('MANUAL', 'API_POOL');
CREATE TYPE "ForwardMode" AS ENUM ('DISABLED', 'COPY', 'MOVE');
CREATE TYPE "MessageStorageStatus" AS ENUM ('PENDING', 'STORED', 'FAILED');
CREATE TYPE "SendStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'CANCELED');
CREATE TYPE "EmailStatus" AS ENUM ('ACTIVE', 'ERROR', 'DISABLED');
CREATE TYPE "MailFetchStrategy" AS ENUM ('GRAPH_FIRST', 'IMAP_FIRST', 'GRAPH_ONLY', 'IMAP_ONLY');
CREATE TYPE "MailProvider" AS ENUM ('OUTLOOK', 'GMAIL', 'QQ');
CREATE TYPE "MailAuthType" AS ENUM ('MICROSOFT_OAUTH', 'GOOGLE_OAUTH', 'APP_PASSWORD');
CREATE TYPE "SendProvider" AS ENUM ('RESEND');

CREATE TABLE "admins" (
    "id" SERIAL NOT NULL,
    "username" VARCHAR(50) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "email" VARCHAR(100),
    "role" "Role" NOT NULL DEFAULT 'ADMIN',
    "status" "Status" NOT NULL DEFAULT 'ACTIVE',
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false,
    "two_factor_secret" TEXT,
    "two_factor_temp_secret" TEXT,
    "last_login_at" TIMESTAMP(3),
    "last_login_ip" VARCHAR(45),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "api_keys" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "key_hash" VARCHAR(64) NOT NULL,
    "key_prefix" VARCHAR(8) NOT NULL,
    "permissions" JSONB,
    "allowed_group_ids" JSONB,
    "allowed_email_ids" JSONB,
    "allowed_domain_ids" JSONB,
    "rate_limit" INTEGER NOT NULL DEFAULT 60,
    "status" "Status" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "usage_count" BIGINT NOT NULL DEFAULT 0,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "provider_oauth_configs" (
    "id" SERIAL NOT NULL,
    "provider" "MailProvider" NOT NULL,
    "client_id" VARCHAR(255),
    "client_secret" TEXT,
    "redirect_uri" TEXT,
    "scopes" TEXT,
    "tenant" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_oauth_configs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "email_groups" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "description" VARCHAR(255),
    "fetch_strategy" "MailFetchStrategy" NOT NULL DEFAULT 'GRAPH_FIRST',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_groups_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "email_accounts" (
    "id" SERIAL NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "provider" "MailProvider" NOT NULL DEFAULT 'OUTLOOK',
    "auth_type" "MailAuthType" NOT NULL DEFAULT 'MICROSOFT_OAUTH',
    "provider_config" JSONB,
    "capabilities" JSONB,
    "client_id" VARCHAR(255),
    "password" VARCHAR(255),
    "refresh_token" TEXT,
    "client_secret" TEXT,
    "status" "EmailStatus" NOT NULL DEFAULT 'ACTIVE',
    "group_id" INTEGER,
    "last_check_at" TIMESTAMP(3),
    "mailbox_status" JSONB,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "email_usage" (
    "id" SERIAL NOT NULL,
    "api_key_id" INTEGER NOT NULL,
    "email_account_id" INTEGER NOT NULL,
    "used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_usage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "api_logs" (
    "id" BIGSERIAL NOT NULL,
    "api_key_id" INTEGER,
    "email_account_id" INTEGER,
    "action" VARCHAR(50) NOT NULL,
    "request_ip" VARCHAR(45),
    "response_code" INTEGER,
    "response_time_ms" INTEGER,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "domains" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "display_name" VARCHAR(255),
    "status" "DomainStatus" NOT NULL DEFAULT 'PENDING',
    "provider" VARCHAR(50) NOT NULL DEFAULT 'CLOUDFLARE',
    "can_receive" BOOLEAN NOT NULL DEFAULT true,
    "can_send" BOOLEAN NOT NULL DEFAULT false,
    "is_catch_all_enabled" BOOLEAN NOT NULL DEFAULT false,
    "catch_all_target_mailbox_id" INTEGER,
    "verification_token" VARCHAR(255),
    "dns_status" JSONB,
    "resend_domain_id" VARCHAR(255),
    "created_by_admin_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "domains_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "domain_sending_configs" (
    "id" SERIAL NOT NULL,
    "domain_id" INTEGER NOT NULL,
    "provider" "SendProvider" NOT NULL DEFAULT 'RESEND',
    "api_key_encrypted" TEXT NOT NULL,
    "from_name_default" VARCHAR(255),
    "reply_to_default" VARCHAR(255),
    "status" "Status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "domain_sending_configs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mailbox_users" (
    "id" SERIAL NOT NULL,
    "username" VARCHAR(100) NOT NULL,
    "email" VARCHAR(255),
    "password_hash" VARCHAR(255) NOT NULL,
    "status" "MailboxUserStatus" NOT NULL DEFAULT 'ACTIVE',
    "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false,
    "two_factor_secret" TEXT,
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "last_login_ip" VARCHAR(45),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mailbox_users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "domain_mailboxes" (
    "id" SERIAL NOT NULL,
    "domain_id" INTEGER NOT NULL,
    "local_part" VARCHAR(255) NOT NULL,
    "address" VARCHAR(255) NOT NULL,
    "display_name" VARCHAR(255),
    "status" "DomainMailboxStatus" NOT NULL DEFAULT 'ACTIVE',
    "provisioning_mode" "DomainMailboxProvisioningMode" NOT NULL DEFAULT 'MANUAL',
    "batch_tag" VARCHAR(100),
    "quota_mb" INTEGER,
    "password_hash" VARCHAR(255),
    "can_login" BOOLEAN NOT NULL DEFAULT true,
    "is_catch_all_target" BOOLEAN NOT NULL DEFAULT false,
    "owner_user_id" INTEGER,
    "forward_mode" "ForwardMode" NOT NULL DEFAULT 'DISABLED',
    "forward_to" VARCHAR(255),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "domain_mailboxes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "domain_mailbox_usage" (
    "id" SERIAL NOT NULL,
    "api_key_id" INTEGER NOT NULL,
    "domain_mailbox_id" INTEGER NOT NULL,
    "used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "domain_mailbox_usage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mailbox_memberships" (
    "id" SERIAL NOT NULL,
    "mailbox_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "role" "MailboxRole" NOT NULL DEFAULT 'MEMBER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mailbox_memberships_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mailbox_aliases" (
    "id" SERIAL NOT NULL,
    "mailbox_id" INTEGER NOT NULL,
    "domain_id" INTEGER NOT NULL,
    "alias_local_part" VARCHAR(255) NOT NULL,
    "alias_address" VARCHAR(255) NOT NULL,
    "status" "Status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mailbox_aliases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ingress_endpoints" (
    "id" SERIAL NOT NULL,
    "domain_id" INTEGER,
    "key_id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "provider" VARCHAR(50) NOT NULL DEFAULT 'CLOUDFLARE_WORKER',
    "signing_key_hash" VARCHAR(64),
    "status" "Status" NOT NULL DEFAULT 'ACTIVE',
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ingress_endpoints_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inbound_messages" (
    "id" BIGSERIAL NOT NULL,
    "domain_id" INTEGER NOT NULL,
    "mailbox_id" INTEGER,
    "matched_address" VARCHAR(255) NOT NULL,
    "final_address" VARCHAR(255) NOT NULL,
    "message_id_header" VARCHAR(255),
    "from_address" VARCHAR(255) NOT NULL,
    "to_address" VARCHAR(255) NOT NULL,
    "subject" VARCHAR(500),
    "text_preview" TEXT,
    "html_preview" TEXT,
    "verification_code" VARCHAR(32),
    "route_kind" VARCHAR(50),
    "received_at" TIMESTAMP(3) NOT NULL,
    "storage_status" "MessageStorageStatus" NOT NULL DEFAULT 'PENDING',
    "raw_object_key" VARCHAR(500),
    "attachments_meta" JSONB,
    "headers_json" JSONB,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inbound_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "outbound_messages" (
    "id" BIGSERIAL NOT NULL,
    "domain_id" INTEGER NOT NULL,
    "mailbox_id" INTEGER,
    "provider_message_id" VARCHAR(255),
    "from_address" VARCHAR(255) NOT NULL,
    "to_addresses" JSONB NOT NULL,
    "subject" VARCHAR(500),
    "html_body" TEXT,
    "text_body" TEXT,
    "status" "SendStatus" NOT NULL DEFAULT 'PENDING',
    "scheduled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbound_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admins_username_key" ON "admins"("username");
CREATE UNIQUE INDEX "admins_email_key" ON "admins"("email");
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");
CREATE UNIQUE INDEX "provider_oauth_configs_provider_key" ON "provider_oauth_configs"("provider");
CREATE UNIQUE INDEX "email_groups_name_key" ON "email_groups"("name");
CREATE UNIQUE INDEX "email_accounts_email_key" ON "email_accounts"("email");
CREATE INDEX "email_accounts_provider_idx" ON "email_accounts"("provider");
CREATE INDEX "email_accounts_auth_type_idx" ON "email_accounts"("auth_type");
CREATE UNIQUE INDEX "email_usage_api_key_id_email_account_id_key" ON "email_usage"("api_key_id", "email_account_id");
CREATE INDEX "api_logs_api_key_id_idx" ON "api_logs"("api_key_id");
CREATE INDEX "api_logs_email_account_id_idx" ON "api_logs"("email_account_id");
CREATE INDEX "api_logs_created_at_idx" ON "api_logs"("created_at");
CREATE INDEX "api_logs_action_created_at_idx" ON "api_logs"("action", "created_at");
CREATE UNIQUE INDEX "domains_name_key" ON "domains"("name");
CREATE INDEX "domains_status_idx" ON "domains"("status");
CREATE UNIQUE INDEX "domain_sending_configs_domain_id_provider_key" ON "domain_sending_configs"("domain_id", "provider");
CREATE UNIQUE INDEX "mailbox_users_username_key" ON "mailbox_users"("username");
CREATE UNIQUE INDEX "mailbox_users_email_key" ON "mailbox_users"("email");
CREATE UNIQUE INDEX "domain_mailboxes_address_key" ON "domain_mailboxes"("address");
CREATE INDEX "domain_mailboxes_owner_user_id_idx" ON "domain_mailboxes"("owner_user_id");
CREATE INDEX "domain_mailboxes_domain_id_provisioning_mode_idx" ON "domain_mailboxes"("domain_id", "provisioning_mode");
CREATE INDEX "domain_mailboxes_domain_id_batch_tag_idx" ON "domain_mailboxes"("domain_id", "batch_tag");
CREATE UNIQUE INDEX "domain_mailboxes_domain_id_local_part_key" ON "domain_mailboxes"("domain_id", "local_part");
CREATE UNIQUE INDEX "domain_mailbox_usage_api_key_id_domain_mailbox_id_key" ON "domain_mailbox_usage"("api_key_id", "domain_mailbox_id");
CREATE UNIQUE INDEX "mailbox_memberships_mailbox_id_user_id_key" ON "mailbox_memberships"("mailbox_id", "user_id");
CREATE UNIQUE INDEX "mailbox_aliases_alias_address_key" ON "mailbox_aliases"("alias_address");
CREATE UNIQUE INDEX "mailbox_aliases_domain_id_alias_local_part_key" ON "mailbox_aliases"("domain_id", "alias_local_part");
CREATE UNIQUE INDEX "ingress_endpoints_key_id_key" ON "ingress_endpoints"("key_id");
CREATE INDEX "inbound_messages_domain_id_received_at_idx" ON "inbound_messages"("domain_id", "received_at");
CREATE INDEX "inbound_messages_mailbox_id_received_at_idx" ON "inbound_messages"("mailbox_id", "received_at");
CREATE INDEX "outbound_messages_domain_id_created_at_idx" ON "outbound_messages"("domain_id", "created_at");

ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "email_accounts" ADD CONSTRAINT "email_accounts_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "email_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "email_usage" ADD CONSTRAINT "email_usage_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "email_usage" ADD CONSTRAINT "email_usage_email_account_id_fkey" FOREIGN KEY ("email_account_id") REFERENCES "email_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "api_logs" ADD CONSTRAINT "api_logs_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "api_logs" ADD CONSTRAINT "api_logs_email_account_id_fkey" FOREIGN KEY ("email_account_id") REFERENCES "email_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "domains" ADD CONSTRAINT "domains_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "domain_sending_configs" ADD CONSTRAINT "domain_sending_configs_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "domain_mailboxes" ADD CONSTRAINT "domain_mailboxes_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "domain_mailboxes" ADD CONSTRAINT "domain_mailboxes_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "mailbox_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "domain_mailbox_usage" ADD CONSTRAINT "domain_mailbox_usage_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "domain_mailbox_usage" ADD CONSTRAINT "domain_mailbox_usage_domain_mailbox_id_fkey" FOREIGN KEY ("domain_mailbox_id") REFERENCES "domain_mailboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mailbox_memberships" ADD CONSTRAINT "mailbox_memberships_mailbox_id_fkey" FOREIGN KEY ("mailbox_id") REFERENCES "domain_mailboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mailbox_memberships" ADD CONSTRAINT "mailbox_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "mailbox_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mailbox_aliases" ADD CONSTRAINT "mailbox_aliases_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mailbox_aliases" ADD CONSTRAINT "mailbox_aliases_mailbox_id_fkey" FOREIGN KEY ("mailbox_id") REFERENCES "domain_mailboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ingress_endpoints" ADD CONSTRAINT "ingress_endpoints_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_mailbox_id_fkey" FOREIGN KEY ("mailbox_id") REFERENCES "domain_mailboxes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_mailbox_id_fkey" FOREIGN KEY ("mailbox_id") REFERENCES "domain_mailboxes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
