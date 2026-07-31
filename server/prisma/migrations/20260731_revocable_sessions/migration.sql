ALTER TABLE admins
ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE mailbox_users
ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE admins
DROP CONSTRAINT IF EXISTS admins_session_version_positive;
ALTER TABLE admins
ADD CONSTRAINT admins_session_version_positive CHECK (session_version > 0);

ALTER TABLE mailbox_users
DROP CONSTRAINT IF EXISTS mailbox_users_session_version_positive;
ALTER TABLE mailbox_users
ADD CONSTRAINT mailbox_users_session_version_positive CHECK (session_version > 0);

CREATE OR REPLACE FUNCTION all_mail_bump_admin_session_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.password_hash IS DISTINCT FROM OLD.password_hash
       OR NEW.role IS DISTINCT FROM OLD.role
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.must_change_password IS DISTINCT FROM OLD.must_change_password
       OR NEW.two_factor_enabled IS DISTINCT FROM OLD.two_factor_enabled
       OR NEW.two_factor_secret IS DISTINCT FROM OLD.two_factor_secret THEN
        NEW.session_version := OLD.session_version + 1;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS admins_bump_session_version ON admins;
CREATE TRIGGER admins_bump_session_version
BEFORE UPDATE ON admins
FOR EACH ROW
EXECUTE FUNCTION all_mail_bump_admin_session_version();

CREATE OR REPLACE FUNCTION all_mail_bump_mailbox_user_session_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.password_hash IS DISTINCT FROM OLD.password_hash
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.must_change_password IS DISTINCT FROM OLD.must_change_password
       OR NEW.two_factor_enabled IS DISTINCT FROM OLD.two_factor_enabled
       OR NEW.two_factor_secret IS DISTINCT FROM OLD.two_factor_secret THEN
        NEW.session_version := OLD.session_version + 1;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mailbox_users_bump_session_version ON mailbox_users;
CREATE TRIGGER mailbox_users_bump_session_version
BEFORE UPDATE ON mailbox_users
FOR EACH ROW
EXECUTE FUNCTION all_mail_bump_mailbox_user_session_version();
