-- Apply once to an existing Feedback & Concerns installation before deployment.
-- Both counters default to zero, including all existing posts.
ALTER TABLE feedback_posts
  ADD COLUMN public_reply_version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN staff_reply_version BIGINT UNSIGNED NOT NULL DEFAULT 0;

-- Durable attachment deletion queue; no live storage paths are backfilled.
CREATE TABLE IF NOT EXISTS feedback_file_cleanup (
  id CHAR(36) NOT NULL PRIMARY KEY,
  storage_path VARCHAR(500) NOT NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY feedback_cleanup_due (next_attempt_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
