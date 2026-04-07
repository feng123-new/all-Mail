DO $$ BEGIN
    CREATE TYPE "PortalState" AS ENUM ('VISIBLE', 'FORWARDED_HIDDEN');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "ForwardJobStatus" AS ENUM ('PENDING', 'RUNNING', 'SENT', 'FAILED', 'SKIPPED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "inbound_messages"
    ADD COLUMN IF NOT EXISTS "portal_state" "PortalState" NOT NULL DEFAULT 'VISIBLE';

CREATE TABLE IF NOT EXISTS "mailbox_forward_jobs" (
    "id" BIGSERIAL NOT NULL,
    "inbound_message_id" BIGINT NOT NULL,
    "mailbox_id" INTEGER,
    "mode" "ForwardMode" NOT NULL,
    "forward_to" VARCHAR(255) NOT NULL,
    "status" "ForwardJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "provider_message_id" VARCHAR(255),
    "next_attempt_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mailbox_forward_jobs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mailbox_forward_jobs_inbound_message_id_fkey"
        FOREIGN KEY ("inbound_message_id") REFERENCES "inbound_messages"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "mailbox_forward_jobs_mailbox_id_fkey"
        FOREIGN KEY ("mailbox_id") REFERENCES "domain_mailboxes"("id")
        ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "mailbox_forward_jobs_inbound_message_id_key"
    ON "mailbox_forward_jobs"("inbound_message_id");

CREATE INDEX IF NOT EXISTS "mailbox_forward_jobs_status_next_attempt_at_created_at_idx"
    ON "mailbox_forward_jobs"("status", "next_attempt_at", "created_at");

CREATE INDEX IF NOT EXISTS "mailbox_forward_jobs_mailbox_id_status_next_attempt_at_idx"
    ON "mailbox_forward_jobs"("mailbox_id", "status", "next_attempt_at");
