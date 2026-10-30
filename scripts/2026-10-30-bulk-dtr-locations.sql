-- Bulk DTR Location Assignment: schema verification migration (MySQL/MariaDB).
-- Run against the intended application database before deploying the backend,
-- then deploy backend + frontend together. This file is read-only and repeatable.
-- No DDL or data backfill is required for the inspected export: existing rows
-- already represent exactly one override per internship and remain unchanged.
-- New writes explicitly set radius_meters (default 150); do not change old radii.

-- Expected: InnoDB for assignments + notifications + activity logs + internships.
SELECT TABLE_NAME, ENGINE
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('dtr_locations', 'internship_records', 'notifications', 'activity_logs');

-- Expected: lat DECIMAL(10,8), lon DECIMAL(11,8), radius_meters INT,
-- label/address VARCHAR(255), internship_id/set_by CHAR(36).
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dtr_locations'
ORDER BY ORDINAL_POSITION;

-- Expected: a UNIQUE index on internship_id (unique_internship_location).
SELECT INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dtr_locations'
ORDER BY INDEX_NAME, SEQ_IN_INDEX;

-- Expected: internship_id -> internship_records.id and set_by -> users.id.
SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dtr_locations'
  AND REFERENCED_TABLE_NAME IS NOT NULL;

-- Expected: existing notification enum includes dtr_location_set; link/link_uuid
-- already exist. Reuse that type for student and grouped employer notifications.
SELECT COLUMN_NAME, COLUMN_TYPE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications'
  AND COLUMN_NAME IN ('type', 'link', 'link_uuid');

-- Expected: no rows. Do not delete existing locations or recreate the table.
SELECT internship_id, COUNT(*) AS assignment_count
FROM dtr_locations GROUP BY internship_id HAVING COUNT(*) > 1;
