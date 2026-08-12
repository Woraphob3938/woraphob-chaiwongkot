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
4. เปิด `http://localhost/fitconnect-api/v1/health`

สคริปต์ตรวจสอบตำแหน่งทั้งหมดก่อนทำงานและจะไม่เขียนทับ `C:\xampp\htdocs\fitconnect-api` หากมีของเดิมอยู่แล้ว

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

ผลรอบล่าสุดอยู่ใน `output/smoke/instant-booking-result.json` และตรวจข้อมูลใน phpMyAdmin/MySQL ต่อได้ด้วย:

```powershell
rtk powershell -NoProfile -Command "$result = Get-Content 'output/smoke/instant-booking-result.json' | ConvertFrom-Json; & 'scripts/audit-booking.ps1' -BookingId $result.approvedBookingId; & 'scripts/audit-booking.ps1' -BookingId $result.expiredBookingId"
```

ผู้ดูแลระบบยังตรวจสลิปด้วยตนเอง ระบบไม่ได้อนุมัติการชำระเงินอัตโนมัติ สคริปต์เหล่านี้เพิ่มข้อมูลทดสอบในฐานข้อมูลสำหรับพัฒนาและเก็บไว้เพื่อให้ตรวจย้อนหลังได้

ข้อมูลเทรนเนอร์ ราคา ใบรับรอง ตารางเวลา และข้อความที่มากับโครงการเป็นข้อมูลสาธิตทั้งหมด รูปบุคคลใน `public/demo` สร้างด้วย AI และระบุไว้บนหน้าเว็บแล้ว
