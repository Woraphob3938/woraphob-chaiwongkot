# FitConnect PHP API

PHP REST API แบบไม่พึ่ง Composer สำหรับ Apache + MySQL ใน XAMPP โค้ดชุดนี้ใช้ PDO, prepared statements, opaque bearer tokens และตรวจ MIME/ขนาดไฟล์ก่อนบันทึก

## ติดตั้งกับ XAMPP

1. คัดลอก `.env.example` เป็น `.env` และแก้รหัสผ่านฐานข้อมูลถ้ามี
2. เปิด Apache และ MySQL ใน XAMPP Control Panel
3. จากโฟลเดอร์โปรเจกต์ รัน `npm run xampp:connect`
4. หากใช้ฐานข้อมูลเดิม รัน `npm run migrate:admin-permissions` หนึ่งครั้ง คำสั่งนี้ให้สิทธิ์ครบทั้ง 4 ด้านแก่ผู้ดูแลระบบเดิมที่ยังไม่มีรายการสิทธิ์ จากนั้นตรวจและลดสิทธิ์ของแต่ละบัญชีผ่านหน้า **ผู้ดูแลระบบ** ให้เหลือเท่าที่จำเป็น
5. รัน `npm run booking-expiry:install` หนึ่งครั้ง เพื่อตรวจการจองที่หมดเวลาทุกหนึ่งนาที
6. ตรวจ `http://localhost/fitconnect-api/v1/health`

สคริปต์เชื่อมต่อจะสร้าง junction จาก `C:\xampp\htdocs\fitconnect-api` มาที่โฟลเดอร์นี้โดยไม่คัดลอกหรือเขียนทับโฟลเดอร์เดิม จากนั้นนำเข้า `database/schema.sql` และ `database/seed.sql`

Windows Task Scheduler จะเก็บงานชื่อ `FitConnect-ExpireBookings` ไว้ งานนี้เรียกคำสั่ง PHP ทุกหนึ่งนาทีเพื่อเปลี่ยนการจองที่เกินกำหนด 10 นาทีเป็น `expired` และคืนช่วงเวลาให้สมาชิกคนอื่นจองได้ งานยังทำต่อเมื่อเครื่องใช้แบตเตอรี่ หากย้ายโฟลเดอร์โปรเจกต์ ให้รันคำสั่งติดตั้งอีกครั้ง คุณสามารถตรวจคำสั่งด้วยตัวเองโดยรัน `npm run booking-expiry:run`

## เส้นทางหลัก

- `GET /v1/health`
- `GET /v1/training-types`
- `GET /v1/trainers`
- `GET /v1/trainers/{slug}`
- `POST /v1/auth/register`
- `POST /v1/auth/login`
- `GET /v1/me`
- `GET|PATCH /v1/profile` — อ่านและแก้ไขข้อมูลโปรไฟล์ตามบทบาท
- `POST|DELETE /v1/profile/image` — อัปโหลดหรือเอารูปโปรไฟล์ออก
- `PATCH /v1/profile/password` — เปลี่ยนรหัสผ่านของบัญชีที่เข้าสู่ระบบ
- `POST /v1/auth/logout` — เพิกถอน token ปัจจุบันก่อนออกจากระบบในเบราว์เซอร์
- `POST /v1/trainer-applications`
- `GET /v1/trainer/me`
- `POST /v1/availability-slots`
- `DELETE /v1/availability-slots/{id}`
- `GET|POST /v1/bookings`
- `POST /v1/bookings/{publicId}/cancel` — สมาชิกยกเลิกคำขอที่ยังไม่ส่งสลิป ระบบคืนช่วงเวลาให้จองต่อทันที
- `PATCH /v1/bookings/{publicId}/status` — เทรนเนอร์บันทึกว่าฝึกเสร็จแล้ว หรือผู้ดูแลระบบยืนยันและยกเลิกตามสิทธิ์
- `POST /v1/payments` — สมาชิกส่งหลักฐานการชำระเงินแบบ multipart
- `GET|POST /v1/chat-rooms/{id}/messages` — อ่านและส่งข้อความหรือไฟล์แนบในห้องของการจอง
- `GET /v1/chat-rooms/{id}/messages/{messageId}/attachment` — ดาวน์โหลดไฟล์แนบสำหรับคู่สนทนาเท่านั้น
- `POST /v1/reviews` — สมาชิกเจ้าของการจองเผยแพร่รีวิวหลังจบการฝึก
- `POST /v1/admin/trainers/{id}/approve`
- `POST /v1/admin/trainers/{id}/reject`
- `GET /v1/admin/review-queue` — คิวหลักฐานที่รอผู้ดูแลระบบตรวจ
- `GET /v1/admin/files/{payment|certificate}/{id}` — เปิดหลักฐานที่มีสิทธิ์ดู
- `POST /v1/admin/payments/{id}/{approve|reject}` — ผู้ดูแลระบบอนุมัติหรือปฏิเสธพร้อมเหตุผล
- `GET /v1/admin/operations` — บัญชี การจอง ประวัติสถานะ รายได้ และธุรกรรมตามสิทธิ์ของบัญชี แบ่งหน้าฝั่ง API ครั้งละ 10 รายการด้วย `userPage`, `administratorPage`, `bookingPage`, `incomePage`, `paymentPage` และกรองด้วย `userQuery`, `bookingStatus`
- `POST /v1/admin/users` — เพิ่มบัญชีผู้ดูแลระบบพร้อมกำหนดสิทธิ์
- `PATCH /v1/admin/users/{id}` — แก้ข้อมูล ระงับหรือเปิดบัญชี และปรับสิทธิ์ผู้ดูแลระบบ

เส้นทางที่เกี่ยวกับบัญชีต้องใส่ `Authorization: Bearer <token>` และเส้นทางผู้ดูแลระบบยังตรวจสิทธิ์ย่อยดังนี้:

- `manageUsers` — ดู/แก้/ระงับบัญชี และเพิ่มหรือกำหนดสิทธิ์ผู้ดูแลระบบ
- `reviewTrainers` — ตรวจโปรไฟล์ ใบรับรอง และตัดสินผลเทรนเนอร์
- `manageBookings` — ดูการจองทั้งหมด ประวัติสถานะ และจัดการสถานะการจอง
- `reviewPayments` — ตรวจสลิป ตัดสินการชำระเงิน ดูธุรกรรมและรายได้ที่อนุมัติแล้ว

`GET /v1/admin/operations` ส่งเฉพาะส่วนที่บัญชีนั้นมีสิทธิ์ดู การมี token บทบาทผู้ดูแลระบบเพียงอย่างเดียวจึงไม่พอสำหรับทุกเส้นทาง การตรวจใบรับรองและสลิปเป็นการตรวจโดยผู้ดูแลระบบจริง ไม่ใช่การตรวจอัตโนมัติหรือระบบชำระเงินอัตโนมัติ เมื่อปฏิเสธ ผู้ดูแลระบบต้องระบุเหตุผลให้สมาชิกแก้ไขและส่งหลักฐานใหม่

ผู้ดูแลระบบแจกได้เฉพาะสิทธิ์ที่บัญชีตนเองมีอยู่ และเปลี่ยนรหัสผ่านเริ่มต้นของตนเองได้จากหน้า **ผู้ดูแลระบบ** ระบบจะกันไม่ให้ระงับหรือลบสิทธิ์จัดการบัญชีของผู้ดูแลคนสุดท้าย

## ตรวจขั้นตอนหลักในเครื่อง

หลังเปิด Apache และ MySQL แล้ว รันจากโฟลเดอร์โปรเจกต์:

```powershell
rtk powershell -NoProfile -ExecutionPolicy Bypass -File scripts/api-workflow-smoke.ps1 -Scenario all
```

การทดสอบครอบคลุมการอนุมัติเทรนเนอร์ การสร้างและลบช่วงเวลาว่าง การจองพร้อมกัน การตรวจชำระเงิน และการปฏิเสธ สคริปต์เปลี่ยนแปลงเฉพาะฐานข้อมูลสำหรับพัฒนาในเครื่อง และ `npm run xampp:connect` จะคืนสถานะข้อมูลตั้งต้นก่อนเริ่มรอบสะอาดอีกครั้ง

ตรวจงานผู้ดูแลระบบทั้งการแก้บัญชี ระงับและเปิดใช้ การสร้างผู้ดูแลระบบ ขอบเขตสิทธิ์ และการซ่อนข้อมูลนอกสิทธิ์ด้วย สคริปต์อ่านค่าฐานข้อมูลจาก `backend/.env` โดยอัตโนมัติและลบบัญชีทดสอบเมื่อเสร็จ:

```powershell
npm run smoke:admin-operations
```

## ย้ายฐานข้อมูลเดิมเพื่อลบจังหวัดและสถานที่นัดฝึก

ฐานข้อมูลที่สร้างจาก schema รุ่นใหม่ไม่ต้องทำขั้นตอนนี้ สำหรับฐานข้อมูล XAMPP เดิม ให้เปิด MySQL แล้วรัน:

```powershell
npm run migrate:remove-location-data
```

สคริปต์จะตรวจสภาพ schema ก่อนเสมอ ถ้าพบว่าถูกแก้ไปเพียงบางส่วนจะหยุดทันที ถ้าเป็น schema เดิมจะสำรองฐานข้อมูลเต็มไว้ที่ `C:\xampp\fitconnect-backups` ก่อนลบตาราง/คอลัมน์จังหวัดและ `bookings.location_text` หากต้องการตรวจอย่างเดียวให้รัน `npm run migrate:remove-location-data -- -PreflightOnly` และหากต้องย้อนกลับให้นำเข้าไฟล์ `.sql` ที่สคริปต์แจ้งหลังคำว่า `Recovery backup`.

ตรวจขั้นตอนบัญชีเทรนเนอร์ → กรอกข้อมูลวิชาชีพ → ถูกปฏิเสธ → ส่งใหม่ → อนุมัติ ด้วย:

```powershell
npm run smoke:trainer-onboarding
```

## ตรวจ flow หลังการจองและเปิดดูใน phpMyAdmin

รัน flow เดียวตั้งแต่สร้างการจอง แชต ส่งสลิปสองครั้ง ให้ผู้ดูแลระบบตรวจ จบการฝึก และรีวิว:

```powershell
npm run smoke:postbooking
```

สคริปต์จะพิมพ์ `Smoke booking id: BK-...` และเก็บแถวฐานข้อมูลกับไฟล์อัปโหลดไว้โดยตั้งใจเพื่อให้ตรวจต่อได้ นำรหัสที่พิมพ์มาใช้ตรวจความเชื่อมโยงทั้ง flow:

```powershell
npm run audit:booking -- -BookingId BK-...
```

สำหรับการตรวจด้วยตา เปิด `http://localhost/phpmyadmin` เลือกฐานข้อมูล `fitconnect` แล้วทำตามลำดับนี้:

1. เปิด `bookings` กรอง `public_id` ด้วย `BK-...` แล้วจด `id` ภายในของแถวนี้
2. กรอง `booking_status_history` และ `payments` ด้วย `booking_id` เดียวกัน
3. กรอง `chat_rooms` ด้วย `booking_id` เดียวกัน แล้วจด `id` ของห้อง
4. กรอง `messages` ด้วย `chat_room_id` จากห้องที่ผูกกับ booking เดียวกัน
5. กรอง `reviews` ด้วย `booking_id` เดียวกัน

ผลที่ผ่านต้องมี booking 1 แถว ประวัติอย่างน้อย 7 แถว หลักฐานชำระเงิน 2 แถว ห้องสนทนา 1 แถว ข้อความอย่างน้อย 2 แถว และรีวิว 1 แถว โดยใช้สายอ้างอิงจาก internal booking id เดียวกัน

## บัญชีสาธิต

รหัสผ่านสำหรับบัญชีใน `seed.sql` คือ `password` และใช้ได้เฉพาะเครื่องพัฒนา:

- `member.demo@fitconnect.local`
- `trainer.a@fitconnect.local`
- `admin.demo@fitconnect.local`

อย่านำบัญชี รหัสผ่าน หรือไฟล์สาธิตเหล่านี้ไปใช้บนระบบจริง
