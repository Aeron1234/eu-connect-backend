-- MariaDB: apply after the October 22 evaluation soft-delete baseline.
-- Removes only the one-active-supervisor-evaluation restriction.
-- The exported schema uses the unique index to support its internship foreign
-- key, so create a nonunique replacement before dropping the unique index.
-- Existing evaluations, scores, soft-deletion history and foreign keys remain.
-- Safe to rerun on MariaDB. ALTER TABLE statements commit implicitly.

ALTER TABLE employer_evaluation_masters
  ADD INDEX IF NOT EXISTS idx_employer_evaluation_internship_record (internship_record_id);

ALTER TABLE employer_evaluation_masters
  DROP INDEX IF EXISTS uq_employer_evaluation_active_slot;

-- Verify that the retired index is absent and the nonunique index is present.
-- Expected: one row for idx_employer_evaluation_internship_record, NON_UNIQUE=1.
SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'employer_evaluation_masters'
  AND INDEX_NAME IN ('idx_employer_evaluation_internship_record', 'uq_employer_evaluation_active_slot')
ORDER BY INDEX_NAME, SEQ_IN_INDEX;
