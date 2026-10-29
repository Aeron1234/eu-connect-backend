-- Historical baseline: apply before 2026-10-29-multiple-performance-evaluations.sql.
-- Do not rerun this baseline after enabling multiple performance evaluations:
-- its consolidation would archive older active performance reviews and restore
-- the retired unique index. Use only the October 29 migration for that upgrade.

-- MariaDB 11.8 (the supplied export). Run during a maintenance window,
-- with evaluation writes stopped, BEFORE deploying the matching backend.
-- Back up the database first. ALTER TABLE commits implicitly.
-- No rows or scores are permanently removed by this migration.
-- This corrected script may also resume the earlier failed #1901 migration.
-- IF NOT EXISTS preserves columns/indexes already added by a previous run;
-- duplicate consolidation only touches evaluations that are still active.

ALTER TABLE student_evaluation_masters
  ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL DEFAULT NULL;
ALTER TABLE employer_evaluation_masters
  ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL DEFAULT NULL;

-- Review duplicate groups before consolidation. Newest created_at wins;
-- equal timestamps use the greatest UUID as a deterministic tie-breaker.
SELECT internship_record_id, COUNT(*) AS active_count
FROM student_evaluation_masters WHERE deleted_at IS NULL
GROUP BY internship_record_id HAVING COUNT(*) > 1;
SELECT internship_record_id, COUNT(*) AS active_count
FROM employer_evaluation_masters WHERE deleted_at IS NULL
GROUP BY internship_record_id HAVING COUNT(*) > 1;

DROP TEMPORARY TABLE IF EXISTS old_student_evaluations;
CREATE TEMPORARY TABLE old_student_evaluations AS
SELECT id FROM (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY internship_record_id ORDER BY created_at DESC, id DESC
  ) AS position_in_record
  FROM student_evaluation_masters
  WHERE internship_record_id IS NOT NULL AND deleted_at IS NULL
) ranked WHERE position_in_record > 1;

UPDATE student_evaluation_masters m
JOIN old_student_evaluations old ON old.id = m.id
SET m.deleted_at = CURRENT_TIMESTAMP WHERE m.deleted_at IS NULL;
DROP TEMPORARY TABLE old_student_evaluations;

DROP TEMPORARY TABLE IF EXISTS old_employer_evaluations;
CREATE TEMPORARY TABLE old_employer_evaluations AS
SELECT id FROM (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY internship_record_id ORDER BY created_at DESC, id DESC
  ) AS position_in_record
  FROM employer_evaluation_masters
  WHERE deleted_at IS NULL
) ranked WHERE position_in_record > 1;

UPDATE employer_evaluation_masters m
JOIN old_employer_evaluations old ON old.id = m.id
SET m.deleted_at = CURRENT_TIMESTAMP WHERE m.deleted_at IS NULL;
DROP TEMPORARY TABLE old_employer_evaluations;

-- UNIQUE indexes permit multiple NULL values: deleted rows do not reserve
-- an active slot. A replacement can be posted after a soft deletion.
-- Generate only a numeric flag from deleted_at. Do not copy the CHAR foreign
-- key into a generated expression (the earlier expression raised #1901).
-- Existing internship IDs and foreign keys remain unchanged.
ALTER TABLE student_evaluation_masters
  ADD COLUMN IF NOT EXISTS active_evaluation TINYINT
    GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN 1 ELSE NULL END) STORED,
  ADD UNIQUE KEY IF NOT EXISTS uq_student_evaluation_active_slot (internship_record_id, active_evaluation);
ALTER TABLE employer_evaluation_masters
  ADD COLUMN IF NOT EXISTS active_evaluation TINYINT
    GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN 1 ELSE NULL END) STORED,
  ADD UNIQUE KEY IF NOT EXISTS uq_employer_evaluation_active_slot (internship_record_id, active_evaluation);

ALTER TABLE student_evaluation_masters DROP COLUMN IF EXISTS status;
-- employer_evaluation_masters has no status column in the supplied schema.
-- Legacy reviewed_by/reviewed_at/review_notes are retained as historical data.

-- Validation: both duplicate queries must return zero rows.
SELECT internship_record_id, COUNT(*) AS active_count
FROM student_evaluation_masters WHERE deleted_at IS NULL
GROUP BY internship_record_id HAVING COUNT(*) > 1;
SELECT internship_record_id, COUNT(*) AS active_count
FROM employer_evaluation_masters WHERE deleted_at IS NULL
GROUP BY internship_record_id HAVING COUNT(*) > 1;
SELECT id, internship_record_id, deleted_at FROM student_evaluation_masters
WHERE deleted_at IS NOT NULL ORDER BY created_at DESC;
SELECT id, internship_record_id, deleted_at FROM employer_evaluation_masters
WHERE deleted_at IS NOT NULL ORDER BY created_at DESC;
