CREATE TABLE IF NOT EXISTS runtime_oauth_states (
    state varchar(128) PRIMARY KEY,
    admin_id integer NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    provider varchar(50) NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS runtime_oauth_states_expiry_idx
    ON runtime_oauth_states (expires_at);

CREATE TABLE IF NOT EXISTS runtime_ingress_replays (
    replay_key varchar(255) PRIMARY KEY,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS runtime_ingress_replays_expiry_idx
    ON runtime_ingress_replays (expires_at);

CREATE TABLE IF NOT EXISTS runtime_rate_limits (
    bucket_key varchar(255) PRIMARY KEY,
    request_count integer NOT NULL DEFAULT 0,
    reset_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS runtime_rate_limits_reset_idx
    ON runtime_rate_limits (reset_at);

CREATE TABLE IF NOT EXISTS runtime_login_attempts (
    subject_key varchar(255) PRIMARY KEY,
    failure_count integer NOT NULL DEFAULT 0,
    window_started_at timestamptz NOT NULL DEFAULT now(),
    locked_until timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now()
);

DO $allmail_0002$
DECLARE
    missing_columns text;
BEGIN
    SELECT string_agg(expected.table_name || '.' || expected.column_name, ', ' ORDER BY expected.table_name, expected.column_name)
    INTO missing_columns
    FROM (
        VALUES
            ('runtime_oauth_states', 'state'),
            ('runtime_oauth_states', 'admin_id'),
            ('runtime_oauth_states', 'provider'),
            ('runtime_oauth_states', 'payload'),
            ('runtime_oauth_states', 'expires_at'),
            ('runtime_oauth_states', 'consumed_at'),
            ('runtime_oauth_states', 'created_at'),
            ('runtime_ingress_replays', 'replay_key'),
            ('runtime_ingress_replays', 'expires_at'),
            ('runtime_ingress_replays', 'created_at'),
            ('runtime_rate_limits', 'bucket_key'),
            ('runtime_rate_limits', 'request_count'),
            ('runtime_rate_limits', 'reset_at'),
            ('runtime_rate_limits', 'updated_at'),
            ('runtime_login_attempts', 'subject_key'),
            ('runtime_login_attempts', 'failure_count'),
            ('runtime_login_attempts', 'window_started_at'),
            ('runtime_login_attempts', 'locked_until'),
            ('runtime_login_attempts', 'updated_at')
    ) AS expected(table_name, column_name)
    WHERE NOT EXISTS (
        SELECT 1
        FROM information_schema.columns actual
        WHERE actual.table_schema = current_schema()
          AND actual.table_name = expected.table_name
          AND actual.column_name = expected.column_name
    );

    IF missing_columns IS NOT NULL THEN
        RAISE EXCEPTION '0002 schema validation failed; missing columns: %', missing_columns;
    END IF;

    IF to_regclass('runtime_oauth_states_expiry_idx') IS NULL
       OR to_regclass('runtime_ingress_replays_expiry_idx') IS NULL
       OR to_regclass('runtime_rate_limits_reset_idx') IS NULL THEN
        RAISE EXCEPTION '0002 schema validation failed; one or more required indexes are missing';
    END IF;
END
$allmail_0002$;
