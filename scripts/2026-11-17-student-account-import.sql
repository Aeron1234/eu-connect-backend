-- Run once before deploying both applications. Existing usernames are preserved.
-- School IDs are nullable and compared case-insensitively by the table collation.
ALTER TABLE user_profiles
  ADD COLUMN school_id VARCHAR(30) NULL DEFAULT NULL,
  ADD UNIQUE KEY uq_user_profiles_school_id (school_id);

CREATE TABLE account_invitation_jobs (
  user_id CHAR(36) NOT NULL PRIMARY KEY,
  status ENUM('pending','processing','sent','failed','cancelled') NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_account_invitation_queue (status, created_at),
  CONSTRAINT fk_account_invitation_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
