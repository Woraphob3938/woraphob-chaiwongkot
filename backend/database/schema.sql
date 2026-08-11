SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE DATABASE IF NOT EXISTS fitconnect
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE fitconnect;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(190) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(150) NOT NULL,
  role ENUM('member', 'trainer', 'admin') NOT NULL,
  status ENUM('active', 'suspended', 'deleted') NOT NULL DEFAULT 'active',
  email_verified_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_role_status (role, status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS member_profiles (
  user_id BIGINT UNSIGNED PRIMARY KEY,
  first_name VARCHAR(100) NULL,
  last_name VARCHAR(100) NULL,
  phone VARCHAR(30) NULL,
  goals TEXT NULL,
  experience_level VARCHAR(50) NULL,
  weight DECIMAL(5, 2) NULL,
  height DECIMAL(5, 2) NULL,
  image_path VARCHAR(500) NULL,
  medical_note TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_member_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS gyms (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(190) NOT NULL,
  address_text VARCHAR(500) NULL,
  latitude DECIMAL(10, 7) NULL,
  longitude DECIMAL(10, 7) NULL,
  status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_gyms_status (status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS trainer_profiles (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  slug VARCHAR(190) NOT NULL,
  legal_name VARCHAR(190) NULL,
  phone VARCHAR(30) NULL,
  headline VARCHAR(220) NULL,
  bio TEXT NULL,
  years_experience SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  service_mode ENUM('freelance', 'gym', 'both') NOT NULL DEFAULT 'freelance',
  gym_id BIGINT UNSIGNED NULL,
  gym_name VARCHAR(190) NULL,
  price_from DECIMAL(10, 2) NULL,
  image_path VARCHAR(500) NULL,
  approval_status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  approval_note VARCHAR(1000) NULL,
  reviewed_by_user_id BIGINT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  is_demo TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_trainer_user (user_id),
  UNIQUE KEY uq_trainer_slug (slug),
  KEY idx_trainer_discovery (approval_status, updated_at),
  CONSTRAINT fk_trainer_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_trainer_gym FOREIGN KEY (gym_id) REFERENCES gyms(id) ON DELETE SET NULL,
  CONSTRAINT fk_trainer_reviewer FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS training_types (
  id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(100) NOT NULL,
  name_th VARCHAR(150) NOT NULL,
  description TEXT NULL,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_training_type_slug (slug),
  UNIQUE KEY uq_training_type_name (name_th)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS trainer_training_types (
  trainer_profile_id BIGINT UNSIGNED NOT NULL,
  training_type_id SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (trainer_profile_id, training_type_id),
  KEY idx_trainer_type_lookup (training_type_id, trainer_profile_id),
  CONSTRAINT fk_trainer_type_trainer FOREIGN KEY (trainer_profile_id) REFERENCES trainer_profiles(id) ON DELETE CASCADE,
  CONSTRAINT fk_trainer_type_type FOREIGN KEY (training_type_id) REFERENCES training_types(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS trainer_certificates (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  trainer_profile_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(255) NOT NULL,
  issuer VARCHAR(190) NOT NULL,
  issued_year SMALLINT UNSIGNED NULL,
  expires_at DATE NULL,
  file_path VARCHAR(500) NOT NULL,
  mime_type VARCHAR(100) NOT NULL DEFAULT 'application/pdf',
  status ENUM('pending', 'verified', 'rejected') NOT NULL DEFAULT 'pending',
  review_note VARCHAR(1000) NULL,
  reviewed_by_user_id BIGINT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_certificates_review (status, created_at),
  CONSTRAINT fk_certificate_trainer FOREIGN KEY (trainer_profile_id) REFERENCES trainer_profiles(id) ON DELETE CASCADE,
  CONSTRAINT fk_certificate_reviewer FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS availability_slots (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  trainer_profile_id BIGINT UNSIGNED NOT NULL,
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NOT NULL,
  state ENUM('available', 'held', 'booked', 'blocked') NOT NULL DEFAULT 'available',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_trainer_slot (trainer_profile_id, starts_at, ends_at),
  KEY idx_slot_discovery (starts_at, state, trainer_profile_id),
  CONSTRAINT chk_slot_period CHECK (ends_at > starts_at),
  CONSTRAINT fk_slot_trainer FOREIGN KEY (trainer_profile_id) REFERENCES trainer_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS bookings (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id VARCHAR(32) NOT NULL,
  member_user_id BIGINT UNSIGNED NOT NULL,
  trainer_profile_id BIGINT UNSIGNED NOT NULL,
  availability_slot_id BIGINT UNSIGNED NULL,
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NOT NULL,
  member_note TEXT NULL,
  session_count SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  quoted_price DECIMAL(10, 2) NULL,
  status ENUM('awaiting_payment', 'payment_review', 'confirmed', 'completed', 'cancelled', 'expired') NOT NULL,
  payment_status ENUM('not_submitted', 'reviewing', 'approved', 'rejected') NOT NULL DEFAULT 'not_submitted',
  payment_deadline_at DATETIME NULL,
  cancellation_reason VARCHAR(1000) NULL,
  is_demo TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_booking_public_id (public_id),
  KEY idx_member_bookings (member_user_id, created_at),
  KEY idx_trainer_bookings (trainer_profile_id, starts_at, status),
  KEY idx_booking_status (status, payment_status),
  KEY idx_booking_payment_deadline (status, payment_deadline_at),
  CONSTRAINT chk_booking_period CHECK (ends_at > starts_at),
  CONSTRAINT chk_booking_sessions CHECK (session_count BETWEEN 1 AND 30),
  CONSTRAINT fk_booking_member FOREIGN KEY (member_user_id) REFERENCES users(id),
  CONSTRAINT fk_booking_trainer FOREIGN KEY (trainer_profile_id) REFERENCES trainer_profiles(id),
  CONSTRAINT fk_booking_slot FOREIGN KEY (availability_slot_id) REFERENCES availability_slots(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS booking_status_history (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  booking_id BIGINT UNSIGNED NOT NULL,
  from_status VARCHAR(50) NULL,
  to_status VARCHAR(50) NOT NULL,
  changed_by_user_id BIGINT UNSIGNED NULL,
  note VARCHAR(1000) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_booking_history (booking_id, created_at),
  CONSTRAINT fk_history_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  CONSTRAINT fk_history_user FOREIGN KEY (changed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS payments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  booking_id BIGINT UNSIGNED NOT NULL,
  submitted_by_user_id BIGINT UNSIGNED NOT NULL,
  amount DECIMAL(10, 2) NULL,
  slip_path VARCHAR(500) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  status ENUM('reviewing', 'approved', 'rejected') NOT NULL DEFAULT 'reviewing',
  review_note VARCHAR(1000) NULL,
  reviewed_by_user_id BIGINT UNSIGNED NULL,
  submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME NULL,
  KEY idx_payment_review (status, submitted_at),
  KEY idx_payment_booking (booking_id),
  CONSTRAINT fk_payment_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  CONSTRAINT fk_payment_submitter FOREIGN KEY (submitted_by_user_id) REFERENCES users(id),
  CONSTRAINT fk_payment_reviewer FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS chat_rooms (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  booking_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_chat_booking (booking_id),
  CONSTRAINT fk_chat_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  chat_room_id BIGINT UNSIGNED NOT NULL,
  sender_user_id BIGINT UNSIGNED NOT NULL,
  message_text TEXT NOT NULL,
  attachment_path VARCHAR(500) NULL,
  attachment_mime VARCHAR(100) NULL,
  attachment_name VARCHAR(255) NULL,
  attachment_size INT UNSIGNED NULL,
  read_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_messages_room (chat_room_id, id),
  CONSTRAINT fk_message_room FOREIGN KEY (chat_room_id) REFERENCES chat_rooms(id) ON DELETE CASCADE,
  CONSTRAINT fk_message_sender FOREIGN KEY (sender_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS reviews (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  booking_id BIGINT UNSIGNED NOT NULL,
  member_user_id BIGINT UNSIGNED NOT NULL,
  trainer_profile_id BIGINT UNSIGNED NOT NULL,
  rating TINYINT UNSIGNED NOT NULL,
  comment TEXT NOT NULL,
  status ENUM('published', 'hidden', 'reported') NOT NULL DEFAULT 'published',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_review_booking (booking_id),
  KEY idx_trainer_reviews (trainer_profile_id, status, created_at),
  CONSTRAINT chk_review_rating CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT fk_review_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  CONSTRAINT fk_review_member FOREIGN KEY (member_user_id) REFERENCES users(id),
  CONSTRAINT fk_review_trainer FOREIGN KEY (trainer_profile_id) REFERENCES trainer_profiles(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS auth_tokens (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_auth_token_hash (token_hash),
  KEY idx_auth_user_expiry (user_id, expires_at),
  CONSTRAINT fk_auth_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_reset_token_hash (token_hash),
  KEY idx_reset_user_expiry (user_id, expires_at),
  CONSTRAINT fk_reset_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
