# FitConnect verification log

บันทึกหลักฐานการตรวจที่ย้ายมาจาก `DESIGN.md` เพื่อไม่ให้เอกสารระบบออกแบบเก็บข้อมูลที่เก่าลงตามเวลา รายการด้านล่างเป็นภาพ ณ วันที่บันทึก ไม่ใช่สัญญาของระบบปัจจุบัน

- ฐานข้อมูล XAMPP ถูกสำรองที่ `C:\xampp\fitconnect-backups\fitconnect-instant-booking-20260811-001948.sql` ก่อนเปิด contract `payment_deadline_at`, `expired` และดัชนี deadline; migration ปฏิเสธ partial state และรันซ้ำได้โดยไม่ทำ DDL
- หลักฐาน live ล่าสุด: approved flow `BK-762ED5ED` เชื่อมการจอง การชำระ แชต และรีวิวครบ; expired flow `BK-2BB85E7E` คืน slot ก่อนสมาชิกอีกคนจองเป็น `BK-FDF7B5D2` และยกเลิกก่อนส่งสลิปจน slot กลับเป็น `available`
- Browser matrix วันที่ 2026-08-11 ผ่าน 7 เส้นทาง × 5 ขนาดที่ 1280/768/414/375/320 โดยไม่มี horizontal overflow; mobile Sheet และ Dialog เปิด-ปิดด้วยคีย์บอร์ดและคืนโฟกัสได้, 200% zoom ยังเข้าถึง CTA และ reduced motion ใช้งานได้ตาม contract
- การจองจริง `BK-AB150410` แสดงตัวนับเวลาชำระบนหน้าสมาชิก โดยตัวเลขไม่ใช้ `aria-live` จึงไม่ประกาศซ้ำทุกวินาที
