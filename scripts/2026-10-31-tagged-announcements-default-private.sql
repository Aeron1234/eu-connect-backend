-- Run after announcement-student-tags.sql and targeted-announcement-audience.sql.
-- Apply the current audience policy to existing tagged posts. No new columns.
-- Existing live feed/calendar/notification guards hide out-of-audience alerts.
UPDATE announcements a
SET tagged_students_only=1
WHERE tagged_students_only=0 AND EXISTS (
  SELECT 1 FROM announcement_student_tags t WHERE t.announcement_id=a.public_id
);
