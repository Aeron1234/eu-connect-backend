-- Run once against the application database before opening Admin > Error Tracking.
-- Only the backend inserts or deletes rows; the admin API exposes GET requests.
CREATE TABLE IF NOT EXISTS error_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  fingerprint CHAR(64) NOT NULL,
  request_id CHAR(36) NULL,
  source VARCHAR(80) NOT NULL,
  method VARCHAR(10) NULL,
  route_pattern VARCHAR(255) NULL,
  status_code SMALLINT UNSIGNED NULL,
  error_name VARCHAR(80) NOT NULL,
  error_code VARCHAR(80) NULL,
  context VARCHAR(160) NOT NULL,
  message VARCHAR(500) NOT NULL,
  code_location VARCHAR(300) NULL,
  actor_id CHAR(36) NULL,
  actor_role VARCHAR(40) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_error_events_created (created_at),
  INDEX idx_error_events_fingerprint_created (fingerprint, created_at),
  INDEX idx_error_events_route_created (route_pattern, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
