-- Apply after 2026-11-07-dtr-overtime-auto-close-review.sql and before deploying
-- the matching backend/frontend. Existing rows remain system-closed or manual.
ALTER TABLE daily_time_records
  ADD COLUMN missed_clock_out TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN claimed_clock_out_at DATETIME NULL;

-- Durable cleanup after a student deletes an eligible DTR. The worker retries
-- storage removal after network failures; existing rows need no backfill.
CREATE TABLE dtr_photo_cleanup (
  id CHAR(36) NOT NULL PRIMARY KEY,
  storage_path VARCHAR(1024) NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_dtr_photo_cleanup_due (next_attempt_at)
);
