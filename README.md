
เว็บภาษาไทยสำหรับค้นหาเทรนเนอร์ส่วนบุคคล ตรวจคุณสมบัติ ดูตารางเวลา จอง และชำระเงิน

## ส่วนประกอบ

- หน้าเว็บ: Next.js + TypeScript + Tailwind CSS (`app/`, `components/`, `lib/`)
- API: PHP แบบ PDO ไม่พึ่ง Composer (`backend/`) รันบน Apache ของ XAMPP
- ฐานข้อมูล: MySQL/MariaDB ของ XAMPP (`backend/database/schema.sql` และ `seed.sql`)
- ชำระเงิน: Stripe Checkout (โหมดทดสอบ)
- ผู้ใช้ 3 บทบาท: สมาชิก เทรนเนอร์ และผู้ดูแลระบบ

ขั้นตอนหลัก: ค้นหา → ดูโปรไฟล์และใบรับรอง → เลือกเวลา → เทรนเนอร์ตอบรับ → ชำระเงินผ่าน Stripe → แชต → ฝึก → รีวิว

## ติดตั้ง

1. เปิด Apache และ MySQL ใน XAMPP Control Panel
2. คัดลอก `backend/.env.example` เป็น `backend/.env` แล้วใส่ `STRIPE_SECRET_KEY` ของโหมดทดสอบ
3. รัน `npm install` แล้ว `npm run xampp:connect` (สร้างฐานข้อมูล `fitconnect` พร้อมข้อมูลสาธิต และเชื่อม `C:\xampp\htdocs\fitconnect-api` มาที่ `backend/`)
4. ตรวจ `http://localhost/fitconnect-api/v1/health`
5. รัน `npm run dev` แล้วเปิด `http://localhost:3000`

ทดสอบจ่ายเงินด้วยบัตร `4242 4242 4242 4242` รายละเอียดของ API, Gmail และงานตามเวลาอยู่ใน `backend/README.md`

## บัญชีสาธิต

ทุกบัญชีใช้รหัสผ่าน `password` และมีไว้ทดสอบบนเครื่องเท่านั้น:

- สมาชิก: `member.demo@fitconnect.local`
- เทรนเนอร์: `trainer.a@fitconnect.local`, `trainer.b@fitconnect.local`, `trainer.c@fitconnect.local`
- ผู้ดูแลระบบ: `admin.demo@fitconnect.local`

ข้อมูลเทรนเนอร์ ราคา ใบรับรอง และตารางเวลาที่มากับโครงการเป็นข้อมูลสาธิตทั้งหมด รูปบุคคลใน `public/demo` สร้างด้วย AI และระบุไว้บนหน้าเว็บแล้ว

## ตรวจคุณภาพ

เปิด Apache และ MySQL ก่อน แล้วรัน:

```powershell
npm run typecheck
npm run lint
npm test
npm run test:php
npm run test:payment-routing
npm run test:e2e
```

เทสต์ PHP ใช้ตารางชั่วคราว ไม่แตะข้อมูลจริงและไม่ส่งอีเมล ส่วน `test:e2e` เป็น Playwright ที่อ่านอย่างเดียวและเข้าสู่ระบบด้วยบัญชีสาธิต
