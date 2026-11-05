-- Run before deploying the camera-enabled backend. Legacy DTR rows remain valid.
ALTER TABLE daily_time_records
  ADD COLUMN clock_in_photo_path VARCHAR(500) NULL DEFAULT NULL AFTER lon_in,
  ADD COLUMN clock_out_photo_path VARCHAR(500) NULL DEFAULT NULL AFTER lon_out;

-- Confirm both nullable columns exist before the new API accepts clock actions.
SHOW COLUMNS FROM daily_time_records LIKE '%photo_path';
