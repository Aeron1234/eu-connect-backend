-- Company analytics / Registrar dashboard: READ-ONLY verification migration.
-- Run on the intended database before deploying backend, then frontend.
-- No CREATE/ALTER/UPDATE/backfill is required: analytics uses existing linked
-- placement records, current academic membership, alumni directory and Annex C.
-- No changes are made to the academic-year view or its definer.
SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES
WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN
 ('users','user_profiles','internship_records','student_academic_info','departments','courses',
  'dept_heads_background_info','alumni_internship_records','program_annual_reports');

SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA=DATABASE() AND
 ((TABLE_NAME='internship_records' AND COLUMN_NAME IN
   ('id','user_id','company_name','status','semester','date_started','deleted_at')) OR
  (TABLE_NAME='program_annual_reports' AND COLUMN_NAME IN
   ('academic_year','degree_program','status','created_at','updated_at','submitted_at')))
ORDER BY TABLE_NAME,ORDINAL_POSITION;

-- Existing status/deleted/date and student/user lookup indexes support reads.
-- Aggregate normalization is in application code; no new normalized column/index.
SELECT TABLE_NAME, INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX
FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND
 TABLE_NAME IN ('internship_records','student_academic_info','dept_heads_background_info')
ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX;
