-- Apply before deploying the summary-report API.
-- One report per internship is enforced even for concurrent submissions.
CREATE TABLE IF NOT EXISTS summary_reports (
  id CHAR(36) NOT NULL PRIMARY KEY,
  internship_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  organization_experience TEXT NOT NULL,
  work_schedule TEXT NOT NULL,
  memorable_moment TEXT NOT NULL,
  difficulties_solutions TEXT NOT NULL,
  memorabilia_note TEXT NULL,
  attachment_path VARCHAR(512) NULL,
  attachment_name VARCHAR(255) NULL,
  attachment_type VARCHAR(120) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_summary_report_internship (internship_id),
  KEY idx_summary_report_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
