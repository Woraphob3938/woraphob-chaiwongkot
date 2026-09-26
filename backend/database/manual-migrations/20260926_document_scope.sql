USE fitconnect;

-- Brings an existing database up to the scope in บทที่ 1 และ บทที่ 3.
-- Idempotent: every statement is IF NOT EXISTS / same-definition, so running
-- this file twice is a no-op.

-- บทที่ 3.1.3 ข้อ 3: a freelance trainer keeps several bank accounts and picks
-- the default one members transfer to.
CREATE TABLE IF NOT EXISTS trainer_bank_accounts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  trainer_profile_id BIGINT UNSIGNED NOT NULL,
  bank_name VARCHAR(100) NOT NULL,
  account_name VARCHAR(190) NOT NULL,
  account_number VARCHAR(20) NOT NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_trainer_bank_account (trainer_profile_id, account_number),
  KEY idx_trainer_bank_default (trainer_profile_id, is_default),
  CONSTRAINT fk_bank_account_trainer FOREIGN KEY (trainer_profile_id) REFERENCES trainer_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- บทที่ 3 ภาพที่ 3-16: a member may start a chat from a trainer's profile
-- before booking. Such a room has no booking and names both people itself.
ALTER TABLE chat_rooms
  MODIFY booking_id BIGINT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS member_user_id BIGINT UNSIGNED NULL AFTER booking_id,
  ADD COLUMN IF NOT EXISTS trainer_profile_id BIGINT UNSIGNED NULL AFTER member_user_id,
  ADD INDEX IF NOT EXISTS idx_chat_inquiry (member_user_id, trainer_profile_id);
-- Foreign keys cannot use IF NOT EXISTS on every server; add them only once.
SET @fk_member := (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'fk_chat_member');
SET @sql := IF(@fk_member = 0,
  'ALTER TABLE chat_rooms ADD CONSTRAINT fk_chat_member FOREIGN KEY (member_user_id) REFERENCES users(id) ON DELETE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;
SET @fk_trainer := (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'fk_chat_trainer');
SET @sql := IF(@fk_trainer = 0,
  'ALTER TABLE chat_rooms ADD CONSTRAINT fk_chat_trainer FOREIGN KEY (trainer_profile_id) REFERENCES trainer_profiles(id) ON DELETE CASCADE',
  'SELECT 1');
PREPARE statement FROM @sql; EXECUTE statement; DEALLOCATE PREPARE statement;

-- บทที่ 3.1.2 ข้อ 2: search a trainer by name or nickname.
ALTER TABLE trainer_profiles
  ADD COLUMN IF NOT EXISTS nickname VARCHAR(60) NULL AFTER legal_name;

-- A booking's chat is removed once the training is completed. Clear the rooms
-- of bookings that were completed before this rule existed.
DELETE cr FROM chat_rooms cr JOIN bookings b ON b.id = cr.booking_id WHERE b.status = 'completed';

-- บทที่ 1 (revised): 12:00 / 18:00 is the round at which an accepted request
-- is confirmed to the member; the training time stays as the member asked.
-- Bookings accepted under the earlier rule had their session moved to the
-- round, so put them back on the requested time.
UPDATE bookings
SET confirmed_starts_at = starts_at, confirmed_ends_at = ends_at
WHERE confirmed_starts_at IS NOT NULL
  AND (confirmed_starts_at <> starts_at OR confirmed_ends_at <> ends_at);

-- Trainer gallery: several photos members see on the trainer's profile.
CREATE TABLE IF NOT EXISTS trainer_photos (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  trainer_profile_id BIGINT UNSIGNED NOT NULL,
  path VARCHAR(500) NOT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_trainer_photos (trainer_profile_id, sort_order),
  CONSTRAINT fk_trainer_photo_profile FOREIGN KEY (trainer_profile_id) REFERENCES trainer_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB;
