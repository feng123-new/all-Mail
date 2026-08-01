ALTER TABLE "domains"
    ADD COLUMN "send_approved" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "send_approved_at" TIMESTAMP(3),
    ADD COLUMN "send_approval_source" VARCHAR(50);

UPDATE "domains"
SET "send_approved" = true,
    "send_approved_at" = COALESCE("send_approved_at", CURRENT_TIMESTAMP),
    "send_approval_source" = COALESCE("send_approval_source", 'existing-can-send')
WHERE "can_send" = true;

ALTER TABLE "ingress_endpoints"
    ADD COLUMN "signing_secret_encrypted" TEXT;

ALTER TABLE "ingress_endpoints"
    ADD CONSTRAINT "ingress_endpoint_secret_requires_hash"
    CHECK ("signing_secret_encrypted" IS NULL OR "signing_key_hash" IS NOT NULL);
