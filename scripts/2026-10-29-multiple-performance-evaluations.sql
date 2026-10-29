-- MariaDB 11.8, matching the latest Layerbase export.
-- Back up first and apply before deploying multiple-performance-evaluation code.
-- This replaces only the employer-to-student single-active restriction.
-- Existing evaluation masters, scores and deleted timestamps are untouched.
-- Student-to-supervisor uniqueness in employer_evaluation_masters stays enabled.
-- The nonunique internship foreign-key index and generated active flag are kept.
-- ALTER TABLE commits implicitly; IF EXISTS makes this change safe to rerun.

ALTER TABLE student_evaluation_masters
  DROP INDEX IF EXISTS uq_student_evaluation_active_slot;

-- Expected: no uq_student_evaluation_active_slot; one
-- uq_employer_evaluation_active_slot remains on the supervisor-feedback table.
SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('student_evaluation_masters', 'employer_evaluation_masters')
  AND INDEX_NAME IN ('uq_student_evaluation_active_slot', 'uq_employer_evaluation_active_slot')
ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX;
