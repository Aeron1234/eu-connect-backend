-- MariaDB: widen longitude without reducing the existing 8 decimal places.
-- Back up and apply during a maintenance window. ALTER commits implicitly.
-- Latitude DECIMAL(10,8) already covers -90 through 90 and is unchanged.
ALTER TABLE daily_time_records
  MODIFY COLUMN lon_in DECIMAL(11,8) NULL DEFAULT NULL,
  MODIFY COLUMN lon_out DECIMAL(11,8) NULL DEFAULT NULL;

SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'daily_time_records'
  AND COLUMN_NAME IN ('lat_in', 'lon_in', 'lat_out', 'lon_out');
