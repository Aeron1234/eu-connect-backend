-- Review the count before applying this one-time correction to historical rows.
-- It targets only records written by the old auto-close implementation at 8 hours.
SELECT COUNT(*) AS rows_to_reclassify
FROM daily_time_records
WHERE auto_closed = 1
  AND status = 'invalid'
  AND total_hours = 8
  AND flag_reason = 'Auto-closed: exceeded max shift duration without clock-out';

UPDATE daily_time_records
SET status = 'present',
    flag_reason = 'Auto-closed at maximum shift duration without manual clock-out'
WHERE auto_closed = 1
  AND status = 'invalid'
  AND total_hours = 8
  AND flag_reason = 'Auto-closed: exceeded max shift duration without clock-out';
