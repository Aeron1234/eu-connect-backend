-- Apply after 2026-11-05-dtr-shift-restrictions.sql and before deploying the
-- schedule-date/notification backend. Existing schedules remain unbounded.
ALTER TABLE dtr_shift_restrictions
  ADD COLUMN start_date DATE NULL AFTER clock_out_time,
  ADD COLUMN end_date DATE NULL AFTER start_date;

-- Preserve the existing notification types from the 2026-11-05 database export.
-- A dedicated type keeps shift changes distinct from geofence assignments.
ALTER TABLE notifications
  MODIFY COLUMN type ENUM(
    'announcement','internship_record_request','internship_record_approved',
    'internship_record_rejected','internship_record_finished',
    'internship_record_force_finished','evaluation_submitted','evaluation_deleted',
    'certificate_uploaded','certificate_accepted','certificate_rejected',
    'supervisor_request_submitted','supervisor_request_accepted',
    'supervisor_request_rejected','dtr_location_set','calendar_schedule',
    'feedback_mentioned','feedback_reply','feedback_status','dtr_shift_schedule'
  ) NOT NULL;

-- Verify the columns and type before deploying the API.
SHOW COLUMNS FROM dtr_shift_restrictions;
SHOW COLUMNS FROM notifications LIKE 'type';
