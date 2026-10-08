-- Apply once to the EU-Connect MySQL database before enabling /calendar.
CREATE TABLE IF NOT EXISTS calendar_schedules (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  created_by CHAR(36) NOT NULL,
  department_id INT NULL,
  title VARCHAR(160) NOT NULL,
  description TEXT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_calendar_schedules_dates (starts_on, ends_on),
  INDEX idx_calendar_schedules_department (department_id, starts_on)
);

CREATE TABLE IF NOT EXISTS calendar_todos (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  internship_id CHAR(36) NOT NULL,
  todo_date DATE NOT NULL,
  title VARCHAR(160) NOT NULL,
  is_done TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_calendar_todos_owner_date (user_id, todo_date)
);

-- The existing notifications.type column is an ENUM, so calendar alerts
-- require an explicit new value. Keep every existing value intact.
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
  'supervisor_request_submitted',
  'supervisor_request_accepted',
  'supervisor_request_rejected',
  'dtr_location_set',
  'calendar_schedule'
) NOT NULL;
