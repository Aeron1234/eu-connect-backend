ALTER TABLE user_profiles
  ADD COLUMN middle_initial CHAR(1) NULL DEFAULT NULL AFTER first_name;
