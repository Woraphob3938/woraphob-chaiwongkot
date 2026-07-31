USE fitconnect;
SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO provinces (id, name_th, region) VALUES
  (1, 'กรุงเทพมหานคร', 'กลาง'), (2, 'กระบี่', 'ใต้'), (3, 'กาญจนบุรี', 'ตะวันตก'), (4, 'กาฬสินธุ์', 'ตะวันออกเฉียงเหนือ'),
  (5, 'กำแพงเพชร', 'กลาง'), (6, 'ขอนแก่น', 'ตะวันออกเฉียงเหนือ'), (7, 'จันทบุรี', 'ตะวันออก'), (8, 'ฉะเชิงเทรา', 'ตะวันออก'),
  (9, 'ชลบุรี', 'ตะวันออก'), (10, 'ชัยนาท', 'กลาง'), (11, 'ชัยภูมิ', 'ตะวันออกเฉียงเหนือ'), (12, 'ชุมพร', 'ใต้'),
  (13, 'เชียงราย', 'เหนือ'), (14, 'เชียงใหม่', 'เหนือ'), (15, 'ตรัง', 'ใต้'), (16, 'ตราด', 'ตะวันออก'),
  (17, 'ตาก', 'ตะวันตก'), (18, 'นครนายก', 'กลาง'), (19, 'นครปฐม', 'กลาง'), (20, 'นครพนม', 'ตะวันออกเฉียงเหนือ'),
  (21, 'นครราชสีมา', 'ตะวันออกเฉียงเหนือ'), (22, 'นครศรีธรรมราช', 'ใต้'), (23, 'นครสวรรค์', 'กลาง'), (24, 'นนทบุรี', 'กลาง'),
  (25, 'นราธิวาส', 'ใต้'), (26, 'น่าน', 'เหนือ'), (27, 'บึงกาฬ', 'ตะวันออกเฉียงเหนือ'), (28, 'บุรีรัมย์', 'ตะวันออกเฉียงเหนือ'),
  (29, 'ปทุมธานี', 'กลาง'), (30, 'ประจวบคีรีขันธ์', 'ตะวันตก'), (31, 'ปราจีนบุรี', 'ตะวันออก'), (32, 'ปัตตานี', 'ใต้'),
  (33, 'พระนครศรีอยุธยา', 'กลาง'), (34, 'พังงา', 'ใต้'), (35, 'พัทลุง', 'ใต้'), (36, 'พิจิตร', 'กลาง'),
  (37, 'พิษณุโลก', 'กลาง'), (38, 'เพชรบุรี', 'ตะวันตก'), (39, 'เพชรบูรณ์', 'กลาง'), (40, 'แพร่', 'เหนือ'),
  (41, 'พะเยา', 'เหนือ'), (42, 'ภูเก็ต', 'ใต้'), (43, 'มหาสารคาม', 'ตะวันออกเฉียงเหนือ'), (44, 'มุกดาหาร', 'ตะวันออกเฉียงเหนือ'),
  (45, 'แม่ฮ่องสอน', 'เหนือ'), (46, 'ยโสธร', 'ตะวันออกเฉียงเหนือ'), (47, 'ยะลา', 'ใต้'), (48, 'ร้อยเอ็ด', 'ตะวันออกเฉียงเหนือ'),
  (49, 'ระนอง', 'ใต้'), (50, 'ระยอง', 'ตะวันออก'), (51, 'ราชบุรี', 'ตะวันตก'), (52, 'ลพบุรี', 'กลาง'),
  (53, 'ลำปาง', 'เหนือ'), (54, 'ลำพูน', 'เหนือ'), (55, 'เลย', 'ตะวันออกเฉียงเหนือ'), (56, 'ศรีสะเกษ', 'ตะวันออกเฉียงเหนือ'),
  (57, 'สกลนคร', 'ตะวันออกเฉียงเหนือ'), (58, 'สงขลา', 'ใต้'), (59, 'สตูล', 'ใต้'), (60, 'สมุทรปราการ', 'กลาง'),
  (61, 'สมุทรสงคราม', 'กลาง'), (62, 'สมุทรสาคร', 'กลาง'), (63, 'สระแก้ว', 'ตะวันออก'), (64, 'สระบุรี', 'กลาง'),
  (65, 'สิงห์บุรี', 'กลาง'), (66, 'สุโขทัย', 'กลาง'), (67, 'สุพรรณบุรี', 'กลาง'), (68, 'สุราษฎร์ธานี', 'ใต้'),
  (69, 'สุรินทร์', 'ตะวันออกเฉียงเหนือ'), (70, 'หนองคาย', 'ตะวันออกเฉียงเหนือ'), (71, 'หนองบัวลำภู', 'ตะวันออกเฉียงเหนือ'),
  (72, 'อ่างทอง', 'กลาง'), (73, 'อำนาจเจริญ', 'ตะวันออกเฉียงเหนือ'), (74, 'อุดรธานี', 'ตะวันออกเฉียงเหนือ'),
  (75, 'อุตรดิตถ์', 'เหนือ'), (76, 'อุทัยธานี', 'กลาง'), (77, 'อุบลราชธานี', 'ตะวันออกเฉียงเหนือ')
ON DUPLICATE KEY UPDATE region = VALUES(region), active = 1;

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
  (5, 'admin.demo@fitconnect.local', '$2y$10$UAHptYudXBuQG5HZCuzvLufSI45l0ElKtaw591f2fyLcR/4RWTmOu', 'แอดมินสาธิต', 'admin', 'active')
ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), display_name = VALUES(display_name), role = VALUES(role), status = 'active';

INSERT INTO member_profiles (user_id, home_province_id, goals) VALUES (1, 57, 'ข้อมูลสาธิตสำหรับตรวจขั้นตอนจอง')
ON DUPLICATE KEY UPDATE home_province_id = VALUES(home_province_id), goals = VALUES(goals);

INSERT INTO trainer_profiles
  (id, user_id, slug, legal_name, phone, headline, bio, years_experience, primary_province_id, service_mode, gym_name, price_from, image_path, approval_status, reviewed_by_user_id, reviewed_at, is_demo)
VALUES
  (1, 2, 'demo-trainer-a', 'เทรนเนอร์สาธิต ก.', '0000000000', 'วางรากฐานความแข็งแรงอย่างเป็นระบบ', 'โปรไฟล์สาธิตสำหรับทดสอบระบบ FitConnect', 6, 57, 'both', 'สถานที่ฝึกสาธิต', 650, '/demo/trainer-a.png', 'approved', 5, UTC_TIMESTAMP(), 1),
  (2, 3, 'demo-trainer-b', 'เทรนเนอร์สาธิต ข.', '0000000000', 'ขยับดีขึ้นก่อนเพิ่มความหนัก', 'โปรไฟล์สาธิตสำหรับทดสอบระบบ FitConnect', 4, 57, 'freelance', NULL, 550, '/demo/trainer-b.png', 'approved', 5, UTC_TIMESTAMP(), 1),
  (3, 4, 'demo-trainer-c', 'เทรนเนอร์สาธิต ค.', '0000000000', 'แผนวิ่งและความฟิตที่เข้ากับชีวิตจริง', 'โปรไฟล์สาธิตสำหรับทดสอบคิวอนุมัติ', 5, 20, 'freelance', NULL, NULL, '/demo/trainer-c.png', 'pending', NULL, NULL, 1)
ON DUPLICATE KEY UPDATE headline = VALUES(headline), bio = VALUES(bio), primary_province_id = VALUES(primary_province_id), approval_status = VALUES(approval_status), is_demo = 1;

INSERT IGNORE INTO trainer_service_areas (trainer_profile_id, province_id, area_label) VALUES
  (1, 57, 'อำเภอเมืองสกลนคร'), (2, 57, 'อำเภอเมืองสกลนคร'), (3, 20, 'อำเภอเมืองนครพนม');

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
  (102, 1, '2026-08-03 10:00:00', '2026-08-03 11:00:00', 'held'),
  (103, 1, '2026-08-04 11:00:00', '2026-08-04 12:00:00', 'available'),
  (104, 1, '2026-08-05 03:00:00', '2026-08-05 04:00:00', 'available'),
  (201, 2, '2026-08-03 00:00:00', '2026-08-03 01:00:00', 'available'),
  (202, 2, '2026-08-04 09:00:00', '2026-08-04 10:00:00', 'available'),
  (203, 2, '2026-08-05 01:00:00', '2026-08-05 02:00:00', 'available'),
  (204, 2, '2026-08-06 10:00:00', '2026-08-06 11:00:00', 'available'),
  (301, 3, '2026-08-04 23:00:00', '2026-08-05 00:00:00', 'available')
ON DUPLICATE KEY UPDATE state = VALUES(state);

INSERT INTO bookings
  (id, public_id, member_user_id, trainer_profile_id, availability_slot_id, starts_at, ends_at, location_text, member_note, status, payment_status, is_demo)
VALUES
  (1, 'BK-DEMO-001', 1, 1, 102, '2026-08-03 10:00:00', '2026-08-03 11:00:00', 'สถานที่ฝึกสาธิต · สกลนคร', 'ข้อมูลสาธิต', 'awaiting_payment', 'not_submitted', 1)
ON DUPLICATE KEY UPDATE status = VALUES(status), payment_status = VALUES(payment_status), is_demo = 1;

INSERT IGNORE INTO booking_status_history (id, booking_id, from_status, to_status, changed_by_user_id, note)
VALUES (1, 1, NULL, 'pending_trainer', 1, 'ข้อมูลสาธิต'), (2, 1, 'pending_trainer', 'awaiting_payment', 2, 'เทรนเนอร์สาธิตตอบรับ');

INSERT IGNORE INTO chat_rooms (id, booking_id) VALUES (1, 1);
INSERT IGNORE INTO messages (id, chat_room_id, sender_user_id, message_text)
VALUES (1, 1, 2, 'ข้อความนี้เป็นข้อมูลสาธิตสำหรับตรวจรูปแบบห้องสนทนา');
