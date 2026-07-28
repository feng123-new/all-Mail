CREATE TABLE IF NOT EXISTS runtime_heartbeats (
    runtime_name text PRIMARY KEY,
    instance_id text NOT NULL,
    metadata jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mailbox_sync_cursors (
    id bigserial PRIMARY KEY,
    email_account_id integer NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
    folder_key varchar(100) NOT NULL,
    provider varchar(50) NOT NULL,
    cursor_type varchar(50) NOT NULL,
    uid_validity bigint,
    last_uid bigint,
    highest_modseq bigint,
    gmail_history_id text,
    graph_delta_link text,
    generation integer NOT NULL DEFAULT 1,
    last_full_sync_at timestamptz,
    last_success_at timestamptz,
    last_error_kind varchar(64),
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (email_account_id, folder_key)
);

CREATE TABLE IF NOT EXISTS mailbox_sync_jobs (
    id bigserial PRIMARY KEY,
    email_account_id integer NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
    folder_key varchar(100) NOT NULL,
    status varchar(32) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'RUNNING', 'RETRY', 'SUCCEEDED', 'DEAD', 'CANCELED', 'SKIPPED')),
    priority integer NOT NULL DEFAULT 0,
    attempt_count integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    locked_by varchar(255),
    locked_until timestamptz,
    last_error_kind varchar(64),
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (email_account_id, folder_key)
);

CREATE INDEX IF NOT EXISTS mailbox_sync_jobs_claim_idx
    ON mailbox_sync_jobs (status, next_attempt_at, priority DESC, id);
CREATE INDEX IF NOT EXISTS mailbox_sync_jobs_lease_idx
    ON mailbox_sync_jobs (locked_until) WHERE locked_until IS NOT NULL;

CREATE TABLE IF NOT EXISTS outbound_delivery_jobs (
    id bigserial PRIMARY KEY,
    outbound_message_id bigint NOT NULL UNIQUE REFERENCES outbound_messages(id) ON DELETE CASCADE,
    status varchar(32) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'RUNNING', 'RETRY', 'SUCCEEDED', 'DEAD', 'CANCELED', 'SKIPPED')),
    idempotency_key varchar(255) NOT NULL UNIQUE,
    priority integer NOT NULL DEFAULT 0,
    attempt_count integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    locked_by varchar(255),
    locked_until timestamptz,
    last_error_kind varchar(64),
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outbound_delivery_jobs_claim_idx
    ON outbound_delivery_jobs (status, next_attempt_at, priority DESC, id);

CREATE TABLE IF NOT EXISTS job_attempts (
    id bigserial PRIMARY KEY,
    job_kind varchar(64) NOT NULL,
    job_id bigint NOT NULL,
    attempt_number integer NOT NULL,
    instance_id varchar(255),
    status varchar(32) NOT NULL,
    error_kind varchar(64),
    error_message text,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    metadata jsonb
);

CREATE INDEX IF NOT EXISTS job_attempts_job_idx
    ON job_attempts (job_kind, job_id, attempt_number DESC);

CREATE TABLE IF NOT EXISTS outbox_events (
    id bigserial PRIMARY KEY,
    aggregate_type varchar(100) NOT NULL,
    aggregate_id varchar(255) NOT NULL,
    event_type varchar(100) NOT NULL,
    payload jsonb NOT NULL,
    status varchar(32) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'RUNNING', 'RETRY', 'PUBLISHED', 'DEAD')),
    attempt_count integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    locked_by varchar(255),
    locked_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz
);

CREATE INDEX IF NOT EXISTS outbox_events_claim_idx
    ON outbox_events (status, next_attempt_at, id);

DO $allmail_0001$
DECLARE
    missing_columns text;
BEGIN
    SELECT string_agg(expected.table_name || '.' || expected.column_name, ', ' ORDER BY expected.table_name, expected.column_name)
    INTO missing_columns
    FROM (
        VALUES
            ('runtime_heartbeats', 'runtime_name'),
            ('runtime_heartbeats', 'instance_id'),
            ('runtime_heartbeats', 'updated_at'),
            ('mailbox_sync_cursors', 'id'),
            ('mailbox_sync_cursors', 'email_account_id'),
            ('mailbox_sync_cursors', 'folder_key'),
            ('mailbox_sync_cursors', 'cursor_type'),
            ('mailbox_sync_cursors', 'generation'),
            ('mailbox_sync_cursors', 'version'),
            ('mailbox_sync_jobs', 'id'),
            ('mailbox_sync_jobs', 'email_account_id'),
            ('mailbox_sync_jobs', 'folder_key'),
            ('mailbox_sync_jobs', 'status'),
            ('mailbox_sync_jobs', 'next_attempt_at'),
            ('mailbox_sync_jobs', 'locked_by'),
            ('mailbox_sync_jobs', 'locked_until'),
            ('outbound_delivery_jobs', 'id'),
            ('outbound_delivery_jobs', 'outbound_message_id'),
            ('outbound_delivery_jobs', 'idempotency_key'),
            ('outbound_delivery_jobs', 'status'),
            ('outbound_delivery_jobs', 'next_attempt_at'),
            ('job_attempts', 'id'),
            ('job_attempts', 'job_kind'),
            ('job_attempts', 'job_id'),
            ('job_attempts', 'attempt_number'),
            ('outbox_events', 'id'),
            ('outbox_events', 'aggregate_type'),
            ('outbox_events', 'aggregate_id'),
            ('outbox_events', 'event_type'),
            ('outbox_events', 'payload'),
            ('outbox_events', 'status')
    ) AS expected(table_name, column_name)
    WHERE NOT EXISTS (
        SELECT 1
        FROM information_schema.columns actual
        WHERE actual.table_schema = current_schema()
          AND actual.table_name = expected.table_name
          AND actual.column_name = expected.column_name
    );

    IF missing_columns IS NOT NULL THEN
        RAISE EXCEPTION '0001 schema validation failed; missing columns: %', missing_columns;
    END IF;

    IF to_regclass('mailbox_sync_jobs_claim_idx') IS NULL
       OR to_regclass('outbound_delivery_jobs_claim_idx') IS NULL
       OR to_regclass('job_attempts_job_idx') IS NULL
       OR to_regclass('outbox_events_claim_idx') IS NULL THEN
        RAISE EXCEPTION '0001 schema validation failed; one or more required indexes are missing';
    END IF;
END
$allmail_0001$;
