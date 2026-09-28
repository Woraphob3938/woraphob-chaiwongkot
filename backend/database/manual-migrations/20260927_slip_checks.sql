-- Slip checks: the exact transfer amount per booking and the payment window each slip answered.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS transfer_amount DECIMAL(10, 2) NULL AFTER quoted_price;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS window_ends_at DATETIME NULL AFTER transaction_ref;
