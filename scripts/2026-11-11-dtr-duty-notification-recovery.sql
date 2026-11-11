-- Recovery for the successfully created duty/absence tables.
-- Run this alone if the original migration failed at PREPARE.
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
