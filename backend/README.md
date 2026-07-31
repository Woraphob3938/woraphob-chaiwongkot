# FitConnect PHP API

PHP REST API แบบไม่พึ่ง Composer สำหรับ Apache + MySQL ใน XAMPP โค้ดชุดนี้ใช้ PDO, prepared statements, opaque bearer tokens และตรวจ MIME/ขนาดไฟล์ก่อนบันทึก

## ติดตั้งกับ XAMPP

1. คัดลอก `.env.example` เป็น `.env` และแก้รหัสผ่านฐานข้อมูลถ้ามี
2. เปิด Apache และ MySQL ใน XAMPP Control Panel
3. จากโฟลเดอร์โปรเจกต์ รัน `npm run xampp:connect`
4. ตรวจ `http://localhost/fitconnect-api/v1/health`

สคริปต์เชื่อมต่อจะสร้าง junction จาก `C:\xampp\htdocs\fitconnect-api` มาที่โฟลเดอร์นี้โดยไม่คัดลอกหรือเขียนทับโฟลเดอร์เดิม จากนั้นนำเข้า `database/schema.sql` และ `database/seed.sql`

## เส้นทางหลัก

- `GET /v1/health`
- `GET /v1/provinces`
- `GET /v1/training-types`
- `GET /v1/trainers`
- `GET /v1/trainers/{slug}`
- `POST /v1/auth/register`
- `POST /v1/auth/login`
- `GET /v1/me`
- `POST /v1/trainer-applications`
- `GET /v1/trainer/me`
- `POST /v1/availability-slots`
- `DELETE /v1/availability-slots/{id}`
- `GET|POST /v1/bookings`
- `PATCH /v1/bookings/{publicId}/status`
- `POST /v1/payments`
- `GET|POST /v1/chat-rooms/{id}/messages`
- `POST /v1/reviews`
- `POST /v1/admin/trainers/{id}/approve`
- `POST /v1/admin/trainers/{id}/reject`
- `GET /v1/admin/review-queue`
- `GET /v1/admin/files/{payment|certificate}/{id}`
- `POST /v1/admin/payments/{id}/{approve|reject}`

เส้นทางที่เกี่ยวกับบัญชีต้องใส่ `Authorization: Bearer <token>`. การตรวจใบรับรองและสลิปเป็นขั้นตอนของแอดมิน ไม่ใช่ระบบชำระเงินอัตโนมัติ

## ตรวจขั้นตอนหลักในเครื่อง

หลังเปิด Apache และ MySQL แล้ว รันจากโฟลเดอร์โปรเจกต์:

```powershell
rtk powershell -NoProfile -ExecutionPolicy Bypass -File scripts/api-workflow-smoke.ps1 -Scenario all
```

การทดสอบครอบคลุมการอนุมัติเทรนเนอร์ การสร้าง/ลบช่วงเวลาว่าง การจองพร้อมกัน การตอบรับ และการปฏิเสธ สคริปต์เปลี่ยนแปลงเฉพาะฐานข้อมูลสำหรับพัฒนาในเครื่อง และ `npm run xampp:connect` จะคืนสถานะข้อมูลตั้งต้นก่อนเริ่มรอบสะอาดอีกครั้ง

## บัญชีสาธิต

รหัสผ่านสำหรับบัญชีใน `seed.sql` คือ `password` และใช้ได้เฉพาะเครื่องพัฒนา:

- `member.demo@fitconnect.local`
- `trainer.a@fitconnect.local`
- `admin.demo@fitconnect.local`

อย่านำบัญชี รหัสผ่าน หรือไฟล์สาธิตเหล่านี้ไปใช้บนระบบจริง
