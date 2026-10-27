ALTER TABLE internship_records
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT NULL DEFAULT NULL;
