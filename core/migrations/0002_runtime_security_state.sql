BEGIN;

CREATE TABLE IF NOT EXISTS runtime_oauth_states (
    state varchar(128) PRIMARY KEY,
    admin_id integer NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    provider varchar(50) NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS runtime_oauth_states_expiry_idx ON runtime_oauth_states (expires_at);

CREATE TABLE IF NOT EXISTS runtime_ingress_replays (
    replay_key varchar(255) PRIMARY KEY,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS runtime_ingress_replays_expiry_idx ON runtime_ingress_replays (expires_at);

CREATE TABLE IF NOT EXISTS runtime_rate_limits (
    bucket_key varchar(255) PRIMARY KEY,
    request_count integer NOT NULL DEFAULT 0,
    reset_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS runtime_rate_limits_reset_idx ON runtime_rate_limits (reset_at);

CREATE TABLE IF NOT EXISTS runtime_login_attempts (
    subject_key varchar(255) PRIMARY KEY,
    failure_count integer NOT NULL DEFAULT 0,
    window_started_at timestamptz NOT NULL DEFAULT now(),
    locked_until timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO runtime_migrations (name)
VALUES ('0002_runtime_security_state')
ON CONFLICT (name) DO NOTHING;

COMMIT;
