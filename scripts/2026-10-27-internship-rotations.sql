-- MariaDB, matching the supplied export's CHAR(36) and utf8mb4_general_ci keys.
-- Back up first; apply BEFORE deploying both applications. ALTER TABLE commits implicitly.
-- Existing internships remain opted out. No placement, attendance or evaluation is replaced.
ALTER TABLE internship_records
  ADD COLUMN IF NOT EXISTS rotations_enabled TINYINT(1) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS internship_rotations (
  id CHAR(36) NOT NULL,
  internship_id CHAR(36) NOT NULL,
  department_name VARCHAR(120) NOT NULL,
  supervisor_name VARCHAR(120) DEFAULT NULL,
  notes TEXT DEFAULT NULL,
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL,
  deleted_at TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_rotation_record_dates (internship_id, deleted_at, date_from, date_to),
  CONSTRAINT fk_rotation_internship FOREIGN KEY (internship_id) REFERENCES internship_records(id) ON DELETE CASCADE,
  CONSTRAINT chk_rotation_dates CHECK (date_to >= date_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Optional saved assignment snapshots. Leave old journals blank rather than inventing history.
ALTER TABLE weekly_narratives
  ADD COLUMN IF NOT EXISTS rotation_assignments JSON NULL DEFAULT NULL;

-- Read-only checks after applying the migration.
SELECT rotations_enabled, COUNT(*) AS internships FROM internship_records GROUP BY rotations_enabled;
SELECT COUNT(*) AS rotations FROM internship_rotations;
