SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  recipient_user_id BIGINT UNSIGNED NOT NULL,
  type VARCHAR(64) NOT NULL,
  category ENUM('booking', 'payment', 'appointment') NOT NULL,
  title VARCHAR(190) NOT NULL,
  message TEXT NOT NULL,
  booking_id BIGINT UNSIGNED NOT NULL,
  action_path VARCHAR(255) NOT NULL,
  read_at DATETIME NULL,
  email_status ENUM('pending', 'sent', 'failed', 'skipped') NOT NULL,
  email_attempt_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  email_next_attempt_at DATETIME NULL,
  email_sent_at DATETIME NULL,
  email_last_error VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_notification_event (recipient_user_id, type, booking_id),
  KEY idx_notification_inbox (recipient_user_id, read_at, created_at),
  KEY idx_notification_email_queue (email_status, email_next_attempt_at, email_attempt_count),
  CONSTRAINT fk_notification_recipient FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_notification_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
) ENGINE=InnoDB;
