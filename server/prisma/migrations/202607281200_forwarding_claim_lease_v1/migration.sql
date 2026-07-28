ALTER TABLE mailbox_forward_jobs
    ADD COLUMN IF NOT EXISTS claim_token VARCHAR(64),
    ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ(3);

CREATE INDEX IF NOT EXISTS mailbox_forward_jobs_go_claim_idx
    ON mailbox_forward_jobs (status, next_attempt_at, lease_expires_at, created_at, id);
