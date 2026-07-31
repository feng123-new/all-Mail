UPDATE email_accounts AS account
SET provider_config = COALESCE(account.provider_config, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
    'oauthTenant', CASE
        WHEN COALESCE(account.provider_config->>'oauthTenant', '') = '' THEN NULLIF(provider_config.tenant, '')
        ELSE NULL
    END,
    'oauthScopes', CASE
        WHEN COALESCE(account.provider_config->>'oauthScopes', '') = '' THEN NULLIF(provider_config.scopes, '')
        ELSE NULL
    END
))
FROM provider_oauth_configs AS provider_config
WHERE account.provider = provider_config.provider
  AND account.auth_type IN ('MICROSOFT_OAUTH'::"MailAuthType", 'GOOGLE_OAUTH'::"MailAuthType")
  AND account.client_id = provider_config.client_id
  AND (
      COALESCE(account.provider_config->>'oauthTenant', '') = ''
      OR COALESCE(account.provider_config->>'oauthScopes', '') = ''
  );
