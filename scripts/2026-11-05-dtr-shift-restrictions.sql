-- Apply after the attendance-photo migration and before deploying schedule-aware API code.
CREATE TABLE dtr_shift_restrictions (
  internship_id CHAR(36) NOT NULL PRIMARY KEY,
  employer_id CHAR(36) NOT NULL,
  clock_in_time TIME NOT NULL,
  clock_out_time TIME NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_dtr_shift_restriction_internship FOREIGN KEY (internship_id) REFERENCES internship_records(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

ALTER TABLE daily_time_records
  ADD COLUMN expected_clock_in DATETIME NULL,
  ADD COLUMN expected_clock_out DATETIME NULL,
  ADD COLUMN is_late TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN is_undertime TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN is_overtime TINYINT(1) NOT NULL DEFAULT 0;
