-- Run after the November 8 missed-clock-out and November 10 company migrations.
-- Existing employer hours are copied from today forward; no historical absences.
-- Back up before running. Run once, before deploying backend and frontend.
SET time_zone = '+08:00';
CREATE TABLE dtr_weekly_schedules (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 internship_id CHAR(36) NOT NULL,
 source ENUM('student','employer') NOT NULL,
 clock_in_time TIME NOT NULL,
 clock_out_time TIME NOT NULL,
 working_days JSON NOT NULL,
 effective_from DATE NOT NULL,
 effective_until DATE NULL,
 created_by CHAR(36) NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY idx_duty_schedule_record (internship_id,source,effective_from),
 CONSTRAINT fk_duty_schedule_record FOREIGN KEY (internship_id) REFERENCES internship_records(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
INSERT INTO dtr_weekly_schedules (internship_id, source, clock_in_time, clock_out_time, working_days, effective_from, effective_until, created_by)
SELECT s.internship_id, 'employer', s.clock_in_time, s.clock_out_time, '[0,1,2,3,4,5,6]',
 GREATEST(CURDATE(), COALESCE(s.start_date,CURDATE())), s.end_date, s.employer_id
FROM dtr_shift_restrictions s JOIN internship_records ir ON ir.id=s.internship_id
WHERE s.employer_id=ir.employer_id AND ir.deleted_at IS NULL AND ir.status='ongoing'
 AND (s.end_date IS NULL OR s.end_date>=CURDATE());
CREATE TABLE dtr_absence_reports (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 internship_id CHAR(36) NOT NULL,
 student_id CHAR(36) NOT NULL,
 shift_date DATE NOT NULL,
 expected_in DATETIME NOT NULL,
 expected_out DATETIME NOT NULL,
 category ENUM('absent','leave','no_duty','worked') NOT NULL DEFAULT 'absent',
 reason VARCHAR(2000) NULL,
 reported_at DATETIME NULL,
 updated_at DATETIME NULL,
 review_status ENUM('reason_needed','pending','reviewed','corrected') NOT NULL DEFAULT 'reason_needed',
 reviewed_by CHAR(36) NULL,
 reviewed_at DATETIME NULL,
 review_note VARCHAR(2000) NULL,
 correction_dtr_id INT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_absence_shift (internship_id,shift_date),
 KEY idx_absence_student (student_id,shift_date),
 CONSTRAINT fk_absence_record FOREIGN KEY (internship_id) REFERENCES internship_records(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
-- A delivery ledger prevents duplicate weekly reminders across restarts/workers.
CREATE TABLE dtr_schedule_reminders (
 student_id CHAR(36) NOT NULL,
 week_date DATE NOT NULL,
 state ENUM('sending','sent','failed') NOT NULL,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(student_id,week_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Direct statements work in editors that do not preserve session variables.
-- Existing enum values match the latest supplied database and November 7 migration.
ALTER TABLE notifications
  MODIFY COLUMN type ENUM(
    'announcement','internship_record_request','internship_record_approved',
    'internship_record_rejected','internship_record_finished',
    'internship_record_force_finished','evaluation_submitted','evaluation_deleted',
    'certificate_uploaded','certificate_accepted','certificate_rejected',
    'supervisor_request_submitted','supervisor_request_accepted',
    'supervisor_request_rejected','dtr_location_set','calendar_schedule',
    'feedback_mentioned','feedback_reply','feedback_status','dtr_shift_schedule',
    'dtr_overtime_request','dtr_overtime_decision','dtr_wall_warning','dtr_auto_close',
    'dtr_absence','dtr_duty_schedule'
  ) NOT NULL,
  MODIFY COLUMN link VARCHAR(255) NULL DEFAULT NULL;

SHOW COLUMNS FROM notifications WHERE Field IN ('type','link');
