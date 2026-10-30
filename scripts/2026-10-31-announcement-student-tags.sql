-- Run after the existing announcement public-ID/employer-visibility migrations,
-- before deploying the matching backend/frontend. Existing posts have no tags
-- and retain their previous employer opt-in audience. No backfill is needed.
ALTER TABLE announcements ADD COLUMN employer_tagged_only TINYINT(1) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS announcement_student_tags (
  announcement_id CHAR(36) NOT NULL,
  student_id CHAR(36) NOT NULL,
  PRIMARY KEY (announcement_id, student_id),
  KEY idx_announcement_tag_student (student_id),
  CONSTRAINT fk_announcement_tag_post FOREIGN KEY (announcement_id)
    REFERENCES announcements(public_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_announcement_tag_student FOREIGN KEY (student_id)
    REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
