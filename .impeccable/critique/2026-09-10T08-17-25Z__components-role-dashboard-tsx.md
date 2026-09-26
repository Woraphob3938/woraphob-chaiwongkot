---
target: หน้า UX/UI การจองของสมาชิก
total_score: 28
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:C:\\Users\\HP\\Documents\\Fitconnect\\components\\role-dashboard.tsx"
target_fingerprint: "sha256:9957ce94bacdc3496b3bab71a3a97dc0ede132ae9cddc6f0439a611b6a228225"
target_path: "C:\\Users\\HP\\Documents\\Fitconnect\\components\\role-dashboard.tsx"
timestamp: 2026-09-10T08-17-25Z
slug: components-role-dashboard-tsx
---
Method: dual-agent (A: /root/booking_ui_design_review · B: /root/booking_ui_detector)

## สรุป

หน้าการจองมีโครงสร้างเริ่มต้นดีและไม่ต้องออกแบบใหม่ คะแนน 28/40 จุดแข็งคือแสดงสิ่งที่ต้องทำต่อก่อน ใช้ตัวกรองสถานะ และพับรายละเอียดแต่ละรายการได้ แต่เมื่อมีประวัติ 100 รายการหรือเปิดรายละเอียด หน้าเริ่มยาวและเสียลำดับความสำคัญ

## Heuristic review

| หลัก UX | คะแนน | สิ่งที่พบ |
|---|---:|---|
| เห็นสถานะระบบ | 3/4 | มี badge, loading และ error ชัด แต่การ์ดด้านบนขาดบริบทนัด |
| ภาษาตรงกับผู้ใช้ | 3/4 | ภาษาไทยดี แต่ “รอตรวจ/เปิด” กำกวม |
| ควบคุมและย้อนกลับ | 3/4 | กรองและพับได้ แต่เปิดหลายรายการพร้อมกันได้ |
| ความสม่ำเสมอ | 3/4 | โครงสร้างดี แต่ชื่อสถานะเดียวกันใช้หลายคำ |
| ป้องกันความผิดพลาด | 3/4 | ยกเลิกมี dialog และฟอร์มรีวิวตรวจข้อมูล |
| ลดการจำ | 3/4 | ต้องจำว่ารหัสคำขอด้านบนตรงกับนัดใด |
| ความรวดเร็ว | 2/4 | “ดูทั้งหมด” เปิดอีก 97 รายการพร้อมกัน |
| ความเรียบง่าย | 2/4 | รายการย่อสะอาด แต่รายละเอียดและฟอร์มเป็นแผ่นยาว |
| การกู้คืน | 3/4 | มีข้อความผิดพลาดและลองใหม่ใกล้จุดเกิด |
| คำอธิบาย | 3/4 | ขั้นตอนถัดไปชัด แต่ชื่อสถานะบางตัวสั้นเกินไป |
| รวม | 28/40 | Good |

## Design specificity

หน้าใช้สีเขียวเข้ม–เขียวมะนาว เส้นแบ่งแบบ ledger และเน้นสถานะ นัดหมาย และการชำระ จึงมีบุคลิก FitConnect ชัด จุดที่ลดความเฉพาะคือ next-action card แสดงเพียงรหัสคำขอแทนข้อเท็จจริงของการฝึก

## Cognitive load

มุมมองเริ่มต้นมีภาระต่ำถึงปานกลางเพราะแสดง next action, ตัวกรอง และรายการย่อ 3 รายการ แต่หลังเปิดรายละเอียดจะสูงขึ้นจากข้อเท็จจริงการชำระ ฟอร์มรีวิว ลิงก์รอง และการเปิดหลาย disclosure พร้อมกัน รวมถึงการเปิด archive อีก 97 รายการในครั้งเดียว

## Priority issues

1. **P1 — “ดูทั้งหมด” เปิดอีก 97 รายการในครั้งเดียว:** เปลี่ยนเป็นแสดงเพิ่มครั้งละ 10 หรือ pagination พร้อมข้อความช่วงรายการ
2. **P1 — การ์ด next action ขาดชื่อเทรนเนอร์และวันนัด:** แสดงชื่อและวันเวลาเป็นข้อมูลหลัก แล้วลดรหัสคำขอเป็น metadata
3. **P1 — รายละเอียดและฟอร์มรีวิวต่อกันยาวเกินไป:** ทำสรุปให้กะทัดรัด เปิดรายละเอียดทีละรายการ และแสดงฟอร์มเมื่อกดเขียนรีวิว
4. **P2 — “เปิด/รีวิว” ไม่สื่อว่าทั้งแถวขยายได้:** ใช้ “ดูรายละเอียด” พร้อม chevron และแยก badge รอรีวิว
5. **P2 — แบบเลือกคะแนนและปุ่มส่งรีวิวกระจายเกินไป:** จำกัดความกว้าง จัดคะแนนชิดซ้าย และวางปุ่มส่งต่อจากช่องความคิดเห็น

## Persona red flags

- **ผู้ใช้ใหม่:** “รอตรวจ” ไม่บอกว่าตรวจอะไร การ์ดบนสุดมีแต่รหัส และ “เปิด” ไม่สื่อว่าเปิดรายละเอียด
- **ผู้ใช้ที่มีประวัติมาก:** การเปิดอีก 97 รายการทำให้ค้นหายากและหน้ากลับมายาว
- **ผู้ใช้คีย์บอร์ด/มือถือ:** semantic โดยรวมดี แต่ลิงก์เปิดแชตและดูโปรไฟล์บนมือถือสูงประมาณ 25px ต่ำกว่าเป้าหมาย 44px

## Minor observations

- เปลี่ยน “รอตรวจ” เป็น “รอตรวจการชำระ” และ “นัดยืนยัน” เป็น “ยืนยันนัดแล้ว”
- เพิ่มจำนวนรายการในแต่ละตัวกรอง
- ใช้ชื่อสถานะรายการยืนยันแล้วให้สม่ำเสมอ
- หากคง role=tab ควรมี tabpanel/aria-controls; ปุ่มตัวกรองธรรมดาจะง่ายกว่า
- เดสก์ท็อป, 768px, 375px และ 320px ไม่มี horizontal overflow และไม่พบ console error/warning

## Questions to consider

1. ประวัติจำนวนมากควรใช้แสดงเพิ่มครั้งละ 10, แบ่งหน้า หรือค้นหาพร้อมแบ่งหน้า?
2. รายละเอียดควรเปิดทีละรายการ เปิดหลายรายการ หรือใช้ popup?
3. ฟอร์มรีวิวควรแสดงในรายละเอียด กดแล้วค่อยแสดง หรือใช้ popup?

## Status after b4f1b5b

- **P1 “ดูทั้งหมด” resolved.** `role-dashboard.tsx` paginates the ledger at ten with a range label and pager, so the archive no longer opens every remaining request at once.
- **P1 next-action facts resolved.** The card leads with the trainer name and appointment from `getMemberNextAction`; the request id is secondary.
- **P1 long detail resolved.** Each request opens a centred dialog holding the payment facts, countdown, scheduler and review disclosure, so the page no longer stacks forms.
- **P2 status wording resolved.** `lib/payment-copy.ts` is now the single label table, which settles the “รอตรวจ/รอตรวจการชำระ” and “นัดยืนยัน/ยืนยันนัดแล้ว” splits across surfaces.
- The tab-filter note stands: the filter row is a plain button group without `role="tab"`, which is the simpler option the review suggested.
