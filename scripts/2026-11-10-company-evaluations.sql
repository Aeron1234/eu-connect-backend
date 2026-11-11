-- Student-authored company evaluations replace student-authored supervisor evaluations.
-- Back up the database first. Run this once before deploying the paired backend/frontend.
-- Existing student-to-supervisor evaluations and their questions are intentionally removed.
-- Employer-authored confidential student_evaluation_* tables are unchanged.
-- If the CREATE statements were already run, IF NOT EXISTS leaves those tables intact.
-- Set up new company questions per department in the Evaluation Criteria page after deployment.

CREATE TABLE IF NOT EXISTS company_evaluation_criteria (
  id INT NOT NULL AUTO_INCREMENT,
  category VARCHAR(100) NOT NULL,
  criterion_name VARCHAR(255) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  department_id INT NOT NULL,
  PRIMARY KEY (id),
  KEY idx_company_eval_criteria_department_active (department_id, is_active),
  CONSTRAINT fk_company_eval_criteria_department
    FOREIGN KEY (department_id) REFERENCES departments (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS company_evaluation_masters (
  id CHAR(36) NOT NULL,
  internship_record_id CHAR(36) NOT NULL,
  student_id CHAR(36) NOT NULL,
  other_remarks TEXT DEFAULT NULL,
  evaluation_period CHAR(7) NOT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_company_eval_internship_created (internship_record_id, created_at),
  KEY idx_company_eval_student_created (student_id, created_at),
  CONSTRAINT fk_company_eval_internship
    FOREIGN KEY (internship_record_id) REFERENCES internship_records (id),
  CONSTRAINT fk_company_eval_student
    FOREIGN KEY (student_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS company_evaluation_scores (
  id INT NOT NULL AUTO_INCREMENT,
  evaluation_master_id CHAR(36) NOT NULL,
  criterion_id INT NOT NULL,
  score TINYINT NOT NULL,
  PRIMARY KEY (id),
  KEY idx_company_eval_score_master (evaluation_master_id),
  KEY idx_company_eval_score_criterion (criterion_id),
  CONSTRAINT fk_company_eval_score_master
    FOREIGN KEY (evaluation_master_id) REFERENCES company_evaluation_masters (id) ON DELETE CASCADE,
  CONSTRAINT fk_company_eval_score_criterion
    FOREIGN KEY (criterion_id) REFERENCES company_evaluation_criteria (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- These legacy tables contain student-to-supervisor evaluations only.
-- IF EXISTS supports databases where the previous manual cleanup already ran.
DROP TABLE IF EXISTS employer_evaluation_scores;
DROP TABLE IF EXISTS employer_evaluation_masters;
DROP TABLE IF EXISTS employer_evaluation_criteria;

-- Confirm that the new questions are empty and that confidential performance
-- questions and scores were not removed.
SELECT COUNT(*) AS company_questions FROM company_evaluation_criteria;
SELECT COUNT(*) AS performance_questions FROM student_evaluation_criteria;
