-- Apply before deploying certificate decision notifications.
-- Preserve any additional values if your live notifications.type ENUM differs.
ALTER TABLE notifications MODIFY COLUMN type ENUM(
  'announcement',
  'internship_record_request',
  'internship_record_approved',
  'internship_record_rejected',
  'internship_record_finished',
  'internship_record_force_finished',
  'evaluation_submitted',
  'evaluation_deleted',
  'certificate_uploaded',
  'certificate_accepted',
  'certificate_rejected',
  'supervisor_request_submitted',
  'supervisor_request_accepted',
  'supervisor_request_rejected',
  'dtr_location_set',
  'calendar_schedule'
) NOT NULL;
