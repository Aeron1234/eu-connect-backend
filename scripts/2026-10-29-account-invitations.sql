-- MariaDB 11.8. Back up before applying; ALTER TABLE commits implicitly.
-- Existing users remain setup-complete. Do not infer onboarding from a NULL
-- password_changed_at: older accounts legitimately have no recorded change.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_setup_required TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS password_setup_token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN IF NOT EXISTS password_setup_expires_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS password_setup_sent_at DATETIME NULL,
  ADD UNIQUE KEY IF NOT EXISTS uq_users_password_setup_token_hash (password_setup_token_hash);

-- Only newly provisioned accounts are explicitly inserted with setup_required=1.
-- Secrets are random 256-bit values; only their SHA-256 digests are stored.
SHOW COLUMNS FROM users LIKE 'password_setup%';
