-- Run once before deploying the multi-image summary-report API.
-- Existing image attachments are copied; older non-image attachments remain available
-- for removal from the report editor.
CREATE TABLE IF NOT EXISTS summary_report_images (
  id CHAR(36) NOT NULL PRIMARY KEY,
  report_id CHAR(36) NOT NULL,
  storage_path VARCHAR(512) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(80) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_summary_report_image_path (storage_path),
  KEY idx_summary_report_images_report (report_id, sort_order),
  CONSTRAINT fk_summary_report_images_report FOREIGN KEY (report_id)
    REFERENCES summary_reports (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO summary_report_images
  (id, report_id, storage_path, original_name, mime_type, sort_order)
SELECT UUID(), sr.id, sr.attachment_path,
       COALESCE(sr.attachment_name, 'Internship image'), sr.attachment_type, 0
FROM summary_reports sr
WHERE sr.attachment_type IN ('image/jpeg', 'image/png', 'image/webp')
  AND sr.attachment_path IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM summary_report_images sri
    WHERE sri.storage_path = sr.attachment_path
  );

UPDATE summary_reports sr
SET sr.attachment_path = NULL, sr.attachment_name = NULL, sr.attachment_type = NULL
WHERE sr.attachment_type IN ('image/jpeg', 'image/png', 'image/webp')
  AND EXISTS (
    SELECT 1 FROM summary_report_images sri
    WHERE sri.report_id = sr.id AND sri.storage_path = sr.attachment_path
  );
