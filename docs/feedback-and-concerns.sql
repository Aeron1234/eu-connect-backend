-- Feedback & Concerns. Apply once before deploying backend + frontend.
-- Additive; existing internship/student records are not modified.
-- Uses the existing private SUPABASE_BUCKET, with objects under feedback/.
CREATE TABLE IF NOT EXISTS feedback_posts (
  id CHAR(36) NOT NULL PRIMARY KEY,
  author_id CHAR(36) NOT NULL,
  category VARCHAR(40) NOT NULL,
  subject VARCHAR(160) NOT NULL,
  description TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  public_reply_version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  staff_reply_version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY feedback_author_updated (author_id, updated_at),
  KEY feedback_updated (updated_at),
  KEY feedback_category_status (category, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS feedback_mentions (
  post_id CHAR(36) NOT NULL,
  internship_id CHAR(36) NOT NULL,
  student_id CHAR(36) NOT NULL,
  student_name VARCHAR(255) NOT NULL,
  department_id INT NOT NULL,
  department_code VARCHAR(50) NOT NULL,
  department_name VARCHAR(255) NOT NULL,
  company_name VARCHAR(250) NOT NULL,
  PRIMARY KEY (post_id, internship_id),
  KEY feedback_department_post (department_id, post_id),
  CONSTRAINT feedback_mentions_post FOREIGN KEY (post_id) REFERENCES feedback_posts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS feedback_replies (
  id CHAR(36) NOT NULL PRIMARY KEY,
  post_id CHAR(36) NOT NULL,
  author_id CHAR(36) NOT NULL,
  body TEXT NOT NULL,
  is_internal TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY feedback_reply_page (post_id, created_at, id),
  CONSTRAINT feedback_replies_post FOREIGN KEY (post_id) REFERENCES feedback_posts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS feedback_attachments (
  id CHAR(36) NOT NULL PRIMARY KEY,
  post_id CHAR(36) NOT NULL,
  storage_path VARCHAR(500) NOT NULL,
  filename VARCHAR(180) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  size_bytes INT UNSIGNED NOT NULL,
  CONSTRAINT feedback_attachments_post FOREIGN KEY (post_id) REFERENCES feedback_posts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Preserve all notification enum members already installed, including additions
-- made since the supplied export. Safe to rerun if these members already exist.
SET @feedback_notification_type = (
  SELECT COLUMN_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications' AND COLUMN_NAME = 'type'
);
SET @feedback_notification_type = IF(
  @feedback_notification_type LIKE 'enum(%' AND LOCATE(CONCAT(CHAR(39), 'feedback_mentioned', CHAR(39)), @feedback_notification_type) = 0,
  CONCAT(LEFT(@feedback_notification_type, CHAR_LENGTH(@feedback_notification_type) - 1), ',', CHAR(39), 'feedback_mentioned', CHAR(39), ')'),
  @feedback_notification_type
);
SET @feedback_notification_type = IF(
  @feedback_notification_type LIKE 'enum(%' AND LOCATE(CONCAT(CHAR(39), 'feedback_reply', CHAR(39)), @feedback_notification_type) = 0,
  CONCAT(LEFT(@feedback_notification_type, CHAR_LENGTH(@feedback_notification_type) - 1), ',', CHAR(39), 'feedback_reply', CHAR(39), ')'),
  @feedback_notification_type
);
SET @feedback_notification_type = IF(
  @feedback_notification_type LIKE 'enum(%' AND LOCATE(CONCAT(CHAR(39), 'feedback_status', CHAR(39)), @feedback_notification_type) = 0,
  CONCAT(LEFT(@feedback_notification_type, CHAR_LENGTH(@feedback_notification_type) - 1), ',', CHAR(39), 'feedback_status', CHAR(39), ')'),
  @feedback_notification_type
);
SET @feedback_notification_sql = IF(
  @feedback_notification_type LIKE 'enum(%',
  CONCAT('ALTER TABLE notifications MODIFY COLUMN type ', @feedback_notification_type, ' NOT NULL'),
  'SELECT 1'
);
PREPARE feedback_notification_stmt FROM @feedback_notification_sql;
EXECUTE feedback_notification_stmt;
DEALLOCATE PREPARE feedback_notification_stmt;

CREATE TABLE IF NOT EXISTS feedback_file_cleanup (
  id CHAR(36) NOT NULL PRIMARY KEY,
  storage_path VARCHAR(500) NOT NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY feedback_cleanup_due (next_attempt_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
