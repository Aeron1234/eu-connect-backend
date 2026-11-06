-- Run once on a backup-tested MariaDB database before deploying the paired API/UI.
-- The preexisting global criteria are the CCS templates. Keep their IDs so old
-- evaluation_scores rows continue to reference the original questions.
-- Confirm CCS exists before running: SELECT id, code FROM departments WHERE code = 'CCS';

ALTER TABLE student_evaluation_criteria ADD COLUMN department_id INT NULL;
ALTER TABLE employer_evaluation_criteria ADD COLUMN department_id INT NULL;

UPDATE student_evaluation_criteria c
JOIN departments d ON d.code = 'CCS'
SET c.department_id = d.id
WHERE c.department_id IS NULL;

UPDATE employer_evaluation_criteria c
JOIN departments d ON d.code = 'CCS'
SET c.department_id = d.id
WHERE c.department_id IS NULL;

-- These constraints intentionally stop the migration if CCS is missing.
ALTER TABLE student_evaluation_criteria
  MODIFY COLUMN department_id INT NOT NULL,
  ADD INDEX idx_student_eval_criteria_department_active (department_id, is_active),
  ADD CONSTRAINT fk_student_eval_criteria_department FOREIGN KEY (department_id) REFERENCES departments(id);

ALTER TABLE employer_evaluation_criteria
  MODIFY COLUMN department_id INT NOT NULL,
  ADD INDEX idx_employer_eval_criteria_department_active (department_id, is_active),
  ADD CONSTRAINT fk_employer_eval_criteria_department FOREIGN KEY (department_id) REFERENCES departments(id);

-- Verify all existing questions remain under CCS after migration.
SELECT d.code, COUNT(*) AS questions FROM student_evaluation_criteria c JOIN departments d ON d.id = c.department_id GROUP BY d.code;
SELECT d.code, COUNT(*) AS questions FROM employer_evaluation_criteria c JOIN departments d ON d.id = c.department_id GROUP BY d.code;
