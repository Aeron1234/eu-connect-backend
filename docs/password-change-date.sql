-- Apply before deploying the account-profile and password-update changes.
-- Existing users remain NULL because earlier password changes were not tracked.
ALTER TABLE users
  ADD COLUMN password_changed_at DATETIME NULL DEFAULT NULL AFTER password_hash;
