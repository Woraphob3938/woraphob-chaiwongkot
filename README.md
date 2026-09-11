# FitConnect

เว็บภาษาไทยสำหรับค้นหา ตรวจคุณสมบัติ ดูตาราง และจองเทรนเนอร์ส่วนบุคคล โดยไม่ผูกขั้นตอนค้นหาและจองกับจังหวัดหรือสถานที่นัดฝึก

## ส่วนประกอบ

- Next.js + TypeScript + Tailwind CSS สำหรับหน้าเว็บ
- PHP REST API แบบ PDO
- MySQL บน XAMPP
- หน้าสมาชิก เทรนเนอร์ และผู้ดูแลระบบ
- session ฝั่งเซิร์ฟเวอร์อายุ 30 วันและเพิกถอน token เมื่อออกจากระบบ
- ขั้นตอนค้นหา → ตรวจคุณสมบัติ → เลือกเวลา → ล็อกเวลา 10 นาที → อัปโหลดสลิป → ผู้ดูแลระบบตรวจ → สนทนา/รีวิว

## เปิดหน้าเว็บ

```powershell
npm install
npm run dev
```

เปิด `http://localhost:3000` หาก PHP API ยังไม่พร้อม หน้าค้นหาจะใช้ข้อมูลสาธิตที่ระบุชัดเจนและแบบฟอร์มจะรายงานว่าเชื่อมต่อบริการไม่สำเร็จแทนการแสดงผลสำเร็จปลอม

## เชื่อม XAMPP

ต้องมี XAMPP แบบเต็มที่ประกอบด้วย Control Panel, Apache, PHP, MySQL และ `htdocs`:

1. เปิด Apache และ MySQL ใน XAMPP Control Panel
2. คัดลอก `backend/.env.example` เป็น `backend/.env` หากต้องเปลี่ยนค่าฐานข้อมูล
3. รัน `npm run xampp:connect`
4. หากเป็นฐานข้อมูลเดิม รัน `npm run migrate:admin-permissions` และ `npm run migrate:monthly-bookings` คำสั่งแรกให้สิทธิ์ผู้ดูแลระบบเดิมที่ยังไม่มีรายการสิทธิ์ครบทั้ง 4 ด้าน จึงต้องเข้าเมนู **ผู้ดูแลระบบ** เพื่อตรวจและลดสิทธิ์ให้เหลือเท่าที่จำเป็น
5. เปิด `http://localhost/fitconnect-api/v1/health`

สคริปต์ตรวจสอบตำแหน่งทั้งหมดก่อนทำงานและจะไม่เขียนทับ `C:\xampp\htdocs\fitconnect-api` หากมีของเดิมอยู่แล้ว

### เปิดการแจ้งเตือนผ่าน Gmail

ศูนย์แจ้งเตือนในเว็บใช้ได้โดยไม่ต้องเปิด Gmail ก่อน หากต้องการส่งอีเมล ให้เปิดการยืนยันแบบ 2 ขั้นตอนในบัญชี Google แล้วสร้าง **App Password** สำหรับ FitConnect จากนั้นใส่ค่าใน `backend/.env`:

```env
MAIL_ENABLED=false
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USERNAME=your-account@gmail.com
MAIL_APP_PASSWORD=your-16-character-app-password
MAIL_FROM_EMAIL=your-account@gmail.com
MAIL_FROM_NAME=FitConnect
APP_URL=http://localhost:3000
```

เตรียมตารางและติดตั้งงานแจ้งเตือนที่ทำงานทุกหนึ่งนาที:

```powershell
npm run migrate:notifications
npm run notifications:install
```

งานนี้แยกจาก `FitConnect-ExpireBookings` ซึ่งยังมีหน้าที่คืนช่วงเวลาของการจองที่หมดอายุ เมื่อพร้อมส่งจริงค่อยเปลี่ยน `MAIL_ENABLED=true` แล้วทดสอบไปยังอีเมลที่คุณควบคุมเองด้วยคำสั่งที่ต้องยืนยันชัดเจน:

```powershell
npm run notifications:send-test -- -RecipientEmail you@example.com -ConfirmSend SEND
```

ระบบส่งซ้ำได้ไม่เกิน 5 ครั้ง ความล้มเหลวของ Gmail จะไม่ย้อนสถานะการจองหรือการชำระเงิน ตรวจรายการที่ส่งไม่สำเร็จได้ในตาราง `notifications` โดยดู `email_status`, `email_attempt_count`, `email_next_attempt_at` และ `email_last_error` โดยไม่ต้องเปิดเผย App Password

### เตรียมข้อมูลโปรไฟล์

เปิด Apache และ MySQL ก่อน จากนั้นรัน migration หนึ่งครั้ง สคริปต์จะสำรองฐานข้อมูลไว้สำหรับกู้คืนก่อนแก้โครงสร้างตาราง:

```powershell
npm run migrate:member-profile
```

ตรวจการแก้โปรไฟล์ อัปโหลดรูป เปลี่ยนรหัสผ่าน และข้อมูลที่บันทึกจริงใน MySQL:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/api-profile-smoke.ps1 -Scenario all
```

ก่อนใช้ระบบจองแบบล็อกเวลา 10 นาที ให้ตรวจและอัปเกรดฐานข้อมูล คำสั่ง migration จะสร้างไฟล์สำรองไว้นอก repository ที่ `C:\xampp\fitconnect-backups` ก่อนแก้ schema:

```powershell
rtk powershell -NoProfile -ExecutionPolicy Bypass -File scripts/migrate-instant-booking.ps1 -PreflightOnly
npm run migrate:instant-booking
```

## บัญชีสาธิต

บัญชีทั้งหมดใช้รหัสผ่าน `password` และมีไว้สำหรับทดสอบบนเครื่องเท่านั้น:

- สมาชิก: `member.demo@fitconnect.local`
- เทรนเนอร์: `trainer.a@fitconnect.local`
- ผู้ดูแลระบบ: `admin.demo@fitconnect.local`

## ตรวจคุณภาพ

```powershell
npm run check
```

ตรวจขั้นตอนสมาชิกจองทันที → ส่งสลิป → ผู้ดูแลระบบให้แก้หนึ่งครั้ง → อนุมัติ รวมถึงกรณีหมดเวลา คืนช่อง และสมาชิกอีกคนจองต่อกับฐานข้อมูล XAMPP ในเครื่อง:

```powershell
npm run smoke:postbooking
```

ตรวจวงจรบัญชี การระงับและเปิดใช้ ขอบเขตสิทธิ์ และการซ่อนข้อมูลนอกสิทธิ์ของผู้ดูแลระบบกับฐานข้อมูลจริง สคริปต์อ่านค่าฐานข้อมูลจาก `backend/.env` โดยอัตโนมัติ:

```powershell
npm run smoke:admin-operations
```

ตรวจเหตุการณ์แจ้งเตือน การแบ่งหน้า สิทธิ์เจ้าของ การอ่านแล้ว การเตือนก่อนนัด และการยกเลิกกับ MySQL ของ XAMPP โดยบังคับปิดการส่งอีเมลจริงและล้างข้อมูลทดสอบเมื่อจบ:

```powershell
npm run smoke:notifications
```

ตรวจแพ็กเกจ 30 วันแบบหนึ่งการจองและหนึ่งเส้นตายชำระเงิน รวมถึงการคืนทุกช่วงเวลาเมื่อสมาชิกยกเลิกหรือหมดเวลา:

```powershell
npm run smoke:monthly-booking
```

ผลรอบล่าสุดอยู่ใน `output/smoke/instant-booking-result.json` และตรวจข้อมูลใน phpMyAdmin/MySQL ต่อได้ด้วย:

```powershell
rtk powershell -NoProfile -Command "$result = Get-Content 'output/smoke/instant-booking-result.json' | ConvertFrom-Json; & 'scripts/audit-booking.ps1' -BookingId $result.approvedBookingId; & 'scripts/audit-booking.ps1' -BookingId $result.expiredBookingId"
```

การตรวจสลิป: ฟรีแลนซ์ตรวจสลิปของตนเอง ส่วนเทรนเนอร์ประจำยิมให้ผู้ดูแลระบบที่มีสิทธิ์ตรวจการชำระเงินตรวจ ระบบรองรับยิมเดียวและไม่อนุมัติเงินอัตโนมัติ

เรียก `npm run migrate:payment-routing` หลังเปิด MySQL โดยสคริปต์สำรองข้อมูลใน `C:/xampp/fitconnect-backups` ก่อนเปลี่ยนโครงสร้าง จากนั้นเปิดหน้าผู้ดูแลระบบ → บัญชีผู้ดูแลระบบ → กำหนดผู้ตรวจสลิปของการจองเดิม เพื่อระบุรูปแบบบริการของรายการเก่าที่ยังไม่ชัดเจน

ตรวจสิทธิ์ด้วย `npm run test:payment-routing` ใช้ตารางชั่วคราวใน MySQL ไม่แก้ข้อมูลจริงและไม่ส่งอีเมล สคริปต์ smoke เดิมที่ให้ผู้ดูแลระบบตรวจสลิปฟรีแลนซ์ไม่ตรงกับกติกาใหม่นี้

ข้อมูลเทรนเนอร์ ราคา ใบรับรอง ตารางเวลา และข้อความที่มากับโครงการเป็นข้อมูลสาธิตทั้งหมด รูปบุคคลใน `public/demo` สร้างด้วย AI และระบุไว้บนหน้าเว็บแล้ว
