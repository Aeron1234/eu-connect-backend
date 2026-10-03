-- Apply before deploying the break endpoints. Review SHOW CREATE TABLE first
-- if your existing status column has a different NULL/default definition.
ALTER TABLE daily_time_records
  MODIFY COLUMN status ENUM('present', 'absent', 'pending', 'invalid', 'on-break')
    NOT NULL DEFAULT 'present',
  ADD COLUMN break_started_at DATETIME NULL DEFAULT NULL,
  ADD COLUMN break_total_seconds INT UNSIGNED NOT NULL DEFAULT 0;
