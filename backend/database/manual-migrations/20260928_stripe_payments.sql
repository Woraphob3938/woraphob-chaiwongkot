-- Stripe payments: Connect accounts for trainers, Checkout sessions on payments, webhook idempotency.
ALTER TABLE trainer_profiles ADD COLUMN IF NOT EXISTS stripe_account_id VARCHAR(64) NULL AFTER payment_qr_path;
ALTER TABLE trainer_profiles ADD COLUMN IF NOT EXISTS stripe_transfers_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER stripe_account_id;
ALTER TABLE trainer_profiles ADD UNIQUE KEY IF NOT EXISTS uq_trainer_stripe_account (stripe_account_id);
ALTER TABLE payments MODIFY slip_path VARCHAR(500) NULL, MODIFY mime_type VARCHAR(100) NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS stripe_checkout_session_id VARCHAR(255) NULL AFTER mime_type;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS stripe_payment_intent_id VARCHAR(255) NULL AFTER stripe_checkout_session_id;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS stripe_destination_account VARCHAR(64) NULL AFTER stripe_payment_intent_id;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS application_fee DECIMAL(10, 2) NULL AFTER stripe_destination_account;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS refunded_at DATETIME NULL AFTER application_fee;
ALTER TABLE payments MODIFY status ENUM('pending', 'reviewing', 'approved', 'rejected', 'refunded') NOT NULL DEFAULT 'pending';
ALTER TABLE payments ADD UNIQUE KEY IF NOT EXISTS uq_payment_checkout_session (stripe_checkout_session_id);
CREATE TABLE IF NOT EXISTS stripe_events (
  id VARCHAR(255) PRIMARY KEY,
  type VARCHAR(100) NOT NULL,
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
