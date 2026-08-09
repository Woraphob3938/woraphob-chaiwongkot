USE fitconnect;

DROP TABLE IF EXISTS trainer_service_areas;

ALTER TABLE member_profiles
  DROP FOREIGN KEY IF EXISTS fk_member_province,
  DROP COLUMN IF EXISTS home_province_id;

ALTER TABLE gyms
  DROP FOREIGN KEY IF EXISTS fk_gyms_province,
  DROP INDEX IF EXISTS idx_gyms_province,
  DROP COLUMN IF EXISTS province_id,
  ADD INDEX IF NOT EXISTS idx_gyms_status (status);

ALTER TABLE trainer_profiles
  DROP FOREIGN KEY IF EXISTS fk_trainer_province,
  DROP INDEX IF EXISTS idx_trainer_discovery,
  DROP COLUMN IF EXISTS primary_province_id,
  ADD INDEX IF NOT EXISTS idx_trainer_discovery (approval_status, updated_at);

ALTER TABLE bookings
  DROP COLUMN IF EXISTS location_text;

DROP TABLE IF EXISTS provinces;
