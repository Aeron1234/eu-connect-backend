-- Run once AFTER 2026-10-31-announcement-student-tags.sql and BEFORE deployment.
-- Existing posts keep their usual General/Department audience; no backfill needed.
ALTER TABLE announcements
  ADD COLUMN tagged_students_only TINYINT(1) NOT NULL DEFAULT 0;
