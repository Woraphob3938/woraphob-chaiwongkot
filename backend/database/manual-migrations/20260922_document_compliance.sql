USE fitconnect;

-- Idempotent: ADD COLUMN IF NOT EXISTS (MariaDB) + MODIFY status is a
-- same-definition redefinition, so re-running this file is a no-op.

-- MODIFY rebuilds the table and re-validates chk_booking_period. A batch of
-- legacy rows holds an ends_at that is not after starts_at (they violate the
-- table's own invariant and abort the ALTER on any database that has them).
-- Repair them to the standard one-hour session first; the repair is a no-op on
-- a consistent database.
UPDATE bookings SET ends_at = DATE_ADD(starts_at, INTERVAL 1 HOUR) WHERE NOT (ends_at > starts_at);

ALTER TABLE bookings
  MODIFY status ENUM('pending_trainer','awaiting_payment','payment_review','confirmed','completed','cancelled','expired') NOT NULL,
  ADD COLUMN IF NOT EXISTS confirmed_starts_at DATETIME NULL AFTER ends_at,
  ADD COLUMN IF NOT EXISTS confirmed_ends_at   DATETIME NULL AFTER confirmed_starts_at;

ALTER TABLE member_profiles
  ADD COLUMN IF NOT EXISTS birth_date DATE NULL AFTER height;

ALTER TABLE trainer_profiles
  ADD COLUMN IF NOT EXISTS birth_date DATE NULL AFTER phone,
  ADD COLUMN IF NOT EXISTS education VARCHAR(255) NULL AFTER birth_date;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS image_path VARCHAR(500) NULL,
  ADD COLUMN IF NOT EXISTS image_mime VARCHAR(100)  NULL,
  ADD COLUMN IF NOT EXISTS image_name VARCHAR(255)  NULL,
  ADD COLUMN IF NOT EXISTS image_size INT UNSIGNED  NULL;

-- CONTRACT §3 requires notification events without a booking (trainer
-- application decisions). notifications.booking_id was NOT NULL; make it
-- nullable so those events can be recorded (schema.sql itself is frozen).
ALTER TABLE notifications MODIFY booking_id BIGINT UNSIGNED NULL;
