ALTER TABLE email_accounts
    ALTER COLUMN account_login_password TYPE text,
    ADD COLUMN gmail_totp_secret text,
    ADD COLUMN gmail_login_notes text;
