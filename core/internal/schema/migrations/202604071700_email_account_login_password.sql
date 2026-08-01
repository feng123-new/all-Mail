ALTER TABLE "email_accounts"
ADD COLUMN "account_login_password" VARCHAR(255);

UPDATE "email_accounts"
SET "account_login_password" = "password"
WHERE "account_login_password" IS NULL
  AND "auth_type" IN ('MICROSOFT_OAUTH', 'GOOGLE_OAUTH')
  AND "password" IS NOT NULL;

UPDATE "email_accounts"
SET "password" = NULL
WHERE "auth_type" IN ('MICROSOFT_OAUTH', 'GOOGLE_OAUTH')
  AND "account_login_password" IS NOT NULL;
