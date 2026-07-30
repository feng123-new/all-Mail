DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "admins"
        WHERE "two_factor_enabled" = true
          AND "two_factor_secret" IS NULL
    ) THEN
        RAISE EXCEPTION 'Cannot enforce administrator 2FA integrity: enabled administrator has no persisted secret'
            USING ERRCODE = '23514';
    END IF;
END $$;

ALTER TABLE "admins"
ADD CONSTRAINT "admins_two_factor_secret_required"
CHECK ("two_factor_enabled" = false OR "two_factor_secret" IS NOT NULL);
