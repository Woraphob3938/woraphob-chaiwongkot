ALTER TABLE trainer_profiles
  ADD COLUMN IF NOT EXISTS monthly_price DECIMAL(10, 2) NULL AFTER price_from,
  ADD COLUMN IF NOT EXISTS monthly_session_count SMALLINT UNSIGNED NULL AFTER monthly_price;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS booking_type ENUM('single', 'monthly') NOT NULL DEFAULT 'single' AFTER member_note,
  ADD COLUMN IF NOT EXISTS period_start DATETIME NULL AFTER session_count,
  ADD COLUMN IF NOT EXISTS period_end DATETIME NULL AFTER period_start;

CREATE TABLE IF NOT EXISTS booking_sessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  booking_id BIGINT UNSIGNED NOT NULL,
  availability_slot_id BIGINT UNSIGNED NULL,
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_booking_session_slot (booking_id, availability_slot_id),
  KEY idx_booking_sessions_period (booking_id, starts_at),
  KEY idx_booking_sessions_slot (availability_slot_id),
  CONSTRAINT chk_booking_session_period CHECK (ends_at > starts_at),
  CONSTRAINT fk_booking_session_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  CONSTRAINT fk_booking_session_slot FOREIGN KEY (availability_slot_id) REFERENCES availability_slots(id) ON DELETE SET NULL
) ENGINE=InnoDB;

INSERT IGNORE INTO booking_sessions (booking_id, availability_slot_id, starts_at, ends_at)
SELECT id, availability_slot_id, starts_at, ends_at
FROM bookings
WHERE availability_slot_id IS NOT NULL;
