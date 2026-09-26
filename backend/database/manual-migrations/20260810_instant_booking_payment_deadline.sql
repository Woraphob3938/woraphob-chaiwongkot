-- NOTE: the "instant booking" flow this file is named after was retired; it now
-- *removes* pending_trainer from the enum, and 20260922_document_compliance.sql
-- adds it back. Filename order is therefore load-bearing — apply these files in
-- name order. ADD COLUMN is guarded so replaying the file is a no-op.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS payment_deadline_at DATETIME NULL AFTER payment_status;

ALTER TABLE bookings
  MODIFY status ENUM(
    'pending_trainer', 'awaiting_payment', 'payment_review',
    'confirmed', 'completed', 'cancelled', 'expired'
  ) NOT NULL;

INSERT INTO booking_status_history
  (booking_id, from_status, to_status, changed_by_user_id, note)
SELECT id, 'pending_trainer', 'expired', NULL,
       'ระบบเปลี่ยนขั้นตอนการจอง กรุณาจองใหม่'
FROM bookings
WHERE status = 'pending_trainer';

UPDATE availability_slots s
JOIN bookings b
  ON b.availability_slot_id = s.id
 AND b.status = 'pending_trainer'
SET s.state = 'available'
WHERE s.state = 'held';

UPDATE bookings
SET status = 'expired',
    cancellation_reason = 'ระบบเปลี่ยนขั้นตอนการจอง กรุณาจองใหม่',
    updated_at = UTC_TIMESTAMP()
WHERE status = 'pending_trainer';

UPDATE bookings
SET payment_deadline_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE)
WHERE status = 'awaiting_payment'
  AND payment_deadline_at IS NULL;

SET SESSION check_constraint_checks = OFF;

ALTER TABLE bookings
  MODIFY status ENUM(
    'awaiting_payment', 'payment_review', 'confirmed',
    'completed', 'cancelled', 'expired'
  ) NOT NULL;

SET SESSION check_constraint_checks = ON;

CREATE INDEX idx_booking_payment_deadline
  ON bookings (status, payment_deadline_at);
