USE fitconnect;
SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO training_types (id, slug, name_th, sort_order) VALUES
  (1, 'strength', 'เวทเทรนนิง', 10), (2, 'weight-loss', 'ลดไขมัน', 20), (3, 'mobility', 'การเคลื่อนไหว', 30),
  (4, 'functional', 'ฟังก์ชันนัล', 40), (5, 'running', 'วิ่ง', 50), (6, 'rehab', 'ฟื้นฟูร่างกาย', 60)
ON DUPLICATE KEY UPDATE name_th = VALUES(name_th), sort_order = VALUES(sort_order), active = 1;

-- บัญชีทั้งหมดด้านล่างเป็นข้อมูลสาธิต รหัสผ่านคือ password และห้ามใช้ในระบบจริง
INSERT INTO users (id, email, password_hash, display_name, role, status) VALUES
  (1, 'member.demo@fitconnect.local', '$2y$10$UAHptYudXBuQG5HZCuzvLufSI45l0ElKtaw591f2fyLcR/4RWTmOu', 'สมาชิกสาธิต', 'member', 'active'),
  (2, 'trainer.a@fitconnect.local', '$2y$10$UAHptYudXBuQG5HZCuzvLufSI45l0ElKtaw591f2fyLcR/4RWTmOu', 'เทรนเนอร์สาธิต ก.', 'trainer', 'active'),
  (3, 'trainer.b@fitconnect.local', '$2y$10$UAHptYudXBuQG5HZCuzvLufSI45l0ElKtaw591f2fyLcR/4RWTmOu', 'เทรนเนอร์สาธิต ข.', 'trainer', 'active'),
  (4, 'trainer.c@fitconnect.local', '$2y$10$UAHptYudXBuQG5HZCuzvLufSI45l0ElKtaw591f2fyLcR/4RWTmOu', 'เทรนเนอร์สาธิต ค.', 'trainer', 'active'),
  (5, 'admin.demo@fitconnect.local', '$2y$10$UAHptYudXBuQG5HZCuzvLufSI45l0ElKtaw591f2fyLcR/4RWTmOu', 'ผู้ดูแลระบบสาธิต', 'admin', 'active')
ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), display_name = VALUES(display_name), role = VALUES(role), status = 'active';

INSERT INTO admin_permissions (user_id, manage_users, review_trainers, manage_bookings, review_payments)
VALUES (5, 1, 1, 1, 1)
ON DUPLICATE KEY UPDATE manage_users = 1, review_trainers = 1, manage_bookings = 1, review_payments = 1;

INSERT INTO member_profiles (user_id, goals) VALUES (1, 'ข้อมูลสาธิตสำหรับตรวจขั้นตอนจอง')
ON DUPLICATE KEY UPDATE goals = VALUES(goals);

INSERT INTO trainer_profiles
  (id, user_id, slug, legal_name, phone, headline, bio, years_experience, service_mode, gym_name, price_from, image_path, approval_status, reviewed_by_user_id, reviewed_at, is_demo)
VALUES
  (1, 2, 'demo-trainer-a', 'เทรนเนอร์สาธิต ก.', '0000000000', 'วางรากฐานความแข็งแรงอย่างเป็นระบบ', 'โปรไฟล์สาธิตสำหรับทดสอบระบบ FitConnect', 6, 'both', 'สถานที่ฝึกสาธิต', 650, '/demo/trainer-a.png', 'approved', 5, UTC_TIMESTAMP(), 1),
  (2, 3, 'demo-trainer-b', 'เทรนเนอร์สาธิต ข.', '0000000000', 'ขยับดีขึ้นก่อนเพิ่มความหนัก', 'โปรไฟล์สาธิตสำหรับทดสอบระบบ FitConnect', 4, 'freelance', NULL, 550, '/demo/trainer-b.png', 'approved', 5, UTC_TIMESTAMP(), 1),
  (3, 4, 'demo-trainer-c', 'เทรนเนอร์สาธิต ค.', '0000000000', 'แผนวิ่งและความฟิตที่เข้ากับชีวิตจริง', 'โปรไฟล์สาธิตสำหรับทดสอบคิวอนุมัติ', 5, 'freelance', NULL, NULL, '/demo/trainer-c.png', 'pending', NULL, NULL, 1)
ON DUPLICATE KEY UPDATE headline = VALUES(headline), bio = VALUES(bio), approval_status = VALUES(approval_status), is_demo = 1;

INSERT IGNORE INTO trainer_training_types (trainer_profile_id, training_type_id) VALUES
  (1, 1), (1, 4), (2, 3), (2, 6), (3, 2), (3, 5);

INSERT INTO trainer_certificates (id, trainer_profile_id, name, issuer, issued_year, file_path, status, reviewed_by_user_id, reviewed_at) VALUES
  (1, 1, 'ใบรับรองผู้ฝึกสอนส่วนบุคคล (ข้อมูลสาธิต)', 'หน่วยงานสาธิต', 2024, 'demo/not-a-real-certificate.pdf', 'verified', 5, UTC_TIMESTAMP()),
  (2, 1, 'การปฐมพยาบาลเบื้องต้น (ข้อมูลสาธิต)', 'หน่วยงานสาธิต', 2025, 'demo/not-a-real-certificate.pdf', 'verified', 5, UTC_TIMESTAMP()),
  (3, 2, 'การเคลื่อนไหวเชิงแก้ไข (ข้อมูลสาธิต)', 'หน่วยงานสาธิต', 2023, 'demo/not-a-real-certificate.pdf', 'verified', 5, UTC_TIMESTAMP()),
  (4, 3, 'ผู้ฝึกสอนการวิ่ง (ข้อมูลสาธิต)', 'หน่วยงานสาธิต', 2025, 'demo/not-a-real-certificate.pdf', 'pending', NULL, NULL)
ON DUPLICATE KEY UPDATE name = VALUES(name), issuer = VALUES(issuer), status = VALUES(status);

INSERT INTO availability_slots (id, trainer_profile_id, starts_at, ends_at, state) VALUES
  (101, 1, '2026-08-03 02:00:00', '2026-08-03 03:00:00', 'available'),
  (102, 1, '2026-08-03 10:00:00', '2026-08-03 11:00:00', 'available'),
  (103, 1, '2026-08-04 11:00:00', '2026-08-04 12:00:00', 'available'),
  (104, 1, '2026-08-05 03:00:00', '2026-08-05 04:00:00', 'available'),
  (201, 2, '2026-08-03 00:00:00', '2026-08-03 01:00:00', 'available'),
  (202, 2, '2026-08-04 09:00:00', '2026-08-04 10:00:00', 'available'),
  (203, 2, '2026-08-05 01:00:00', '2026-08-05 02:00:00', 'available'),
  (204, 2, '2026-08-06 10:00:00', '2026-08-06 11:00:00', 'available'),
  (301, 3, '2026-08-04 23:00:00', '2026-08-05 00:00:00', 'available')
ON DUPLICATE KEY UPDATE state = VALUES(state);

INSERT INTO bookings
  (id, public_id, member_user_id, trainer_profile_id, availability_slot_id, starts_at, ends_at, member_note, quoted_price, status, payment_status, payment_deadline_at, cancellation_reason, is_demo)
VALUES
  (1, 'BK-DEMO-001', 1, 1, 102, '2026-08-03 10:00:00', '2026-08-03 11:00:00', 'ข้อมูลสาธิต', 650, 'expired', 'not_submitted', '2026-08-03 10:10:00', 'หมดเวลาส่งหลักฐานการชำระเงิน', 1)
ON DUPLICATE KEY UPDATE quoted_price = VALUES(quoted_price), status = VALUES(status), payment_status = VALUES(payment_status), payment_deadline_at = VALUES(payment_deadline_at), cancellation_reason = VALUES(cancellation_reason), is_demo = 1;

INSERT IGNORE INTO booking_status_history (id, booking_id, from_status, to_status, changed_by_user_id, note)
VALUES (1, 1, NULL, 'awaiting_payment', 1, 'ข้อมูลสาธิต'), (2, 1, 'awaiting_payment', 'expired', NULL, 'หมดเวลาส่งหลักฐานการชำระเงิน');

INSERT IGNORE INTO chat_rooms (id, booking_id) VALUES (1, 1);
INSERT IGNORE INTO messages (id, chat_room_id, sender_user_id, message_text)
VALUES (1, 1, 2, 'ข้อความนี้เป็นข้อมูลสาธิตสำหรับตรวจรูปแบบห้องสนทนา');
