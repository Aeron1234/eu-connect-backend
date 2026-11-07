-- Apply after the DTR photo and shift restriction migrations, before deploying
-- the paired backend/frontend. Back up daily_time_records and internship_records.
ALTER TABLE daily_time_records
  ADD COLUMN auto_closed_at DATETIME NULL,
  ADD COLUMN wall_warning_sent_at DATETIME NULL,
  ADD COLUMN proposed_hours DECIMAL(10,2) NULL,
  ADD COLUMN student_explanation TEXT NULL,
  ADD COLUMN explanation_submitted_at DATETIME NULL,
  ADD COLUMN auto_close_review_status ENUM('pending_explanation','pending_review','approved','adjusted','legacy_credited') NULL,
  ADD COLUMN reviewed_by CHAR(36) NULL,
  ADD COLUMN reviewed_at DATETIME NULL,
  ADD COLUMN overtime_reason VARCHAR(500) NULL,
  ADD COLUMN overtime_intended_end DATETIME NULL,
  ADD COLUMN overtime_requested_at DATETIME NULL,
  ADD COLUMN overtime_status ENUM('requested','approved','not_approved') NULL,
  ADD COLUMN overtime_reviewed_by CHAR(36) NULL,
  ADD COLUMN overtime_reviewed_at DATETIME NULL,
  ADD INDEX idx_dtr_auto_close_review (user_id, auto_close_review_status),
  ADD INDEX idx_dtr_open_warning (clock_out, wall_warning_sent_at, clock_in),
  ADD INDEX idx_dtr_open_safety (clock_out, clock_in);

-- Historical auto-closures have already increased internship accumulated_hours.
-- Preserve that credit exactly once and label them as legacy for staff review.
UPDATE daily_time_records
SET auto_closed_at = clock_out,
    proposed_hours = total_hours,
    auto_close_review_status = 'legacy_credited'
WHERE auto_closed = 1 AND clock_out IS NOT NULL;

ALTER TABLE notifications
  MODIFY COLUMN type ENUM(
    'announcement','internship_record_request','internship_record_approved',
    'internship_record_rejected','internship_record_finished',
    'internship_record_force_finished','evaluation_submitted','evaluation_deleted',
    'certificate_uploaded','certificate_accepted','certificate_rejected',
    'supervisor_request_submitted','supervisor_request_accepted',
    'supervisor_request_rejected','dtr_location_set','calendar_schedule',
    'feedback_mentioned','feedback_reply','feedback_status','dtr_shift_schedule',
    'dtr_overtime_request','dtr_overtime_decision','dtr_wall_warning','dtr_auto_close'
  ) NOT NULL;

SHOW COLUMNS FROM daily_time_records;
SHOW COLUMNS FROM notifications LIKE 'type';
