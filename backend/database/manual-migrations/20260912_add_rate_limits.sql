-- Fixed-window counters for the endpoints that accept credentials or files.
CREATE TABLE IF NOT EXISTS rate_limits (
  scope VARCHAR(64) NOT NULL,
  subject VARCHAR(190) NOT NULL,
  window_started_at DATETIME NOT NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, subject),
  KEY idx_rate_limits_window (window_started_at)
) ENGINE=InnoDB;
