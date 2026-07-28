ALTER TABLE mailbox_forward_jobs
    ADD COLUMN IF NOT EXISTS claim_token varchar(64),
    ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz(3);

CREATE INDEX IF NOT EXISTS mailbox_forward_jobs_go_claim_idx
    ON mailbox_forward_jobs (status, next_attempt_at, lease_expires_at, created_at, id);

DO $allmail_0003$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'mailbox_forward_jobs'
          AND column_name = 'claim_token'
          AND data_type = 'character varying'
          AND character_maximum_length = 64
          AND is_nullable = 'YES'
    ) THEN
        RAISE EXCEPTION '0003 schema validation failed; mailbox_forward_jobs.claim_token is missing or malformed';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'mailbox_forward_jobs'
          AND column_name = 'lease_expires_at'
          AND data_type = 'timestamp with time zone'
          AND datetime_precision = 3
          AND is_nullable = 'YES'
    ) THEN
        RAISE EXCEPTION '0003 schema validation failed; mailbox_forward_jobs.lease_expires_at is missing or malformed';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = current_schema()
          AND indexname = 'mailbox_forward_jobs_go_claim_idx'
          AND indexdef LIKE '%(status, next_attempt_at, lease_expires_at, created_at, id)%'
    ) THEN
        RAISE EXCEPTION '0003 schema validation failed; mailbox_forward_jobs_go_claim_idx is missing or malformed';
    END IF;
END
$allmail_0003$;
