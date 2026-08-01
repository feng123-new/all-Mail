-- Historical API keys treated NULL or an empty object as implicit full access.
-- Preserve those keys before both runtimes switch to fail-closed permission checks.
UPDATE api_keys
SET permissions = '{"all": true}'::jsonb,
    updated_at = CURRENT_TIMESTAMP
WHERE permissions IS NULL
   OR permissions = '{}'::jsonb;
