DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name = 'inbound_messages'
    ) THEN
        ALTER TABLE "inbound_messages"
            ADD COLUMN IF NOT EXISTS "delivery_key" VARCHAR(128);

        UPDATE "inbound_messages"
        SET "delivery_key" = md5(COALESCE("message_id_header", '') || ':' || COALESCE("final_address", '') || ':' || "id"::text)
        WHERE "delivery_key" IS NULL;

        ALTER TABLE "inbound_messages"
            ALTER COLUMN "delivery_key" SET NOT NULL;

        CREATE UNIQUE INDEX IF NOT EXISTS "inbound_messages_domain_id_delivery_key_key"
            ON "inbound_messages"("domain_id", "delivery_key");
    END IF;
END $$;
