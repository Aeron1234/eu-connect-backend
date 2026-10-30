-- Run once before deploying the matching backend and frontend.
-- Existing announcements remain hidden from employers until their author opts in.
ALTER TABLE announcements
  ADD COLUMN visible_to_employers TINYINT(1) NOT NULL DEFAULT 0;
