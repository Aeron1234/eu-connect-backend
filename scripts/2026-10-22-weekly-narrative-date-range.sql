-- MariaDB (the supplied database). Run before deploying the matching code.
-- Existing narratives have no recorded coverage dates. Leave those NULL
-- until the author supplies the actual range; created_at is not coverage.
-- IF NOT EXISTS allows this migration to resume or be rerun safely.
ALTER TABLE weekly_narratives
  ADD COLUMN IF NOT EXISTS date_from DATE NULL DEFAULT NULL AFTER week_number,
  ADD COLUMN IF NOT EXISTS date_to DATE NULL DEFAULT NULL AFTER date_from;

-- Review legacy narratives still needing dates. No records are overwritten.
SELECT id, internship_id, week_number, title, date_from, date_to
FROM weekly_narratives
WHERE date_from IS NULL OR date_to IS NULL
ORDER BY internship_id, week_number;
