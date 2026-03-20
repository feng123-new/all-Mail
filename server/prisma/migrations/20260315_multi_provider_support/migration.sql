-- Multi-provider support: Outlook + Gmail + QQ
-- Adjust IF NOT EXISTS clauses if your Postgres version differs.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MailProvider') THEN
        CREATE TYPE "MailProvider" AS ENUM ('OUTLOOK', 'GMAIL', 'QQ');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MailAuthType') THEN
        CREATE TYPE "MailAuthType" AS ENUM ('MICROSOFT_OAUTH', 'GOOGLE_OAUTH', 'APP_PASSWORD');
    END IF;
END $$;

ALTER TABLE "email_accounts"
    ADD COLUMN IF NOT EXISTS "provider" "MailProvider" NOT NULL DEFAULT 'OUTLOOK',
    ADD COLUMN IF NOT EXISTS "auth_type" "MailAuthType" NOT NULL DEFAULT 'MICROSOFT_OAUTH',
    ADD COLUMN IF NOT EXISTS "provider_config" JSONB,
    ADD COLUMN IF NOT EXISTS "capabilities" JSONB;

ALTER TABLE "email_accounts"
    ALTER COLUMN "client_id" DROP NOT NULL,
    ALTER COLUMN "refresh_token" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "email_accounts_provider_idx" ON "email_accounts" ("provider");
CREATE INDEX IF NOT EXISTS "email_accounts_auth_type_idx" ON "email_accounts" ("auth_type");
