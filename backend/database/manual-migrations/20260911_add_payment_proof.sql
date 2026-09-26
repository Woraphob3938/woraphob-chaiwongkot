ALTER TABLE trainer_profiles
  ADD COLUMN payment_account_name VARCHAR(190) NULL AFTER monthly_session_count,
  ADD COLUMN promptpay_id VARCHAR(13) NULL AFTER payment_account_name,
  ADD COLUMN payment_qr_path VARCHAR(500) NULL AFTER promptpay_id;
