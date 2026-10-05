# FitConnect PHP API

PHP REST API แบบไม่พึ่ง Composer สำหรับ Apache + MySQL ใน XAMPP ใช้ PDO, prepared statements, bearer token และตรวจ MIME/ขนาดไฟล์ก่อนบันทึก

- เส้นทางทั้งหมดอยู่ใน `index.php` (หนึ่งบรรทัดต่อหนึ่งเส้นทาง)
- ตัวจัดการอยู่ใน `src/handlers/` แยกไฟล์ตามเรื่อง (เทรนเนอร์ บัญชี การจอง การชำระเงิน แชต แอดมิน) รวมเป็นคลาสเดียวใน `src/Handlers.php` กติกาอยู่ใน `src/*Rules.php`, `src/PaymentRouting.php` และ `src/StripePayments.php`
- โครงสร้างฐานข้อมูลอยู่ใน `database/schema.sql` ข้อมูลสาธิตอยู่ใน `database/seed.sql`

## ติดตั้งกับ XAMPP

1. คัดลอก `.env.example` เป็น `.env` แก้รหัสผ่านฐานข้อมูลถ้ามี และใส่ `STRIPE_SECRET_KEY` ของโหมดทดสอบ
2. เปิด Apache และ MySQL ใน XAMPP Control Panel
3. จากโฟลเดอร์โปรเจกต์ รัน `npm run xampp:connect`
4. รัน `npm run booking-expiry:install` หนึ่งครั้ง เพื่อคืนช่วงเวลาของการจองที่หมดเวลาทุกหนึ่งนาที
5. ตรวจ `http://localhost/fitconnect-api/v1/health`

สคริปต์เชื่อมต่อสร้าง junction จาก `C:\xampp\htdocs\fitconnect-api` มาที่โฟลเดอร์นี้โดยไม่เขียนทับของเดิม แล้วนำเข้า `schema.sql` และ `seed.sql`

เส้นทางที่เกี่ยวกับบัญชีต้องใส่ `Authorization: Bearer <token>` เส้นทางผู้ดูแลระบบยังตรวจสิทธิ์ย่อย `manageUsers`, `reviewTrainers`, `manageBookings` และ `reviewPayments`

## การชำระเงิน (Stripe โหมดทดสอบ)

สมาชิกชำระผ่าน Stripe Checkout ด้วยบัตรทดสอบ `4242 4242 4242 4242` เมื่อกลับมาที่ `/member?checkout=success` หน้าเว็บเรียก `POST /v1/payments/confirm` เพื่อบันทึกผล จึงไม่ต้องมี webhook URL สาธารณะบน localhost ใส่ `STRIPE_WEBHOOK_SECRET` เฉพาะเมื่อตั้ง webhook

## งานตามเวลา

- `FitConnect-ExpireBookings` (`npm run booking-expiry:install`): เปลี่ยนการจองที่เกินกำหนดชำระ 10 นาทีเป็น `expired` และคืนช่วงเวลา รันเองได้ด้วย `npm run booking-expiry:run`
- `FitConnect-ProcessNotifications` (`npm run notifications:install`): สร้างการเตือนก่อนนัดและส่งคิวอีเมล

หากย้ายโฟลเดอร์โปรเจกต์ ให้ติดตั้งทั้งสองงานใหม่

## Gmail สำหรับการแจ้งเตือน

การแจ้งเตือนในเว็บใช้ได้โดยไม่ต้องเปิดอีเมล หากต้องการส่งอีเมลจริง ให้สร้าง **App Password** ของ Gmail แล้วใส่ค่า `MAIL_*` ใน `.env` ตามตัวอย่างใน `.env.example` จากนั้นตั้ง `MAIL_ENABLED=true` และทดสอบด้วย:

```powershell
npm run notifications:send-test -- -RecipientEmail you@example.com -ConfirmSend SEND
```

ระบบลองส่งใหม่สูงสุด 5 ครั้ง การส่งล้มเหลวไม่เปลี่ยนผลการจองหรือการชำระเงิน ห้ามคัดลอก `MAIL_APP_PASSWORD` ลง log, ภาพหน้าจอ หรือ Git

## การจำกัดจำนวนครั้งและรหัสผ่าน

endpoint ที่รับรหัสผ่าน การสมัคร และการอัปโหลดไฟล์นับจำนวนครั้งในตาราง `rate_limits` เมื่อเกินเพดานระบบตอบ `429` พร้อม `Retry-After` ค่าเพดานอยู่ใน `RateLimiter::RULES`

รหัสตั้งรหัสผ่านใหม่ 6 หลักมีอายุ 15 นาที ใช้ได้ครั้งเดียว เก็บเฉพาะแฮช และเมื่อตั้งรหัสผ่านใหม่สำเร็จระบบจะเพิกถอน token ทุกตัวของบัญชีนั้น

## ตรวจการจองหนึ่งรายการ

```powershell
npm run audit:booking -- -BookingId BK-...
```

## บัญชีสาธิต

รหัสผ่านของบัญชีใน `seed.sql` คือ `password` ใช้ได้เฉพาะเครื่องพัฒนา รายชื่ออยู่ใน `README.md` ที่โฟลเดอร์หลัก อย่านำไปใช้บนระบบจริง
