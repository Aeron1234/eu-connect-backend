-- Run once for the student evaluation categories. Criterion IDs and scores stay unchanged.
-- Idempotent: rows without a leading number and dot are not modified.
-- Restart the backend after running this out-of-band update to clear cached criteria,
-- evaluation history, and dashboard summaries that still contain old labels.
UPDATE student_evaluation_criteria
SET category = TRIM(REGEXP_REPLACE(category, '^[[:space:]]*[0-9]+[.][[:space:]]*', ''))
WHERE category REGEXP '^[[:space:]]*[0-9]+[.]';

SELECT DISTINCT category
FROM student_evaluation_criteria
ORDER BY category;
