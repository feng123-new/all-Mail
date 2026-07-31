DO $$
BEGIN
    IF to_regclass('provider_oauth_configs') IS NULL
       OR NOT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = current_schema() AND table_name = 'email_accounts' AND column_name = 'provider_config'
       ) THEN
        RETURN;
    END IF;

    EXECUTE $backfill$
        UPDATE email_accounts AS account
        SET provider_config = COALESCE(account.provider_config, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
            'oauthTenant', CASE
                WHEN COALESCE(account.provider_config->>'oauthTenant', '') = '' THEN NULLIF(oauth_config.tenant, '')
                ELSE NULL
            END,
            'oauthScopes', CASE
                WHEN COALESCE(account.provider_config->>'oauthScopes', '') = '' THEN NULLIF(oauth_config.scopes, '')
                ELSE NULL
            END
        ))
        FROM provider_oauth_configs AS oauth_config
        WHERE account.provider::text = oauth_config.provider::text
          AND account.auth_type::text IN ('MICROSOFT_OAUTH', 'GOOGLE_OAUTH')
          AND account.client_id = oauth_config.client_id
          AND (
              COALESCE(account.provider_config->>'oauthTenant', '') = ''
              OR COALESCE(account.provider_config->>'oauthScopes', '') = ''
          )
    $backfill$;
END
$$;
