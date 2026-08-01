ALTER TABLE "email_accounts"
    ADD COLUMN IF NOT EXISTS "mailbox_status" JSONB;
